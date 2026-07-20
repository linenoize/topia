# Topia Architecture

## 5-Layer Model

| Layer | Name | Count | Can Call | Called By | State |
|-------|------|-------|----------|----------|-------|
| **L0** | **Router** | **1** | **L1-L3 (routing)** | **Every message** | **Stateless (rule-based)** |
| L1 | Orchestrators | 5 | L2, L3 | L0, User | Stateful (workflow) |
| L2 | Workflow Hubs | 30 | L2 (cross-hub), L3 | L1, L2 | Stateful (task) |
| L3 | Utilities | 27 | Nothing (pure)* | L1, L2 | Stateless |
| L4 | Extension Packs | 14 | L3 | L2 (domain match) | Config-based |

### L0 — The Enforcement Layer

`skill-router` is the only L0 skill. It enforces a single discipline: **check the routing table before every response**. It doesn't do work — it ensures the right skill does the work.

- Loaded via plugin description, always active
- Routes user intent to the correct L1-L3 skill
- Prevents agents from bypassing skills ("I'll just do it manually")
- See `skills/skill-router/SKILL.md` for the full routing table and anti-rationalization gate

### L4 — Extension Packs (Activation Protocol)

L4 packs are domain-specific instruction sets stored as `extensions/*/PACK.md` files. **All packs ship with the Topia plugin** — activation records workspace preference and runtime loading, not a separate install.

They are activated (read) in three ways:

**0. Workspace config** — `topia install`, `topia init` (non-Claude), or `/topia onboard` run `detect-l4-packs.js`
   - Writes `.topia/active-packs.json` with `enabled[]` for this repo
   - `build` Phase 1.5 unions `enabled[]` with signal-matched packs (cap 2 per build)
   - Cursor/Codex: `topia.config.json` → `extensions.enabled` filters compiled pack rules

**1. Explicit invocation** — User runs `/topia <pack-skill>` (e.g., `/topia rag-patterns`)
   - `skill-router` detects the L4 trigger in Tier 4 routing table
   - Agent reads `extensions/<pack>/PACK.md`
   - Agent follows the matching skill's Workflow steps

**2. Implicit detection** — `build` detects domain context in Phase 1.5
   - Scout output reveals domain signals (e.g., `three.js` in dependencies)
   - Cook matches against L4 pack mapping table
   - Agent reads matching PACK.md and applies its constraints/patterns
   - Domain patterns supplement build's standard phases

**L4 calling rules:**
- L4 CAN call L3 utilities (scout, verification, hallucination-guard)
- L4 CANNOT call L1 or L2 skills
- L4 CANNOT call other L4 packs (no cross-pack dependencies)
- If L4 pack file not found on disk, skip silently (graceful degradation)

### Exceptions

- `team` (L1) can call other L1 orchestrators — meta-orchestration pattern.
- *L3→L3 coordination: `context-engine` → `session-bridge`, `hallucination-guard` → `research`, `session-bridge` → `integrity-check` (documented in SKILL.md).

## Nexus Protocol

### Loop Prevention

```
Rule 1: No self-calls (history[-1] !== target)
Rule 2: Max 2 visits to same skill per chain
Rule 3: Max chain depth: 8
Rule 4: If blocked → escalate to L1 orchestrator
```

### Model Auto-Selection

```
Read-only / scan?           → haiku   (cheapest)
Write / edit / generate?    → sonnet  (default)
Architecture / security?    → opus    (deep reasoning)

Override: priority=critical → always opus
Override: budget constraint → downgrade
Override: user preference   → manual in config
```

### Behavioral Modes (v2.16+)

Mode-based execution variants that activate inside existing skills based on signals or input context. Modes do NOT add new skills — they expand the behavior surface of existing skills.

