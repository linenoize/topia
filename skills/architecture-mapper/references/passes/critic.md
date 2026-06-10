> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Critique and improve the existing architecture docs.

Arguments: $ARGUMENTS

Tasks:
1. Read all docs in `docs/architecture/`.
2. Identify weaknesses:
   - generic claims without file-level evidence
   - missing links between frontend actions and API endpoints
   - missing middleware / auth / validation steps in lifecycle traces
   - missing entity touches in workflows
   - missing async boundaries (flows shown as synchronous when they aren't)
   - missing integration side effects
   - contradictions across files (module-map vs steel-threads vs data-flow)
   - diagrams that don't match the written flow
   - confidence labels missing, misused, or too optimistic
3. Also verify the **cross-linking contract** (defined in `CLAUDE.md`):
   - every addressable thing (module, endpoint, entity, widget, steel thread, workflow, job, integration) has an explicit anchor `{#slug}` in its canonical file
   - prose references to those things use relative markdown links, not bare names
   - every Mermaid diagram that references addressable things has `click` directives on ≥80% of its slug nodes
   - every file ends with a `## Backlinks` section that matches reality (an entity's backlinks should list threadsreferences/passes/workflows.md/endpoints that actually reference it)
   - forward-links from earlier passes (e.g., `repo-inventory.md` linking to a `module-...` that didn't exist yet) are now valid — fix or flag the broken ones
4. Revise the docs in place to fix all the above. Use the Edit tool — preserve file structure and only change what's wrong.
5. Update `docs/architecture/progress.md` with:
   - gaps closed this pass
   - remaining weak spots
   - next best investigations
   - a "link health" summary: number of broken anchor links found + fixed, diagrams still missing click directives

Be skeptical and specific. For each revision, note in the doc the evidence you added. Do not rewrite docs wholesale — targeted edits only.
