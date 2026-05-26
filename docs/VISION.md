# Topia Vision

---

## 1. Why Topia Exists

The problem is not that developers lack AI tools. The problem is that AI tools behave like interns with amnesia — capable, but stateless, siloed, and unable to hand work off cleanly.

Three specific failures motivated topia:

**Failure 1: Isolation.** Most skill ecosystems are collections, not systems. 500+ skills exist that don't know each other. When `debug` finds a root cause, nothing hands that diagnosis to `fix`. The developer becomes the integration layer — which defeats the purpose of AI tooling.

**Failure 2: Fragility.** Pipeline-based tools (A→B→C) break at every seam. If B fails, everything stops. There's no skill graph, no alternative path, no resilience. One broken step means starting over.

**Failure 3: Amnesia.** Each session starts from zero. The AI re-discovers conventions, re-reads the codebase, re-asks questions that were answered two sessions ago. Context dies at the end of every conversation.

**Topia's insight:** the value is in the connections, not the nodes. A toolkit of 40 well-connected skills outperforms 500 isolated ones. Resilience comes from redundant paths. Memory comes from structured persistence. The goal is not to give developers more AI tools — it's to give them an AI that behaves like a senior engineer who was actually there last week.

---

## 2. What Topia Is

Topia is a **skill toolkit** — not a skill collection, not a pipeline, not an AI agent framework.

**Technical definition:**

> **Topia = 66 skills × 203 sync connections × 44 async signals × cross-session memory × multi-platform compiler**

All three components are equally essential:
- Remove connections → becomes a collection (The Bloat wins)
- Remove memory → becomes a stateless chatbot
- Remove skills → nothing remains

**Topia operates on graph principles:**
- Every skill knows who to call when it hits the edge of its scope
- When a skill fails, the toolkit finds an alternate path — it does not stop
- Skills pass structured output to each other; the developer is not the integration layer
- Context flows in one direction: L1 holds the full picture, L2 gets a relevant slice, L3 gets a minimal query

**Topia serves the complete development lifecycle:** idea → design → code → quality → deploy → rescue. Not a tool for one phase. A system for all of them.

**The toolkit is the product.** A new skill that doesn't increase connection density is not a Topia skill — it's a feature that happens to live in the same repo.

---

## 3. What Topia Is NOT

*This is where The Bloat gets defeated.*

**The Bloat** is the persistent temptation to add features that seem useful in isolation but erode Topia's identity as a graph of skills. The Bloat speaks in reasonable-sounding arguments: *"users would love this"*, *"it only takes 50 lines"*, *"it's just one more skill."* The Bloat is not wrong about usefulness. It is wrong about what Topia is for.

### Anti-Goals

**Topia is NOT a general-purpose AI assistant.**
`email-writer`, `meeting-summarizer`, `travel-planner` — these are not development lifecycle skills. They don't connect to the toolkit. A user asking Topia to write an email has the wrong mental model of what Topia is. we do not want to correct that mental model by adding email skills; we want to reinforce the correct one.

**Topia is NOT a skill marketplace.**
More skills ≠ more value. The benchmark is not "how many skills does Topia have?" It is "what is the average connection depth of each skill?" A skill with 0 inbound and 0 outbound connections is a dead node. Dead nodes dilute the toolkit.

**Topia is NOT an IDE or code editor.**
Topia does not manage files directly, run terminal sessions, or provide a UI. It operates through Claude Code's existing tooling. Topia extends Claude's reasoning — it does not replace the environment.

**Topia is NOT a replacement for the developer.**
Topia amplifies developer judgment, not replaces it. `build` presents a plan and waits for approval before writing code. `brainstorm` proposes options, not decisions. The developer remains in the loop at every consequential step. Topia without a developer at the helm is half a system.

**Topia is NOT a pipeline.**
`build` is not a rigid A→B→C→D sequence that fails if one step breaks. It's a graph-orchestrated workflow where each phase can invoke any skill needed, retry via alternatives, and skip phases that don't apply. If someone tries to build a Topia skill as a strict sequential pipeline with no branching — they've misunderstood the architecture.

**Topia is NOT trying to cover every programming language or domain at the core layer.**
That's what L4 extension packs are for. The core (L1-L3) is language-agnostic. Domain specifics (React patterns, Rust idioms, trading algorithms) belong in L4. Adding language-specific logic to L1-L3 is scope creep disguised as helpfulness.

---

## 4. Design Principles

These are the rules that govern every decision in Topia — skill design, connection design, naming, layer assignment, model selection. When two options conflict, these principles break the tie.

### P1 — Connection Density Over Feature Count

Every new skill must increase the total graph connection density, not just add a node. Before adding a skill, count its inbound + outbound connections. A skill with fewer than 2 connections is a dead node.

**Test:** *"If I remove this skill, how many workflows break?"* If the answer is zero, the skill should not exist.

### P2 — Structured Output Is a Contract

Skills communicate through structured, predictable output formats — not natural language summaries. A skill's `## Output Format` section is a contract with callers. Changing it is a breaking change. Natural language output that cannot be parsed by a calling skill is a design failure.

