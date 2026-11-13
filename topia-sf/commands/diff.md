---
name: diff
description: "Describe org, repo, and working-tree differences in admin language."
disable-model-invocation: true
---

# /topia-sf:diff

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `investigate`. Read only. Print the identity block first.

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. A production-versus-sandbox question names both orgs. The identity block names the org under discussion, and you say the other beside it. Don't merge them into one target.
2. Call `metadata_diff`, passing `briefId`. Describe org, repo, and working tree in admin language.
3. Follow `salesforce/skills/release-engineer.md`. A vendor name stays a vendor until they say it's a user or a package.
4. A difference shows what changed, not who changed it or why. Use `audit_query` for that, with a confirmed user and a time window.

## Hosts and refusals

`sf_brief_confirm` exists only on Claude Code. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
