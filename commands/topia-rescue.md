---
name: topia-rescue
description: "Legacy refactoring orchestrator. Use when user says 'refactor', 'modernize', 'clean up this mess', 'rescue', or when dealing with old/messy/legacy code. Multi-session workflow — autopsy, safety net, incremental surgery, progress tracking."
disable-model-invocation: true
---

# /topia-rescue

User-facing alias for the Topia **rescue** skill (`/topia:rescue`).

1. Invoke the Skill tool with `topia:rescue`
2. Pass the request as the skill arguments. The skill runs as a forked subagent, in the background by default, and cannot see this conversation. Do not claim results until its report arrives as a task notification; then relay any Decision Needed block (skill-router Step 4.5)
3. Announce: "Routing to topia:rescue (L1, sonnet)"

Also reachable via `/topia rescue` or `/topia:rescue`.
