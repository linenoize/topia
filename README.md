<p align="center">
  <img src="assets/banner.svg" alt="Topia — discipline rails for AI coding agents" width="100%">
</p>

<p align="center">
  <strong>Topia — internal skill toolkit for AI coding assistants.</strong><br>
  65 skills · 203 synapses · 44 pulses · 10 extension packs · optional persistent memory via agora-code MCP
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

## Install

### Claude Code (recommended — plugin marketplace)

Install like any other Claude Code plugin — no clone required for the plugin itself:

```text
/plugin marketplace add protopia/skill-topia
/plugin install skill-topia@protopia
```

Then wire global discipline hooks (one-time per machine). The npm package is **not** required for a private repo — use `node` against a clone or the Claude plugin cache (see [`docs/INSTALL-CLAUDE-CODE.md`](docs/INSTALL-CLAUDE-CODE.md)):

```bash
cd skill-topia && node compiler/bin/topia.js setup --global --preset gentle
```

Restart Claude Code, then use `/topia build` or `/Topia:build`. Full guide: [`docs/INSTALL-CLAUDE-CODE.md`](docs/INSTALL-CLAUDE-CODE.md). Team repos can merge [`docs/templates/team-claude-settings.json`](docs/templates/team-claude-settings.json) into `.claude/settings.json` to prompt the marketplace on folder trust.

Validate the catalog before release: `claude plugin validate .`

### Clone + one-shot installer (contributors / offline)

```bash
git clone https://github.com/protopia/skill-topia.git
cd skill-topia
npm install
node compiler/bin/topia.js install
```

Optional stable location: `~/.claude/skills/skill-topia` (see [`docs/INSTALL-CLAUDE-CODE.md`](docs/INSTALL-CLAUDE-CODE.md)).

`topia install` is a one-shot orchestrator. In order, it:

1. **Pre-flights rune-kit conflicts.** If [rune-kit](https://github.com/Rune-kit/rune) is detected on your machine, the installer halts and asks: migrate `.rune/` state into `.topia/` and disable rune-kit, abort so you can remove rune-kit manually, or skip (with a warning that the two plugins will fight over skill names).
2. **Registers the plugin** via the Protopia marketplace (`marketplace add` + `plugin install skill-topia@protopia`), falling back to `claude plugin add .` if needed.
3. **Wires discipline hooks** globally: `readiness` (logic gates), `guardian` (secrets/OWASP), `completion-gate` (claims-vs-evidence), `quarantine` (untrusted-input advisory).
4. **Installs the agora-code MCP** for persistent memory if Python 3.10+ is on your machine. Registers `agora-memory` in your project's `.mcp.json`. Skip with `--skip-agora`. (No Python? You get a one-line notice, install continues without persistent memory.)
5. **Runs `topia doctor`** to verify the install.

> **Restart Claude Code after install** so it picks up the newly-registered plugin. Until you restart, `/topia <skill>` commands won't be available.

Then edit [`.topia/org/org.md`](.topia/org/org.md) to set team policies and approval flows — `guardian` and `readiness` read this. See [`docs/ORG-CONFIG.md`](docs/ORG-CONFIG.md) for what each section drives.

Explore the skill graph:

```bash
node compiler/bin/topia.js visualize   # writes .topia/nexus.html and opens in browser
```

### Verify

```bash
node compiler/bin/topia.js doctor
# ✓ 65 skills, 203 synapses, 44 pulses — nexus is healthy
```

### Non-Claude IDEs

```bash
node compiler/bin/topia.js init --platform cursor       # also: codex, antigravity, opencode, openclaw, generic
```

Compiles all 65 skills to the target IDE's rule format.

### Install flags

```bash
node compiler/bin/topia.js install --dry-run        # preview every step, no writes
node compiler/bin/topia.js install --here           # hooks per-project instead of global
node compiler/bin/topia.js install --preset strict  # blocking gates (default: gentle / advisory)
node compiler/bin/topia.js install --skip-agora     # don't install Python MCP
node compiler/bin/topia.js install --yes            # non-interactive (CI-friendly; aborts on rune-kit)
```

### About agora-code MCP

Topia ships a vendored copy of [agora-code](https://github.com/thebnbrkr/agora-code) at [`mcp-servers/agora-code/`](mcp-servers/agora-code/). It provides SQLite-backed memory, symbol indexing, and semantic recall via the MCP protocol. Four Topia skills (`journal`, `build`, `idea`, `neural-memory`) detect it automatically and route recall / learning through it. Without it, those skills fall back to file-based `.topia/` persistence.

Integration details: [`docs/mcp-integrations/agora-code.md`](docs/mcp-integrations/agora-code.md). Upstream README (vendored verbatim): [`mcp-servers/agora-code/README.md`](mcp-servers/agora-code/README.md).

> **Do NOT** run `agora-code install-hooks --claude-code`. Topia's hooks are canonical — running both installers produces a fragile dual-owner hook chain. The `topia install` command above sets up agora-code as an **MCP server only**, never installs its hooks. See the integration doc for the full rationale.

### Coming from rune-kit?

`topia install` handles this for you. If you'd rather migrate explicitly outside the installer:

```bash
node compiler/bin/topia.js migrate-from-rune --dry-run    # preview
node compiler/bin/topia.js migrate-from-rune              # interactive
```

This copies `.rune/` state files (decisions, ADRs, conventions, learnings) into `.topia/` and renames `~/.claude/plugins/cache/rune-kit/` → `.disabled` so the two plugins stop fighting over skill names. Reversible: see [`docs/migration/from-rune.md`](docs/migration/from-rune.md).

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

The `org/org.md` is the only `.topia/` file committed to the repo — it holds stable team and policy configuration. `guardian` and `readiness` consume it at compile time and inject an `<ORG-POLICY>` block into their runtime hooks. See [`.topia/org/org.md`](.topia/org/org.md) for the template.

---

## Reference

| Doc | Contents |
|---|---|
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
Skills:            65 (L0:1 · L1:5 · L2:~30 · L3:27)
Extension Packs:   10
Synapses:       203 (3.1 avg/skill)
Pulses:           44 (51 emit/listen edges)
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
