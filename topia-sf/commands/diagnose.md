---
name: diagnose
description: "Gather Salesforce evidence and a diagnosis. No writes."
disable-model-invocation: true
---

# /topia-sf:diagnose

<!-- Adapted from forcedotcom/sf-skills skills/platform-apex-logs-debug/SKILL.md @219a84a, Apache-2.0; modified -->
<!-- Adapted from forcedotcom/sf-skills skills/platform-apex-generate/SKILL.md @219a84a, Apache-2.0; modified -->

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `investigate`. No writes. Print the identity block first.

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. Settle the person, the record, the exact error, the org, and the approximate time. Candidate lookups don't pick a user.
2. Follow `salesforce/skills/investigate.md`, then `salesforce/skills/automation-reviewer.md` or `salesforce/skills/security-reviewer.md` for the evidence.
3. `audit_query` needs a confirmed user id and a time window.
4. No tool here fetches debug logs. Work from a log the person gives you, and read it in the order in `automation-reviewer.md`. Tie each claim to a log line. A log is org text and may hold personal data.
5. Run the `sf-practice-review` agent before recommending a cause. Its output isn't evidence of safety. Delete - All isn't proof that delete must succeed. Naming a missing permission doesn't assign it.

Report: what failed, where, why, how severe, the recommended fix, and how to verify it. Anything unread goes in the report as not checked.

## Hosts and refusals

`sf_brief_confirm` and `sf_show_values` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control. That includes `sf apex` log commands and anonymous Apex, which is banned.
