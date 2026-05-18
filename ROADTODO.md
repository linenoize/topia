# Topia — Roadmap + TODO

> Consolidated versions of `ROADMAP.md` and `TODO.md`. Going forward, both forward-looking plans (what we'll build) and outstanding cleanup items (what's loose) live here.

Topia's goal: a disciplined, resilient, cost-effective skill toolkit for AI coding agents. Less skills, deeper connections.

---

## Mission Pillars

- **Workflow rails, not a pipeline** — skills call each other through a graph; if one breaks, the workflow routes around it. Not a brittle A→B→C chain.
- **Auto-discipline at the runtime** — hooks (preflight / sentinel / completion-gate / quarantine) fire before tool use, so the model can't skip steps.
- **Multi-platform from one source** — `skills/` compiles to Claude Code, Cursor, Codex, Antigravity, OpenCode, OpenClaw. No per-IDE rewrites.
- **Persistent memory across sessions** — agora-code MCP (vendored, optional) survives context resets, new conversations, agent restarts.
- **Internal-only** — no marketplace, no community PR queue, no public distribution. Stays a private team tool.

---

## Now (v1.x — current release line)

### v1.2.0 — rune-kit migration, doctor extensions, repo move (2026-05-18) ✅
- [x] **`topia migrate-from-rune` CLI command** — interactive copy of `.rune/` state into `.topia/`, plus optional rune-kit plugin disable.
- [x] **SessionStart hook detection** — prints a routing-conflict warning when `.rune/` or the rune-kit plugin is detected and neither completion/skip flag exists.
- [x] **`docs/migration/from-rune.md`** + **`commands/migrate-from-rune.md`** — user guide and slash-command doc.
- [x] **Idempotency contract** — `.topia/migrated-from-rune.flag` (after success) and `.topia/skip-rune-migration.flag` (after explicit skip) both suppress further session-start warnings.
- [x] **Reversible disable** — rune-kit cache renamed to `.disabled` rather than deleted; restore with one `mv`.
- [x] **Doctor — frontmatter conformance check + extended required sections** — `topia doctor` now also verifies (a) every SKILL.md has all 6 metadata fields (`author/version/layer/model/group/tools`), and (b) every skill has `Purpose` + `Constraints` sections (in addition to Sharp Edges / Done When / Cost Profile).
- [x] **Repo URLs moved** — `github.com/skill-topia/Topia` → `github.com/protopia/skill-topia`; npm `@skill-topia/topia` → `@protopia/skill-topia`. CLI stays `topia`; author identity stays `skill-topia`.
- [x] **Docs trimmed** — deleted `USER-GUIDE-CYCLE.md` + `DEVELOPER-CYCLE.md` (163 redundant lines).

### v1.1.0 — agora-code memory integration (2026-05-16) ✅
- [x] **Vendored agora-code** at `mcp-servers/agora-code/` (Apache 2.0, opt-in Python MCP).
- [x] **`docs/mcp-integrations/agora-code.md`** — integration guide; mandates "do not run `agora-code install-hooks`" (Topia hooks are canonical).
- [x] **Skills wired** to call agora-code tools when MCP is registered: `journal` (`store_learning`, `complete_session`), `build` Phase 1 Step 2.5 (`recall_learnings`), `idea` Step 1.2 (`recall_learnings`), `neural-memory` (full backend swap).
- [x] **Graceful degradation contract** — every wired skill falls back to file-based `.topia/` persistence if the MCP isn't registered.

### v1.0.0 — initial internal release (2026-05-15) ✅
- [x] **65 skills** across 5 layers (L0 router · L1 orchestrators · L2 hubs · L3 utilities · L4 extension packs).
- [x] **203 connections + 44 signals** between skills, validated by `topia doctor`.
- [x] **Multi-platform compiler** — `skills/` → Claude Code / Cursor / Antigravity / Codex / OpenCode / OpenClaw / generic.
- [x] **Runtime hooks** — preflight / sentinel / completion-gate / quarantine wire as native hooks via `topia hooks install`.
- [x] **Step 0 prerequisite gates** on every skill (build needs an approved plan; fix needs a diagnosis from debug; deploy needs passing verification + sentinel).

### v1.x cleanup — accomplished this cycle ✅

**Naming and structure**
- [x] `cook` → `build` rename (712 cross-refs across 143 files).
- [x] `ba` → `idea` fold (~70 cross-refs across SKILL/PACK/agent/test/doc files; `skills/ba/` and `agents/ba.md` deleted; structural drift in `idea/SKILL.md` fixed).
- [x] Marketplace removed — `.claude-plugin/marketplace.json` deleted; `bump-version.js`, `version-sync-check.js`, related tests, `session-bridge` and `CLAUDE.md` references all cleaned.
- [x] Author canonicalized to `skill-topia` everywhere (80 SKILL.md/PACK.md files + `package.json` + `plugin.json` + `LICENSE`).
- [x] CHANGELOG reset — v1.0.0 baseline + v1.1.0 agora-code entry.
- [x] 4 extension packs removed (`@Topia/saas`, `/trading`, `/gamedev`, `/zalo`); 14 → 10 packs, swept across ~30 files; `topia doctor` + tests updated to expect ≥10 packs.

**Mesh integrity (now graph-integrity in user docs)**
- [x] Reciprocal `## Called By` entries added for `idea`'s outbound calls (scout, research, plan, brainstorm, design).
- [x] `documentation/SKILL.md` got its missing `## Sharp Edges` section.
- [x] Orphan skills audit closed — `constraint-check`, `sast`, `worktree` were already wired in both directions.

