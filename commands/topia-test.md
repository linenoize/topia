---
name: topia-test
description: "Use when writing or repairing tests: 'add tests for X', 'write a failing test first', 'raise coverage on Y', 'add an e2e test'. Writes the failing test first, then confirms it passes after the change. Running the existing suite is verification."
disable-model-invocation: true
---

# /topia-test

User-facing alias for the Topia **test** skill (`/topia:test`).

1. Invoke the Skill tool with `topia:test`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:test (L2, sonnet)"

Also reachable via `/topia test` or `/topia:test`.
