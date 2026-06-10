> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Assemble the final reverse-engineered architecture report.

Arguments: $ARGUMENTS

Tasks:
1. Read all docs in `docs/architecture/`.
2. Consolidate them into `docs/architecture/final-report.md`.

The final report must include:
- executive summary (5-10 sentences)
- stack / runtime summary
- frontend architecture summary (if applicable)
- backend architecture summary
- data-model summary
- background-processing summary
- integrations summary
- top steel threads (names + one-line each + link to the full section in `steel-threads.md`)
- most important workflows (same pattern)
- data-flow summary
- risks / unknowns / ambiguity
- confidence assessment (overall + per section)
- onboarding guide:
  - if you only have 2 hours, read these files in this order
  - if you need to debug a frontend issue, start here
  - if you need to debug an API issue, start here
  - if you need to debug a data issue, start here
  - if you need to debug a background-job issue, start here

Be concise, evidence-based, and explicit about uncertainty. Separate confirmed from likely architecture. Use quotes-with-file-paths when citing specific code claims.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`. The final report is the **most-linked document** in the knowledge base — it should make a reader land on any detailed section in one click:

- Every module, entity, endpoint, thread, workflow, job, and integration named in the report links to its canonical anchor.
- The "top steel threads" and "most important workflows" sections are tables whose rows each end with a link to the full section anchor.
- The "onboarding guide" sections link to the specific file + anchor the reader should open (not just the filename).
- Include a **"How to drill down"** paragraph directing the reader to `INDEX.md` and `system-flowchart.md` as the two navigational hubs.
- End the file with a `## Backlinks` section — the final report is typically only referenced by `INDEX.md`, but note it anyway for consistency.
