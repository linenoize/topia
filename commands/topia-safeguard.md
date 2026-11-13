---
name: topia-safeguard
description: "Use when a risky refactor needs a way back first: 'add characterization tests before I refactor', 'set a rollback point'. Writes tests that pin current behavior, marks module boundaries, freezes config and tags a rollback point. Surgeon needs it first."
disable-model-invocation: true
---

# /topia-safeguard

User-facing alias for the Topia **safeguard** skill (`/topia:safeguard`).

1. Invoke the Skill tool with `topia:safeguard`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:safeguard (L2, sonnet)"

Also reachable via `/topia safeguard` or `/topia:safeguard`.
