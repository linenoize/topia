---
name: topia-surgeon
description: "Use when refactoring one module safely after safeguard has run: 'extract this into a service', 'apply strangler fig to the old router', 'break up this god class'. Changes one module per session, runs tests after each edit, and touches at most 5 files. Usually driven by rescue."
disable-model-invocation: true
---

# /topia-surgeon

User-facing alias for the Topia **surgeon** skill (`/topia:surgeon`).

1. Invoke the Skill tool with `topia:surgeon`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:surgeon (L2, sonnet)"

Also reachable via `/topia surgeon` or `/topia:surgeon`.