| Mode | Skill | Activation | Behavior |
|------|-------|------------|----------|
| **Caveman Output** | `context-engine` (broadcast) | Auto on context ORANGE / RED, manual via `/caveman` / "be brief" | Strips filler / articles / hedging while preserving full technical accuracy. ~75% output reduction. Auto-clarity exception for security warnings, irreversible-action confirmations, multi-step sequences. |
| **Synthesis** | `idea` (Step 1.4) | Pasted spec > 200 words, conversation > 1000 words, continuation session, filled issue template, explicit "synthesize" | Extract Requirements Document from existing context with mandatory source citations, then confirm instead of re-interview. Skip 5-question elicitation if all 5 dimensions filled. |
| **Vertical Slice** | `plan` (Step 3) | Default for any feature with 3+ phases | Tracer-bullet task decomposition: each task = end-to-end path through schema + API + UI + test, demoable on its own. AFK / HITL classification. Replaces horizontal layer planning. |
| **Feedback Loop (Step 0)** | `debug` | Repro is slow / non-deterministic / multi-component / intermittent | Construct fast deterministic pass/fail signal from 10-rank ladder BEFORE forming hypotheses. Skip if existing repro is one command, deterministic, < 5s. > 10 min construction → 3-Fix Escalation (architecture, not bug). |
| **Issue Triage** | `review-intake` | Input is issue tracker item (not PR comment), `--inbox` flag, or "triage" / "process the inbox" | State machine (needs-triage → needs-info / ready-for-agent / ready-for-human / wontfix). Repro-first HARD-GATE for bugs. AGENT-BRIEF emission for `ready-for-agent`. Wontfix-enhancement writes `.out-of-scope/<slug>.md`. |
| **Agent Brief Variant** | `context-pack` | Async / durable handoff (issue tracker queue, scheduled cron, > 1 hour delay) | Behavioral over procedural; type names over file:line; survives codebase drift between handoff and execution. Adds Category / Current behavior / Desired behavior / Out of scope sections. |
| **Out-of-Scope WRITE (Step 1.6)** | `idea` | Mid-elicitation explicit rejection ("scrap it", "drop it") | HARD-GATE writes `.out-of-scope/<slug>.md` before session end. Confirms durable rejection vs deferral. Lexical-similarity gate appends to existing files. Closes the read/write loop on `.out-of-scope/` records (Step 1.5 reads them). |

Mode discovery is automatic via signals + input pattern matching. Cook / team / rescue do NOT need to manually select modes — the called skill detects activation conditions and switches behavior.

### Cross-Provider Model Mapping (v2.15+)

SKILL.md frontmatter uses Anthropic-native model names (`opus`/`sonnet`/`haiku`) as the canonical authoring vocabulary. Adapters translate this hint to provider-correct model names so the field is meaningful in every compiled output:

| Tier | claude / cursor / windsurf | codex | antigravity | opencode / openclaw / generic |
|------|---------------------------|-------|-------------|------------------------------|
| opus | claude-opus-4-7 (no-op) | gpt-5-pro | gemini-3-pro | tier:heavy |
| sonnet | claude-sonnet-4-6 (no-op) | gpt-5 | gemini-3-flash | tier:mid |
| haiku | claude-haiku-4-5 (no-op) | gpt-5-mini | gemini-3-flash-lite | tier:light |

Rules:
- Anthropic-backed adapters (claude/cursor/windsurf) understand the native names — adapter is no-op
- Concrete-provider adapters (codex/antigravity) emit recognizable IDE model names
- Provider-agnostic adapters (opencode/openclaw/generic) emit `tier:heavy|mid|light` semantic hints — the consuming runtime resolves to its configured provider model
- Skills without `model:` produce no model field in any adapter
- Unknown values pass through unchanged (forward-compatibility for new models)

**Version bumps (e.g. Opus 4.7 → 4.8):** Skill frontmatter stays on tiers (`opus`/`sonnet`/`haiku`). Claude Code/Cursor resolve tiers to the current Anthropic model. When Anthropic ships a new version, update this table and any hardcoded example IDs in docs/snippets — not the 71 skill files.

**Telemetry:** Session-end metrics and `models_used` resolve tiers from `skills/<name>/SKILL.md` first (then `agents/<name>.md`). Agent subagent wrappers should match their skill tier so reports reflect intended cost profile.

