> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Build the module map for this detected stack (from stack profile) codebase.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/progress.md`
   - `docs/architecture/repo-inventory.md`
   - `docs/architecture/entry-points.md`
2. Identify major modules. Expected categories for this stack:
   - application shell / bootstrap
   - HTTP/route layer
   - middleware (auth / validation / error handling)
   - controllers / handlers
   - services / use-cases / domain logic
   - data access — see CLAUDE.md → Data access section
   - background workers / job processors
   - integrations / external clients
   - frontend shell, routing, state (if applicable) — see CLAUDE.md → Frontend section
3. For each module, document:
   - responsibility
   - key files
   - inbound dependencies
   - outbound dependencies
   - important abstractions / interfaces
4. Write `docs/architecture/module-map.md`.

Required output:
- summary table
- module detail sections
- Mermaid `graph TD` of major module relationships
- "architecture smells" list: tight coupling, god modules, direct DB access from routes/controllers, frontend bypassing the API client layer, duplicated business logic, circular dependencies
- confidence labels

Stack-specific access-pattern guidance to incorporate:
(read DATA_ACCESS_HINTS from the active stack profile)

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each module section starts with `### {Module name} {#module-{slug}}`. Slug is kebab-case and matches the module-map node ID exactly.
- Inbound/outbound dependency lists use markdown links to peer module anchors: `- [auth](./module-map.md#module-auth)`.
- When a module owns an entity, link to it: `Owns [User](./data-models.md#entity-user)`. When it fronts an endpoint, link to it.
- The `graph TD` / `graph LR` Mermaid diagram uses each slug as the node ID, with a `click` directive per slug at the end.
- End the file with a `## Backlinks` section — for each module, list which steel threads, endpoints, jobs, and integrations reference it (once those files exist; use placeholder "to be populated" until then).
