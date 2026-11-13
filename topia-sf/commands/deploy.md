---
name: deploy
description: "Apply an approved Salesforce deployment that has a current validation. A person approves in a dialog."
disable-model-invocation: true
---

# /topia-sf:deploy

<!-- Adapted from forcedotcom/sf-skills skills/platform-metadata-deploy/SKILL.md @219a84a, Apache-2.0; modified -->

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `execute`. Print the identity block first. Follow `salesforce/skills/release-engineer.md`.

## Before calling the tool

- The plan exists, and its brief was confirmed through `sf_brief_confirm`.
- `deployment_validate` passed for this org and this plan: `/topia-sf:validate`. It says `passed` only when it meets the acceptance list in the skill.
- Say the plan's reversibility class. A deploy is `forward-only`. List what a redeploy can't restore first: deleted field data, type changes, picklist replacements, and flow versions already run.

## On production

A deploy targets the writer, a second user a person logged in for this change. If it isn't logged in, or none is registered, the tool refuses and names the steps. Show them, and stop. The person runs them in their own terminal. You don't. If the result carries `afterThis`, pass it on word for word: the person logs the writer out when they're done.

An org with no local Apex tests can't deploy to production. No test run means no quick deploy, and a full deploy is banned. Say that, and don't look for a way around it. A test class, in the org or in the deploy, is the way through.

## Applying

Call `sf_deployment_execute` with `{planId}`. It asks the org what the validated job is, reads the components from the zip itself, and shows a person a screen built from that. Only a person's answer in that dialog approves. Nothing you write can approve it, and neither can a chat reply or a practice review. For production, the person types the org name.

Then it re-reads the org. If anything in the manifest changed since it was validated, it stops: that's drift, and shipping would overwrite it. That same read is saved as the rollback snapshot.

- Production applies by quick deploy of the validated job. Sandbox deploys the same zip, with its hash re-checked.
- **On a refused or voided validation, revalidate with `deployment_validate` (or `sf_deployment_validate` for a zip with Apex) and `revalidate: true`, then come back for a new approval. Never fall back to a full deploy.** Any later deployment voids all validations.
- A timeout or killed CLI means `unknown`, not stopped. Don't retry. Calling this again, or `/topia-sf:verify`, queries it and sends nothing.
- A deploy still running comes back as `started`, with its id. Calling this again reads it. To stop it, call `sf_deployment_execute` with `{planId, cancel: true}`: that takes its own dialog, and it's done only at `Canceled`.

## After

Report the status and the `checks` from the result. `done` means the component, retrieve, and identity checks passed and Setup Audit Trail could be read. The audit check reads the trail and judges nothing. A planned component showing neither changed nor created is a failed outcome, even with `success: true`. A failed post-deploy check stays failed, and `/topia-sf:verify` won't clear it. Partial is partial. Don't report it as complete.

There's no undo. The result offers a redeploy of the rollback snapshot as a new plan, with what that can't restore listed first. See `salesforce/skills/references/reversibility.md`.

## Hosts and refusals

`sf_deployment_execute` exists only on Claude Code, and it's denied inside subagents. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, or `sf` commands. There's no other way to deploy through Topia, so say the person can run this on Claude Code.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