**Slash commands:** User-facing Topia skills are invoked as `/topia-<skill>` (hyphen alias), `/topia:<skill>` (plugin namespace), or `/topia <skill>` (router). Bare `/skill` is intentionally not a Topia entry point.

### Parallel Execution

| Context | Max Parallel | Reason |
|---------|-------------|--------|
| L3 utilities (haiku) | 5 | Cheap, fast, independent |
| L2 hubs (sonnet) | 3 | Moderate cost, may share context |
| L1 orchestrators | 1 | Only one orchestrator at a time |

### Error Handling & Resilience

| If this fails... | Try this instead... |
|-------------------|---------------------|
| debug can't find cause | problem-solver (different reasoning) |
| docs-seeker can't find | research (broader web search) |
| browser-pilot can't capture | verification (CLI checks) |
| scout can't find files | research + docs-seeker |
| test can't run (env broken) | deploy fix env → test again |
| review finds too many issues | plan re-scope → fix priorities |

## Skill Groups

### L1 Orchestrators

| Skill | Model | Role |
|-------|-------|------|
| build | sonnet | Feature implementation orchestrator (v0.5.0 — phase-aware execution) |
| team | opus | Multi-agent parallel orchestrator |
| launch | sonnet | Deploy + marketing orchestrator |
| rescue | sonnet | Legacy refactoring orchestrator |
| scaffold | sonnet | Project bootstrap orchestrator (idea-driven, 9-phase pipeline) |

### L2 Workflow Hubs

| Group | Skills |
|-------|--------|
| CREATION | plan, scout, brainstorm, design, skill-forge, idea, mcp-builder, graft |
| DEVELOPMENT | debug, fix, test, review, db |
| QUALITY | sentinel, preflight, onboard, audit, perf, review-intake, logic-guardian |
| DELIVERY | deploy, marketing, incident, docs |
| RESCUE | autopsy, safeguard, surgeon |
| SECURITY | adversary |
| VELOCITY | retro |

### L3 Utilities

| Group | Skills |
|-------|--------|
| KNOWLEDGE | research, docs-seeker, trend-scout |
| REASONING | problem-solver, sequential-thinking |
| VALIDATION | verification, hallucination-guard, integrity-check, completion-gate, constraint-check, sast |
| STATE | context-engine, context-pack, journal, session-bridge, neural-memory |
| MONITORING | watchdog, scope-guard |
| MEDIA | browser-pilot, asset-creator, video-creator, slides |
| DEPS | dependency-doctor |
| WORKSPACE | worktree |
| GIT | git |
| DOCUMENTS | doc-processor |
| SECURITY | guardian-env |

## Runtime Layer

The nexus ships as a **library** (invoke via slash commands) and as a **runtime** (native hooks that auto-fire on tool use). The runtime converts passive advice into enforced discipline.

### Hook adapter registry

`compiler/adapters/hooks/{claude,cursor,windsurf,antigravity}.js` — one adapter per platform. Each accepts:

- `preset` — `strict` | `gentle` | `off`

The adapter translates the preset into the platform's native hook format (Claude `.claude/settings.json`, Cursor `.cursor/rules`, Windsurf workflow+rule, Antigravity rule-inject).

### Merge Logic

`mergePreset()` strips all Topia-managed entries once, then `appendHookBlock()` layers the preset. `isTopiaManaged()` uses `Topia_DISPATCH_RE` (npx shape) so uninstall/re-install is idempotent. User-authored hooks in the same events are preserved verbatim.

### Invocation

```bash
Topia hooks install --preset gentle                            # Install gentle hooks
Topia hooks status                                             # inspect wiring
Topia hooks uninstall                                          # remove Topia entries only
```

## Signals

Event-driven skill communication via frontmatter declarations. Skills declare what signals they `emit` and `listen` to — the compiler builds a signal graph and validates consistency.

### Frontmatter

```yaml
metadata:
  emit: code.changed, tests.passed
  listen: plan.ready, codebase.scanned
```

### Signal Naming

