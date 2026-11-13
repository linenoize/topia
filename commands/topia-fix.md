---
name: topia-fix
description: "Use when the change is already known and only needs applying: a diagnosis from debug, review findings, or a small edit like 'change the timeout to 30s'. Edits the code and runs the tests. Does not investigate causes (debug) or plan multi-step features (build)."
disable-model-invocation: true
---

# /topia-fix

User-facing alias for the Topia **fix** skill (`/topia:fix`).

1. Invoke the Skill tool with `topia:fix`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:fix (L2, sonnet)"

Also reachable via `/topia fix` or `/topia:fix`.
