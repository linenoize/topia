---
name: ask
description: "Free-form Salesforce request. Enhance it, wait for confirmation, then investigate. No writes."
disable-model-invocation: true
---

# /topia-sf:ask

Refuse until this project has an activation lock. Another project stays off. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

This is the free-form door. The person writes what they're trying to accomplish.

Mode: `investigate`. Print the identity block first: classification, org name, org id, authenticated user, mode, operation.

1. Follow `salesforce/skills/enhance-request.md`. Don't assume production or sandbox. A fully specified read gets a short restatement, not a long interview.
2. Call `brief_propose`, then `sf_brief_confirm`. A chat reply isn't confirmation. The only org call before that is a labeled candidate lookup (`users_resolve`, or `schema_describe` with `purpose: 'candidate'`). The result is a list to confirm, not a finding.
3. Then follow `salesforce/skills/investigate.md`, passing `briefId`. Counts before personal values.
4. Run the `sf-practice-review` agent before recommending a cause or a change. Its output isn't evidence of safety.
5. Don't write, deploy, delete, grant a permission, or send anything from this command.

## Hosts and refusals

`sf_brief_confirm` and `sf_show_values` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