Lowercase, dot-separated: `<domain>.<event>` (e.g. `code.changed`, `tests.failed`, `deploy.complete`).

### Pulse Catalog

| Pulse | Emitters | Listeners |
|--------|----------|-----------|
| `code.changed` | fix | test, guardian, review, readiness, verification |
| `tests.passed` | test | deploy |
| `tests.failed` | test | debug |
| `tdd.horizontal.violation` | test | completion-gate, readiness |
| `architecture.shallow.flagged` | improve-architecture, audit | surgeon, review |
| `architecture.deletion.passed` | improve-architecture | audit |
| `outofscope.match` | idea | review-intake, build, plan |
| `agent.stuck` | fix, debug | recon, adversary |
| `oracle.dispatched` | adversary | session-bridge |
| `oracle.response` | adversary | debug, fix |
| `oracle.failed` | adversary, session-bridge | debug, fix |
| `context.preview` | context-engine | adversary, team, review, audit |
| `security.passed` | guardian | deploy |
| `security.blocked` | guardian | fix, plan |
| `review.complete` | review | build |
| `review.issues` | review | fix |
| `plan.ready` | plan | build |
| `architecture.mapped` | architecture-mapper | improve-architecture |
| `codebase.scanned` | recon | plan, brainstorm, integrate, architecture-mapper, improve-architecture |
| `phase.complete` | build, team | session-bridge |
| `deploy.complete` | deploy | watchdog |
| `bug.diagnosed` | debug | fix |
| `docs.updated` | docs, architecture-mapper | — |
| `audit.complete` | audit | — |
| `db.migrated` | db | — |
| `verification.complete` | verification | build |
| `integrate.complete` | integrate | journal |
| `ideas.ready` | brainstorm | build |
| `readiness.passed` | readiness | build |
| `readiness.blocked` | readiness | fix |
| `project.onboarded` | onboard | plan |
| `incident.detected` | watchdog | incident |
| `output.density.set` | context-engine | *(orchestrators dynamically — build, team, rescue)* |
| `triage.classified` | review-intake | *(observability)* |
| `agent.brief.ready` | review-intake | *(external — issue tracker)* |
| `outofscope.recorded` | idea, review-intake | *(observability — discovered via .out-of-scope/ file scan)* |
| `quarantine.notice.emitted` | quarantine | guardian, integrity-check |
| `external.content.received` | *(external — runtime hook on `mcp__*` / WebFetch / upload-Read)* | quarantine |

### Validation

- `node scripts/validate-signals.js` — checks all signals for consistency
- Every `listen` must have a matching `emit` (hard error)
- Unlistened emitters generate warnings (acceptable for external consumers)
- Two whitelists for intentional exceptions:
  - `INTENTIONAL_BROADCAST_SIGNALS` — emitted but no skill listens (observability, dynamically-consumed by orchestrators).
  - `EXTERNAL_TRIGGER_SIGNALS` — listened but no skill emits (entry points fired by users / orchestrators / hooks from outside the nexus).
- Signal graph compiled into `skill-index.json` under the `signals` key

### Design Principles

1. **Declarative, not runtime** — signals are metadata for discovery and validation, not a pub/sub bus
2. **Graph-based, not linear** — one signal can trigger multiple listeners in parallel (vs. before/after hooks)
3. **Layer-agnostic** — any skill at any layer can emit or listen
4. **Extensible** — extension packs can declare their own signals

## Cross-Hub Nexus (L2 ↔ L2)

