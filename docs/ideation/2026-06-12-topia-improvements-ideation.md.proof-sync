---
date: 2026-06-12
topic: topia-improvements
focus: plugin infrastructure, skills, hooks, agent memory and processing
mode: repo-grounded
---

# Ideation: Topia Plugin, Skills, Hooks, and Memory Improvements

## Grounding Context

**Codebase Context.** Node 18+ ESM CLI (`compiler/bin/topia.js`, zero runtime deps); 71 `SKILL.md` skills with YAML frontmatter (layers L0–L3, emit/listen pulses, Calls/Called-By synapses; 315 synapses + 49 pulses in `compiler/nexus-constants.js`); Maestro routing (L0 `skill-router` → L1 orchestrators build/team/rescue/scaffold/launch); platform adapters (claude, cursor, windsurf, codex, opencode, openclaw, antigravity, generic); 15 native CJS hooks plus settings.json dispatch hooks via the stable launcher shim (`.claude/topia/hook-dispatch.cjs`, v3.3.2); 10 L4 extension packs; vendored Python agora-code MCP (SQLite semantic memory); file-based `.topia/` state; two-step install (plugin → `/topia finalize`).

**Known pain points.** Hook dispatch path-rot is the dominant recurring bug (stale v2.x entries warn but don't self-heal — hit again this week on a second machine); stat drift (README 71 skills vs marketplace.json 69); recurring Windows regressions (CRLF frontmatter, Git Bash mkdir mangling, Python 3.13 asyncio); agora-code Windows patch destroyed by upstream rsync; install friction; broken skill-invocation telemetry (`.topia/metrics/` records `skill_invocations: 0` on essentially every session); no CI gate on push/PR; HIGH skill-name path-traversal audit finding; Cursor/Windsurf lack full hook parity; `port-rebrand.mjs` silently regresses; no `docs/solutions/` knowledge capture.

**External context (2026).** Compile-to-platform portability and hooks-as-deterministic-middleware are validated consensus. Emerging patterns worth borrowing: skill trigger-rate eval loops, memory scoping, permission manifests, and skill lockfiles (named unfilled ecosystem gap). A 26.1% vulnerability rate in community skills makes auditable security a differentiator. File-based knowledge compounding (`docs/solutions/`) is the leading memory pattern.

**Process.** Six parallel ideation frames (pain, inversion/automation, assumption-breaking, leverage/compounding, cross-domain analogy, constraint-flipping) generated 48 raw ideas → 18 dedup clusters → 7 survivors. All six frames independently converged on idea #1; five of six on idea #2.

## Topic Axes

1. plugin — infrastructure: compiler, CLI, adapters, install/distribution, versioning
2. skills — the 71 SKILL.md definitions, authoring, validation, routing metadata
3. hooks — native CJS hooks, dispatch hooks, presets, cross-platform parity
4. memory — .topia/ state, agora-code MCP, session-bridge, recall, telemetry/processing

## Ranked Ideas

### 1. Self-Healing Hook Reconciliation

**Description:** Promote `detectStaleHooks()` in `hooks/session-start/index.cjs` from warn-only to repair: compute the desired hook set from the installed plugin, atomically rewrite stale settings.json entries (timestamped backup; generation marker so user-authored hooks are never touched), and report what was fixed. Absorbs two companions: a dispatch ring buffer written by the launcher shim (`.topia/hook-flightrec.jsonl`, last \~200 dispatches: hook name, resolved path, exit code, duration) so hook failures are reconstructable, and auto-finalize for installed-but-never-finalized machines.
**Axis:** hooks
**Basis:** direct: `hooks/session-start/index.cjs` lines 227–232 build the full stale-entry list, then only print "Repair with: /topia finalize". The user hit exactly this bug this week on a second machine.
**Rationale:** Path-rot is the documented dominant bug class; detection already runs every session, so the marginal cost is only the write step. All six ideation frames independently converged here.
**Downsides:** Auto-editing user settings.json has real blast radius — needs deliberate backup/idempotency/opt-out design.
**Confidence:** 90%
**Complexity:** Medium
**Status:** Unexplored

### 2. `topia.lock` — Skill Lockfile + Per-Skill Permission Manifests

**Description:** Compiler emits a lockfile pinning every skill, hook, and vendored file to a content hash, plus a `permissions:` block per skill (filesystem write / shell / network / MCP) validated at compile time and enforced by `pre-tool-guard` at runtime. `topia doctor`, finalize, and CI verify against it. Build can emit `stats.json` as a side product, retiring stat drift.
**Axis:** plugin
**Basis:** external: skill lockfiles named an unfilled 2026 ecosystem gap; 26.1% community-skill vulnerability rate. direct: open HIGH skill-name path-traversal audit finding; rsync-clobber and fork-sync regressions are lockfile-detectable failures.
**Rationale:** One artifact retires three silent-drift bug classes and becomes the substrate every future integrity feature reads from; first-mover positioning.
**Downsides:** Schema decisions ossify quickly; policy enforcement (warn vs block) reverses the fail-open principle and needs explicit team agreement.
**Confidence:** 75%
**Complexity:** High
**Status:** Unexplored

### 3. Fix Skill Telemetry, Then Close the Trigger-Rate Eval Loop

**Description:** Fix attribution in the metrics collector (`.topia/metrics/sessions.jsonl` currently records `skill_invocations: 0` on nearly every session), then build a prompt→expected-skill eval corpus replayed in CI so description edits that silently kill triggering fail at PR time. Same data powers a declared-vs-observed audit of the 315-synapse graph; deriving `Called-By` from `Calls` at compile time deletes half the hand-maintained graph immediately.
**Axis:** skills
**Basis:** direct: sampled `.topia/metrics/sessions.jsonl` rows all show `"skill_invocations":0,"skills_used":[],"primary_skill":"none"`; `skills.json` shows one skill ever counted. external: trigger-rate eval loops are the emerging 2026 pattern.
**Rationale:** With 71 skills and routing as the core mechanism, "do the right skills fire?" is the central product question and currently unanswerable.
**Downsides:** Forces a definition of what counts as an invocation (file read vs router selection vs explicit command) — load-bearing for the nexus model.
**Confidence:** 80%
**Complexity:** Medium-High
**Status:** Unexplored

### 4. `docs/solutions/` Knowledge-Compounding Pipeline

**Description:** `post-session-reflect` (already shipping) drafts a structured solution doc (frontmatter: symptoms, module, root cause, fix) when a session closes a debug→fix chain; `session-start`/recall surfaces matching docs when a new session touches the same module or error signature. Phase 2 option: spaced-repetition scheduling (SM-2 style) so only currently-due entries occupy session-start context as the corpus grows.
**Axis:** memory
**Basis:** external: file-based knowledge compounding is the leading 2026 memory pattern (ce-compound / ce-learnings-researcher prior art). direct: `hooks/post-session-reflect/` exists; no `docs/solutions/` does — trigger built, sink missing.
**Rationale:** Topia's own history (launcher saga, agora Windows patch) is problems solved, forgotten, and at risk of re-solving; the project shipping memory tooling should compound its own.
**Downsides:** Needs a quality gate on what's worth capturing or it becomes noise.
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 5. agora-code Vendored Patch Queue

**Description:** Keep the vendored tree pristine; store the Windows asyncio fix (and future local modifications) as committed `.patch` files applied as the sync script's last step, failing loudly with rejected hunks when upstream drifts. Debian/quilt and Chromium `patches/` are the proven pattern.
**Axis:** memory
**Basis:** direct: documented pain — "agora-code Windows patch gets blown away by upstream rsync and must be re-applied manually." external: Debian quilt format, Chromium third\_party patch overlays.
**Rationale:** Cheapest item on the list; permanently retires a silent-data-loss bug that disables semantic memory for all Windows users when it fires.
**Downsides:** Essentially none — a one-time patch-format decision.
**Confidence:** 95%
**Complexity:** Low
**Status:** Unexplored

### 6. Hook Conformance CI Harness

**Description:** Test matrix spawning all 15 native hooks with fixture payloads per platform contract (Claude JSON events, Cursor strict valid-JSON-stdout, CRLF-tainted input, Windows paths), asserting exit codes and output shape, on windows-latest + ubuntu-latest. Converts the recurring Windows-regression and Cursor-hook-output bug classes into pre-merge failures; gives the missing CI gate its first concrete job.
**Axis:** hooks
**Basis:** direct: `hooks/lib/cursor-io.cjs` and `scripts/scan-mangled-windows-dirs.js` exist precisely because these failures recur; audit flagged no CI gate on push/PR.
**Rationale:** 15 hooks × 8 platform adapters is too large a matrix for manual testing — which is why these regressions recur. The fixture spec itself converts tribal knowledge into a contract.
**Downsides:** Defining per-platform contract fixtures is real effort (but is itself the valuable artifact).
**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

### 7. Tiered Memory Scoping (project / user / org)

**Description:** Define explicit memory tiers — project (this repo), user (cross-repo personal conventions), org (shared team knowledge) — with a deliberate promotion command (`topia memory promote`) and scope rules for which tiers hooks read at session-start. `.topia/org/` already exists with no scoping model behind it.
**Axis:** memory
**Basis:** external: memory scoping named an emerging 2026 pattern. direct: `decisions.md`/ADRs are semantically project-scoped but mechanically machine-scoped — this week's cross-machine bug is the symptom of state that doesn't travel.
**Rationale:** Scoping is the decision that makes every other memory feature safe to scale; deciding now means later features inherit a correct boundary model instead of retrofitting one.
**Downsides:** Sync introduces merge, privacy, and memory-poisoning questions (integrity-check exists for a reason); expensive to reverse once data lands in the wrong tier.
**Confidence:** 65%
**Complexity:** High
**Status:** Unexplored

## Rejection Summary

| #  | Idea                                                                    | Reason Rejected                                                                                                                               |
| :- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Pure-Node port of agora-code                                            | Too expensive relative to value while the patch queue (#5) addresses the live wound at \~5% of the cost; revisit if patches start conflicting |
| 2  | Event-log memory + WAL/checkpoint session replay                        | Rewrite of the entire memory write path; better as a brainstorm variant behind #7                                                             |
| 3  | Spaced-repetition memory resurfacing                                    | Folded into #4 as an optional retrieval phase, not standalone                                                                                 |
| 4  | Flight-data-recorder ring buffer for hook dispatch                      | Folded into #1 as the record step of the reliability loop                                                                                     |
| 5  | Auto-finalize on first session                                          | Subsumed by #1's reconciler                                                                                                                   |
| 6  | Declarative `topia converge` (IaC-style fleet reconciliation)           | Bigger commitment than current evidence demands; #1 covers the high-value slice                                                               |
| 7  | Prebuilt per-platform release artifacts                                 | Reshapes the release pipeline; premature before #6 establishes the CI matrix                                                                  |
| 8  | Stats generated-not-checked (compiler emits stats.json, templates docs) | Real but small; folded into #2's integrity substrate                                                                                          |
| 9  | HARD-GATE prose → executable assertions                                 | Promising; needs schema design that should follow #6's contract work — brainstorm later                                                       |
| 10 | 7-meta-skill nexus collapse (skills as behavior tables)                 | Identity-level question; #3's trigger data should exist before any such decision                                                              |
| 11 | Hooks as compiled declarative policy manifest                           | Premature before #6 makes per-platform contracts explicit                                                                                     |
| 12 | Self-amending skills (field notes appended into SKILL.md)               | Self-modifying-file integrity/review questions outweigh benefit; #4 captures the same knowledge with cleaner ownership                        |
| 13 | Pulses + hooks unified event bus                                        | Architecturally attractive one-way door; needs the telemetry from #3 and contracts from #6 first                                              |

## Suggested Sequencing

Quick wins on live wounds: **#5** then **#1**. CI substrate: **#6**. Builds on substrate: **#2**, **#3**. Longer memory arc: **#4**, then **#7**.
