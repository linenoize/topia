---
name: skill-router
description: "Meta-enforcement layer that routes EVERY agent action through the correct skill. MUST check this routing table before ANY response involving code, files, or technical decisions. Default: route to Topia:build for code tasks. Prevents rationalization, enforces check-before-act discipline."
user-invocable: false
metadata:
  author: skill-topia
  version: "1.4.0"
  layer: L0
  model: haiku
  group: orchestrator
  tools: "Read, Glob, Grep"
---

## Live Routing Context

Routing overrides (if available): !`cat .topia/metrics/routing-overrides.json 2>/dev/null || echo "No adaptive routing rules active."`

Recent skill usage: !`cat .topia/metrics/skills.json 2>/dev/null | head -20 || echo "No metrics collected yet."`

# skill-router

## Purpose

The missing enforcement layer for topia. While individual skills have HARD-GATEs and constraints, nothing forces the agent to *check* for the right skill before acting. `skill-router` fixes this by intercepting every user request and routing it through the correct skill(s) before any code is written, any file is read, or any clarifying question is asked.

This is L0 — it sits above L1 orchestrators. It doesn't do work itself; it ensures the right skill does the work.

## Triggers

- **ALWAYS** — This skill is conceptually active on every user message
- Loaded via system prompt or plugin description, not invoked manually
- The agent MUST internalize this routing table and apply it before every response

## Calls (outbound connections)

- Any skill (L1-L3): routes to the correct skill based on intent detection

## Called By (inbound connections)

- None — this is the entry point. Nothing calls skill-router; it IS the first check.

## Workflow

### Step 0 — Check Routing Overrides (H3 Adaptive Routing)

Before standard routing, check if adaptive routing rules exist:

1. Use `Read` on `.topia/metrics/routing-overrides.json`
2. If the file exists and has active rules, scan each rule's `condition` against the current user intent
3. If a rule matches:
   - Apply the override action (e.g., "route to problem-solver before debug")
   - Log: "Adaptive routing: applying rule [id] — [action]"
4. If no file exists or no rules match, proceed to standard routing (Step 1)

**Override constraints**:
- Overrides MUST NOT bypass layer discipline (L3 cannot call L1)
- Overrides MUST NOT skip quality gates (guardian, readiness, verification)
- Overrides MUST NOT route to non-existent skills
- If an override seems wrong, announce it and let user decide to keep or disable

**Model hint support** (Adaptive Model Re-balancing):
- Override entries may include `"model_hint": "opus"` — this signals that a skill previously failed at sonnet-level and needed opus reasoning depth
- When a model_hint is present, announce: "Adaptive routing: this skill previously required opus-level reasoning for [context]. Escalating model."
- Model hints are written by build Phase 8 when debug-fix loops hit max retries on the same error pattern
- Model hints do NOT override explicit user model preferences

### Context Efficiency (Trigger-Table Pattern)

Skill-router's routing table above IS the trigger table — it maps keywords to skill paths without loading any skill content. Skills are loaded on-demand via the Skill tool only when routed. This keeps baseline context usage minimal.

**Rules for context efficiency:**
- NEVER read a SKILL.md to decide routing — use the routing table keywords
- NEVER load multiple skills speculatively — route to ONE, let it chain if needed
- Skill content is loaded by the Skill tool, not by skill-router reading files

### Step 0.25 — Request Classifier (Fast-Path Filter)

Before intent classification, categorize the request into one of 5 types. This determines the **enforcement level** — how strictly routing must be followed.

| Request Type | Keywords / Signals | Enforcement | Action |
|---|---|---|---|
| `CODE_CHANGE` | "build", "build", "implement", "add", "create", "fix", "refactor", "update code" | **FULL** | build mandatory, no exceptions |
| `QUESTION` | "what is", "how does", "explain", "why" | **LITE** | Check if a skill has domain knowledge first; answer directly if no skill matches |
| `DEBUG_REQUEST` | "error", "bug", "not working", "broken", "crash", "fails" | **FULL** | debug skill mandatory |
| `REVIEW_REQUEST` | "review", "check", "audit", "look at this code" | **FULL** | review skill mandatory |
| `EXPLORE` | "find", "search", "where is", "show me", "list", "Jira tickets", "CSV", "stories" | **LITE** | recon if codebase-related; answer directly if general |

**Enforcement levels:**
- **FULL** → MUST route through a skill. Writing code without skill invocation = protocol violation.
- **LITE** → SHOULD check if a skill applies. Can answer directly if no skill matches and the response involves no code changes.