```
plan ↔ brainstorm     (creative ↔ structure)
fix ↔ debug           (fix ↔ root cause)
test → debug          (unexpected failure)
review → test         (untested edge case found)
review → fix          (bug found during review)
review → review-intake (external feedback received on reviewed code)
review-intake → fix   (verified feedback → apply changes)
review-intake → test  (reviewer found untested edge case)
review-intake → sentinel (reviewer flagged security concern)
fix → test            (verify after fix)
deploy → test         (pre-deploy verification)
debug → scout         (find related code)
marketing → scout     (analyze assets)
plan → scout          (scan before planning)
fix → review          (self-review complex fix)
review → scout        (more context needed)
surgeon → safeguard   (untested module found)
preflight → sentinel  (security sub-check)
audit → sentinel      (security phase delegation)
audit → autopsy       (complexity/health phase)
audit → dependency-doctor (deps phase delegation)
audit → scout         (discovery phase)
audit → journal       (save audit report)

# perf
perf ← build           (Phase 5 quality gate)
perf ← audit          (performance dimension delegation)
perf ← review         (performance patterns detected in diff)
perf ← deploy         (pre-deploy perf regression check)
perf → scout          (find hotpath files)
perf → browser-pilot  (Lighthouse / Core Web Vitals)
perf → verification   (run benchmark scripts if configured)

# db
db ← build             (schema change detected in diff)
db ← deploy           (pre-deploy migration safety check)
db ← audit            (database health dimension)
db → scout            (find schema/migration files)
db → verification     (run migration in test env)
db → hallucination-guard (verify SQL syntax and ORM methods)

# incident
incident ← launch     (watchdog alerts during Phase 3 VERIFY)
incident ← deploy     (health check fails post-deploy)
incident → watchdog   (current system state — what's down)
incident → autopsy    (root cause after containment)
incident → journal    (record incident timeline)
incident → sentinel   (check for security dimension)

# design
design ← build         (frontend task detected, no design-system.md)
design ← review       (AI anti-pattern detected in diff)
design ← perf         (Lighthouse Accessibility BLOCK)
design → scout        (detect platform, tokens, component library)
design → asset-creator (generate base visual assets from design system)

# skill-forge
skill-forge ← build    (feature being built IS a new skill)
skill-forge ← plan    (plan identifies need for reusable skill)
skill-forge → scout   (scan existing skills for overlap)
skill-forge → plan    (structure complex multi-phase skills)
skill-forge → hallucination-guard (verify referenced skills exist)
skill-forge → verification (validate SKILL.md format)
skill-forge → journal (record skill creation ADR)

# review-intake
review-intake ← build  (Phase 5: external review arrives)
review-intake ← review (self-review surfaces issues to address)
review-intake → scout  (verify reviewer claims against codebase)
review-intake → fix    (apply verified changes)
review-intake → test   (add tests for reviewer-found edge cases)
review-intake → hallucination-guard (verify suggested APIs exist)
review-intake → sentinel (re-check security if reviewer flagged)

# completion-gate
completion-gate ← build    (Phase 5d: validate agent claims)
completion-gate ← team    (validate build reports from streams)

# worktree
worktree ← team           (Phase 2: create worktrees for streams)
worktree ← build           (optional isolation for complex features)

# sast
sast ← sentinel           (deep analysis beyond regex patterns)
sast ← audit              (security dimension in full audit)
sast ← build               (security-sensitive code paths)
sast ← review             (security patterns detected in diff)

# constraint-check
constraint-check ← build   (end-of-workflow discipline audit)
constraint-check ← team   (verify stream agent compliance)
constraint-check ← audit  (quality dimension assessment)

# logic-guardian
logic-guardian ← build     (Phase 1.5: complex logic project detected)
logic-guardian ← fix      (pre-edit gate on manifested files)
logic-guardian ← surgeon  (pre-refactor on logic modules)
logic-guardian ← team     (validate logic integrity across streams)
logic-guardian ← review   (check if diff removes manifested logic)
logic-guardian → scout    (scan project for logic files)
logic-guardian → verification (run tests after logic edits)
logic-guardian → hallucination-guard (verify references after edit)
logic-guardian → journal  (record logic changes as ADRs)
logic-guardian → session-bridge (save manifest for cross-session)

# idea (Business Analyst)
idea ← build             (Phase 1 idea gate — feature requests, integrations, greenfield)
idea ← scaffold         (Phase 1 requirement elicitation)
idea → plan             (hand-off: requirements.md → implementation planning)
idea → brainstorm       (explore approaches when requirements are ambiguous)
idea → research         (domain research for hidden requirements)

# scaffold (Project Bootstrap)
scaffold → idea         (Phase 1: requirement elicitation)
scaffold → research   (Phase 2: tech stack research)
scaffold → plan       (Phase 3: architecture planning)
scaffold → design     (Phase 4: design system generation)
scaffold → fix        (Phase 5: code generation)
scaffold → test       (Phase 6: test generation)
scaffold → docs       (Phase 7: documentation)
scaffold → git        (Phase 8: initial commit)
scaffold → verification (Phase 9: build + test verification)
scaffold → sentinel   (Phase 9: security scan)

# docs (Documentation Lifecycle)
docs ← build           (Phase 8: auto-update docs after feature)
docs ← scaffold       (Phase 7: generate initial docs)
docs → scout          (scan codebase for doc-worthy exports)
docs → doc-processor  (generate PDF/DOCX from markdown)
docs → docs           (commit doc changes)

# git (Semantic Git Operations)
git ← build            (Phase 7: semantic commit generation)
git ← scaffold        (Phase 8: initial commit)
git ← docs            (commit doc changes)
git ← launch          (tag and release)

# mcp-builder (MCP Server Builder)
mcp-builder ← build    (building an MCP server)
mcp-builder → scout   (scan for existing MCP patterns)
mcp-builder → test    (generate MCP server tests)
mcp-builder → docs    (generate MCP server documentation)
mcp-builder → hallucination-guard (verify SDK imports exist)

# doc-processor (Document Format Utility)
doc-processor ← docs  (PDF/DOCX generation)
doc-processor ← marketing (generate branded PDFs)

# graft (Repo Porting)
graft → scout         (scan target repo before porting)
graft → review        (validate grafted code quality)
graft → journal       (record grafting decision as ADR)
graft → sentinel      (security check on ported code)

# New connections
brainstorm → design   (ideas feed into design system generation)
idea → design           (requirements feed into UI design)
rescue → retro        (post-rescue retrospective)
launch → retro        (post-launch retrospective)
scaffold → skill-forge (scaffold identifies reusable skill patterns)
sentinel → plan       (security.blocked triggers re-planning)
```

