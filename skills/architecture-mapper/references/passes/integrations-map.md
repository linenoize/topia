> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Map all external integrations and system boundaries for this detected stack (from stack profile) system.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/repo-inventory.md`
   - `docs/architecture/module-map.md`
2. Identify:
   - outbound HTTP clients
   - SDK imports (payments, email, storage, auth, analytics, observability)
   - inbound webhooks
   - file storage / CDN
   - feature-flag or remote-config services
3. For each integration, document:
   - purpose
   - where configured (file + env vars)
   - where called (call sites)
   - inbound or outbound
   - sync vs async
   - sensitive config/env vars required
   - fallback / retry / circuit-breaker behavior if visible
4. Write `docs/architecture/integrations.md`.

Stack-specific integration guidance:
(read INTEGRATION_HINTS from the active stack profile)

Required output:
- integrations table (name → direction → purpose → config location → call sites)
- inbound boundary map (external system → route → handler)
- outbound boundary map (caller → external system → purpose)
- secrets / config dependency summary (grouped by integration)

Flag integrations where failure handling is absent or silent — those are the ones that break in production without anyone noticing.

## Required linking

Follow the cross-linking conventions in `references/conventions.md`:
- Each integration section starts with `### {Integration name} {#integration-{slug}}` (e.g., `#integration-stripe`, `#integration-sendgrid`).
- Call sites cite the file path and link to the owning module: `Called from [payments module](./module-map.md#module-payments)`.
- Inbound boundary rows link to the route handling the webhook: `[POST /webhooks/stripe](./entry-points.md#endpoint-post-webhooks-stripe)`.
- End the file with a `## Backlinks` section.
