---
name: "background-jobs"
pack: "@Topia/backend"
description: "Queue-based async processing — BullMQ (Node.js), job patterns, retry strategies, idempotency, dead letter queues, monitoring."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# background-jobs

Queue-based async processing — BullMQ (Node.js), job patterns, retry strategies, idempotency, dead letter queues, monitoring.

#### Workflow

**Step 1 — Identify async operations**
Scan route handlers and service functions for operations that: (a) take > 200ms (PDF generation, image resizing, report aggregation), (b) are non-user-facing (email sending, webhook delivery, analytics events), (c) can tolerate eventual consistency (data sync, cache warming, notification dispatch). Flag these as candidates for background jobs. Output a classification: fire-and-forget vs delayed vs scheduled (cron) vs fan-out.

**Step 2 — Choose queue system**
Node.js: BullMQ (Redis-backed, TypeScript-native, built-in retry/delay/priority/rate-limiting — recommended). Python: Celery + Redis/RabbitMQ broker (mature, distributed workers, beat scheduler for cron). For very simple use cases (single server, low volume): `node-cron` + in-process worker. Avoid in-process queues in production — they die with the process and lose jobs.

**Step 3 — Implement job with retry strategy**
Emit job producer (enqueue) and worker (processor) as separate files. Retry strategy: exponential backoff with jitter (`attempts: 5, backoff: { type: 'exponential', delay: 1000 }`). Idempotency: every job MUST have an idempotency key — use a deterministic ID from the operation (e.g., `email:welcome:${userId}` not a random UUID). This ensures duplicate enqueues (from retries, double-clicks) process exactly once. Dead letter queue: after max retries, move job to a `{queue-name}:failed` queue for inspection and manual replay — never silently drop.

**Step 4 — Add monitoring and alerting**
BullMQ Board or Bull Dashboard for visual queue monitoring. Emit metrics: queue depth (jobs waiting), processing rate (jobs/sec), failure rate (failed/total). Alert when: queue depth > threshold (workers not keeping up), failure rate > 5% (systematic error in processor), job age > expected TTL (stuck job). Use BullMQ events (`queue.on('failed', ...)`) to push metrics to Prometheus or Datadog.

**Step 5 — Handle dead letters**
Emit dead letter inspection endpoint: list failed jobs with error reason, retry count, and last error. Emit replay endpoint: re-enqueue a specific failed job with a fresh retry budget. Purge endpoint: clear dead letter queue after investigation. Add alerting on dead letter queue depth > 0 for critical job types (payment processing, compliance logging).

#### Example

```typescript
// BullMQ setup with TypeScript — producer + worker
import { Queue, Worker, Job } from 'bullmq';

const connection = { host: REDIS_HOST, port: 6379 };

// Job type definitions
interface EmailJob { to: string; template: string; data: Record<string, unknown> }
interface PdfJob { reportId: string; userId: string; format: 'pdf' | 'xlsx' }

// Producers
export const emailQueue = new Queue<EmailJob>('email', { connection });
export const pdfQueue = new Queue<PdfJob>('pdf', { connection });

// Enqueue with idempotency key (jobId = idempotent identifier)
export const sendWelcomeEmail = (userId: string, email: string) =>
  emailQueue.add('welcome', { to: email, template: 'welcome', data: { userId } }, {
    jobId: `email:welcome:${userId}`, // prevents duplicate welcome emails
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1000 }, // keep last 1000 completed for audit
    removeOnFail: false, // keep all failed for dead letter review
  });

// Scheduled/delayed job
export const sendReminderEmail = (userId: string, delayMs: number) =>
  emailQueue.add('reminder', { to: userId, template: 'reminder', data: {} }, {
    delay: delayMs,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
  });

// Worker processor with error handling
const emailWorker = new Worker<EmailJob>('email', async (job: Job<EmailJob>) => {
  const { to, template, data } = job.data;
  // Validate job data — serialized payload may be stale
  if (!to || !template) throw new Error(`Invalid job payload: ${JSON.stringify(job.data)}`);
  await emailService.send({ to, template, data });
  // Return value is stored in job.returnvalue for audit
  return { sentAt: new Date().toISOString() };
}, {
  connection,
  concurrency: 10,           // process up to 10 emails in parallel
  limiter: { max: 100, duration: 60_000 }, // rate limit: 100/min
});

emailWorker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, queue: 'email', error: err.message, attempts: job?.attemptsMade });
  if (job?.attemptsMade >= job?.opts.attempts!) {
    // max retries exhausted → alert
    await alerting.notify(`Dead letter: email job ${job.id} failed after ${job.attemptsMade} attempts`);
  }
});

// Fan-out pattern: one job enqueues many children
const fanOutNotification = async (eventId: string, userIds: string[]) => {
  const jobs = userIds.map(userId => ({
    name: 'notify',
    data: { userId, eventId },
    opts: {
      jobId: `notify:${eventId}:${userId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
    },
  }));
  await notificationQueue.addBulk(jobs);
};

// Dead letter inspection API
app.get('/admin/jobs/failed', authenticate, authorize('admin'), async (req, res) => {
  const failed = await emailQueue.getFailed(0, 50);
  res.json({ count: failed.length, jobs: failed.map(j => ({ id: j.id, data: j.data, reason: j.failedReason, attempts: j.attemptsMade })) });
});

app.post('/admin/jobs/:id/retry', authenticate, authorize('admin'), async (req, res) => {
  const job = await emailQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
  await job.retry();
  res.json({ status: 'retried' });
});

// Celery equivalent (Python) — minimal pattern
# tasks.py
from celery import Celery
from celery.utils.log import get_task_logger

app = Celery('tasks', broker=REDIS_URL, backend=REDIS_URL)
app.conf.task_acks_late = True  # at-least-once delivery
app.conf.task_reject_on_worker_lost = True  # requeue on worker crash
logger = get_task_logger(__name__)

@app.task(bind=True, max_retries=5, default_retry_delay=60)
def send_email(self, to: str, template: str, data: dict) -> dict:
    try:
        result = email_service.send(to=to, template=template, data=data)
        return {'sent_at': result.timestamp.isoformat()}
    except TransientError as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries * 60)
    except PermanentError as exc:
        logger.error(f"Permanent failure for {to}: {exc}")
        raise  # no retry — goes to dead letter
```
