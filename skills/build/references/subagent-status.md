# Subagent Status Protocol

When build completes (whether standalone or invoked by `team`), it MUST return one of four statuses.
Sub-skills invoked by build (fix, test, review, sentinel, etc.) MUST also return one of these statuses
so build can route accordingly.

## Status Table

| Status | Meaning | Cook Action |
|--------|---------|-------------|
| `DONE` | Task complete, no issues | Proceed to next phase |
| `DONE_WITH_CONCERNS` | Task complete but issues noted (e.g., "tests pass but a performance regression observed") | Proceed, but append concern to `.topia/progress.md` and surface in Cook Report; address in Phase 5 (QUALITY) or next review cycle |
| `NEEDS_CONTEXT` | Cannot proceed without more information or a decision (missing requirement, ambiguous spec, unknown environment, plan approval, checkpoint) | Save state and stop. Return the specific question(s) and a resume line. The caller asks the person and re-invokes build with the answer in ARGUMENTS. Build then resumes from the same phase. |
| `BLOCKED` | Hard blocker — cannot continue regardless of context (broken dependency, fundamental incompatibility, exhausted escalation chain) | Trigger escalation chain: debug-fix (3x) → re-plan (1x) → brainstorm rescue (1x) → then escalate to user with full details |

## Message Formats

### DONE_WITH_CONCERNS

Append to `.topia/progress.md`:
```
[CONCERN][phase][timestamp] <sub-skill>: <concern description>
```

### NEEDS_CONTEXT

State exactly:
1. What is unknown
2. Why it blocks progress
3. The two most likely answers (to help the user respond quickly)
4. The state file that holds progress so far
5. The resume line, e.g. `/topia:build approved .topia/plan-auth.md` or `/topia:build resume .topia/.continue-here.md — <answer>`

On Claude Code build usually runs in the background, so this report reaches the main conversation as a task notification. It is the only way a decision reaches the person. Never wait or guess past it.

### BLOCKED

Include:
1. The phase
2. The sub-skill that emitted BLOCKED
3. The specific blocker
4. What was already attempted
