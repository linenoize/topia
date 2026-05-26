---
description: "Topia skill toolkit — interconnected workflows for the full project lifecycle. Use /topia <action> to invoke a skill or run a CLI command."
disable-model-invocation: true
---

# Topia

Route to the appropriate Topia skill, CLI command, or extension pack based on the action.

> **Invocation legend:** 👤 user-invoked · 🤖 agent / auto-fires · ↻ either (standalone or called mid-workflow).

---

## Finalize install (run from inside Claude — no terminal required)

- `/topia finalize` — **in-Claude one-shot finish-install.** Run after `/plugin install topia@linenoize` to enable the optional extras (system-wide dispatch hooks, agora-code MCP, project `.gitignore`) without leaving the chat. See [`commands/finalize.md`](finalize.md). Flags: `--strict`, `--skip-agora`, `--all`, `--reset`.

## CLI commands (run from terminal)

These are entry-points the user runs in their shell. They do not invoke a skill — they execute the `compiler/bin/topia.js` binary.

- `topia install` — terminal alternative to `/topia finalize` for users running from a clone. One-shot end-to-end setup (rune-kit detect → plugin register → hooks wire → agora-code MCP install → doctor verify). Flags: `--dry-run`, `--here`, `--preset gentle|strict`, `--yes`, `--skip-agora`, `--skip-rune-check`.
- `topia setup` — interactive wizard for the hook-installer step only (scope + preset). Useful when you've already cloned + `npm install`'d but want to (re)wire hooks.
- `topia init` — for non-Claude IDEs: compile skills into the target platform's rule format (`--platform cursor|codex|antigravity|opencode|openclaw|generic`).
- `topia build` — recompile skills using the existing `topia.config.json`.
- `topia doctor` — validate compiled output + nexus integrity (`--nexus` for nexus only, `--hooks` for hook drift, `--strict` for CI).
- `topia status` — neofetch-style project dashboard.
- `topia visualize` — open the interactive skill-graph in a browser.
- `topia analytics` — usage analytics dashboard (sessions, skills, **token KPIs**). See [`docs/TOKEN-METRICS.md`](../docs/TOKEN-METRICS.md).
- `topia metrics` — token + nexus metrics summary (alias for analytics token queries; opens dashboard unless `--json`).
- `topia hooks install|uninstall|status` — manage runtime hooks per platform.
- `topia migrate-from-rune` — pull `.rune/` memories into `.topia/` and disable the rune-kit plugin. See [`commands/migrate-from-rune.md`](migrate-from-rune.md).

---

## L0 Router (1)

- 🤖 `/topia skill-router` — meta-enforcement layer. Routes every action to the right skill. Rarely invoked directly; runs implicitly on every request.

## L1 Orchestrators (5)

- 👤 `/topia build <task>` — feature implementation orchestrator (full TDD cycle). Default route for most code changes.
- 👤 `/topia team <task>` — multi-agent meta-orchestrator for parallel work spanning 5+ files or 3+ modules.
- 👤 `/topia launch` — deploy + marketing orchestrator (pre-flight → deploy → live verification → assets → announce).
- 👤 `/topia rescue` — legacy refactoring orchestrator (multi-session, safety nets, incremental modernization).
- 👤 `/topia scaffold <description>` — autonomous project bootstrapper (0 → production-ready in one pipeline).

## L2 Workflow Hubs

### Creation
- 👤 `/topia idea <requirement>` — requirements elicitation (5 probing questions → Requirements Document).
- 👤 `/topia plan <task>` — structured implementation plan (master plan + phase files).
- 👤 `/topia scout` — fast read-only codebase scanner (files, patterns, dependencies).
- 👤 `/topia brainstorm <topic>` — creative ideation with trade-offs.
- 👤 `/topia design` — design-system generator (palette, typography, anti-patterns → `.topia/design-system.md`).
- 👤 `/topia skill-forge` — create new Topia skills, edit existing ones, verify quality.
- 👤 `/topia mcp-builder <spec>` — generate Model Context Protocol servers (TypeScript or Python).
- ↻ `/topia adversary` — pre-implementation red-team analysis. User-callable; also runs as `build` Phase 2.5.

### Development
- 👤 `/topia debug <issue>` — root cause analysis (does NOT fix; hands off to `fix`).
- ↻ `/topia fix <issue>` — apply code changes from diagnosis or review findings. Called by `build` Phase 4.
- ↻ `/topia test` — TDD test writer (red → green). Called by `build` Phase 3.
- ↻ `/topia db <task>` — database workflow specialist (migrations, schema diff, query audit). Auto-called by `build` when schema files change.

