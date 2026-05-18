# Changelog

All notable changes to Topia will be documented in this file.

---

## [1.2.1] — 2026-05-18

### Added
- **`topia install` command** — one-shot orchestrator that replaces the manual 5-step setup. Pre-flights rune-kit conflicts (offers migrate / abort / skip), registers the plugin with Claude Code (`claude plugin add .`), wires discipline hooks globally, installs the agora-code MCP if Python 3.10+ is available, registers it in `.mcp.json`, and runs `topia doctor` to verify. Cross-platform binary detection for `claude`, `python3` / `python` / `py`, `pip3` / `pip`. Flags: `--dry-run`, `--here`, `--preset`, `--skip-agora`, `--skip-rune-check`, `--yes`.
- **`scripts/postinstall.js`** — fires after every `npm install`, prints the one-command next-step. Quiet in CI and when run as a transitive dependency.
- **`docs/ORG-CONFIG.md`** — explains `.topia/org/org.md`: what each section drives (Teams / Roles / Policies / Approval Flows / Governance Level), when to edit, how to verify changes took effect, what happens if the file is missing or malformed.

### Changed
- **`README.md` install section** — replaces the 5-step manual flow with the single `node compiler/bin/topia.js install` command. Documents the `--dry-run`, `--here`, `--preset`, `--skip-agora`, `--yes` flags. Adds an explicit "restart Claude Code after install" note and a pointer to `.topia/org/org.md` + `docs/ORG-CONFIG.md`.
- **`.topia/org/org.md`** — opening note now points users at `docs/ORG-CONFIG.md` for the full field reference and re-emphasises the "re-run `topia setup` after editing" step.
- **`package.json`** — added `"postinstall": "node scripts/postinstall.js"`.

---

## [1.2.0] — 2026-05-18

