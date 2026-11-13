---
name: topia-rescue
description: "Use when a legacy codebase needs modernizing over several sessions: 'rescue this legacy app', 'modernize this old code', 'this module is unmaintainable'. Runs autopsy, sets up safety nets, then refactors one module per session. For one focused refactor use surgeon; not for new features."
disable-model-invocation: true
---

# /topia-rescue

User-facing alias for the Topia **rescue** skill (`/topia:rescue`).

1. Invoke the Skill tool with `topia:rescue`
2. Pass the request as the skill arguments. The skill runs as a forked subagent, in the background by default, and cannot see this conversation. Do not claim results until its report arrives as a task notification; then relay any Decision Needed block (skill-router Step 4.5)
3. Announce: "Routing to topia:rescue (L1, sonnet)"

Also reachable via `/topia rescue` or `/topia:rescue`.
