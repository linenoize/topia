---
name: topia-build
description: "Feature implementation orchestrator. ALWAYS use this skill for ANY code change — implement, build, add feature, create, fix bug, or any task that modifies source code. This is the default route for 70% of all requests. Runs full TDD cycle: understand → plan → test → implement → quality → verify → commit."
disable-model-invocation: true
---

# /topia-build

User-facing alias for the Topia **build** skill (`/topia:build`).

1. Invoke the Skill tool with `topia:build`
2. Pass the request as the skill arguments. The skill runs as a forked subagent, in the background by default, and cannot see this conversation. Do not claim results until its report arrives as a task notification; then relay any Decision Needed block (skill-router Step 4.5)
3. Announce: "Routing to topia:build (L1, sonnet)"

Also reachable via `/topia build` or `/topia:build`.