**Escape hatch**: If request is clearly trivial (< 5 LOC change, single-line fix, user says "just do it"), classify as CODE_CHANGE but build activates Fast Mode automatically.

### Step 0.3 — Skill Discovery (`/topia list`)

If user says `/topia list`, "what skills do I have", "show all skills", "available skills", or "what can Topia do":

1. **Scan installed skills**: `Glob` for `skills/*/skill.md` (core L0-L3) and `extensions/*/PACK.md` (L4 packs)
2. **Output the catalog**:

```
## Topia Skills Catalog

### Core Skills (L0-L3) — Always Available
| Skill | Layer | Description |
|-------|-------|-------------|
(list each skill from skills/*/skill.md — read name + description from frontmatter)

### Extension Packs (L4) — Domain Knowledge
| Pack | Skills | Trigger |
|------|--------|---------|
(list each pack from extensions/*/PACK.md — read name + skill count + trigger commands)
```

4. **Tip line at bottom**: "Use `/topia <pack> <skill>` to invoke any skill directly. Use `/topia <pack>` for the full pack workflow."

**Filtering**: `/topia list <query>` filters by name or domain keyword (e.g., `/topia list finance` shows only finance-related skills).

### Step 0.5 — STOP before responding

Before generating ANY response (including clarifying questions), the agent MUST:

1. **Check the request type** from Step 0.25 — if FULL enforcement, routing is mandatory
2. **Classify the user's intent** using the routing table below
3. **Identify which skill(s) match** — if even 1% chance a skill applies, invoke it
4. **Invoke the skill** via the Skill tool
5. **Follow the skill's instructions** — the skill dictates the workflow, not the agent

### Step 1 — Intent Classification (Progressive Disclosure)

Skills are organized for discoverability. **Primary skills handle 90% of user requests.**

#### Primary Entry Points (User-Facing)

These 5 skills are the main interface. Most user intents route here first:

| User Intent | Route To | When |
|---|---|---|
| Build / implement / build / add feature / fix bug | `Topia:build` | Any code change request |
| Large multi-part task / parallel work | `Topia:team` | 5+ files or 3+ modules |
| Deploy + launch + marketing | `Topia:launch` | Ship to production |
| Legacy code / rescue / modernize | `Topia:rescue` | Old/messy codebase |
| Check project health / full audit | `Topia:audit` | Quality assessment |
| New project / bootstrap / scaffold | `Topia:scaffold` | Greenfield project creation |

**Default route**: If unclear, route to `Topia:build`. Build handles 70% of all requests.

#### Power User Skills (Direct Invocation)

For users who know exactly what they want:

| User Intent | Route To | Priority |
|---|---|---|
| Plan / design / architect | `Topia:plan` | L2 — requires opus |
| Brainstorm / explore ideas | `Topia:brainstorm` | L2 — before plan |
| Review code / check quality | `Topia:review` | L2 |
| Write tests | `Topia:test` | L2 — TDD |
| Refactor | `Topia:surgeon` | L2 — incremental |
| Deploy (without marketing) | `Topia:deploy` | L2 |
| Security concern | `Topia:guardian` | L2 — opus for critical |
| Performance issue | `Topia:perf` | L2 |
| Database change | `Topia:db` | L2 |
| Received code review / PR feedback | `Topia:review-intake` | L2 |
| Protect / audit / document business logic | `Topia:logic-guardian` | L2 |
| Create / edit a Topia skill | `Topia:skill-forge` | L2 — requires opus |
| Incident / outage | `Topia:incident` | L2 |
| UI/UX design | `Topia:design` | L2 |
| Fix bug / debug only (no fix) | `Topia:debug` → `Topia:fix` | L2 chain |
| Marketing assets only | `Topia:marketing` | L2 |
| Initial concept intake / Idea elicitation / Memory retrieval | `Topia:idea` | L2 — requires opus |
| Generate / update docs | `Topia:docs` | L2 |
| Generate leadership package / Jira CSV / User Stories | `Topia:documentation` | L2 |
| Build MCP server | `Topia:mcp-builder` | L2 |
| Red-team / challenge a plan / stress-test | `Topia:adversary` | L2 — requires opus |
| Port / graft from repo / copy from external repo | `Topia:integrate` | L2 — challenge gate before code |

#### Internal Skills (Called by Other Skills)

These are rarely invoked directly — they're called by higher-level skills:

