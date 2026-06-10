# Command catalog

The 17 mapping passes (Topia modes under `/topia architecture-mapper <pass>`). Each writes to or reads from `docs/architecture/`; later passes build on earlier outputs. All outputs cross-link via anchor slugs and clickable Mermaid diagrams (see `references/conventions.md`).

## Recommended entry point

| #  | Command                    | Purpose                                                                                                         |
| -- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0  | `/architecture-run-all`    | **Recommended first run.** Orchestrates the full pipeline end-to-end. `--autonomous` (default) or `--checkpoint`. |

## Individual passes (manual mode, in execution order)

| #  | Command                    | Purpose (one-liner)                                                                     | Primary output                                   |
| -- | -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1  | `/architecture-bootstrap`  | Breadth-first pass: identify startup, routes, UI entries, configs                       | `repo-inventory.md`, `entry-points.md`, `progress.md` |
| 2  | `/repo-inventory`          | Group folders by meaningful subsystem, flag hotspots and likely legacy zones            | `repo-inventory.md` (deepened)                   |
| 3  | `/module-map`              | Major modules, their dependencies, a Mermaid graph, architecture smells                 | `module-map.md`                                  |
| 4  | `/entry-trace`             | Map how external actors (UI, webhooks, CLIs, cron) enter the system                     | `vue-to-api-map.md` (Node) / equivalent          |
| 5  | `/ui-surface-map`          | Widget → handler → endpoint → service → entity, for every UI element                    | `ui-surface-map.md` (or no-op note for headless) |
| 6  | `/request-lifecycle`       | Backend request lifecycle: middleware → controller → service → data                     | `api-lifecycle.md`                               |
| 7  | `/data-model-map`          | Entity catalog, access patterns, relationships, lifecycle per entity                    | `data-models.md`                                 |
| 8  | `/background-jobs`         | Schedulers, queues, workers, webhook-triggered async work                                | `background-jobs.md`                             |
| 9  | `/integrations-map`        | Outbound/inbound third-party systems, auth/payments/email/storage/webhooks               | `integrations.md`                                |
| 10 | `/steel-threads`           | 5-10 highest-value end-to-end flows that cross the most layers                          | `steel-threads.md`                               |
| 11 | `/workflows`               | Business and operational workflows grouped by actor                                     | `workflows.md`                                   |
| 12 | `/data-flow`               | System-wide data movement + per-entity lineage                                          | `data-flow.md`                                   |
| 13 | `/architecture-flowchart`  | Composite clickable flowchart stitched from all prior outputs                           | `system-flowchart.md`                            |
| 14 | `/architecture-critic`     | Self-review + fix broken links + verify click-directive coverage                        | revises multiple files + `progress.md`           |
| 15 | `/architecture-index`      | Generate/refresh the INDEX.md hub                                                       | `INDEX.md`                                       |
| 16 | `/architecture-report`     | Consolidate everything into one executive-readable final report                         | `final-report.md`                                |

## Why this order

The ordering is deliberate. `steel-threads.md` (step 10) is the highest-leverage deliverable but the hardest to do well — it needs entry-trace, ui-surface-map, request-lifecycle, and data-model-map already in place, otherwise the threads come out vague.

New steps 13-15 turn the individual artifacts into a drillable knowledge base:
- `/architecture-flowchart` composes per-pass diagrams into a unified system view with clickable nodes.
- `/architecture-critic` now also verifies the cross-linking contract (anchor validity, click-directive coverage, backlink completeness).
- `/architecture-index` builds the hub doc a newcomer opens first.

Running `/architecture-critic` before `/architecture-report` catches the worst "generic architecture prose without file-level grounding" failures before they make it into the final doc.

Each command starts by reading relevant prior outputs (listed explicitly in its body). This is what lets the user pause, close the session, and resume days later — the filesystem *is* the state.

## When to stop early

- After `/module-map` (step 3): you have a structural understanding. Enough for many onboarding cases.
- After `/ui-surface-map` (step 5): you have the widget-to-data map. Enough if the question is "what does this button actually do?"
- After `/steel-threads` (step 10): you have the workhorse end-to-end narratives. Enough for most bug-triage and feature-planning cases.
- After `/architecture-flowchart` (step 13): you have a drillable map. Enough for onboarding a team member.
- After `/architecture-report` (step 16): you have the full package. Do this when you need a hand-off document.

## Orchestrator vs manual

`/architecture-run-all` runs steps 1-16 in order. Two modes:
- **Autonomous** (default): no pauses. Right for "go away and come back to a finished report."
- **Checkpoint** (`--checkpoint`): pauses at 4 milestones — after inventory (step 3), after entities (step 9), after narratives (step 12), before final report (step 16). Right when you want to course-correct mid-pipeline.

Both modes produce the same set of artifacts. Resuming a partial run is free — the orchestrator reads `progress.md` and picks up from the first incomplete step.

## Re-running commands

Commands are idempotent by design — each reads current state from `docs/architecture/`, refines, and writes back. Running `/module-map` twice after a code change updates the module map; it doesn't duplicate it. `/architecture-critic` can be run repeatedly; each pass tightens the docs and the cross-linking.

## What's explicitly excluded from the catalog

- No test-generation or code-modification commands. This is a read-only analysis skill; adding write-to-code commands would change what the skill is.
- No automated PR or commit commands. The artifacts go into `docs/architecture/` for the user to review and commit (or not).
