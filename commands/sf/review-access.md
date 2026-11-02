---
name: sf:review-access
description: "Review Salesforce permission and sensitive-field impact. Naming a permission does not assign it."
disable-model-invocation: true
---

# /topia:sf:review-access

<!-- Adapted from forcedotcom/sf-skills skills/platform-permission-set-generate/SKILL.md @219a84a, Apache-2.0; modified -->

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `review`. No grants and no writes. Print the identity block first.

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. Settle the person (a name isn't a username), the permission sets, and the org.
2. Follow `salesforce/skills/security-reviewer.md`, passing `briefId`. When two sets are compared, a matrix covers object, field, system, Apex, tab, and custom permissions.
3. Say who gains or loses access, which objects and fields, and which sharing or field-level rules apply. Configured access isn't proof of use.
4. Run the least-privilege checklist on any proposed change. `ViewAllData`, `ModifyAllData`, and `ManageUsers` need a named person's security review. Don't add a permission just to clear a dependency error.
5. PII stays aggregated unless values are approved through `sf_show_values`. Naming a missing permission doesn't assign it.
6. A proposed change goes to `/topia:sf:plan`, with class `access`: an assignment can be removed, and access already used can't be undone.

## Hosts and refusals

`sf_brief_confirm` and `sf_show_values` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
