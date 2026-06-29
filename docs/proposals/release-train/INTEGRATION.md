# Proposal: `release-train` — coordinated multi-unit release as a first-class Topia capability

_Status: **proposed** (2026-06-19). Not yet promoted. This folder holds the
proposal (`INTEGRATION.md`), the draft skill (`SKILL.draft.md`), and the
detection-hook + lock-format specs that whoever promotes it will implement._

> Origin: a developer on a polyrepo team (8 service repos, Express + NestJS +
> Vue/React, wired by one `docker-compose.yml`) shipped 6 tickets that
> overlapped across 3 services (api / hermes / dashboard) and had to get them
> from QA to PROD by **sorting every PR chronologically across all three repos
> and cherry-picking each one by hand**. It worked once. It does not scale.
> This proposal generalizes the fix so it serves *any* project with the same
> shape, not just that one stack.

---

## 1. The problem (generalized — not Protopia-specific)

Any project that ships **coordinated changes across more than one
independently-versioned deploy unit** hits the same wall. That shape shows up as:

- a **polyrepo** of services released together (the origin case),
- a **split frontend + backend** that must ship as a pair,
- **microservices** with cross-cutting features,
- a monorepo whose **packages are released independently**,
- a **mobile app + API** that version in lockstep.

The wall is always the same: **there is no single object that says "this exact
set of versions, validated together, is the release."** Without that object,
promoting a *subset* of in-flight work from QA → PROD degenerates into manual
archaeology — reconstruct which commits belong together, across N repos, in
order, and cherry-pick them. The cherry-pick is the *symptom*. The missing
abstraction is the *disease*:

> **A release unit** = a named, pinned, validated set of `(unit → ref)` tuples,
> plus the tickets/PRs that set satisfies and the evidence they were validated
> together.

Topia today has `deploy` (ships **one** unit to **one** platform), `git`
(per-repo tags/changelog), and `launch` (deploy + marketing). **None models a
release unit spanning multiple deploy targets.** That is the gap this proposal
fills.

---

## 2. The pattern: **release train** + **`release.lock`**

### 2.1 `release.lock` — the source of truth

