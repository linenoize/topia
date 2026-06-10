> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Reverse-engineer the top steel threads in this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read all architecture docs created so far.
2. Identify 5-10 highest-value end-to-end flows. Prefer flows that cross the most layers:
   - frontend entry (if applicable) → API route → middleware → controller → service → data → queue/job → integration → response/side effect
3. Write `docs/architecture/steel-threads.md`.

For each steel thread include:
- name
- trigger (user action, scheduled, inbound webhook, etc.)
- actor (end user, admin, system, external)
- path in numbered steps with file + function for each
- modules touched
- entities / collections / tables touched
- async boundaries (where the request returns while work continues)
- side effects (emails, events emitted, third-party calls, state mutations)
- evidence
- open questions
- confidence

Required diagrams:
- one Mermaid `sequenceDiagram` per steel thread

Suggested steel threads to hunt (pick the ones that apply):
- user login / session bootstrap
- dashboard / main list initial load
- create a primary business entity
- update status / workflow transition
- search / filter / list flow
- export or import flow
- webhook-driven update
- scheduled sync or notification flow
- file upload flow
- admin-only privileged action

If you can't populate a steel thread fully (a step is genuinely missing from the code), say so and label it speculative — a steel thread with gaps is still useful if the gaps are named.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`. Steel threads are the **highest-density cross-linkers** in the whole knowledge base — they touch everything, so they must link to everything:

- Each thread section starts with `### {Thread name} {#thread-{slug}}` (e.g., `#thread-user-login`).
- In the numbered-step path, link each hop: widget → endpoint → module → entity → job → integration, each to its anchor.
- "Modules touched" → bullet list of `[module name](./module-map.md#module-...)` links.
- "Entities touched" → `[entity name](./data-models.md#entity-...)` links.
- "Integrations invoked" → `[integration](./integrations.md#integration-...)` links.
- "Jobs triggered" → `[job](./background-jobs.md#job-...)` links.
- **After writing this file**, also add a "Touched by" line under each referenced entity in `data-models.md` (use the Edit tool on that file), each referenced module in `module-map.md`, etc. That's what makes the knowledge base navigable backwards. If you don't have the budget to reconcile all backlinks now, `references/passes/critic.md` will catch them later.
- The `sequenceDiagram` per thread uses participants named after slugs where possible and includes `click` notes at the end with the canonical anchor each participant maps to.
- End the file with a `## Backlinks` section — typically `workflows.md`, `system-flowchart.md`, `final-report.md`, and `INDEX.md` point back here.
