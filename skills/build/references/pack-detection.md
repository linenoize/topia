# L4 Pack Detection — Signal → Pack Mapping

This file defines the full signal-to-pack mapping used in Phase 1.5 (DOMAIN CONTEXT).
When a signal in the codebase or task description matches a row below, load the corresponding pack.

## Workspace-enabled packs (priority)

Before the signal table:

1. If `.topia/active-packs.json` exists, `Read` it and collect `enabled[]` (e.g. `@Topia/ui`).
2. Run the **Signal → Pack Table** below against scout output + task description.
3. **Union** workspace-enabled packs with signal-matched packs (dedupe by pack id).
4. **Cap at 2 packs** for this build — prefer packs that match **both** workspace-enabled and signals first, then workspace-only if the task is clearly in that domain, then pure signal matches.
5. If union is empty after cap logic: skip Phase 1.5 silently.

Packs are **shipped with Topia** — `active-packs.json` records workspace preference from onboard/install, not a separate install step.

## Split Pack Protocol (context-efficient)

- `Read` the matching PACK.md index (~60-80 lines) — contains triggers, skill table, connections, workflows
- Match the task to the specific skill name in the index's Skills Included table
- `Read` only the matching skill file(s) from `skills/` subdirectory (e.g., `extensions/backend/skills/auth.md`)
- Load max 2-3 skill files per invocation — not all skills in the pack
- Pack-level constraints (from index's Connections and Sharp Edges sections) always apply

## Monolith Pack Protocol (legacy)

If no `format: split` in PACK.md frontmatter, read the full PACK.md and extract the matching `### skill-name` section.

## Signal → Pack Table

| Signal in Codebase or Task | Pack | File |
|---|---|---|
| `*.tsx`, `*.svelte`, `*.vue`, Tailwind, CSS modules | `@Topia/ui` | `extensions/ui/PACK.md` |
| Express/Fastify/NestJS routes, API endpoints | `@Topia/backend` | `extensions/backend/PACK.md` |
| Dockerfile, `.github/workflows/`, Terraform | `@Topia/devops` | `extensions/devops/PACK.md` |
| `react-native`, `expo`, `flutter`, `ios/`, `android/` | `@Topia/mobile` | `extensions/mobile/PACK.md` |
| Auth, OWASP, secrets, PCI/HIPAA markers | `@Topia/security` | `extensions/security/PACK.md` |
| Cart, checkout, inventory, Shopify | `@Topia/ecommerce` | `extensions/ecommerce/PACK.md` |
| `openai`, `anthropic`, embeddings, RAG, LLM | `@Topia/ai-ml` | `extensions/ai-ml/PACK.md` |
| CMS, blog, MDX, `i18next`, SEO | `@Topia/content` | `extensions/content/PACK.md` |
| Analytics, tracking, A/B test, funnel | `@Topia/analytics` | `extensions/analytics/PACK.md` |
| Chrome extension, `manifest.json`, service worker, content script | `@Topia/chrome-ext` | `extensions/chrome-ext/PACK.md` |
## After Match Found

If ≥1 pack matches:
- Use `Read` to load the matching PACK.md (index if split, full if monolith)
- For split packs: identify the relevant skill from the index table, then `Read` only that skill file from `skills/` subdirectory
- For monolith packs: extract the relevant `### skill-name` section from the PACK.md body
- Apply pack constraints alongside build's own constraints for the rest of the workflow
- Announce: "Loaded @Topia/[pack] → [skill-name] (split)" or "Loaded @Topia/[pack] → [skill-name] (full)"

If 0 packs match: skip silently, proceed to Phase 2.

## Workflow Command Detection

After a pack is matched, check if the user's request maps to a named workflow in the pack's Workflows table.

**Detection rules:**
1. Explicit command: user types `/topia <pack> <workflow>` (e.g., `/topia finance monthly-close`)
2. Implicit match: task description contains workflow trigger keywords from the Workflows table
3. Single-skill shortcut: `/topia <pack> <skill>` routes directly to one skill

**If a workflow matches:**
1. Read the Workflows section of the matched PACK.md
2. Extract the skill sequence (e.g., `expense-analysis → financial-reporting → cash-flow-optimization`)
3. Execute skills in order — each skill's output feeds the next as context
4. Thread state via `.topia/<pack>/` artifacts (each skill reads previous skill's output file)

**If no workflow matches:**
- Fall back to single-skill detection (match task to best skill from the Skills table)
- This is the current default behavior

**Workflow examples** (illustrative — packs declare their own Workflows tables in `PACK.md`):
| Command | Pack | Workflow | Skill Sequence |
|---------|------|----------|----------------|
| `/topia saas onboarding` | saas | onboarding | multi-tenant-setup → billing-integration → subscription-flow |
| `/topia ecommerce launch` | ecommerce | launch | inventory-setup → payment-integration → cart-flow |
| `/topia ai-ml rag` | ai-ml | rag | embeddings-setup → vector-store → retrieval-pipeline |
| `/topia chrome-ext publish` | chrome-ext | publish | cws-preflight → cws-publish |