| Skill | Called By | Purpose |
|---|---|---|
| `Topia:recon` | build, plan, team | Codebase scanning |
| `Topia:fix` | debug, build | Apply code changes |
| `Topia:readiness` | build | Quality gate |
| `Topia:verification` | build, fix | Run lint/test/build |
| `Topia:hallucination-guard` | build, fix | Verify imports |
| `Topia:completion-gate` | build | Validate claims |
| `Topia:guardian-env` | build, scaffold, onboard | Environment pre-flight |
| `Topia:research` / `Topia:docs-seeker` | any | Look up docs |
| `Topia:session-bridge` | build, team | Save context (in-session state handoff) |
| `Topia:journal` | build, team | Persistent work log within a session |
| `Topia:neural-memory` | build, team, any L1/L2 | Cross-session cognitive persistence via Neural Memory MCP — semantic complement to session-bridge and journal |
| `Topia:recall` | build, plan, recon, session-start | Unified read-only recall across `.topia/`, `.remember/`, neural-memory, agora-memory |
| `Topia:git` | build, scaffold, team, launch | Semantic commits, PRs, branches |
| `Topia:doc-processor` | docs, marketing | PDF/DOCX/XLSX/PPTX generation |
| "Done" / "ship it" / "xong" | — | `Topia:verification` → commit |
| "recall", "what did we do", "session context", "pick up where we left off" | `Topia:recall` | Unified cross-source memory read |
| "remember", "brain", "nmem", "cross-project memory", "store learning" | `Topia:neural-memory` | Persist or query semantic graph memory |

#### Domain Extension Packs (L4)

When user intent matches a domain-specific pattern or user explicitly invokes an L4 trigger command, route to the L4 pack.

**Split pack loading** (context-efficient): First `Read` the pack's PACK.md index. If the index contains `format: split` in its frontmatter metadata, it is a split pack — the index lists skills in a table but skill content lives in separate files under `skills/`. Match user intent to the specific skill name in the table, then `Read` only that skill file (e.g., `extensions/backend/skills/api-design.md`). This loads ~100-200 lines instead of ~1000+.

**Monolith pack loading** (legacy): If no `format: split` marker, the PACK.md contains all skills inline — read it fully and extract the matching `### skill-name` section.

| User Intent / Domain Signal | Route To | Pack File |
|---|---|---|
| Frontend UI, design system, a11y, animation | `@Topia/ui` | `extensions/ui/PACK.md` |
| API design, auth, middleware, rate limiting | `@Topia/backend` | `extensions/backend/PACK.md` |
| Docker, CI/CD, monitoring, server setup | `@Topia/devops` | `extensions/devops/PACK.md` |
| React Native, Flutter, mobile app, app store | `@Topia/mobile` | `extensions/mobile/PACK.md` |
| OWASP, pentest, secrets, compliance | `@Topia/security` | `extensions/security/PACK.md` |
| Shopify, payments, cart, inventory | `@Topia/ecommerce` | `extensions/ecommerce/PACK.md` |
| LLM, RAG, embeddings, fine-tuning | `@Topia/ai-ml` | `extensions/ai-ml/PACK.md` |
| Blog, CMS, MDX, i18n, SEO | `@Topia/content` | `extensions/content/PACK.md` |
| Analytics, A/B testing, funnels, dashboards | `@Topia/analytics` | `extensions/analytics/PACK.md` |
| Chrome extension, manifest, service worker | `@Topia/chrome-ext` | `extensions/chrome-ext/PACK.md` |
**L4 routing rules:**
1. If user explicitly invokes an L4 trigger (e.g., `/topia rag-patterns`), read the PACK.md index first, then load only the matching skill file (split packs) or extract the matching section (monolith packs)
2. If the intent also involves implementation, route to `build` (L1) first — build will detect L4 context in Phase 1.5
3. L4 packs supplement L1/L2 workflows — they are domain knowledge, not standalone orchestrators
4. L4 packs can call L3 utilities (recon, verification) but CANNOT call L1 or L2 skills
5. If the L4 pack file is not found on disk, skip silently and proceed with standard routing
6. **NEVER load an entire split pack** — always load index first, then only the specific skill file needed

### Step 1.5 — File Ownership Matrix (Constraint Inheritance)

When the routed skill produces file changes, the **owner skill's constraints** apply to those files — even if a different skill (e.g., build) is the orchestrator.

