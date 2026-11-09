---
name: sf:verify
description: "Check a Salesforce deploy or record change against its plan afterward. A failed check stays failed."
disable-model-invocation: true
---

# /topia:sf:verify

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `validate`. Read the outcome. Don't start a new deploy. Print the identity block first. Follow `salesforce/skills/release-engineer.md`.

Confirm the plan and the org. Then call `deployment_verify` with `{orgId, briefId, planId}`. It works on a record plan or a deploy plan. It reads the org and writes nothing to it. It can update the local ledger, because that's where what it found is kept.

## After a deploy

It reads the deploy by its id, then re-retrieves with the same manifest. Report its `checks`:

1. `components`: `componentSuccesses` must show the expected `changed` or `created` for each planned component. A planned change showing neither is a **failed outcome, even with `success: true`**.
2. `retrieve`: what the org holds now, compared to what shipped.
3. `audit`: whether `SetupAuditTrail` could be read. Report anything by this user that isn't in the journal, through `audit_query`.
4. `identity`: the org it reached. A mismatch reads as written to the wrong org.
5. Type-specific checks are yours to add: describe for fields, and active version for flows. Tests only through `/topia:sf:test`.
6. Quick deploy runs under its own job id. Report on that id, not the validation's.

A deploy that may have landed is queried, never retried.

## After a record change

It re-reads every frozen id and classifies each one: `done`, `untouched`, `changed` by someone else, `missing`, or `failed`. Report these:

1. Target fields must equal the intended values, or the record isn't `done`.
2. `sideEffects` counts the fields that moved beyond the plan. Report them as automation or someone else's edit. Don't hide them.
3. Report partial as partial, with counts.
4. `unknown` means it can't be decided yet: a timeout, a crash, or a job it can't read. Say `unknown`. It may settle if read again later. Nothing is re-sent, here or anywhere, without a new dialog.

## Reporting

A failed check stays failed. Don't re-run it until it passes, and don't report the change as complete.

If a check fails, repeat the reversibility text from `salesforce/skills/references/reversibility.md`, with what can't be undone first. A restore is a new approved plan, through `/topia:sf:plan`. A git revert isn't an org rollback.

## Hosts and refusals

`deployment_verify` runs on any host that loads the server. `sf_brief_confirm` and `sf_show_values` exist only on Claude Code. Where one doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants the read without confirmation, it runs read-only and carries `briefConfirmed: false`. Repeat that next to every result.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
