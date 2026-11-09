---
name: sf:inspect
description: "Inspect Salesforce schema, metadata, and dependencies, including coverage gaps."
disable-model-invocation: true
---

# /topia:sf:inspect

<!-- Adapted from forcedotcom/sf-skills skills/platform-metadata-discovery-get/SKILL.md @219a84a, Apache-2.0; modified -->

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `investigate`. Read only. Print the identity block on every result.

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. Settle the object, the metadata member, and the org.
2. Use `schema_describe`, `metadata_retrieve`, `metadata_diff`, and `dependency_report`, passing `briefId`.
3. To say what runs on an object, list its active triggers, record-triggered flows, and validation rules. Those lists give names and status. Retrieve a component before saying what it does.
4. Follow `salesforce/skills/navigator.md`.

How to report:

- An empty result isn't absence. Say "no match found for that name", never "it doesn't exist".
- A partial dependency check is never a full impact analysis, and never shows that a change is safe. Partial coverage is a notice cleared through `sf_ack_issue`, not a complete map.
- Don't retrieve over uncommitted local files until that notice is cleared. Don't deploy.

## Hosts and refusals

`sf_brief_confirm` and `sf_ack_issue` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