| File Pattern | Owner Skill | Constraints Applied |
|---|---|---|
| `*.test.*`, `*.spec.*`, `__tests__/` | `Topia:test` | Test patterns, assertions, no `test.skip`, coverage rules |
| `migrations/`, `schema.*`, `*.prisma` | `Topia:db` | Migration safety, rollback script, parameterized queries |
| `Dockerfile`, `*.yml` (CI/CD), `terraform/` | `Topia:deploy` | Deployment checklist, no hardcoded secrets |
| `docs/*.md`, `README.md`, `CHANGELOG.md` | `Topia:docs` | Documentation patterns, no stale references |
| `SKILL.md`, `PACK.md` | `Topia:skill-forge` | Skill template compliance, frontmatter validation |
| `.env*`, `*secret*`, `*credential*` | `Topia:guardian` | Security scan mandatory, never commit secrets |
| `*.css`, `*.scss`, `tailwind.config.*` | `@Topia/ui` | Design system patterns (if L4 pack installed) |

**Ownership rules:**
1. Ownership = **constraints apply**, NOT exclusive access. build can modify test files during Phase 4 as long as test constraints are honored.
2. If a file matches multiple patterns, ALL matching constraints apply (union, not exclusive).
3. If no pattern matches, the routed skill's own constraints apply (default behavior).
4. File ownership is checked DURING implementation, not at routing time — it augments, not replaces, skill routing.

### Step 2 — Compound Intent Resolution

Many requests combine intents. Route to the HIGHEST-PRIORITY skill first:

```
Priority: L1 > L2 > L3
Within same layer: process skills > implementation skills

Example: "Add auth and deploy it"
  → Topia:build (add auth) FIRST
  → Topia:deploy SECOND (after build completes)

Example: "Fix the login bug and add tests"
  → Topia:debug (diagnose) FIRST
  → Topia:fix (apply fix) SECOND
  → Topia:test (add tests) THIRD

L4 integration: If build is the primary route AND a domain pack matches,
build handles orchestration while the L4 pack provides domain patterns.
Both are active — build for workflow, L4 for domain knowledge.
```

### Step 3 — Anti-Rationalization Gate

The agent MUST NOT bypass routing with these excuses:

| Thought | Reality | Action |
|---|---|---|
| "This is too simple for a skill" | Simple tasks still benefit from structure | Route it |
| "I already know how to do this" | Skills have constraints you'll miss | Route it |
| "Let me just read the file first" | Skills tell you HOW to read | Route first |
| "I need more context before routing" | Route first, skill will gather context | Route it |
| "The user just wants a quick answer" | Quick answers can still be wrong | Check routing table |
| "No skill matches exactly" | Pick closest match, or use recon + plan | Route it |
| "I'll apply the skill patterns mentally" | Mental application misses constraints | Actually invoke it |
| "This is just a follow-up" | Follow-ups can change intent | Re-check routing |

### Step 4 — Execute

Once routed:
1. Announce: "Using `Topia:<skill>` to [purpose]"
2. Invoke the skill via Skill tool
3. Follow the skill's workflow exactly
4. If the skill has a checklist/phases, track via TodoWrite

### Step 5 — Post-Completion Neural Memory Capture

After ANY L1 or L2 workflow completes (build, team, launch, rescue, scaffold, plan, design, debug, fix, review, deploy, guardian, readiness, perf, db, idea, docs, mcp-builder, integrate, etc.):

1. Trigger `Topia:neural-memory` in **Capture Mode** automatically
2. Save 2–5 memories covering: key decisions made, bugs fixed, patterns applied, architectural choices
3. Use rich cognitive language (causal, temporal, decisional) — NOT flat facts
4. Tag memories with [project-name, skill-used, topic]
5. This step is MANDATORY even if the user did not ask for it
6. Exception: skip if the workflow produced zero technical output (e.g., only a clarifying question was asked)

**Capture Mode trigger phrase**: "Session artifact — capturing to Neural Memory."

## Routing Exceptions

These DO NOT need skill routing:
- Pure conversational responses ("hello", "thanks")
- Answering questions about Topia itself (meta-questions)
- Single-line factual answers with no code impact
- Resuming an already-active skill workflow

## Proactive Skill Recommendations (One-Hop Max)

At the end of a skill's workflow, skill-router MAY suggest a **complementary skill** — limited to ONE recommendation to prevent infinite referral chains.

### Chain Metadata Awareness (Priority Source)