### Added
- **`topia migrate-from-rune` command** — interactive migration for projects coming from [rune-kit](https://github.com/runedev/rune-kit). Pulls `.rune/` state (decisions, ADRs, conventions, learnings, features) into `.topia/`, then renames `~/.claude/plugins/cache/rune-kit/` to `.disabled` so Claude Code stops loading it. Conflict-safe (existing `.topia/` files preserved unless `--force`), idempotent (writes `.topia/migrated-from-rune.flag`), reversible (`--skip` writes a suppression flag, `mv rune-kit.disabled rune-kit` restores).
- **Session-start hook detection** — `hooks/session-start/index.cjs` now detects `.rune/` and the rune-kit plugin on every session. If neither flag (`migrated-from-rune.flag` or `skip-rune-migration.flag`) is present, prints a prominent warning explaining the routing-conflict risk and pointing at the migration command. Self-suppressing once a flag is written.
- **`docs/migration/from-rune.md`** — full migration guide (what gets copied, what gets disabled, how to revert).
- **`commands/migrate-from-rune.md`** — slash-command definition for `/topia migrate-from-rune`.
- **Doctor: `Frontmatter conformance` check** — verifies every SKILL.md declares the six required metadata fields (`author`, `version`, `layer`, `model`, `group`, `tools`). Warns if any are missing.

### Changed
- **`compiler/bin/topia.js`** — new `migrate-from-rune` subcommand wired with `--dry-run` / `--force` / `--skip` / `--yes` flags.
- **Doctor: `Required sections` extended** — now requires `Purpose` and `Constraints` in addition to `Sharp Edges`, `Done When`, `Cost Profile`. Added `## Purpose` headings to `scout`, `test`, `verification` SKILL.md files where the intro paragraph existed without the heading.
- **Repo URLs updated** — moved from `github.com/skill-topia/Topia` to `github.com/linenoize/topia`; npm package `@skill-topia/topia` → `@linenoize/topia`; landing page links + install instructions + hook-detection regexes updated across ~32 files. CLI command stays `topia`; author identity stays `skill-topia`.
- **Docs trimmed** — deleted `docs/USER-GUIDE-CYCLE.md` and `docs/DEVELOPER-CYCLE.md` (163 lines of content redundant with `docs/index.html` "How it works" + "Scenarios" sections and `docs/GETTING_STARTED.md`).

---

## [1.1.0] — 2026-05-16

### Added
- **Vendored agora-code MCP server** at `mcp-servers/agora-code/` — persistent memory + codebase intelligence for AI coding agents (Apache 2.0, vendored from [thebnbrkr/agora-code](https://github.com/thebnbrkr/agora-code)). Provides MCP tools: `store_learning`, `recall_learnings`, `get_file_symbols`, `search_symbols`, `recall_file_history`, `complete_session`, `list_sessions`, `get_memory_stats`. Opt-in — requires Python 3.10+ and `pip install ./mcp-servers/agora-code`.
- **`docs/mcp-integrations/agora-code.md`** — integration guide with install, MCP registration, per-skill usage, graceful-degradation contract, and caveats (Python dependency, hook overlap with `topia hooks install`, upstream drift policy).
- **`mcp-servers/agora-code/NOTICE-TOPIA.md`** — Apache 2.0 attribution + vendoring metadata + upstream refresh procedure.

### Changed
- **`skills/journal/SKILL.md`** — new "Optional MCP Integration" section: when `agora-memory` MCP is registered, ADR writes additionally call `store_learning` and session end calls `complete_session`. File-based persistence remains source of truth.
- **`skills/build/SKILL.md`** — Phase 1 Step 2.5 (new): optional `recall_learnings` call before `idea` gate, surfaces past similar features/bugs from agora-code if available.
- **`skills/idea/SKILL.md`** — Step 1.2 (Neural Memory Retrieval): now also calls agora-code's `recall_learnings` when available, merged with neural-memory results.
- **`skills/neural-memory/SKILL.md`** — new "Optional MCP Backend: agora-code" section: routes capture/recall/symbol-lookup/file-history to agora-code when both MCPs are registered.

---

## [1.0.0] — 2026-05-15

Initial internal release of Topia — an interconnected skill ecosystem for AI coding assistants.

### Core
- **65 skills** wired into a 5-layer mesh:
  - **L0 Router** (1): `skill-router`
  - **L1 Orchestrators** (5): `build`, `team`, `launch`, `rescue`, `scaffold`
  - **L2 Workflow Hubs** (~30): `plan`, `scout`, `idea`, `debug`, `fix`, `test`, `review`, `sentinel`, `design`, `db`, `mcp-builder`, …
  - **L3 Utilities** (~27): `research`, `verification`, `git`, `journal`, `worktree`, `constraint-check`, `sast`, …
- **203 sync connections** + **44 async signals** between skills, with reciprocal `Called By` tracking enforced by `topia doctor`.
- **5-layer rule**: L1 calls L2/L3, L2 calls L2/L3, L3 calls nothing (with documented exceptions for `team` meta-orchestration).

### Multi-platform compiler
- Single `skills/` source of truth compiles to Claude Code (native plugin), Cursor, Windsurf, Antigravity, Codex, OpenCode, and a generic target.
- CLI commands: `topia init`, `build`, `doctor`, `status`, `visualize`, `hooks install`.
- Runtime layer wires `preflight` / `sentinel` / `completion-gate` / `quarantine` as native hooks on Claude Code, Cursor, Windsurf, Antigravity.

### Workflow enforcement
- Step 0 prerequisite checks on every skill — e.g., `build` requires an approved plan, `fix` requires a diagnosis from `debug`, `deploy` requires passing `verification` + `sentinel`.
- `Mandatory Skill Routing` table in `CLAUDE.md` maps user intent → skill, blocking casual ad-hoc work.

### Extension packs (10)
`@Topia/ui`, `@Topia/backend`, `@Topia/devops`, `@Topia/mobile`, `@Topia/security`, `@Topia/ecommerce`, `@Topia/ai-ml`, `@Topia/content`, `@Topia/analytics`, `@Topia/chrome-ext`.

### Internal-only
- No marketplace distribution. Install by cloning the repo and pointing Claude Code at the directory.
- Author: `skill-topia`. License: MIT.
