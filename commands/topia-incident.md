---
name: topia-incident
description: "Use when production is down or degraded right now: 'the site is down', 'users are getting 500s', 'we have an outage'. Triages severity, contains the damage first, finds the root cause, and writes a timeline and postmortem. For a bug that is not urgent, use debug."
disable-model-invocation: true
---

# /topia-incident

User-facing alias for the Topia **incident** skill (`/topia:incident`).

1. Invoke the Skill tool with `topia:incident`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:incident (L2, sonnet)"

Also reachable via `/topia incident` or `/topia:incident`.