When a previous skill's output contains a `chain_metadata` block in the conversation context, skill-router MUST use it as the PRIMARY source for next-skill suggestions:

1. **Read `chain_metadata.suggested_next`** — these are data-driven recommendations from the skill that just ran. They have MORE context than the hardcoded table below.
2. **Read `chain_metadata.status`** — override suggestion logic based on outcome:
   - `BLOCKED` → suggest `debug` or `fix` regardless of what the hardcoded table says
   - `NEEDS_CONTEXT` → suggest `recon` or `research`
   - `DONE_WITH_CONCERNS` → suggest `review` or `guardian`
3. **Read `chain_metadata.domain`** — trigger L4 pack auto-suggest (see below)
4. **Forward `chain_metadata.exports`** — when announcing the suggestion, mention what data is available: "Review can use the 5 changed files and test results from build."

**Conflict resolution:** If `chain_metadata.suggested_next` recommends skill A but the hardcoded table below recommends skill B, **prefer chain_metadata** — it was generated from actual output data, not generic rules.

**Announcement format with chain_metadata:**
```
Suggested next: `Topia:<skill>` — <chain_metadata.suggested_next.reason>
Available data: <list of export keys the suggested skill would consume>
Run it? (skip to continue)
```

### Hardcoded Fallback Table

