<p align="center">
  <img src="assets/banner.svg" alt="Topia — discipline rails for AI coding agents" width="100%">
</p>

<p align="center">
  <strong>Topia — internal skill toolkit for AI coding assistants.</strong><br>
  71 skills · 315 synapses · 49 pulses · 10 extension packs · optional persistent memory via agora-code MCP
</p>

<p align="center">
  <strong>Claude Code</strong> (native) · <strong>Cursor</strong> · <strong>Antigravity</strong> · <strong>Codex</strong> · <strong>OpenCode</strong> · <strong>OpenClaw</strong>
</p>

---

## What Topia is

AI coding agents are smart but undisciplined. They skip steps, forget context across sessions, and ship code that "looks done." Topia gives them workflow rails the model can't skip:

- **Plan before code** — `idea` elicits requirements, `plan` writes phase files, `adversary` red-teams the plan, all before a line of code.
- **Tests before commits** — `test` writes failing tests first (red), `fix` implements until green. TDD enforced, not suggested.
- **Hooks block bad work** — `guardian` (secrets, OWASP), `readiness` (logic, regressions), `completion-gate` (validates agent claims have evidence). Auto-fire on tool use.
- **Memory survives sessions** — `journal` persists ADRs to `.topia/`, optional [agora-code MCP](mcp-servers/agora-code/README.md) adds SQLite-backed semantic recall across sessions.

One source of truth (`skills/`) compiles to six IDE rule formats — switch IDEs without rewriting your workflow rules.

---

## Install (Claude Code)

