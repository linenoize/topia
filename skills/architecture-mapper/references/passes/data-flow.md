> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Map the system-wide data flow in this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read all docs in `docs/architecture/`.
2. Identify:
   - inbound data sources (API requests, webhooks, file uploads, message consumers)
   - validation / transformation points
   - internal movement between modules
   - persistence points (which layers write where)
   - cached or transient state (in-memory caches, Redis, etc.)
   - outbound publishing or integration paths
3. Trace primary entities from creation through downstream use.
4. Write `docs/architecture/data-flow.md`.

Stack-specific data-access guidance (for tracing writes/reads):
(read DATA_ACCESS_HINTS from the active stack profile)

Required output:
- system-wide data movement summary
- primary entity lineage (for the 3-5 most important entities)
- sync vs async boundaries across the system
- state mutation hotspots (files/functions that change entity state most often)
- data-integrity / consistency risks (cross-collection writes without transactions, eventual-consistency gaps, race windows)
- one high-level Mermaid `flowchart TD` of system-wide data movement
- one entity-specific flowchart for the single most important entity

Be explicit about unknown vs code-confirmed behavior. If you can't tell whether two writes are atomic, say so.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each "primary entity lineage" subsection starts with `### Lineage: {Entity} {#lineage-entity-{name}}` and links to the canonical entity at `./data-models.md#entity-{name}`.
- State-mutation hotspots cite file paths and link to the owning module.
- The system-wide `flowchart TD` uses slug IDs that match addressable things — module/entity/endpoint/job/integration — with `click` directives.
- The entity-specific flowchart uses the `entity-{name}` slug as its central node.
- End the file with a `## Backlinks` section.
