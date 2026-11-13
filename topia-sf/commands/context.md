---
name: context
description: "Show the Salesforce org, user, repo, branch, mode, and allowed operations for this project."
disable-model-invocation: true
---

# /topia-sf:context

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `investigate`. Read only.

1. Call `org_inspect` for the org named in the registry. Never the CLI default org. If it refuses for want of a brief, or the request goes further than showing the context, clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation.
2. Print the identity block, then repo, branch, class, and allowed operation classes.
3. If the service reports that this CLI user can write directly, say so. Topia's approval doesn't stop a shell command.
4. Follow `salesforce/skills/navigator.md`.

State observed facts separately from inferences. Don't invent an org id.

## Hosts and refusals

`sf_brief_confirm` exists only on Claude Code. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