Full guide: [`docs/INSTALL.md`](docs/INSTALL.md). **Teams:** see [Team policy](#team-policy-orgmd) below.

### Step 1 — Install the plugin (in chat, no terminal)

```text
/plugin marketplace add linenoize/topia
/plugin install topia@linenoize
```

Restart Claude Code if `/topia:build` does not appear.

| Marketplace path | Works? |
|------------------|--------|
| `linenoize/topia` (recommended) | ✓ |
| Git URL to the repo | ✓ |
| Direct URL to `marketplace.json` | ✓ (v3.1.2+) |
| Local clone path | ✓ |

**Plugin id is lowercase `topia`.** If install fails, run `/plugin marketplace update linenoize` first.

**After Step 1 you have:** all `/topia:*` skills, plugin hooks (session-start, secrets-scan, quarantine, …), and file-based `.topia/` memory — but **not** machine-wide dispatch hooks, team `org.md` policy, or agora-code MCP until Step 2.

### Step 2 — Finalize (in chat, recommended)

```text
/topia finalize
```

**Run this once per machine** (and again when you want to change hooks or org policy). It enables:

| What finalize adds | Why it matters |
|--------------------|----------------|
| **Dispatch hooks** (`readiness`, `guardian`, `completion-gate`, `dependency-doctor`) | Auto-fire on edits and shell commands **in every repo**, even when the plugin is not loaded |
| **Team org policy** (interview → `.topia/org/org.md`) | `guardian` and `readiness` enforce *your* review, security, and deploy rules — not the template |
| **agora-code MCP** (optional) | Cross-session semantic memory |
| **Project `.gitignore`** (optional) | Keeps `.topia/` session state out of git (except `org/`) |

**If you skip Step 2:** skills still work when you invoke them; discipline gates only run when you remember to call them or when plugin hooks fire in that session. Cross-repo consistency and team policy injection are the main gaps.

Details: [`docs/INSTALL-CLAUDE-CODE.md`](docs/INSTALL-CLAUDE-CODE.md) · [`commands/finalize.md`](commands/finalize.md)

### Per project (each repo you work in)

Run in **that project's** Claude Code session:

| Step | Command | What you get |
|------|---------|--------------|
| 1 | `/topia onboard` | `CLAUDE.md` + `.topia/` context so every session starts with codebase knowledge |
| 2 | `/topia org-config` | Team policy in `.topia/org/org.md` (also offered during finalize) |
| 3 | `/topia doctor` | Verify install and nexus health |

**Teams:** commit `.topia/org/` to git so every teammate and agent shares the same gates. See [`docs/ORG-CONFIG.md`](docs/ORG-CONFIG.md).

### Team policy (`org.md`)

[`.topia/org/org.md`](.topia/org/org.md) is where your team defines roles, reviewers, security SLAs, deploy windows, and governance level. Topia compiles it into `guardian` and `readiness` hooks — so "we require two reviewers on security files" becomes an actual gate, not a wiki page.

- **Set up in chat:** `/topia org-config` (structured interview) or during `/topia finalize`
- **Edit later:** change `org.md`, then refresh hooks (`/topia finalize` or `topia setup --global`)

### Other IDEs (Cursor, Codex, Windsurf, …)

The Claude plugin does **not** compile Cursor/Codex rules. One-time terminal compile from your project root:

```bash
node "<path-to-topia>/compiler/bin/topia.js" init --platform cursor
```

→ [`docs/INSTALL-NON-CLAUDE.md`](docs/INSTALL-NON-CLAUDE.md) (secondary path; Claude install above is primary)

### Contributors / terminal install

```bash
git clone https://github.com/linenoize/topia.git
cd topia && npm install
node compiler/bin/topia.js install
```

Optional stable location: `~/.claude/skills/topia`. `topia install` registers the plugin, wires hooks, installs agora-code MCP (if Python 3.10+), and runs doctor. Restart Claude Code after install.

```bash
node compiler/bin/topia.js install --dry-run        # preview every step
node compiler/bin/topia.js install --here           # hooks per-project instead of global
node compiler/bin/topia.js install --preset strict  # blocking gates (default: gentle)
node compiler/bin/topia.js install --skip-agora     # skip Python MCP
node compiler/bin/topia.js install --yes            # non-interactive (CI-friendly)
```

### Verify (terminal)

From a Topia clone or plugin cache path:

```bash
node compiler/bin/topia.js doctor
# ✓ 71 skills, 315 synapses, 49 pulses — nexus is healthy
```

Claude-only users can use `/topia doctor` in chat instead.

### About agora-code MCP

Topia ships a vendored copy of [agora-code](https://github.com/thebnbrkr/agora-code) at [`mcp-servers/agora-code/`](mcp-servers/agora-code/). Four skills (`journal`, `build`, `idea`, `neural-memory`) detect it automatically. Without it, skills fall back to file-based `.topia/` persistence.

Integration: [`docs/mcp-integrations/agora-code.md`](docs/mcp-integrations/agora-code.md). **Do NOT** run `agora-code install-hooks --claude-code` — Topia's hooks are canonical.

### Coming from rune-kit?

`topia install` handles migration. Manual path:

```bash
node compiler/bin/topia.js migrate-from-rune --dry-run
node compiler/bin/topia.js migrate-from-rune
```

See [`docs/migration/from-rune.md`](docs/migration/from-rune.md).

---

## Use

Every skill is invoked as `/topia <name>`. The router picks the right skill from a natural description of what you want done.

```bash
/topia onboard                # generate CLAUDE.md + .topia/ context for a new project
/topia build "add JWT auth"   # implement a feature (full TDD cycle)
/topia debug "login 401s"     # root-cause an issue
/topia rescue                 # refactor legacy code safely
/topia audit                  # 8-dimension project health check
/topia sentinel               # security scan before commit
/topia incident "503s"        # production incident response
/topia retro                  # engineering retrospective
```

The 8-step build flow (route → recall → plan → test → implement → gate → verify → persist+commit) is documented on the [landing page](docs/index.html). Concrete scenarios — "I just inherited this codebase," "production is down," "I want to steal a pattern from a GitHub repo" — live in the [Scenarios section](docs/index.html#scenarios).

---

## Skill catalog

### Core development & workflow
| Skill | Purpose |
|---|---|
| `build` | **L1 orchestrator** — full TDD cycle (Understand → Plan → Test → Implement → Verify → Commit). Default route for most code tasks. |
| `rescue` | **L1 orchestrator** — multi-session legacy refactor with safety nets. |
| `scaffold` | **L1 orchestrator** — bootstrap a new project from a description. |
| `team` | **L1 orchestrator** — decompose into parallel workstreams with worktree isolation. |
| `launch` | **L1 orchestrator** — deploy + verify + announce. |
| `fix` | Apply code changes from diagnosis or review findings. |
| `debug` | Root-cause analysis; hands off to `fix`. |
| `test` | TDD test writer — red first, green after. |
| `scout` | Fast read-only codebase scanner. |
| `verification` | Run lint + type-check + tests + build. |
| `db` | Migrations, rollbacks, query validation. |
| `git` | Semantic commits, PR bodies, branch naming. |
| `integrate` | Port features from external GitHub repos. |
| `surgeon` | Incremental refactor (Strangler Fig, Branch by Abstraction). |
| `safeguard` | Characterization tests + rollback markers before risky refactors. |
| `improve-architecture` | Find friction; propose deepening opportunities. |
| `mcp-builder` | Generate MCP servers from spec. |

### Security, governance, infrastructure
| Skill | Purpose |
|---|---|
| `guardian` | Pre-commit security gate — OWASP, secrets, deps. |
| `readiness` | Pre-commit quality gate — logic, regressions, completeness. |
| `guardian-env` | OS + runtime + tools + ports + env-var check before work starts. |
| `sast` | Static-analysis wrapper (ESLint, Semgrep, Bandit, Clippy). |
| `adversary` | Pre-implementation red-team analysis on high-risk plans. |
| `logic-guardian` | Protects business logic from accidental deletion. |
| `quarantine` | Advisory on untrusted MCP / WebFetch / upload content. |
| `hallucination-guard` | Catch phantom imports, non-existent packages. |
| `deploy` | Multi-platform deploy with health checks. |
| `watchdog` | Post-deploy health monitoring. |
| `incident` | Production incident response (triage → contain → root-cause → postmortem). |
| `dependency-doctor` | Outdated packages + CVE scan + prioritized update plan. |
| `audit` | 8-dimension project health audit. |
| `perf` | Performance regression gate (N+1, sync-in-async, bundle bloat). |

### Knowledge, research, strategy
| Skill | Purpose |
|---|---|
| `research` | Web search for technologies + best practices. |
| `docs` | Auto-generate + maintain README, API, architecture docs. |
| `docs-seeker` | Locate API references, changelogs, migration guides. |
| `documentation` | Leadership-ready packages, user stories, Jira CSV. |
| `onboard` | Generate CLAUDE.md + .topia/ context for a new project. |
| `brainstorm` | Generate 2-3 approaches with trade-offs. |
| `design` | Design-system generator (palette, typography, anti-patterns). |
| `problem-solver` | 19 analytical frameworks + 12 bias detectors. |
| `sequential-thinking` | Multi-variable analysis with dependency ordering. |
| `journal` | ADRs, decisions, progress across sessions. |
| `neural-memory` | Cross-session recall via semantic graph (uses agora-code MCP when registered). |
| `trend-scout` | Market intelligence (Product Hunt, GitHub Trending, HN, Reddit). |
| `autopsy` | Health assessment of legacy codebases (rescue RECON). |
| `doc-processor` | Generate / parse PDF, DOCX, XLSX, PPTX, CSV. |

### Planning & management
| Skill | Purpose |
|---|---|
| `plan` | Master plan + phase files for multi-phase features. |
| `idea` | Requirements elicitation — 5-question gate, cross-session memory. |
| `review` | Code review with `file:line` findings. |
| `review-intake` | Process external PR comments / issue triage. |
| `retro` | Engineering retrospective on commit history. |
| `scope-guard` | Detect + quantify scope creep. |
| `context-pack` | Bundle context for sub-agent delegation. |
| `completion-gate` | Validate agent claims against evidence trail. |

### Creative & specialized
| Skill | Purpose |
|---|---|
| `asset-creator` | SVG icons, OG images, social banners. |
| `marketing` | Landing copy, SEO meta, blog posts, video scripts. |
| `slides` | Marp-compatible decks from JSON schema. |
| `video-creator` | Video plans — scripts, storyboards, asset checklists. |
| `browser-pilot` | Playwright automation + a11y audit. |

### Internal toolkit primitives
| Skill | Purpose |
|---|---|
| `skill-router` | L0 — routes every action to the right skill. |
| `skill-forge` | Build + verify new Topia skills. |
| `context-engine` | Context-window management + compaction. |
| `session-bridge` | Cross-session state persistence. |
| `worktree` | Git worktree lifecycle for parallel streams. |
| `integrity-check` | Detect adversarial content in `.topia/` files. |
| `constraint-check` | Validate that HARD-GATEs were actually followed. |

Full catalog with invocation markers (👤 user / 🔄 either / 🤖 agent): [`docs/SKILLS.md`](docs/SKILLS.md).

---

## Extension packs

Install what you need; each pack adds 3–8 domain-specific skills that plug into the core toolkit.

| Pack | Focus |
|---|---|
| `@Topia/ui` | Design systems, accessibility, animation, React patterns |
| `@Topia/backend` | API, auth, DB, middleware |
| `@Topia/mobile` | React Native, Flutter, app store |
| `@Topia/devops` | Docker, CI/CD, SSL, monitoring |
| `@Topia/security` | Pentest, supply chain, API hardening |
| `@Topia/ecommerce` | Shopify, payments, cart, inventory |
| `@Topia/ai-ml` | LLM, RAG, embeddings |
| `@Topia/content` | Blog, CMS, MDX, i18n, SEO |
| `@Topia/analytics` | Tracking, A/B, funnels |
| `@Topia/chrome-ext` | Manifest V3, service workers |

---

## Auto-discipline hooks

```bash
node compiler/bin/topia.js hooks install --preset gentle     # advisory (default)
node compiler/bin/topia.js hooks install --preset strict     # blocking
node compiler/bin/topia.js hooks status                      # inspect wiring
node compiler/bin/topia.js hooks uninstall                   # remove cleanly
```

| Event | Skill | Fires |
|---|---|---|
| `PreToolUse(Edit\|Write)` | `readiness` | Before source-file edits |
| `PreToolUse(Bash)` | `guardian` | Before shell commands |
| `PostToolUse(Edit\|Write)` | `dependency-doctor` | After manifest edits |
| `Stop` | `completion-gate` | End of session |

---

## Architecture

Five layers, each with one responsibility:

| Layer | Role | Count |
|---|---|---|
| **L0 Router** | Routes every action | 1 |
| **L1 Orchestrators** | Full lifecycle workflows | 5 (`build`, `team`, `launch`, `rescue`, `scaffold`) |
| **L2 Workflow Hubs** | Cross-hub coordination — the differentiator | ~30 |
| **L3 Utilities** | Stateless, pure capabilities | 27 |
| **L4 Extensions** | Domain-specific packs | 10 |

Skills only call downward (with documented L3→L3 exceptions). Connections are declared in `## Calls` / `## Called By`. Event-driven coordination is declared in `emit` / `listen` pulses — full inventory in [`docs/PULSES.md`](docs/PULSES.md). Full architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Cross-session state

```
.topia/
├── decisions.md     architectural decisions log
├── conventions.md   established patterns & style
├── progress.md      task progress tracker
├── session-log.md   brief session history
├── adr/             individual ADR files (numbered)
├── features/        per-feature requirements + plans
└── org/
    └── org.md       team / role / policy config — committed
```

Every new session loads `.topia/` automatically.

Only the `org/` tree is intended for commit; all other `.topia/*` (including `active-packs.json`) stays local per workspace.

### Project .gitignore

`topia install` and `topia setup --here` prompt once to append Topia ignore rules (`.topia/*`, `.mcp.json`, with an exception for `org/`). Decline is remembered via `.topia/skip-gitignore.flag`. Verify anytime with `topia doctor`.

### L4 packs: shipped vs activated

All `@Topia/*` packs ship with the plugin. **Onboard**, **`topia install`**, and **`topia init`** (non-Claude) run stack detection and write `.topia/active-packs.json` so each workspace declares which packs to lean on — not a separate install step. Re-run anytime with `topia packs detect`.

The `org/` tree holds stable team and policy configuration. `guardian` and `readiness` consume it at compile time and inject an `<ORG-POLICY>` block into their runtime hooks. See [`.topia/org/org.md`](.topia/org/org.md) for the template.

---

## Reference

| Doc | Contents |
|---|---|
| [`docs/INSTALL.md`](docs/INSTALL.md) | Install hub — Claude, Cursor, hybrid |
| [`docs/INSTALL-CLAUDE-CODE.md`](docs/INSTALL-CLAUDE-CODE.md) | Claude Code plugin install |
| [`docs/INSTALL-NON-CLAUDE.md`](docs/INSTALL-NON-CLAUDE.md) | Cursor, Codex, Windsurf, etc. |
| [`docs/GETTING_STARTED.md`](docs/GETTING_STARTED.md) | First 5 minutes |
| [`docs/SKILLS.md`](docs/SKILLS.md) | Full skill catalog with invocation markers |
| [`docs/SKILL-CATEGORIES.md`](docs/SKILL-CATEGORIES.md) | Skill taxonomy reference |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 5-layer architecture details |
| [`docs/PULSES.md`](docs/PULSES.md) | Pulse inventory + emit/listen graph |
| [`docs/HOOKS.md`](docs/HOOKS.md) | Hook reference per platform |
| [`docs/mcp-integrations/agora-code.md`](docs/mcp-integrations/agora-code.md) | Persistent-memory MCP integration |
| [`docs/migration/from-rune.md`](docs/migration/from-rune.md) | Migrating from rune-kit |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Common issues + fixes |
| [`docs/VISION.md`](docs/VISION.md) | Strategic positioning + skill-addition filter |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |
| [`ROADTODO.md`](ROADTODO.md) | Roadmap + outstanding work |
| [`mcp-servers/agora-code/README.md`](mcp-servers/agora-code/README.md) | Vendored agora-code reference (Apache 2.0) |

---

## Numbers

```
Skills:            71 (L0:1 · L1:5 · L2:33 · L3:32)
Extension Packs:   10
Synapses:          315 (4.4 avg/skill)
Pulses:            49 (60 emit/listen edges)
Platforms:         Claude Code, Cursor, Codex, Antigravity, OpenCode, OpenClaw, Generic
Tests:             1,035 passing
```

---

## Acknowledgments

- **[agora-code](https://github.com/thebnbrkr/agora-code)** (Apache 2.0) — vendored at `mcp-servers/agora-code/` for optional persistent memory. See [`mcp-servers/agora-code/NOTICE-TOPIA.md`](mcp-servers/agora-code/NOTICE-TOPIA.md) for attribution + refresh procedure.
- **[UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)** (MIT) — design-intelligence DB powering `design` + `@Topia/ui`.
- **[biome](https://github.com/biomejs/biome)** (MIT) (Apache 2.0) - Installed for app use.
- **[rune-kit](https://github.com/Rune-kit/rune)** (MIT) — Workflow, hooks, skill, methodology process grafted (integrated) into the topia operation. 


---

## License

MIT — see [`LICENSE`](LICENSE). Vendored agora-code is Apache 2.0 — see [`mcp-servers/agora-code/LICENSE`](mcp-servers/agora-code/LICENSE).