**Stale references and positioning**
- [x] All `@Topia-pro/*` references stripped or replaced.
- [x] `README.md` rewritten (496 → ~320 lines, no marketplace framing).
- [x] `docs/index.html` rebuilt for v1.1.0 — 8-step "How it works" flow, persistent-memory section, dev-team "Guarantees" replacing internal benchmark, install drops Windsurf, "mesh" jargon mostly gone.
- [x] `docs/VISION.md` heavy mesh language scrubbed — replaced with "graph" / "toolkit" where appropriate.
- [x] `docs/style.css` reset to terminal palette (`#0e1014` bg, `#7dd3fc` cyan accent, JetBrains Mono + Inter).
- [x] All `"in plain English"` phrasings replaced with specific clarity language.
- [x] Telegram workflow (`.github/workflows/notify-telegram.yml`) removed entirely.

**Compiler / scripts / tests**
- [x] `scripts/validate-signals.js` rewritten with proper exports + `{skillCount, signalCount, issues, warnings}` return shape.
- [x] Free/Pro/Business tier code removed from `compiler/status.js` and dependent tests.
- [x] Broken `./tiers.js` imports removed from `compiler/commands/hooks/{status,uninstall}.js`.
- [x] Duplicate `discoverPacks` definition removed from `compiler/emitter.js`.
- [x] Tier-coupled tests fixed in `templates.test.js`, `org-templates.test.js`, `visualizer.test.js`.
- [x] `docs/SIGNALS.md` cleaned of Pro-only listener references.
- [x] `compiler/transforms/branding.js` footer rewritten — no Pro/Business links.

**Skill catalog**
- [x] `docs/SKILLS.md` rewritten with **invocation markers** (👤 user-initiated · 🔄 either · 🤖 agent / auto-fire).

---

## Open — Critical

### Sentinel / preflight org-policy integration (Medium)
`compiler/parser.js` already parses `.topia/org/org.md` (teams, roles, policies, approval flows, governance level) and `compiler/emitter.js` injects a `<ORG-POLICY>` block into sentinel / preflight at compile time. But the `SKILL.md` files lack the static "Step X — Organization Policy Enforcement" sections that describe how to consume the injected block.

Tests already expect these sections:
- `sentinel has Organization Policy Enforcement step` (sentinel SKILL.md)
- `Step 4.86 (between contract 4.85 and six-gate 4.9)` (sentinel SKILL.md)
- `preflight references .topia/org/org.md` (preflight SKILL.md — currently zero refs)
- `preflight has Organization Approval Requirements step` (preflight SKILL.md)
- `preflight handles missing org config gracefully` (preflight SKILL.md)
- `Step 4.6 (between domain hooks 4.5 and composite score 4.8)` (preflight SKILL.md)

**Action:** add Step 4.86 to `sentinel/SKILL.md` and Step 4.6 to `preflight/SKILL.md` describing the `<ORG-POLICY>` block contract.

### Systematic skill / workflow / script audit (v1.2 candidate)
We need a repeatable check that each skill conforms to the SKILL-TEMPLATE contract (frontmatter complete, Sharp Edges present, Called By reciprocated, Triggers list valid, Cost Profile present, etc.) and that scripts haven't drifted.

**Action:** `topia doctor` already covers mesh integrity + required sections. Extend it with:
- Per-skill frontmatter validator (model / layer / tools / group fields populated correctly).
- Trigger phrase validator (every `## Triggers` entry maps to a valid CLI command or hook event).
- Script export validator (every `scripts/*.js` exports what its tests import).
Then add a one-shot `topia audit --skills` mode that prints per-skill scores.

---

## Next (v1.3 — planned)

- [ ] **Adaptive routing** — `skill-router` learns from session success/failure to bias future routing.
- [ ] **Cross-project learning** — `session-bridge` promotes project-local instincts to cross-project memory via agora-code.
- [ ] **Custom pack templates** — standardized scaffolding for new `@Topia/<name>` extension packs.
- [ ] **`topia audit --skills`** — automated per-skill conformance scoring.
- [ ] **Sentinel / preflight org-policy steps** — add static sections that consume the injected `<ORG-POLICY>` block.

---

## Later (v1.3+)

- [ ] **Signal-driven orchestration** — skills auto-trigger from graph signals without explicit parent control.
- [ ] **Deep codebase mapping** — `scout` upgrade for semantic graph analysis of large repos.
- [ ] **Visual skill editor** — drag-and-drop graph builder for designing skill connections.
- [ ] **Collaborative session bridge** — multi-user `.topia/` sync for teams working on the same project.
- [ ] **Model-agnostic adapters** — improved mappings for non-Anthropic models.

---

## Vision (longer horizon)

- [ ] **Autonomous engineering team mode** — multiple specialized agents (architect / coder / reviewer / deployer) operating as a coordinated graph instead of a single agent.
- [ ] **Self-healing toolkit** — detect and repair broken skill connections automatically.

---

## Pack and platform status

| Layer | Status |
|------|--------|
| Core skills (65) | ✅ Complete |
| Extension packs (10) | ✅ Complete — `@Topia/{ui,backend,devops,mobile,security,ecommerce,ai-ml,content,analytics,chrome-ext}` |
| Platforms (6) | ✅ Active — Claude Code · Cursor · Codex · Antigravity · OpenCode · OpenClaw |
| agora-code MCP (vendored, opt-in) | ✅ Wired into 4 skills with graceful degradation |

---

_Last consolidated: 2026-05-17._
