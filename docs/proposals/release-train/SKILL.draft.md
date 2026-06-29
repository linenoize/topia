---
name: release-train
description: "Coordinate the promotion of a PINNED, VALIDATED set of changes across multiple deploy units (polyrepo services, split front/back end, microservices, independently-released packages). Use when shipping several tickets that span >1 repo from one environment to the next without cherry-picking. Replaces hand-sorted, hand-cherry-picked cross-repo releases with a single release.lock manifest and a promote-the-whole-set workflow."
disable-model-invocation: true
metadata:
  author: topia
  version: "0.1.0"
  layer: L2
  model: sonnet
  group: delivery
  tools: "Read, Write, Edit, Bash, Glob, Grep"
  emit: release.assembled, release.validated, release.promoted
  listen: tests.passed, verification.complete
---

# release-train

## Purpose

Coordinate releases that span more than one independently-deployed unit. A
release becomes a single manifest — `release.lock` — that pins each unit to an
exact ref, records which tickets it carries and whether they were validated
together, and tracks promotion state across environments. The skill assembles
that lock, drives integrated validation against the pinned set, and promotes the
**whole** validated set forward. It exists to eliminate the cross-repo
cherry-pick: never reassemble a release by hand again.

This is a **coordinator** above `deploy`, not a replacement for it. `deploy`
ships one unit to one platform; `release-train` owns the *set* and the
*promotion state*, calling `deploy` once per component.

<HARD-GATE>
- PROMOTE refuses if lock `status` != `validated`.
- PROMOTE refuses if ANY ticket in the lock has `validated: false`.
- PROMOTE is all-or-nothing — the whole lock advances, or nothing does.
  There is no "promote a subset" flag. A subset request = reject + explain.
- VALIDATE stashes ONLY a dirty working tree. Never force-stash a clean tree.
</HARD-GATE>

## Triggers

- `/topia release-train assemble | validate | promote <env> | status | rollback <env>`
- Auto-suggested (advisory) by the `release-train-detect` hook when a
  coordinated multi-unit release is detected without a `release.lock`.
- Routed by `intent-router` on phrases like "promote to prod across repos",
  "cherry-pick across services", "release train", "ship these tickets together".

## Called By (inbound)

- `launch` (L1): when a launch spans >1 deploy unit
- User: direct `/topia release-train ...`
- `release-train-detect` hook: advisory nudge only (does not auto-run)

## Calls (outbound)

- `deploy` (L2): once per component during PROMOTE, with that component's pinned ref
- `verification` (L2) / `test` (L2): the VALIDATE gate (or a stack-local validator)
- `git` (L2): stamp the coordinated tag/changelog across components
- `journal` (L3): record promotion decision + rollback target
- `watchdog` (L3): post-promote health monitoring
- `incident` (L2): if post-promote health fails → triage, then `rollback`

## Cross-Hub Connections

- `release-train` → `deploy` — per-component shipping of the pinned set
- `release-train` → `verification` — the validation gate must pass before FREEZE
- `release-train` → `journal` — promotion + rollback target recorded

## Data Flow

### Feeds Into →
- `deploy` (L2): pinned `components[].ref` → the exact thing each deploy ships
- `journal` (L3): promotion event + `provenance.previous` → ADR / rollback record

### Fed By ←
- `verification` / `test` (L2): pass/fail + evidence → written into `tickets[].validated`
- stack-local validator (e.g. `stash-pull-build-tests`): integrated test results ← consumed by VALIDATE

## Execution Steps

### Mode: `assemble`

1. Resolve the component set from the stack profile (e.g. compose build
   contexts, a repo list, or workspace file). If no profile, ask the user for the
   units once.
2. For each unit, capture the current ref (`git -C <unit> rev-parse HEAD`) and,
   if present, its latest tag.
3. Collect open/merged tickets since `provenance.previous`. **Group co-dependent
   tickets into this one lock** — overlapping work ships together, not as N
   separate promotions.
4. Write `.topia/release/release.lock.yaml` with `status: draft`.
5. Emit `release.assembled`. Report the draft lock.

### Mode: `validate`

1. **Stash guard:** if (and only if) a unit's working tree is dirty, stash it;
   record that a stash was taken so it can be restored. A clean tree is pulled
   without stashing.
2. Bring each unit to its pinned ref; run **integrated** validation against the
   whole set (delegate to `verification`/`test`, or the stack-local validator).
3. For each ticket, set `validated: true|false` + `validated_by` + `evidence`
   path. Do not invent validation — a ticket with no evidence stays `false`.
4. If all tickets validated → `status: validated` (FREEZE; lock is now immutable
   for this channel). Emit `release.validated`. Otherwise report the blockers.

### Mode: `promote <env>`

1. Enforce HARD-GATE (status == validated, every ticket validated). On failure →
   STOP, list exactly which tickets/units block, suggest `validate`.