A release becomes a **diff to one manifest file**, not a hand-assembled pile of
cherry-picks. Canonical location follows Topia's `.topia/` state convention
(same as `deploy`'s `.topia/deploy/rollback-*.md`):

```
.topia/release/release.lock.yaml          # current/in-flight lock
.topia/release/history/<name>.lock.yaml   # archived, one per promoted release
```

Stack-neutral schema:

```yaml
# .topia/release/release.lock.yaml
release: 2026-06-19            # human name: date / vX.Y / R-142 — your call
status: validating            # draft | validating | validated | promoting:<env> | promoted:<env>
channel: qa                   # which environment this lock currently describes

components:                   # the deploy units and their PINNED versions
  - unit: api
    ref: a1b2c3d              # immutable SHA — the source of truth
    tag: v3.4.0               # human alias for the SHA (optional)
    artifact: registry/core-api:a1b2c3d   # built image/package identity (optional)
  - unit: hermes
    ref: e4f5g6h
  - unit: dashboard
    ref: i7j8k9l

tickets:                      # the validated WORK this release carries
  - id: SCRUM-512
    units: [api, dashboard]
    validated: true
    validated_by: maggie
    validated_at: 2026-06-18
    evidence: qa-run-2026-06-18.md
  - id: SCRUM-518
    units: [api, hermes]
    validated: false          # ← blocks promotion. See HARD-GATE in §3.

provenance:
  previous: 2026-06-05        # last promoted lock → clean diff + rollback target
  promoted_to: { qa: 2026-06-18T14:10Z, prod: null }
```

Why each part earns its place:

| Field | Why it exists | What it kills |
|---|---|---|
| `components[].ref` (SHA) | Records *exactly* what was tested. Tag is an alias; **SHA is truth.** | "which commit was actually in QA?" guesswork |
| `tickets[]` with `validated` | The validated work is **noted in the lock and carried forward** as a unit | losing track of which tickets are release-ready |
| `status` + `channel` | A promotion **state machine**, not vibes | "is this in prod yet?" ambiguity |
| `provenance.previous` | Rollback = **re-promote the previous lock** | cherry-picking a revert by hand |

### 2.2 The release-train method (the workflow)

Five steps. The "train" framing: releases **depart on a defined gate/cadence**.
Validated work **boards the train**; unvalidated work waits for the next one (or
rides **dark behind a feature flag** — reuse `deploy`'s progressive-rollout /
feature-flag mode). You never hold the train and reassemble cars by hand — that
*is* the cherry-pick anti-pattern.

```
1. ASSEMBLE  → collect current refs across units into a DRAFT lock.
               Group co-dependent tickets into ONE lock (the 6 overlapping
               tickets are one release unit, not six promotions).

2. VALIDATE  → run INTEGRATED validation against the pinned set (delegate to
               existing test/verification skills, or a stack-local validator).
               Mark each ticket validated:true + evidence in the lock.
               ── Stash is OPTIONAL: only stash a dirty working tree; a clean
                  pull needs no stash. (Do not force-stash.)

3. FREEZE    → status: validated. The lock is now immutable for this channel.
               No "just one more PR." That PR rides the next train.

4. PROMOTE   → advance the ENTIRE validated lock to the next environment.
               Promotion = bump channel/status + deploy exactly those refs,
               per unit (calls `deploy`). Never a subset. Never a cherry-pick.

5. RECORD    → write provenance, archive the lock to history/, emit a pulse.
               Rollback target = provenance.previous.
```

**The one rule that removes the pain: _promote the set, in full._** The moment
you allow "just push this one PR straight to prod," you are back to cherry-pick.

### 2.3 How this directly answers the field feedback

The developer praised a stack-local validator (`stash-pull-build-tests`) but
noted two gaps. The pattern closes both **by design**:

- *"We don't always need to stash before pull."* → VALIDATE stashes **only a
  dirty tree**; clean pulls skip it. Stash is a precondition guard, not a ritual.
- *"We still need validated tickets noted and then moved forward."* → the lock's
  `tickets[]` **is** where validated tickets are noted; PROMOTE **moves the whole
  noted set forward** (qa→prod) with validation state intact. The validator
  *checks*; the lock *records and carries*. That hand-off is the missing half.

---

## 3. The skill: `release-train` (draft in `SKILL.draft.md`)

Proposed frontmatter:

```yaml
name: release-train
metadata:
  layer: L2                 # orchestrates sub-steps; itself invoked by launch/user
  model: sonnet
  group: delivery
  tools: "Read, Write, Edit, Bash, Glob, Grep"
  emit: release.assembled, release.validated, release.promoted
  listen: tests.passed, verification.complete
```

Modes (folded into one skill — do **not** register five commands):

| Mode | Command | Does |
|---|---|---|
| assemble | `/topia release-train assemble` | build/update the draft lock from current refs + open tickets |
| validate | `/topia release-train validate` | validate the pinned set, mark tickets, attach evidence |
| promote  | `/topia release-train promote <env>` | promote the **whole** validated lock to `<env>` |
| status   | `/topia release-train status` | show the lock + where each unit/ticket sits |
| rollback | `/topia release-train rollback <env>` | re-promote `provenance.previous` |

**HARD-GATE (non-negotiable):**

```
- PROMOTE refuses if status != validated.
- PROMOTE refuses if ANY ticket in the lock has validated:false.
- PROMOTE is all-or-nothing: the whole lock, or nothing. No subset flag exists.
```

### Relationship to existing skills (avoid overlap — this is a *coordinator*)

- **`deploy`** ships one unit to one platform. `release-train` is the layer
  **above** it: it calls `deploy` once **per component** with that component's
  pinned ref. `release-train` owns the *set* and the *promotion state*; `deploy`
  owns the *act of shipping one thing*. No reimplementation.
- **`git`** stamps the coordinated tag/changelog **per repo** — `release-train`
  calls it to apply the same `vX` tag across every component.
- **`verification` / `test`** — the VALIDATE gate delegates here. On a stack with
  a bespoke integrated validator (e.g. a `stash-pull-build-tests`-style local
  skill), VALIDATE delegates to that instead and folds its results into the lock.
- **`journal`** — records the promotion decision + rollback target (ADR-style).
- **`incident`** / **`watchdog`** — post-promote health; on failure → rollback.
- **`launch`** — for a single-unit product launch, keep using `launch`. For a
  multi-unit coordinated release, `launch` (or the user) calls `release-train`.

### New pulses (must pass `scripts/validate-signals.js` before promotion)

| Pulse | Emitted by | Proposed listener | Meaning |
|---|---|---|---|
| `release.assembled` | release-train | verification / test | Draft lock built; validation can begin |
| `release.validated` | release-train | deploy | Lock frozen; ready to promote |
| `release.promoted` | release-train | watchdog, journal | A lock advanced to an environment |

(Every `emit` needs a real `listen` or an `INTENTIONAL_BROADCAST_SIGNALS`
whitelist entry — see promotion checklist §6.)

---

## 4. The hook set: **detect the problem, then guide the developer**

The user's explicit ask: *"if it can help identify when that exists, it would
help to notify the developer or guide them to this skill."* Two complementary
routes — one catches **what the developer says**, the other catches **what the
repo state shows even when they don't think to ask.**

### 4.1 `intent-router` entries (catches what they *say*) — zero new infra

Add `release-train` keywords to the compiled `skill-index.json` so the **existing**
`intent-router` hook (UserPromptSubmit) suggests the skill. Trigger phrases:

```
"cherry-pick across", "promote to prod", "release across repos",
"coordinated release", "sort PRs chronologically", "qa to prod",
"polyrepo deploy", "release train", "ship these tickets together",
"merge order across services"
```

This reuses the existing notification channel verbatim — it already prints
`🧭 [Topia intent-router] Suggested: topia:<skill>`.

### 4.2 `release-train-detect` (catches what the repo *shows*) — new advisory hook

A new hook at `hooks/release-train-detect/index.cjs`, registered in
`hooks/hooks.json`. **Advisory only — never blocks** (mirror `scope-guard`'s
posture: cherry-pick is *sometimes* legitimate; the hook informs, it does not
gate). The hard part is **not crying wolf on ordinary single-repo work**, so it
fires only when the workspace shape itself is multi-unit. Heuristic — suggest the
skill when **≥2** of these hold **and** no `release.lock` exists:

1. **Workspace is multi-unit.** Multiple sibling git repos under one parent, OR a
   compose/manifest with multiple `build.context`/service dirs, OR a workspace
   file enumerating repos. *(This gate is mandatory — it is what keeps the hook
   silent on the common single-repo case.)*
2. **Breadth is in flight.** ≥2 of those units have commits on their default
   branch since the last shared tag, OR ≥2 have un-merged release branches.
3. **The smell fired.** A `git cherry-pick` was invoked, OR cross-repo
   `git log`/`git push`/branch-compare commands ran against ≥2 sibling repos in
   one session.

Registration (matches the `intent-router`/`secrets-scan` pattern already in
`hooks.json`):

```jsonc
// PreToolUse, matcher "Bash" — fires on the cherry-pick / cross-repo-git smell
{ "type": "command",
  "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cjs\" release-train-detect",
  "async": true }
// (optionally also SessionStart — inspect workspace shape once per session)
```

On detection it prints, in the `intent-router` voice:

```
🚂 [Topia release-train] Coordinated multi-unit release detected
   (3 sibling repos with in-flight commits, no release.lock, cherry-pick in progress).
   Consider:  /topia release-train assemble
   Instead of cherry-picking PRs across repos by hand.
   → docs/proposals/release-train/INTEGRATION.md
```

**Anti-false-positive contract (ship as a test):** the detector MUST stay silent
on a single-repo project, on a monorepo that releases one atomic artifact, and on
continuous-deploy-per-merge setups. Gate #1 (workspace is multi-unit) is the
guard; without it the hook is noise and teams will mute it.

---

## 5. When to use it — and when NOT to (scope guardrail)

**Use `release-train` when:**

- ≥2 independently-deployed units must ship **coherently** (polyrepo, split FE/BE,
  microservices, independently-released monorepo packages, app + API).
- Promotion crosses environments (dev → qa → prod) **and you have ever
  cherry-picked to do it.**
- Multiple tickets/PRs land between releases and must be promoted as a set.

**Do NOT use it (and the detector must not fire) when:**

- **Single repo, single deploy unit** → just use `deploy`. The lock is pure
  overhead.
- **Continuous deploy** where every merge ships immediately → there is no "set"
  to coordinate.
- **Atomic monorepo** that already releases one artifact → the build *is* the
  manifest; a `release.lock` would duplicate it.

This boundary is the skill's terminal scope guardrail: **`release-train`
coordinates the promotion of a pinned set across units — it does not replace
`deploy`, and it must not engage on single-unit projects.**

---

## 6. Generalization discipline (scaffold vs. instance)

Following the same split the `architecture-mapper` proposal used: the **skill +
hooks ship stack-neutral**; everything Protopia-specific is an **instance
profile applied at runtime**, never baked into plugin content.

| Kind | Example | Where it lives |
|---|---|---|
| **Generic capability** | the lock schema, the 5-step method, the detector heuristic, the HARD-GATE | `skills/release-train/`, `hooks/release-train-detect/` (this proposal) |
| **Stack instance** | "components come from `docker-compose.yml` build contexts", "tickets are `SCRUM-*`", "validator is the local `stash-pull-build-tests`", "envs are dev/qa/demo/test/prod" | a `release-train-profile.md` fed to the skill at runtime — see Appendix A |

---

## 7. Promotion checklist (the actual integration work, when someone builds it)

1. [ ] `skills/release-train/SKILL.md` ← promote `SKILL.draft.md`.
2. [ ] `hooks/release-train-detect/index.cjs` + register in `hooks/hooks.json`
       (PreToolUse `Bash`, `async: true`; optional SessionStart).
3. [ ] Ship the detector's anti-false-positive **test** (silent on single-repo,
       atomic-monorepo, CD-per-merge).
