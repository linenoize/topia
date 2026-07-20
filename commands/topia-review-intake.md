---
name: topia-review-intake
description: "Use when receiving external input that needs structured intake before action — PR review feedback, code review comments, OR issue tracker items (bug reports, feature requests). PR Review Mode (default) verifies suggestions before implementing. Issue Triage Mode classifies issues into a state machine (ready-for-agent / ready-for-human / needs-info / wontfix) and emits AGENT-BRIEFs for AFK execution. Prevents blind implementation, enforces verification-first discipline."
disable-model-invocation: true
---

# /topia-review-intake

User-facing alias for the Topia **review-intake** skill (`/topia:review-intake`).

1. Invoke the Skill tool with `topia:review-intake`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:review-intake (L2, sonnet)"

Also reachable via `/topia review-intake` or `/topia:review-intake`.
