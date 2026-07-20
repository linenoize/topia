---
name: topia-deploy
description: "Deploy application to target platform. Use when user explicitly says 'deploy', 'push to production', 'ship it'. Handles Vercel, Netlify, AWS, GCP, DigitalOcean, and VPS with pre-deploy verification and health checks."
disable-model-invocation: true
---

# /topia-deploy

User-facing alias for the Topia **deploy** skill (`/topia:deploy`).

1. Invoke the Skill tool with `topia:deploy`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:deploy (L2, sonnet)"

Also reachable via `/topia deploy` or `/topia:deploy`.