2. `status: promoting:<env>`. For each component, call `deploy` with the pinned
   ref to `<env>`. Apply the coordinated tag via `git` if not already stamped.
3. On all components live + healthy → `status: promoted:<env>`, set
   `provenance.promoted_to.<env>`, archive a copy to
   `.topia/release/history/<release>.lock.yaml`.
4. Emit `release.promoted`. Call `journal` to record the decision + rollback
   target. Call `watchdog` to monitor `<env>`.
5. If any component fails to go live → STOP, report partial state, recommend
   `rollback <env>` (the set is atomic in intent).

### Mode: `status`

Print the lock: each unit + ref, each ticket + validation state, current
`channel`/`status`, and where it sits relative to `provenance`.

### Mode: `rollback <env>`

Re-promote `provenance.previous` to `<env>` (its components are already-known
good refs). Rollback is **not** a cherry-picked revert — it is a re-promotion of
the prior lock.

## Output Format

```
## Release Train — <release> [<status> @ <channel>]
Components:  api@a1b2c3d  hermes@e4f5g6h  dashboard@i7j8k9l
Tickets:     SCRUM-512 ✅(maggie)   SCRUM-518 ❌ blocks promote
Gate:        BLOCKED — 1 ticket unvalidated
Next:        /topia release-train validate
Rollback to: 2026-06-05
```

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `lock_path` | path | `.topia/release/release.lock.yaml` |
| `status` | enum | `draft` / `validating` / `validated` / `promoting:<env>` / `promoted:<env>` |
| `blocked_tickets` | list | tickets with `validated: false` (empty if promotable) |
| `components` | list | `{unit, ref}` actually pinned/promoted |
| `rollback_target` | string | `provenance.previous` release name |

## Constraints

1. MUST treat the SHA (`components[].ref`) as truth and a tag as an alias — record both, trust the SHA.
2. MUST NOT promote a subset of a lock — promotion is the whole set or nothing (kills cherry-pick).
3. MUST NOT mark a ticket `validated: true` without an evidence artifact — no evidence, no promotion.
4. MUST stash only a dirty tree during validate; MUST restore any stash it took.
5. MUST write `provenance.previous` on every promotion so rollback re-promotes a known-good lock.
6. MUST stay stack-neutral — read the component set / ticket prefix / envs from a runtime profile, never hardcode a stack.
7. MUST NOT reimplement single-unit deploy — call `deploy` per component.

## Nexus Gates

| Gate | Requires | If Missing |
|------|----------|------------|
| Promote gate | `status == validated` AND every ticket `validated` | STOP; run `validate`; list blockers |
| Rollback gate | `provenance.previous` exists | STOP; no known-good prior lock to fall back to |
| Component gate | a resolvable component set (profile or user input) | ask the user for units once, then proceed |

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Promoting a subset "just this one PR" | CRITICAL | HARD-GATE: no subset flag exists; reject + explain |
| Marking tickets validated without integrated test | CRITICAL | Constraint 3: evidence artifact required per ticket |
| Tag drift — promoting a tag that moved off the tested SHA | HIGH | Pin + deploy by SHA; tag is display-only |
| Force-stashing a clean tree (origin-stack complaint) | MEDIUM | Stash guard: dirty-tree-only, restore after |
| Detector firing on a single-repo project | MEDIUM | Hook gate #1 (workspace must be multi-unit); ship the silence test |
| Lost rollback target after promote | HIGH | Constraint 5: write `provenance.previous` every promotion |

## Self-Validation

```
SELF-VALIDATION (run before emitting output):
- [ ] Every component has a SHA ref (not just a tag)
- [ ] Every ticket marked validated:true has an evidence path that exists
- [ ] PROMOTE was refused if status != validated or any ticket unvalidated
- [ ] No subset of the lock was promoted
- [ ] provenance.previous is set after a promotion
- [ ] Any stash taken during validate was restored
IF ANY check fails → fix before reporting done. Do NOT defer to completion-gate.
```

## Done When

- A `release.lock` exists with every component pinned to a SHA
- Every carried ticket has an explicit validation state + evidence
- The requested mode completed (assembled / validated / promoted / rolled back)
- On promote: all components live + healthy, lock archived, provenance written
- Self-Validation checklist: all checks passed

## Cost Profile

~1500–4000 tokens input, ~600–1500 output. Sonnet. Most wall-clock is in the
delegated `deploy`/validation runs, not in the skill itself.

**Scope guardrail**: `release-train` coordinates the promotion of a pinned,
validated set across multiple deploy units. It does NOT ship a single unit
(that's `deploy`), does NOT write application code, and MUST NOT engage on
single-repo / atomic-monorepo / continuous-deploy-per-merge projects — there is
no "set" to coordinate there.
