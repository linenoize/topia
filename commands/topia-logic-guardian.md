---
name: topia-logic-guardian
description: "Use when editing payment, billing, trading, state-machine or other business logic where one deleted line can silently corrupt data. Keeps a manifest of the logic that must survive, asks what an edit will preserve, and checks the diff after."
disable-model-invocation: true
---

# /topia-logic-guardian

User-facing alias for the Topia **logic-guardian** skill (`/topia:logic-guardian`).

1. Invoke the Skill tool with `topia:logic-guardian`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:logic-guardian (L2, sonnet)"

Also reachable via `/topia logic-guardian` or `/topia:logic-guardian`.