### Quality
- 👤 `/topia review` — code-quality review with `file:line` findings.
- ↻ `/topia review-intake <PR-url-or-issue>` — process external review feedback or triage inbound issues. Also auto-runs in `build` Phase 5 when external feedback is detected.
- 🤖 `/topia readiness` — pre-commit quality gate (logic, regressions, completeness). Auto-fires via hook.
- 🤖 `/topia guardian` — security gate (secrets, OWASP, deps). Auto-fires via hook.
- 🤖 `/topia logic-guardian` — protects business logic from accidental deletion. Auto-fires when `.topia/logic-manifest.json` exists.
- 🤖 `/topia quarantine` — prompt-injection advisory on untrusted MCP / WebFetch / upload reads. Auto-fires.
- 👤 `/topia audit` — comprehensive 8-dimension health audit.
- 👤 `/topia metrics` — nexus + **token** metrics only (audit Phase 8). CLI: `topia metrics` or `topia analytics`.
- 👤 `/topia autopsy` — codebase health assessment (Rescue's RECON phase).
- ↻ `/topia perf` — performance regression gate (N+1, sync-in-async, memory leaks). Called by `build` Phase 5.

### Delivery
- 👤 `/topia deploy` — multi-platform deploy with health checks.
- 👤 `/topia marketing` — landing copy, social, SEO, video scripts.
- 👤 `/topia incident <issue>` — structured incident response (triage → contain → root cause → postmortem).

### Rescue (called by `rescue` L1)
- 🤖 `/topia safeguard` — characterization tests + rollback markers before refactoring. Called by `rescue` before `surgeon`.
- 🤖 `/topia surgeon <module>` — incremental refactorer (one module per session). Runs inside `rescue` workflow.

### Documentation
- 👤 `/topia docs` — auto-generate + maintain READMEs, API docs, changelogs.
- 👤 `/topia doc-processor <format> <source>` — generate / parse PDF, DOCX, XLSX, PPTX, CSV.

### Project lifecycle
- 👤 `/topia onboard` — generate `CLAUDE.md` + `.topia/` for an inherited codebase.
- 👤 `/topia retro` — engineering retrospective on commit history + work patterns.
- 👤 `/topia graft <url>` — port features from external GitHub repos (modes: `--port`, `--copy`, `--compare`, `--improve`).
- 👤 `/topia improve-architecture` — find architectural friction; propose deepening opportunities for testability.

## L3 Utilities

### Knowledge / Research
- ↻ `/topia research <topic>` — web research with min-3-source triangulation.
- ↻ `/topia docs-seeker <api-or-error>` — Context7 / llms.txt / WebSearch fallback chain.
- 👤 `/topia trend-scout <topic>` — Product Hunt / GitHub Trending / HN / Reddit scan.

### Reasoning
- ↻ `/topia problem-solver <problem>` — structured frameworks (5 Whys, Fishbone, First Principles, SCAMPER) + bias detection.
- ↻ `/topia sequential-thinking <problem>` — multi-variable analysis with dependency tracking.

### Validation
- ↻ `/topia verification` — lint + type-check + tests + build.
- 🤖 `/topia hallucination-guard` — verify imports / APIs / packages actually exist. Auto-fires after AI-generated code.
- 🤖 `/topia completion-gate` — validate agent claims against the tool-call evidence trail. Auto-fires at workflow end.
- 🤖 `/topia constraint-check` — meta-validator: did the agent follow declared HARD-GATEs? Auto-runs in `build`, `team`, `audit`.
- ↻ `/topia sast` — static analysis runner (ESLint, Semgrep, Bandit, Clippy, govulncheck).

### State / Memory
- 🤖 `/topia context-engine` — context-window management + auto-compaction.
- 🤖 `/topia context-pack <task>` — package context for subagent delegation.
- ↻ `/topia journal` — ADRs + decision history. User runs to log; also called by `build`/`rescue`.
- 🤖 `/topia session-bridge` — auto-saves decisions / conventions / progress to `.topia/`. Fires at session boundaries.
- ↻ `/topia recall [topic]` — unified memory recall (`.topia/`, `.remember/`, neural-memory, agora). Read-only.
- ↻ `/topia neural-memory <recall|store>` — semantic memory graph writes and MCP-only recall
- 🤖 `/topia integrity-check` — detect adversarial content in `.topia/` files. Called by `guardian` / `session-bridge`.

### Monitoring / Scope
- 🤖 `/topia watchdog` — post-deploy HTTP / response-time / error-rate checks. Auto-fires after `deploy`.
- 🤖 `/topia scope-guard` — detect scope creep (files exceeding the approved plan). Auto-triggered by L1.

### Dev surface
- ↻ `/topia git <task>` — semantic commits, PR descriptions, branch naming, changelog.
- ↻ `/topia worktree <create|cleanup|list>` — git worktree lifecycle for parallel streams.
- ↻ `/topia dependency-doctor` — outdated packages + CVE scan + prioritized update plan.
- 👤 `/topia guardian-env` — environment pre-flight (OS, runtime versions, tools, ports, env vars).

### Browser / Media
- ↻ `/topia browser-pilot <url>` — Playwright automation + a11y audit.
- 👤 `/topia asset-creator <brief>` — SVG icons, OG images, social banners.
- 👤 `/topia video-creator <brief>` — narration scripts, storyboards, shot lists.
- 👤 `/topia slides <topic>` — Marp-compatible decks from structured JSON.

---

## L4 Extension Packs (10)

L4 packs provide domain-specific patterns. When invoked, read the pack's PACK.md and follow the matching skill's workflow.

### Frontend & UI (`extensions/ui/PACK.md`)
- `/topia design-system` — design token generation and enforcement
- `/topia component-patterns` — component architecture refactoring
- `/topia a11y-audit` — accessibility audit (WCAG compliance)
- `/topia animation-patterns` — motion design and animation patterns

### Backend (`extensions/backend/PACK.md`)
- `/topia api-patterns` — REST/GraphQL API design and validation
- `/topia auth-patterns` — authentication and authorization flows
- `/topia database-patterns` — schema design, migrations, query optimization
- `/topia middleware-patterns` — middleware pipeline and error handling

### DevOps (`extensions/devops/PACK.md`)
- `/topia docker` — Dockerfile optimization, multi-stage builds, compose
- `/topia ci-cd` — CI/CD pipeline setup (GitHub Actions, GitLab CI)
- `/topia monitoring` — observability, logging, alerting setup
- `/topia server-setup` — VPS / cloud server provisioning
- `/topia ssl-domain` — SSL certificates and domain configuration

### Mobile (`extensions/mobile/PACK.md`)
- `/topia react-native` — React Native / Expo architecture and performance
- `/topia flutter` — Flutter state management and widget patterns
- `/topia app-store-prep` — App Store / Play Store submission preparation
- `/topia native-bridge` — native module bridges (Turbo Modules, MethodChannel)

### Security (`extensions/security/PACK.md`)
- `/topia owasp-audit` — OWASP Top 10 vulnerability audit
- `/topia pentest-patterns` — penetration testing methodology
- `/topia secret-mgmt` — secret management and rotation
- `/topia compliance` — compliance framework guidance (SOC2, HIPAA, PCI)

### E-commerce (`extensions/ecommerce/PACK.md`)
- `/topia shopify-dev` — Shopify theme / app development (Hydrogen, Liquid)
- `/topia payment-integration` — payment flow (Stripe Payment Intents, 3DS)
- `/topia cart-system` — shopping cart architecture
- `/topia inventory-mgmt` — stock tracking with optimistic locking

### AI/ML (`extensions/ai-ml/PACK.md`)
- `/topia llm-integration` — LLM API clients with retry and structured output
- `/topia rag-patterns` — RAG pipeline (chunking, embedding, retrieval, reranking)
- `/topia embedding-search` — hybrid search (BM25 + vector)
- `/topia fine-tuning-guide` — fine-tuning dataset prep, training, evaluation

### Content (`extensions/content/PACK.md`)
- `/topia blog-patterns` — blog system (pagination, RSS, reading time)
- `/topia cms-integration` — headless CMS setup (Sanity, Contentful, Strapi)
- `/topia mdx-authoring` — MDX pipeline with custom components
- `/topia i18n` — internationalization (locale routing, translations)
- `/topia seo-patterns` — SEO audit (JSON-LD, sitemap, meta tags, OG)

### Analytics (`extensions/analytics/PACK.md`)
- `/topia tracking-setup` — analytics tracking with consent management
- `/topia ab-testing` — A/B experiment design and statistical significance
- `/topia funnel-analysis` — conversion funnel tracking and drop-off analysis
- `/topia dashboard-patterns` — KPI dashboards with server-side aggregation

### Chrome extension (`extensions/chrome-ext/PACK.md`)
- `/topia manifest-v3` — Manifest V3 scaffolding
- `/topia service-worker` — service worker lifecycle and message passing
- `/topia cws-compliance` — Chrome Web Store compliance and CWS publishing
- `/topia chrome-ai` — Chrome built-in AI integration

---

## Usage

When the user runs `/topia <action>`:

1. **CLI command?** (install, setup, init, doctor, build, status, visualize, analytics, hooks, migrate-from-rune) → route to the CLI binary (`node compiler/bin/topia.js <action>`).
2. **Core skill?** (any name in L0/L1/L2/L3 above) → invoke `topia:<action>` via the Skill tool, passing arguments as the prompt.
3. **L4 pack command?** → read the corresponding `extensions/<pack>/PACK.md`, locate the matching skill section, follow its workflow.
4. **No action provided?** → show this help menu.

For ambiguous routing (the user described intent without naming a skill), defer to `topia:skill-router` for canonical resolution.
