---
name: topia-team
description: "Use when a task is too big for one session: it touches 5+ files or 3+ modules, or the user says 'do these in parallel', 'split this up', 'do all of these'. Splits the work into parallel streams in separate worktrees, runs build in each, and merges the results."
disable-model-invocation: true
---

# /topia-team

User-facing alias for the Topia **team** skill (`/topia:team`).

1. Invoke the Skill tool with `topia:team`
2. Pass the request as the skill arguments. The skill runs as a forked subagent, in the background by default, and cannot see this conversation. Do not claim results until its report arrives as a task notification; then relay any Decision Needed block (skill-router Step 4.5)
3. Announce: "Routing to topia:team (L1, opus)"

Also reachable via `/topia team` or `/topia:team`.
