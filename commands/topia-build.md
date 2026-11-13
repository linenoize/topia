---
name: topia-build
description: "Use when building a feature or a multi-step change that needs tests: 'implement X', 'add support for Y', 'build the Z flow'. Plans, writes a failing test, codes, checks and commits. For a known one-line change use fix; for a bug with an unknown cause use debug first."
disable-model-invocation: true
---

# /topia-build

User-facing alias for the Topia **build** skill (`/topia:build`).

1. Invoke the Skill tool with `topia:build`
2. Pass the request as the skill arguments. The skill runs as a forked subagent, in the background by default, and cannot see this conversation. Do not claim results until its report arrives as a task notification; then relay any Decision Needed block (skill-router Step 4.5)
3. Announce: "Routing to topia:build (L1, sonnet)"

Also reachable via `/topia build` or `/topia:build`.
