---
name: report
description: "Explain a Salesforce report: meaning, filters, and whether the extract is complete."
disable-model-invocation: true
---

# /topia-sf:report

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `investigate`. Read only. Print the identity block first.

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. Settle the report and the org. Don't invent a report id.
2. Call `reports_describe`, passing `briefId`. Call `reports_run` only if the question needs numbers. Its rows hold only cells proven safe. The rest need `sf_show_values`, with `{orgId, briefId, reportId, limit}`, and a person answers it.
3. The first 2,000 detail rows are a partial extract. Say so, and call aggregates out separately. That notice clears through `sf_ack_issue`, and it doesn't make the extract complete.
4. Follow `salesforce/skills/reporting-analyst.md`.

## Hosts and refusals

`sf_brief_confirm`, `sf_ack_issue`, and `sf_show_values` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
