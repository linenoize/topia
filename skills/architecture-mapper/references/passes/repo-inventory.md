> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Create a detailed repository inventory for this detected stack (from stack profile) repo.

Arguments: $ARGUMENTS

Tasks:
1. Read `CLAUDE.md` and `docs/architecture/progress.md`.
2. Inventory the repository by meaningful subsystem, not every file.
3. Group folders into categories such as:
   - frontend app (if present)
   - backend / API
   - shared utilities
   - config / build tooling
   - tests
   - scripts / migrations / seeds
   - jobs / workers
   - integration clients
4. Write `docs/architecture/repo-inventory.md`.

Required output:
- subsystem table (folder path → category → responsibility)
- probable ownership per major folder
- suspicious hotspots (very large files, mixed concerns, dead-code suspects)
- likely legacy zones if visible
- confidence label per claim

Focus on grouping, not per-file description. Use the stack-specific hunt priority from `CLAUDE.md` to decide which folders are high-signal.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each subsystem section gets an anchor `### {name} {#subsystem-{slug}}`.
- When you reference a module that will be catalogued by `references/passes/module-map.md`, link forward to the expected anchor: `[auth module](./module-map.md#module-auth)` — even if that file doesn't exist yet. `references/passes/critic.md` will reconcile broken links later.
- End with a `## Backlinks` section.
