---
name: explain
description: "Explain current Salesforce behavior. No writes."
disable-model-invocation: true
---

# /topia-sf:explain

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `explain`. No writes. Print the identity block first.

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. Restate the behavior being asked about, and settle the org.
2. Follow `salesforce/skills/automation-reviewer.md` for flows and rules, or `salesforce/skills/navigator.md` for structure. Pass `briefId`.
3. Separate observed facts, inferences, and recommendations. Don't invent API names, report ids, or automation.
4. A recommendation waits for the `sf-practice-review` agent. Its output isn't evidence of safety.

## Hosts and refusals

`sf_brief_confirm` exists only on Claude Code. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
