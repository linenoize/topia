---
name: topia-launch
description: "Use when shipping a product to the public and announcing it: 'launch this', 'go live and announce it'. Runs tests and security checks, deploys, verifies the live site, then writes the marketing assets. For a deploy with no announcement, use deploy."
disable-model-invocation: true
---

# /topia-launch

User-facing alias for the Topia **launch** skill (`/topia:launch`).

1. Invoke the Skill tool with `topia:launch`
2. Pass the request as the skill arguments. The skill runs as a forked subagent, in the background by default, and cannot see this conversation. Do not claim results until its report arrives as a task notification; then relay any Decision Needed block (skill-router Step 4.5)
3. Announce: "Routing to topia:launch (L1, sonnet)"

Also reachable via `/topia launch` or `/topia:launch`.
