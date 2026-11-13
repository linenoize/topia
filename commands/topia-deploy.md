---
name: topia-deploy
description: "Use when pushing an app to a host: 'deploy to Vercel', 'push this to production', 'set up deploys to Fly.io'. Checks tests and security first, deploys to Vercel, Netlify, AWS, GCP, DigitalOcean or a VPS, then runs health checks. For deploy plus announcement, use launch."
disable-model-invocation: true
---

# /topia-deploy

User-facing alias for the Topia **deploy** skill (`/topia:deploy`).

1. Invoke the Skill tool with `topia:deploy`
2. Follow the full workflow defined in that skill — do not shortcut steps
3. Announce: "Routing to topia:deploy (L2, sonnet)"

Also reachable via `/topia deploy` or `/topia:deploy`.
