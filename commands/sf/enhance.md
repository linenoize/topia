---
name: sf:enhance
description: "Clarify a Salesforce request and stop. Also runs inside other /topia:sf commands when the instruction is ambiguous."
disable-model-invocation: true
---

# /topia:sf:enhance

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `explain`. Clarify and stop. Don't investigate, and don't write.

1. Follow `salesforce/skills/enhance-request.md`. Draft the brief: objective, environment (ask if they didn't name one), subjects marked known or assumed, what would change, and what blocks the next step.
2. Stop on any ambiguity in that skill's table, and ask its questions: a person named without a username, an unknown vendor or product name that could be a user or a package (a registered one resolves with no stop), a business nickname, a screenshot or "this error" not yet restated, an omitted environment, both production and sandbox in one breath, a change verb before the current behavior is confirmed, or a scope word with no edge.
3. Call `brief_propose`, then `sf_brief_confirm`. `Confirm`, `Change it`, and `Stop` are the only answers. A chat reply isn't confirmation.
4. Stop. Report the `briefId` and whether it's confirmed.

Print the identity block when an org is confirmed. If none is confirmed, say the environment is unconfirmed. Don't label anything with the CLI default org.

The same steps run inside the other `/topia:sf:*` commands.

## Hosts and refusals

`sf_brief_confirm` exists only on Claude Code. Where it doesn't exist, stop and say so. Show the brief and say nothing here can confirm it. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
