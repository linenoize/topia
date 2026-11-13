---
name: document
description: "Update a docs/salesforce entry from a confirmed decision."
disable-model-invocation: true
---

# /topia-sf:document

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `explain`. Update documentation. Don't change the org. Print the identity block when an org was confirmed.

1. A confirmed decision is written under `docs/salesforce/decisions/`. Observed org state, reviewed intent, and personal preferences stay in separate files (`docs/salesforce/orgs/`, `docs/salesforce/architecture/`, `docs/salesforce/preferences/`).
2. Every entry has scope, owner, evidence, last verified, rationale, dependencies, and uncertainty.
3. Follow `salesforce/skills/documentation-maintainer.md`.
4. Don't copy tokens or raw personal rows into the doc.
5. If the entry needs fresh evidence from the org, clarify first: `brief_propose`, then `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation.

## Hosts and refusals

`sf_brief_confirm` exists only on Claude Code. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. Evidence gathered without confirmation carries `briefConfirmed: false`. Record that in the entry's uncertainty.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
