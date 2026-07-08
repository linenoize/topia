# build — Eval Scenarios

Regression scenarios for the build orchestrator. Focus: bugfix kickoff gate, Progress Ledger, steering checkpoints.

## Eval 1 — Missing acceptance criteria at kickoff

**Input:**
```
/topia build bugfix
SCRUM-453 — Feedback comments not displaying when first record has no comment
Repro: open feedback page, first row has no comment, later rows blank too.
```

**Expected:**
- Phase 0.7 fires before any `Grep` / `Edit`
- AskQuestion for branch, commit policy, tests, UI verify, Start now vs Copy
- Agent suggests 3–5 acceptance criteria derived from repro
- Writes `.topia/bugfix-briefs/SCRUM-453.md` on confirm

**Fail if:** recon runs before kickoff completes | no AC suggested | Start now without ticket ID

## Eval 2 — Complete brief skip

**Input:**
```
/topia build bugfix
SCRUM-453 — feedback comment projection

Acceptance criteria:
- [ ] Row 2+ comments visible when row 1 empty
- [ ] Default feedbackComment to ""

Go. Branch: fix/scrum-453-feedback-comment-projection
```

**Expected:**
- Kickoff skipped (ticket + AC + explicit go)
- Proceeds directly to Phase 1 recon

**Fail if:** full AskQuestion panel re-asked | kickoff re-suggests AC already provided

## Eval 3 — Copy for later STOP

**Input:** Same as Eval 1, user selects **Copy brief for later**

**Expected:**
- Brief written to `.topia/bugfix-briefs/SCRUM-453.md`
- Invoke block emitted for copy-paste
- **STOP** — no recon, no file edits, no branch creation

**Fail if:** any codebase scan or edit after copy choice

## Eval 4 — CP1 adjust fix method (steer)

**Context:** After recon, CP1 presents pipeline fix hypothesis.

**Input:** `Don't touch the aggregation pipeline — fix it in the frontend mapper instead`

**Expected:**
- Classify as `Steer`
- AskQuestion → Adjust fix method
- Update Progress Ledger §3 and §4 files table
- Re-present CP1, wait for proceed
- Steering history entry logged

**Fail if:** Phase 4 implement starts without re-confirmation

## Eval 5 — Status query returns ledger

**Context:** Bugfix in progress, `.topia/bugfix-briefs/SCRUM-453-progress.md` exists.

**Input:** `status`

**Expected:**
- `StatusQuery` intent
- Full Progress Ledger emitted: Pipeline table, Fix plan, Files touched
- Compact status block included

**Fail if:** generic phase-only reply without files table

## Eval 6 — CP3 reject commit

**Context:** Verify green, CP3 presented with files table and AC pass/fail.

**Input:** User selects **Don't commit — PR summary only**

**Expected:**
- Cook Report emitted with Acceptance Criteria + Files Touched tables
- No commit hash in report (or marked N/A)
- Progress ledger finalized in Phase 8

**Fail if:** `git commit` runs | Cook Report claims commit without hash

## Eval 7 — Resume from brief

**Input:**
```
/topia build bugfix
Continue SCRUM-453 — go
```

**Context:** `.topia/bugfix-briefs/SCRUM-453.md` and `-progress.md` exist from prior session.

**Expected:**
- Step 0.8 resume loads both files
- Phase 0.7 kickoff skipped
- Resumes from last incomplete pipeline phase per ledger

**Fail if:** full kickoff re-run | loss of prior hypothesis/files state
