# Bugfix Kickoff — Phase 0.7 Reference

Phase 0.7 runs before Phase 1 when the active chain is `bugfix`. It collects ticket/branch preferences, suggests acceptance criteria, assembles an execution brief, and initializes the Progress Ledger. See steering checkpoints below for in-flight visibility.

## When to activate

All required:
- Active chain is `bugfix` (explicit `/topia build bugfix` or auto-detect from keywords)
- NOT `hotfix`, `nano`, or `fast` mode
- NOT resuming with `Continue <TICKET>` when `.topia/bugfix-briefs/<ticket>.md` already exists and kickoff was completed

## Skip kickoff when

- User said `"just do it"` / `"skip kickoff"`
- Kickoff brief already confirmed in this session (idempotency)
- User pasted a **complete** brief: ticket ID present + acceptance criteria (`- [ ]` items) + explicit `"go"` / `"start now"`

## Step 0.7.1 — Parse incoming context

| Field | Detection |
|-------|-----------|
| Ticket ID | Regex `([A-Z]{2,10}-\d+)` — e.g. `SCRUM-453`, `JIRA-123` |
| Summary | Text after `—` on first line, or first line sans ticket |
| Repro | Numbered steps in pasted body |
| Suspected cause | "Root cause", "suspected", "likely" sections |
| Acceptance criteria | Lines matching `- [ ]` or `- [x]` |

Pre-fill AskQuestion defaults from parsed values.

## Step 0.7.2 — AskQuestion (dev control panel)

Use **AskQuestion** for discrete choices. Collect ticket ID and branch name via follow-up prompt when AskQuestion cannot capture free text.

### Question 1: Create a branch?

| Option | id |
|--------|-----|
| Yes — create a branch (recommended) | `branch-yes` |
| No — stay on current branch | `branch-no` |

### Question 2: Commit policy

| Option | id |
|--------|-----|
| Ask before commit (default) | `commit-ask` |
| Auto-commit when tests pass | `commit-auto` |

### Question 3: Regression test

| Option | id |
|--------|-----|
| Write failing test first (default) | `test-red` |
| Skip tests (requires reason in follow-up) | `test-skip` |

### Question 4: UI verification

| Option | id |
|--------|-----|
| Tests only | `ui-tests-only` |
| Also run browser-pilot if UI bug | `ui-browser-pilot` |

### Question 5: Next action

| Option | id |
|--------|-----|
| Start now | `action-start` |
| Copy brief for later | `action-copy` |

### Free-text follow-up (always ask if not parsed)

1. **Ticket ID** — required for Start now. HARD-GATE: block Start now without ticket ID.
2. **Branch name** — suggest `fix/<ticket-lowercase>-<slug>` (max 50 chars, kebab-case). Example: `fix/scrum-453-feedback-comment-projection`

If repro is unconfirmed, suggest `/topia review-intake` before Start now.

## Step 0.7.3 — Suggest acceptance criteria (when missing)

Derive 3–5 criteria from repro + suspected cause:

1. Current broken behavior (observable)
2. Desired behavior after fix
3. Fix invariant (e.g. field always projected with default `""`)
4. Regression test covers the repro case
5. Out-of-scope item stated as negative criterion if helpful

Present as editable checklist. Dev accepts, edits, or adds before brief assembly.

## Step 0.7.4 — Bugfix Execution Brief template

Write to `.topia/bugfix-briefs/<ticket>.md`:

```markdown
# Bugfix Execution Brief

**Ticket:** SCRUM-453
**Summary:** [one line]
**Branch:** fix/scrum-453-[slug] (create: yes | no)
**Created:** [ISO date]

## Repro
[steps]

## Suspected cause
[if provided]

## Acceptance criteria
- [ ] [criterion 1]
- [ ] [criterion 2]

## Out of scope
- [item or "(none)"]

## Controls
- Commit: ask-before-commit | auto-commit
- Tests: regression-required | skip-with-reason
- UI verify: tests-only | browser-pilot

## Pipeline preview
1. Recon — locate relevant code paths
2. Checkpoint 1 — confirm hypothesis + files in scope
3. Test (RED) — failing regression test
4. Checkpoint 2 — confirm fix method before implementation
5. Fix — minimal change
6. Quality — readiness, guardian, review, completion-gate
7. Verify — lint, types, tests, build
8. Checkpoint 3 — pre-commit review
9. Commit — per commit policy
10. Cook Report — acceptance criteria + files touched + progress

## Invoke (copy for later)
/topia build bugfix
Continue SCRUM-453 — execute the brief below. Branch: fix/scrum-453-...
[paste repro + criteria]
Go.
```

## Step 0.7.5 — Dev choice outcomes

| Choice | Action |
|--------|--------|
| **Start now** | Create branch via `topia:git branch` if yes → write brief → init Progress Ledger → proceed Phase 1 |
| **Copy for later** | Write brief only → emit copy-ready Invoke block → **STOP** (no recon, no edits) |

## Step 0.7.7 — Progress Ledger template

Write to `.topia/bugfix-briefs/<ticket>-progress.md` on Start now. Update after every phase transition and every file touch.

