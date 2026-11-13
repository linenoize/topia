---
name: execute
description: "Run an approved Salesforce record plan. A person approves the exact change in a dialog."
disable-model-invocation: true
---

# /topia-sf:execute

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `execute`, for this turn only. Print the identity block first. Follow `salesforce/skills/data-steward.md`.

## Before calling the tool

- The plan exists: `records_plan_update` returned its `planId`. If not, go to `/topia-sf:plan`.
- Its brief was confirmed through `sf_brief_confirm` this session. If not, call it now. A chat reply isn't confirmation.
- Say the plan's reversibility class first: `restorable` for an update, `recycle-bin` for a soft delete. Use the service's fixed text from `salesforce/skills/references/reversibility.md`.

## On production

Writes target the writer, a second user a person logged in for this change. If it isn't logged in, or none is registered, the tool refuses and names the steps. Show them, and stop. The person runs them in their own terminal. You don't. If the result carries `afterThis`, pass it on word for word: the person logs the writer out when they're done.

## Running it

Call `sf_records_execute` with `{planId}`. It checks the org live, compares the org's audit trail with the journal, and shows a person a screen built from what it just read. Nothing you write can approve it. A chat reply can't, and neither can a practice review. For production, the person types the org name.

If the person says no, or closes the dialog, stop. Don't call it again unless they ask.

## What comes back

Report the status in the result, in its own words. Don't soften it.

| Status | What it means | What to say |
| --- | --- | --- |
| `done` | Every frozen record now holds the intended values | Name any `sideEffects`: fields that moved beyond the plan, from automation or someone else |
| `partial` | Some records are written, and some aren't | Give the counts and the failures by id. Work already done isn't rolled back |
| `started` | A Bulk job is still running in the org | Say so. Calling this again, or `/topia-sf:verify`, picks it up. It sends nothing new |
| `unknown` | Nothing here can say what landed | Say `unknown`. It isn't stopped, and it isn't failed |
| `unreadable` | The ledger is damaged, so this plan stops | The counts come from the org. A new plan covers what remains |

**Never re-send on your own.** A retry fires triggers and flows again, and anything they send goes out again. Calling `sf_records_execute` again on the same plan first reads what happened. If there's a remainder, it opens a new dialog over only that, and that's for the person to want, not for you to offer as a fix.

A rate limit partway through doesn't mean nothing was written. Don't say it does.

## After

- Run `/topia-sf:verify` if the result asks for it.
- Restoring is a new plan with its own dialog: `/topia-sf:restore`. Automation fires again on what it restores.
- A soft delete has no restore tool. `/topia-sf:restore` reads the Recycle Bin, and a person restores from Setup.

## Hosts and refusals

`sf_records_execute` exists only on Claude Code, and it's denied inside subagents. Where it doesn't exist, stop and say so, naming the tool. Don't substitute Bash, PowerShell, or `sf` commands. There's no other way to write records through Topia, so say the person can run this on Claude Code.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