4. [ ] Add `release-train` intent keywords to the `skill-index.json` source so
       `intent-router` suggests it.
5. [ ] Register pulses `release.assembled` / `release.validated` /
       `release.promoted` with real listeners (or whitelist) →
       `node scripts/validate-signals.js` must pass.
6. [ ] `agents/release-train.md` mirror (read-mostly assemble/validate; write
       only under `.topia/release/`).
7. [ ] `node scripts/validate-skills.js && node scripts/validate-nexus.js && npm test`.
8. [ ] Bump stats (skill count, hook count): `README.md`, `docs/index.html`,
       `.claude-plugin/plugin.json`, `docs/SKILLS.md`, `docs/HOOKS.md`,
       `docs/PULSES.md`, `CLAUDE.md`, `MEMORY.md`.
9. [ ] Sync to fork: `node scripts/sync-to-skill-topia.mjs`.

---

## Appendix A — Protopia instance profile (runtime input, NOT plugin content)

This is the *example* mapping for the origin stack. It stays in the Protopia
`dev-stack` workspace and is fed to the generic skill — it does **not** ship in
the plugin.

```yaml
# release-train-profile.md (Protopia dev-stack instance)
components_source: docker-compose.yml      # 7 build.context dirs = the units
units: [api, api-gateway, process-service, process-dashboard,
        hermes, dashboard, recruiting-dashboard]
ref_source: git -C ./<unit> rev-parse HEAD # source is baked at image build today
ticket_prefix: SCRUM-
environments: [dev, qa, demo, test, prod]
validator: stash-pull-build-tests          # local skill; VALIDATE delegates to it
                                           #   (stash only a dirty tree)
artifact_note: |
  compose currently builds from ./<unit> (whatever SHA is checked out) — there is
  no version pinning. First instance step: switch compose to tagged images
  (image: registry/<unit>:${REF}) so the lock's ref becomes the deployed artifact.
constraints:
  - linenoize lacks push to protopia/dashboard + protopia/hermes — promotion of
    those units routes through their own PR channel; the lock records the ref,
    a maintainer performs the push.
```

---

## Backlinks

- Pattern consumed by → `SKILL.draft.md` (this folder)
- Detection mechanism extends → `hooks/intent-router/index.cjs`, `hooks/hooks.json`
- Advisory-hook posture modeled on → `skills/scope-guard/SKILL.md`
- Promotion act delegates to → `skills/deploy/SKILL.md`, `skills/git/SKILL.md`
- Feature-flag / "ride dark" path reuses → `skills/deploy/SKILL.md` (Progressive Rollout)
- Generalization discipline mirrors → `docs/proposals/architecture-mapper/INTEGRATION.md`
