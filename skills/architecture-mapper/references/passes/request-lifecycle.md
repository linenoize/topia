> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Map the backend request lifecycle for this detected stack (from stack profile) API.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/entry-points.md`
   - `docs/architecture/module-map.md`
   - the entry-trace output (`vue-to-api-map.md` / `frontend-to-api-map.md` / equivalent)
2. Identify:
   - app initialization and where middleware is registered
   - middleware order and what each piece does (auth, validation, error handling, logging)
   - mounted routers / router groups
   - route handlers → services / use-cases → data access
3. Pick the 3-5 most important endpoints and document the full lifecycle of a request through each one.
4. Write `docs/architecture/api-lifecycle.md`.

Stack-specific route/handler guidance:
(read ROUTE_LAYER_HINTS from the active stack profile)

Required output:
- startup and middleware chain summary (in order)
- router mount map
- lifecycle section for each selected endpoint
- Mermaid `sequenceDiagram` for at least 3 representative requests
- explicit call-outs for synchronous vs asynchronous steps
- note when a controller bypasses service layer and hits data access directly — that's usually the interesting part

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- When you name an endpoint, link to it via its anchor: `[POST /api/auth/login](./entry-points.md#endpoint-post-api-auth-login)`.
- When you name a module/service, link to it: `[auth module](./module-map.md#module-auth)`.
- When you mention an entity written/read, link to `./data-models.md#entity-...`.
- The `sequenceDiagram`s use participants with slug IDs where possible: `participant auth as module-auth` then `Note over auth:` style — so `click`-able composition still works in `references/passes/flowchart.md`.
- End the file with a `## Backlinks` section.