**Test:** *"Can `build` consume this skill's output without re-reading the context?"* If no, fix the output format.

### P3 — Fail Loud, Route Around

When a skill fails, it must fail loudly (specific error, not silent empty output) so the toolkit can route around it. Silent failures are the most dangerous failure mode — the calling skill proceeds with incomplete data.

**Test:** *"If this skill returns nothing, does the caller know something went wrong?"* If no, add explicit error output.

### P4 — Layer Discipline Is Non-Negotiable

L3 utilities do not call L1 or L2. L1 orchestrators do not implement business logic directly — they delegate to L2. This is not a suggestion; it's what makes the toolkit predictable. Violating layer discipline for "just this one case" introduces coupling that spreads.

**Test:** *"Is this skill calling something above its layer?"* If yes, restructure. No exceptions.

### P5 — The Graph Is More Valuable Than any Single Skill

No skill is indispensable. If a skill consistently causes issues (wrong model, bad output format, poor connections), replace or remove it. Protecting a skill because it was hard to build is The Bloat thinking. The toolkit's health matters more than any individual node.

**Test:** *"Would removing this skill and re-routing its callers make the toolkit stronger?"* If yes, remove it.

### P6 — Constraints Block Rationalization

Behavioral constraints (MUST/MUST NOT rules) exist to prevent the most common AI failure mode: rationalization. The AI will always find a reason to skip a step, abbreviate a check, or declare success without verification. Constraints don't suggest — they block. If a constraint can be argued away, it is not a constraint; it's a guideline.

**Test:** *"Can the AI talk itself out of following this constraint?"* If yes, rewrite it to be more specific.

### P7 — Cost Is a Feature

Model selection is a design decision, not an afterthought. Haiku for scans. Sonnet for code. Opus for architecture and security. Using opus for a file glob is waste. Using haiku for a security audit is negligence. Every skill's `## Cost Profile` is a design constraint, not documentation.

**Test:** *"Is this skill using the cheapest model that can do the job correctly?"* If not, downgrade.

---

## 5. The Skill Addition Filter

*Use this checklist every time a new skill is proposed — by the team, by users, or by an AI session that thinks "we should add X."*

A proposed skill must pass **all 5 gates** to be added to the core graph (L1-L3). L4 extension packs have a lighter filter (gates 1 and 5 only).

### Gate 1 — Lifecycle Fit
> Does this skill serve the software development lifecycle?

The skill must fit one of these phases: planning, coding, testing, reviewing, deploying, monitoring, rescuing. If it primarily serves a non-development task (communication, content, business ops), it belongs outside Topia's core — possibly as a user's private skill.

❌ **Fail example:** `slack-notifier` — communication, not development
✅ **Pass example:** `audit` — project health assessment, fits the quality phase

### Gate 2 — Connection Requirement
> Does this skill have ≥2 meaningful graph connections (inbound + outbound combined)?

A skill must either call at least one existing skill OR be called by at least two existing skills — and ideally both. Connections must be meaningful (actual data flow), not ceremonial.

❌ **Fail example:** `code-formatter` — no inbound, no outbound, pure L3 with 0 connections
✅ **Pass example:** `audit` — calls `guardian`, `dependency-doctor`, `autopsy`, `scout`, `journal`; called by `build`, `launch`

### Gate 3 — Non-Redundancy
> Can this skill's function be achieved by composing 2 existing skills?

If yes, add a new workflow to an existing skill instead of creating a new one. Topia's philosophy is deepening connections in existing skills before adding new nodes.

❌ **Fail example:** `quick-security-check` — just `guardian` with fewer checks; redundant
✅ **Pass example:** `audit` — orchestrates multiple skills into a unified 7-phase report; not achievable by a single existing skill

### Gate 4 — Layer Assignment
> Is the correct layer assignment clear and unambiguous?

If it's unclear whether the skill should be L1, L2, or L3 — that's a signal the skill's scope is not well-defined yet. Clarify the scope first.

L3 if: stateless, single-purpose, no orchestration
L2 if: workflow with multiple steps, may call other skills
L1 if: full lifecycle orchestration, user-facing entry point

### Gate 5 — The Removal Test
> If this skill is removed in 6 months, does the toolkit lose something irreplaceable?

This test separates essential skills from convenience features. If the skill's absence could be worked around trivially, it's not core.

❌ **Fail example:** `git-log-formatter` — convenience wrapper; absence has no workflow impact
✅ **Pass example:** `guardian` — no other skill provides security scanning; its absence leaves a critical gap

---

## 6. Roadmap Horizons

Topia operates on three time horizons. The roadmap is intentionally non-prescriptive about dates — Topia is a solo/small-team project and date-driven roadmaps create pressure to ship The Bloat.

### H1 — Consolidation ✅ COMPLETE

**Goal:** Make the existing skills excellent before adding more.

- Deepen graph connections: audit every skill's `## Calls` and `## Called By` for accuracy
- Harden behavioral constraints: identify constraints that can be rationalized away and rewrite them
- Validate L4 extension packs: ensure all 10 packs have complete, executable `PACK.md` files
- Wire Topia as a native plugin in the internal Claude Code configuration

