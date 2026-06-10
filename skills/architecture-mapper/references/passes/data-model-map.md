> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Map the data model and access patterns for this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/module-map.md`
   - `docs/architecture/api-lifecycle.md`
2. Identify:
   - the persistence layer(s) in use (check data-access hints below)
   - schemas / models / entities / collections / tables
   - key fields and relationships
   - embedded vs referenced patterns (for document DBs) or joined vs normalized (for relational)
   - aggregate pipelines, views, stored procedures
   - declared indexes
   - transactions / sessions if used
3. For each major entity, document:
   - where created
   - where read
   - where updated
   - where deleted / archived / soft-deleted
   - which workflows touch it
4. Write `docs/architecture/data-models.md`.

Stack-specific data-access guidance:
(read DATA_ACCESS_HINTS from the active stack profile)

Database-model notes for this stack:

(read MONGODB_NOTE from the active stack profile — empty if not Mongo)

(read RELATIONAL_NOTE from the active stack profile — empty if not relational)

Required output:
- entity catalog (table)
- relationship summary
- lifecycle-per-entity sections
- access hotspots (entities hit by many different code paths)
- probable data-integrity risks
- Mermaid diagram showing entity relationships

Do not assume behavior the code doesn't prove. If the DB type is unclear or mixed, say so explicitly and list the evidence for each candidate.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each entity section starts with `### {Entity name} {#entity-{name-lower}}`.
- The "where created/read/updated/deleted" subsections link to the modules and endpoints responsible: `- Created in [orders module](./module-map.md#module-orders) via [POST /api/orders](./entry-points.md#endpoint-post-api-orders)`.
- When a steel thread or workflow touches this entity, it's the entity's job to record that backlink — add it under the entity's `### Touched by` subsection as those docs are produced (or reconciled by `references/passes/critic.md`).
- The Mermaid entity-relationship diagram uses `entity-{name}` as node IDs with `click` directives.
- End the file with a `## Backlinks` section at file level (in addition to per-entity `Touched by` subsections).
- **Flag the 3-5 most important entities** at the top of the file with `**Primary entities:**` — `references/passes/flowchart.md` uses this list to pick which entity overlay diagrams to generate.
