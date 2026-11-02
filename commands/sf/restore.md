---
name: sf:restore
description: "Restore what a Salesforce record plan changed, as a new plan a person approves. For a soft delete or a deploy, read what's possible and give guidance."
disable-model-invocation: true
---

# /topia:sf:restore

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `execute`, for this turn only. Print the identity block first. Follow `salesforce/skills/references/reversibility.md`.

Restore is a new change. It isn't an undo, and a git revert isn't an org rollback. Say that before anything else, and say that automation fires again on what it restores, so anything it sends goes out again.

## Steps

1. Settle which plan to restore, by its `planId`. If the plan may still be running, `/topia:sf:verify` first: a restore refuses until it settles.
2. The brief says this is a restore, and it's confirmed through `sf_brief_confirm`. A chat reply isn't confirmation.
3. Call `sf_restore_plan_execute` with `{planId, briefId}`.

## What it does, by what the plan did

**A record update.** The code generates a new plan from the saved old values, and a person approves it in a dialog. It targets only records whose current value still equals what was written. Records changed since are listed as `conflicts`, and they're never overwritten. Show that list, and don't offer to force it. If the pre-image has gone or passed its 30 days, nothing can be restored from it, and the tool says so.

**A soft delete.** There's no restore tool. The tool reads the org with `--all-rows`, and returns how many records are still in the bin, how many are purged, and how many were never deleted. Pass on its guidance: a person restores from the Recycle Bin in Setup. The bin usually keeps records for 15 days, but it can purge after 2 hours. Don't write a script for them, and don't offer anonymous Apex.

**A deploy.** There's no undo. The tool returns what a redeploy can't restore, and says whether a rollback snapshot is here. Show that list first. Putting the snapshot back is a new plan: `/topia:sf:plan` with `deployment_plan` and `rollbackOf`, then `/topia:sf:validate`, then `/topia:sf:deploy`. It voids other validations.

## Hosts and refusals

`sf_restore_plan_execute` exists only on Claude Code, and it's denied inside subagents. Where it doesn't exist, stop and say so, naming the tool. Don't substitute Bash, PowerShell, or `sf` commands, and don't write the old values back any other way.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
