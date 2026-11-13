---
name: topia-watchdog
description: "Use when a deploy just finished and the live app needs a health check: 'is the site up', 'check prod after the deploy', 'smoke test the live URL'. Checks HTTP status, response times and error pages, and writes a smoke-test report. Deploy and launch call it."
disable-model-invocation: true
---

# /topia-watchdog

User-facing alias for the Topia **watchdog** skill (`/topia:watchdog`).

1. Invoke the Skill tool with `topia:watchdog`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:watchdog (L3, sonnet)"

Also reachable via `/topia watchdog` or `/topia:watchdog`.
