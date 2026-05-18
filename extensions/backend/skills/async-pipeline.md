---
name: "async-pipeline"
pack: "@Topia/backend"
description: "Multi-stage async processing pipelines with waterfall engine selection, progress streaming, and credit-based billing. Patterns for building services that process data through multiple fallback strategies with real-time status updates."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# async-pipeline

Multi-stage async processing pipelines with waterfall engine selection, progress streaming, and credit-based billing. Patterns for building services that process data through multiple fallback strategies with real-time status updates.

#### Workflow

**Step 1 — Design engine waterfall**
Multiple processing engines ranked by quality and cost:
```typescript
interface ProcessingEngine {
  name: string;
  quality: number;       // higher = preferred
  costMultiplier: number; // credit cost factor
  execute: (input: Input) => Promise<Result>;
  canHandle: (input: Input) => boolean;
}

// Engines race with staggered delays — first valid result wins
async function waterfallExecute(
  engines: ProcessingEngine[],
  input: Input,
  staggerDelayMs: number = 500
): Promise<{ result: Result; engine: string }> {
  const sorted = engines
    .filter(e => e.canHandle(input))
    .sort((a, b) => b.quality - a.quality);

  const controller = new AbortController();

  const races = sorted.map((engine, i) =>
    new Promise<{ result: Result; engine: string }>(async (resolve, reject) => {
      // Stagger start: engine 0 starts immediately, engine 1 after 500ms, etc.
      if (i > 0) await delay(i * staggerDelayMs);
      if (controller.signal.aborted) return reject(new Error('aborted'));

      try {
        const result = await engine.execute(input);
        if (isValid(result)) {
          controller.abort();  // cancel slower engines
          resolve({ result, engine: engine.name });
        } else {
          reject(new Error(`${engine.name}: invalid result`));
        }
      } catch (err) {
        reject(err);
      }
    })
  );

  return Promise.any(races);
}
```

**Step 2 — Implement transform pipeline**
Chain transforms that process data sequentially:
```typescript
type Transformer<T> = (data: T, context: PipelineContext) => Promise<T>;

async function runPipeline<T>(
  data: T,
  transformers: Transformer<T>[],
  onProgress: (stage: string, pct: number) => void
): Promise<T> {
  let current = data;
  for (let i = 0; i < transformers.length; i++) {
    onProgress(transformers[i].name, (i / transformers.length) * 100);
    current = await transformers[i](current, context);
  }
  onProgress('complete', 100);
  return current;
}
```

**Step 3 — Stream progress via SSE**
Real-time progress from worker to client:
```typescript
// Worker side: publish progress to Redis pub/sub
async function publishProgress(jobId: string, stage: string, pct: number) {
  await redis.publish(`job:${jobId}:progress`, JSON.stringify({ stage, pct, ts: Date.now() }));
}

// API side: SSE endpoint
app.get('/jobs/:id/progress', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const subscriber = redis.duplicate();
  await subscriber.subscribe(`job:${req.params.id}:progress`);

  subscriber.on('message', (_channel, message) => {
    res.write(`data: ${message}\n\n`);
  });

  req.on('close', () => subscriber.unsubscribe());
});
```

**Step 4 — Two-tier concurrency control**
```typescript
// Team-level: limit concurrent jobs per team
async function canEnqueue(teamId: string): Promise<boolean> {
  const active = await redis.zcard(`team:${teamId}:active`);
  const limit = await getTeamConcurrencyLimit(teamId);
  return active < limit;
}

// Job-level: track active jobs with TTL (auto-cleanup on crash)
async function markActive(teamId: string, jobId: string) {
  await redis.zadd(`team:${teamId}:active`, Date.now(), jobId);
  await redis.expire(`team:${teamId}:active`, 3600);  // 1h TTL safety net
}

async function markComplete(teamId: string, jobId: string) {
  await redis.zrem(`team:${teamId}:active`, jobId);
}
```

**Step 5 — Dynamic credit billing**
```typescript
interface CreditCost {
  base: number;
  engineMultiplier: number;   // stealth proxy = 4x
  formatMultiplier: number;   // JSON extraction = 5x
  extras: number;             // per-page for PDFs, per-territory for pricing
}

function calculateCredits(job: CompletedJob): number {
  let cost = job.cost.base;
  cost *= job.cost.engineMultiplier;
  cost *= job.cost.formatMultiplier;
  cost += job.cost.extras;
  return Math.ceil(cost);
}
```

**Step 6 — Dead letter queue with retry classification**
```typescript
interface FailedJob {
  id: string;
  error: string;
  errorCode: 'TRANSIENT' | 'PERMANENT' | 'TIMEOUT' | 'RATE_LIMITED';
  attempts: number;
  stageTiming: Record<string, number>;  // per-stage perf data
}

// Retry only transient failures; permanent goes to dead letter
function shouldRetry(job: FailedJob): boolean {
  if (job.errorCode === 'PERMANENT') return false;
  if (job.attempts >= 3) return false;
  return true;
}
```

#### Example

```typescript
// Complete async pipeline for document processing
const docPipeline = createPipeline({
  engines: [
    { name: 'native-parser', quality: 100, costMultiplier: 1, execute: nativeParse },
    { name: 'llm-extraction', quality: 80, costMultiplier: 5, execute: llmExtract },
    { name: 'ocr-fallback', quality: 50, costMultiplier: 3, execute: ocrExtract },
  ],
  transforms: [
    cleanHTML,
    extractMetadata,
    convertToMarkdown,
    generateSummary,
    indexForSearch,
  ],
  concurrency: { perTeam: 10, perJob: 3 },
  billing: { base: 1, jsonFormat: 5 },
  deadLetter: { maxRetries: 3, alertThreshold: 10 },
});

// Enqueue
const jobId = await docPipeline.enqueue(teamId, { url, format: 'json' });

// Stream progress
const progress = docPipeline.streamProgress(jobId);
for await (const update of progress) {
  console.log(`${update.stage}: ${update.pct}%`);
}
```
