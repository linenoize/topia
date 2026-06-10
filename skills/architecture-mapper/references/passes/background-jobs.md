> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Map background jobs, schedulers, queues, and async processing in this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/repo-inventory.md`
   - `docs/architecture/module-map.md`
2. Hunt for background work using the stack-specific cues below.
3. For each background process, document:
   - trigger (schedule pattern, inbound event, queue name, webhook)
   - code entry point (file + function)
   - business purpose
   - data stores / collections / tables touched
   - integrations invoked
   - retry / dead-letter / error-handling behavior if present
4. Write `docs/architecture/background-jobs.md`.

Stack-specific background-work guidance:
(read BACKGROUND_WORK_HINTS from the active stack profile)

Required output:
- job inventory (table: name → trigger → entry file → purpose)
- scheduler map (cron patterns → jobs)
- async boundary notes (where a sync request defers work)
- risks list:
  - duplicate processing (missing idempotency)
  - missing retries or silent failures (swallowed exceptions)
  - timers used as schedulers (fragile across restarts)
  - unbounded concurrency (no rate limit on consumers)
  - hidden retries (library-default retry behavior not visible in code)

If the repo has no background work at all, say so explicitly and note any synchronous operations that *should* be async (e.g., inline email send inside a request handler).

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each job section starts with `### {Job name} {#job-{slug}}`.
- Jobs link to the modules they invoke, entities they touch, and integrations they call: `[orders module](./module-map.md#module-orders)`, `[Order entity](./data-models.md#entity-order)`, `[Stripe](./integrations.md#integration-stripe)`.
- The scheduler map table links each job name to its `#job-...` anchor.
- End the file with a `## Backlinks` section — typically steel threads, workflows, and data-flow will reference jobs.