```markdown
# Progress: SCRUM-453

**Ticket:** SCRUM-453
**Branch:** fix/scrum-453-feedback-comment-projection
**Last updated:** [ISO timestamp]

## Pipeline
| Phase | Status | Notes |
|-------|--------|-------|
| Kickoff | done | |
| Recon | pending | |
| Fix hypothesis (CP1) | pending | |
| Test RED | pending | |
| Fix method (CP2) | pending | |
| Fix | pending | |
| Quality | pending | |
| Verify | pending | |
| Pre-commit (CP3) | pending | |
| Commit | pending | |

## Fix plan (adjustable sections)
1. **Objective** — [what we're fixing]
2. **Root cause hypothesis** — [why it's broken]
3. **Fix method** — [how we'll change code]
4. **Files in scope** — [predicted touch points]
5. **Acceptance criteria** — [from kickoff brief]

## Files touched
| File | Action | Why | Phase |
|------|--------|-----|-------|
| | | | |

## Steering history
```

### Ledger update rules

- After recon: populate §2 hypothesis, §4 files (action `read`), update Pipeline row `Recon` → `done`
- After CP1 approved: Pipeline `Fix hypothesis` → `done`
- After RED test: add test file row (`create`), Pipeline `Test RED` → `done`
- After CP2 approved: Pipeline `Fix method` → `done`
- After each edit: append row with `modify` or `create`
- After steer: append Steering history line with timestamp + section changed

## Compact status block (every turn during bugfix)

Emit after each substantive step (max 8 lines):

```markdown
**SCRUM-453 progress:** Recon complete → Checkpoint 1 pending
- Phases: kickoff ✓ | recon ✓ | hypothesis ⏸ | test ○ | fix ○
- Files: 2 read, 0 modified
- Next: confirm fix hypothesis or adjust plan section
```

Symbols: ✓ done | ⏸ waiting on dev | ○ pending | ✗ blocked

## Steering Checkpoints

Skip all checkpoints only if user said `just do it` / `skip kickoff` at kickoff.

<HARD-GATE>
Do NOT enter Phase 4 (implement) until dev confirms at CP1 or CP2.
</HARD-GATE>

### Checkpoint 1 — Fix Hypothesis (after recon, before Phase 3)

**Present:**
- Root cause hypothesis (1–2 sentences, cite code paths)
- Files in scope table (`read` actions + why)
- Proposed fix method (high level)
- Acceptance criteria from brief (unchanged unless dev edits)

**AskQuestion — "Any changes before we write a failing test?"**

| Option | id | Effect |
|--------|-----|--------|
| Proceed — hypothesis looks right | `cp1-proceed` | Continue to Phase 3 |
| Adjust objective | `cp1-objective` | Update ledger §1 + AC → re-present CP1 |
| Adjust root cause hypothesis | `cp1-hypothesis` | Update ledger §2 + files → re-present CP1 |
| Adjust fix method | `cp1-method` | Update ledger §3 → re-present CP1 |
| Adjust files in scope | `cp1-files` | Update ledger §4 → re-present CP1 |
| Adjust acceptance criteria | `cp1-ac` | Update brief + ledger §5 → re-present CP1 |
| Pause | `cp1-pause` | Write `.topia/.continue-here.md` → STOP |

Free-text follow-up: *"Which section would you like to change, and what should it say?"*

### Checkpoint 2 — Fix Method (after RED test, before Phase 4)

**Present:**
- Failing test name + actual failure output
- Exact change plan: file, function/stage, before → after
- Updated files touched table (includes test file)

**AskQuestion — "Test is RED. Proceed with this fix, or adjust?"**

Same options as CP1, plus:

| Option | id | Effect |
|--------|-----|--------|
| Adjust test approach | `cp2-test` | Rewrite test expectations → re-present CP2 |

### Checkpoint 3 — Pre-commit (after verify green, before Phase 7)

**Present:**
- Full files touched table
- Acceptance criteria pass/fail per item
- Diff summary (1 line per file)
- Commit message draft

**AskQuestion — "Ready to commit, or changes needed?"**

| Option | id | Effect |
|--------|-----|--------|
| Commit | `cp3-commit` | Phase 7 per commit policy |
| Adjust fix — more code changes | `cp3-more-fix` | Return Phase 4, update ledger |
| Adjust acceptance criteria | `cp3-ac` | Update brief; may require new test |
| Don't commit — PR summary only | `cp3-no-commit` | Cook Report without commit hash |

## Resume from brief

When user says `Continue SCRUM-453` or `Continue <TICKET>`:

1. `Read` `.topia/bugfix-briefs/<ticket>.md`
2. `Read` `.topia/bugfix-briefs/<ticket>-progress.md` if exists
3. Skip Phase 0.7 kickoff
4. Resume from last incomplete pipeline phase or checkpoint

## Worked example — SCRUM-453

**Input:**
```
/topia build bugfix
SCRUM-453 — Feedback comments not displaying when first record has no comment
[paste Jira body with repro + $concatArrays suspected cause]
```

**Suggested acceptance criteria:**
- [ ] When first feedback row has no `feedbackComment`, later rows still display their comments
- [ ] When first row has a comment, behavior unchanged
- [ ] Aggregation always projects `feedbackComment` with default `""`
- [ ] Regression test: row1 empty, row2+ populated → row2+ visible
- [ ] Out of scope: AppState/Denison placeholder workaround data removal

**Suggested branch:** `fix/scrum-453-feedback-comment-projection`

## Sharp edges

| Failure | Tier | Prevention |
|---------|------|------------|
| Start now without ticket ID | CRITICAL | HARD-GATE at Step 0.7.2 |
| Skipping CP1/CP2 and implementing immediately | CRITICAL | HARD-GATE on Phase 4 entry |
| Progress Ledger not updated after file edit | HIGH | Update ledger in same turn as edit |
| Copy-for-later still runs recon | HIGH | STOP after brief write — no Grep/Edit |
| Complete brief skip without all three signals | MEDIUM | Require ticket + AC checklist + explicit go |
