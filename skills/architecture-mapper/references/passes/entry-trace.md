> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Trace how external actors enter this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/progress.md`
   - `docs/architecture/repo-inventory.md`
2. Enumerate all entry surfaces:
   - HTTP routes / endpoints (see stack-specific hints below)
   - UI pages / components that initiate actions (if frontend present)
   - CLI commands / scripts
   - Scheduled triggers
   - Inbound webhooks
   - Message consumers (queue subscribers, event listeners)
3. For each important entry, map:
   - what triggers it (user click, external POST, cron, message)
   - the specific file + function or route registration
   - the next hop (controller / service / handler)
   - the payload or params shape if inferable
4. Write `docs/architecture/entry-points.md` (or update the bootstrap output). If the stack has a frontend, also write `docs/architecture/entry-map.md` with the UI-action → API-endpoint pairs (use filename `vue-to-api-map.md` if the stack is Vue-based, `frontend-to-api-map.md` otherwise).

Stack-specific route/handler guidance:
(read ROUTE_LAYER_HINTS from the active stack profile)

Stack-specific frontend guidance (skip if no frontend):
(read FRONTEND_HINTS from the active stack profile)

Required output:
- action-to-endpoint table (one row per user/external action)
- route / view / consumer inventory
- evidence links to files
- top 5-10 frontend or external entry points to target for steel-thread analysis

Focus especially on:
- login / auth
- the main dashboard or list view's initial load
- create / update / delete actions on primary entities
- search / filter interactions
- file uploads and downloads
- admin-only actions
- inbound webhook handlers

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Every endpoint in `entry-points.md` gets an anchor `### {METHOD path} {#endpoint-{method}-{path-slug}}`. Method is lowercased, path slashes become dashes, path params are left intact (e.g., `#endpoint-get-api-users-:id`).
- Webhook endpoints and queue consumers follow the same pattern with method = `webhook` or `consumer`.
- The action-to-endpoint table links both sides: widgets link to `./ui-surface-map.md#widget-...` (if that doc exists or will be produced), endpoints link to their own anchor in `entry-points.md`.
- End the file with a `## Backlinks` section.