## Master Plan + Phase Files (Amateur-Proof Architecture)

The `plan` skill (v0.4.0) produces structured plans designed for **any model to execute with high accuracy**.

### Design Principle

> Plan for the weakest coder. If Haiku (Amateur) can execute the phase file, every model benefits.

### Structure

```
.topia/
  plan-<feature>.md          ← Master plan: overview (<80 lines)
  plan-<feature>-phase1.md   ← Phase 1: self-contained execution detail (<200 lines)
  plan-<feature>-phase2.md   ← Phase 2: self-contained execution detail
  ...
```

### Phase File Template (Amateur-Proof)

Every phase file MUST include these 7 mandatory sections:

| Section | Purpose | Why Amateur Needs It |
|---------|---------|---------------------|
| Data Flow | ASCII diagram of data movement | Prevents wrong function call order |
| Code Contracts | Function signatures, interfaces | Prevents wrong return types |
| Tasks | File paths, logic, edge cases | Prevents missed files |
| Failure Scenarios | When/Then/Error table | Prevents missing error handling |
| Rejection Criteria | Explicit DO NOTs | Prevents common anti-patterns |
| Cross-Phase Context | Imports from prior, exports for future | Prevents broken dependencies |
| Acceptance Criteria | Testable conditions | Prevents "done" without proof |

### Execution Flow

```
1. build Phase 0: check for existing master plan → resume from current phase
2. build Phase 2: plan produces master + phase files → user approves
3. build Phase 3-7: load ONLY current phase file → test → implement → quality → commit
4. build Phase 7: mark phase ✅ in master plan → announce next phase
5. Next session: Phase 0 detects master plan → loads next phase → executes
```

**One phase per session = small context = better code from any model.**

## Context Bus

Each workflow maintains a shared context managed by L1:

```
L1: full bus (complete picture)
L2: relevant subset (only what they need)
L3: minimal query (stateless, no history)
L4: domain-filtered subset
```
