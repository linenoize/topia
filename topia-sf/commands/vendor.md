---
name: sf:vendor
description: "Find which vendor packages an org has installed, record how each changes Salesforce, and re-check those notes after an upgrade."
disable-model-invocation: true
---

# /topia:sf:vendor

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `investigate`. Reads the org, and changes nothing in it. It writes only `docs/salesforce/vendors/` in this project. Print the identity block on every result.

Say which of these the person wants. If they didn't say, ask.

| Subcommand | Tools | What happens |
| --- | --- | --- |
| `fingerprint` | `packages_inventory`, then `vendor_fingerprint` | Finds what's installed. The person picks the package and the vendor folder name. Writes `package.md` |
| `add-finding` | `vendor_finding_add` | Records one difference as `suspected`, pinned to the installed version |
| `list` | `vendor_findings_list` | Shows vendors, findings, status, and any file that doesn't parse. With an org, marks stale findings |
| `reverify` | `vendor_finding_reverify` | Re-checks one finding, pins it to the version installed now, and sets its status |

1. Clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`, for anything that reads the org. A chat reply isn't confirmation. Name the org. Production and sandbox are checked separately. `list` with no org reads no org, so it needs no brief.
2. Pass `briefId` to the tool.
3. Follow "Recording vendor findings" in `salesforce/skills/documentation-maintainer.md`.

How to report:

- Never name a package from memory. It comes from the inventory, or it isn't known. A package that isn't listed may just not be visible to this CLI user.
- Always say a finding's status. `suspected` isn't fact.
- Say plainly that managed code is hidden. The inventory gives names and counts, not source.
- A partial inventory stays partial. List what wasn't checked.
- A stale finding raises `vendor-version-drift`. Its **Okay to continue** goes through `sf_ack_issue`. It clears only with `reverify`, once the behavior has been checked on the new version.
- A file reported as malformed wasn't used. Say which one and what's wrong. Don't fix it by guessing.
- A refusal about an email means the text would have been committed. Take the personal value out. Don't reword it to get past the check.

## Hosts and refusals

`sf_brief_confirm` and `sf_ack_issue` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result, and record it in the finding's uncertainty.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