**Constraint:** No new L1-L3 core skills until Consolidation is complete. L4 packs are allowed.

### H2 — Ecosystem ✅ COMPLETE

**Goal:** Make Topia extensible internally without compromising the core graph.

- Internal L4 extension packs: documented contribution process, review criteria
- Plugin versioning: semver for skill APIs so callers don't break on updates
- Skill testing framework: automated validation of graph connections and output format contracts
- `topia:onboard` generates project-specific L4 suggestions based on detected stack

**Constraint:** Growth happens in L4 packs. Core graph (L1-L3) expansions require Skill Addition Filter approval.

### H3 — Intelligence ✅ COMPLETE

**Goal:** Make the toolkit self-aware and self-improving.

- ✅ Graph analytics: `metrics-collector` hook captures skill invocations, `post-session-reflect` flushes to `.topia/metrics/`, `audit` Phase 8 surfaces insights via `/topia metrics`
- ✅ Adaptive routing: `skill-router` Step 0 reads `.topia/metrics/routing-overrides.json`, `build` Phase 8 auto-generates overrides from failure patterns
- ✅ Skill performance metrics: `skills.json` tracks invocations, phase outcomes, quality gate results, debug loops per skill
- ✅ Internal skill sharing: `/topia pack install/list/remove/create` commands, `validate-pack.js` script, internal pack contribution guide, `onboard` discovers installed packs

**Implementation**: Zero new L1-L3 skills added. 1 new hook (`metrics-collector`), 3 modified hooks, 4 extended skills (`audit`, `build`, `skill-router`, `onboard`), 2 new commands (`/topia metrics`, `/topia pack`).

**Constraint:** Core graph holds at 66 skills. Further growth happens in L4 packs.

### H4 — Runtime Discipline ✅ COMPLETE (v2.12)

**Goal:** Move workflow discipline from "invoke the skill" (opt-in) to "the platform fires it" (automatic).

- ✅ **Native hooks across 4 platforms** — `Topia hooks install` wires `readiness`, `guardian`, `completion-gate`, `dependency-doctor` as pre-tool-use hooks on Claude Code, Cursor, Windsurf, Antigravity
- ✅ **Three presets** — `strict` (blocking), `gentle` (warnings, default), `off` (uninstall). Idempotent with full user-hook restore
- ✅ **logic-guardian auto-seeding** — `Topia init` writes `.topia/INVARIANTS.md` with project-detected rules; preflight reads as a hard gate

**Why this matters:** Principle P6 ("Constraints Block Rationalization") is now enforced at the tool-use layer, not just in skill prompts. The AI cannot "forget" to run preflight — the hook fires before every edit.

**Constraint:** Hooks run on user tools, not hypothetical Topia commands.

---

## 7. Success Metrics

*Topia is successful when these are true. Not when the feature list is long.*

### Graph Health
- **Connection density** ≥ 3.0 connections/skill (currently: 3.1 at 203 synapses / 66 skills) — do not let this drop below 2.5
- **Dead nodes** = 0 — every skill has ≥1 inbound and ≥1 outbound connection
- **Max chain depth used** < 6 in practice (ceiling is 8) — if chains regularly hit 8, the toolkit needs restructuring
- **Bloat Index** = 0.00 — dead nodes / total skills

### Behavioral Quality
- **Constraint coverage** = 100% — every skill has a `## Constraints` section
- **HARD-GATE consistency** — all hard gates use `<HARD-GATE>` XML format, none can be silently bypassed
- **Output format coverage** = 100% — every skill has a structured `## Output Format`

### Developer Experience
- A developer can go from `/topia onboard` to first working feature with `/topia build` in one session
- A developer can pick up work across sessions with zero manual context re-loading (`.topia/` handles it)
- The most common workflows (`build`, `debug`, `rescue`) work without reading any documentation

### The Bloat Index
*This is the most important metric.*

> **Bloat Index = dead nodes / total skills**

Target: **0.00**. If any skill has 0 inbound AND 0 outbound connections, it is dead weight. Review quarterly and remove or reconnect.

---

## Appendix: The Bloat's Greatest Hits

*A record of feature requests and ideas that The Bloat has whispered — and why they were rejected.*

| Proposal | The Bloat's argument | Why rejected |
|----------|---------------------|--------------|
| `code-formatter` | "Devs always need formatting" | 0 graph connections. Use the project's existing linter instead. |
| `email-writer` | "Devs write emails about their code all the time" | Not a development lifecycle task. Wrong product category. |
| `quick-fix` | "Sometimes `fix` is overkill" | Redundant. Use `fix` with a narrow scope. Don't duplicate skills. |
| `explain-code` | "Junior devs need code explained" | Claude's base capability handles this. No graph value added by wrapping it in a skill. |
| `changelog-generator` | "Every project needs changelogs" | `journal` + `session-bridge` + a git log command covers this. Non-core. |

*When The Bloat returns with a new proposal — and it will — add it here with the rejection reason. This log is part of the VISION.*

---

*This document is a living compass, not a frozen spec. Update it when Topia's direction genuinely shifts — not to justify a decision already made.*