When NO chain_metadata is present (skill didn't emit one, or legacy invocation), fall back to this static table:

| After This Skill | Suggest | Rationale |
|-----------------|---------|-----------|
| `debug` | `fix` | Root cause found — apply the fix |
| `fix` | `test` | Code changed — verify with tests |
| `plan` | `adversary` | Plan created — stress-test before implementation |
| `adversary` | `documentation` | Plan red-teamed — generate leadership package and Jira CSV |
| `documentation` | `build` | Package approved — start implementation |
| `test` (GREEN) | `readiness` | Tests pass — check for edge cases and completeness |
| `review` (issues found) | `fix` | Issues identified — apply fixes |
| `guardian` (findings) | `fix` | Security issues — remediate |

#### L4 Extension Auto-Suggest (Domain Context Detection)

When routing a request through L1/L2 skills, skill-router SHOULD detect domain signals and suggest relevant L4 packs the user may not know they have:

| Domain Signal Detected | Suggest Pack | Announcement |
|----------------------|-------------|--------------|
| Frontend / UI work (React, Vue, Tailwind, design tokens) | `@Topia/ui` | "You have `@Topia/ui` with frontend patterns + design system. Use `/topia ui` to access." |
| Backend / API work (Express, Fastify, REST, GraphQL) | `@Topia/backend` | "You have `@Topia/backend` with API, auth, and DB patterns. Use `/topia backend` to access." |
| Mobile work (React Native, Flutter, native bridges) | `@Topia/mobile` | "You have `@Topia/mobile` with cross-platform mobile patterns. Use `/topia mobile` to access." |
| DevOps / infra (Docker, CI/CD, IaC, monitoring) | `@Topia/devops` | "You have `@Topia/devops` with infra and deploy patterns. Use `/topia devops` to access." |
| Security work (OWASP, secrets, compliance) | `@Topia/security` | "You have `@Topia/security` with security audit patterns. Use `/topia security` to access." |
| Fintech (real-time data, charts, trading) | | "You have with fintech patterns. Use `/topia trading` to access." |
| SaaS (multi-tenant, billing, subscriptions) | | "You have with multi-tenant patterns. Use `/topia saas` to access." |
| E-commerce (Shopify, cart, payments, inventory) | `@Topia/ecommerce` | "You have `@Topia/ecommerce` with commerce patterns. Use `/topia ecommerce` to access." |
| AI/ML (LLM, RAG, embeddings, fine-tuning) | `@Topia/ai-ml` | "You have `@Topia/ai-ml` with LLM patterns. Use `/topia ai-ml` to access." |
| Game dev (Three.js, WebGL, game loops) | | "You have with game patterns. Use `/topia gamedev` to access." |
| Content / CMS (blog, MDX, i18n, SEO) | `@Topia/content` | "You have `@Topia/content` with content patterns. Use `/topia content` to access." |
| Analytics (tracking, A/B testing, funnels) | `@Topia/analytics` | "You have `@Topia/analytics` with analytics patterns. Use `/topia analytics` to access." |
| Chrome extension (manifest v3, content scripts) | `@Topia/chrome-ext` | "You have `@Topia/chrome-ext` with extension patterns. Use `/topia chrome-ext` to access." |
| Zalo platform (OA messaging, mini-app, ZNS) | | "You have with Zalo platform patterns. Use `/topia zalo` to access." |

**Auto-suggest rules:**
1. Only suggest if the pack's PACK.md **exists on disk** — `Glob` for the pack path first. If not installed, skip silently.
2. Read `.topia/active-packs.json` if present — **do not** re-suggest packs already listed in `enabled` (onboard activated them).
3. Suggest ONCE per session per pack — do not repeat after user has seen the suggestion.
4. Format: brief inline note, not a blocking prompt. User can ignore and continue.
5. If user is already inside the pack's workflow, do not re-suggest.
6. When `chain_metadata.domain` matches an **active** pack, prefer loading that pack's patterns over generic suggestions.

**Rules:**
- Hard limit: 1 hop. NEVER chain recommendations (fix→test→readiness→...). Suggest ONE, let the user decide.
- Announcement format: "Suggested next: `Topia:<skill>` — [1-line reason]. Run it? (skip to continue)"
- User can disable with "no suggestions" or "just do what I asked"
- Inside `build` orchestration: skip recommendations — build already manages transitions


## Output Format

### Routing Proof (Required in Every Code Response)

Every response that involves code changes MUST begin with a routing proof line:

```
> Routed: Topia:<skill> | Type: CODE_CHANGE | Confidence: HIGH
```

This is NOT optional formatting. It is evidence that routing occurred. If this line is missing from a code response, the response violated skill-router compliance. For LITE enforcement (QUESTION, EXPLORE), the proof line is optional.

### Full Routing Decision (when announcing route)

```
## Routing Decision
- **Intent**: [classified user intent]
- **Type**: CODE_CHANGE | QUESTION | DEBUG_REQUEST | REVIEW_REQUEST | EXPLORE
- **Skill**: Topia:[skill-name]
- **Confidence**: HIGH | MEDIUM | LOW
- **Override**: [routing override applied, if any]
- **Reason**: [one-line justification for skill selection]
```

For multi-skill chains:
```
## Routing Chain
1. Topia:[skill-1] — [purpose]
2. Topia:[skill-2] — [purpose]
3. Topia:[skill-3] — [purpose]
```

## Constraints

1. MUST check routing table before EVERY response that involves code, files, or technical decisions
2. MUST invoke skill via Skill tool — "mentally applying" a skill is NOT acceptable
3. MUST NOT write code without routing through at least one skill first
4. MUST NOT skip routing because "it's faster" — speed without correctness wastes more time
5. MUST re-route on intent change — if user shifts from "plan" to "implement", switch skills
6. MUST announce which skill is being used and why — transparency builds trust
7. MUST follow skill's internal workflow, not override it with own judgment

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Agent writes code without invoking any skill | CRITICAL | Constraint 3: code REQUIRES skill routing. No exceptions. |
| Agent "mentally applies" skill without invoking | HIGH | Constraint 2: must use Skill tool for full content |
| Routes to wrong skill, wastes a full workflow | MEDIUM | Step 2 compound resolution + re-route on mismatch |
| Over-routing trivial tasks (e.g., "what time is it") | LOW | Routing Exceptions section covers non-technical queries |
| Skill invocation adds latency to simple tasks | LOW | Acceptable trade-off: correctness > speed |

## Done When

- This skill is never "done" — it's a persistent routing layer
- Success = every agent response passes through routing check
- Failure = any code written without skill invocation

## Self-Verification Trigger (MANDATORY)

<HARD-GATE>
Before EVERY response, complete this 3-point self-check:

1. **Did I classify this request?** (Step 0.25 — what type is it?)
2. **Did I route through a skill?** (Step 1-2 — which skill handles this?)
3. **Am I about to write code without a skill invocation?** → **STOP. Route first.**

If the request type is `CODE_CHANGE` or `DEBUG_REQUEST` (FULL enforcement) and ANY answer is "no":
→ DO NOT RESPOND. Complete routing first.

If the request type is `QUESTION` or `EXPLORE` (LITE enforcement):
→ Check if a skill has relevant domain knowledge. If yes, route. If no, respond directly.

**User override**: If user explicitly says "skip routing", "just write it", "no process" → respect the override. Log: "User override: routing skipped per explicit request."
</HARD-GATE>

## Cost Profile

~0 tokens (routing logic is internalized from this document). Cost comes from the skills it routes to, not from skill-router itself. The routing table is loaded once and cached in context.
