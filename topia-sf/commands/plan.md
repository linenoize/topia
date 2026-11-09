---
name: sf:plan
description: "Write a Salesforce change plan and stop. Do not execute it."
disable-model-invocation: true
---

# /topia:sf:plan

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `plan`. It lasts this turn: it goes back to read-only when the turn ends, so if you stop to ask a question, the person runs this command again to plan. Write the plan and stop. Print the identity block first.

## Steps

1. The brief is confirmed through `sf_brief_confirm`. If it isn't, follow `salesforce/skills/enhance-request.md` first. A chat reply isn't confirmation.
2. Run the `sf-practice-review` agent. It reports practice, experience and continuity, security, PII, and vendor impact. Record that with `practice_record`, passing `briefId`, and keep the `practiceReviewId` it returns. Each review serves one plan. A finding can stop the plan (`stopRecommendation`). It can't widen the confirmed change (`confirmedChange` lists the fields, or `delete`, or `deploy`). This is a quality check. Its output isn't evidence of safety, so never present it as that.
3. Call `dependency_report` with `{orgId, briefId, componentType, componentName}` for each component the change touches. List its coverage and its blind spots, unedited. It's advisory: dynamic references are invisible, and row limits apply, so it never shows that a change is safe. A partial report stays listed as partial.
4. For a record change, call `records_preview` with `{orgId, briefId, object, operation, changes, frozenRecordIds}`, and present it as below. Name anything in its `blockers`.
5. Call `records_plan_update` with `{orgId, briefId, practiceReviewId, object, operation, changes, frozenRecordIds}`, or `deployment_plan` with `{orgId, briefId, practiceReviewId, artifactPath, destructive}`. `operation` is `update` or `delete`. There's no upsert or insert. You can add `businessObjective` and `notes`: they stay in the local store and appear below a rule, labelled as unchecked.

   A deploy artifact is a folder in metadata format with a `package.xml` at its root, or a zip of one, with every member named. Source format isn't converted here. `ignoreWarnings` goes on the plan only if the person agrees to it, and the screen names it. To put back what a deploy replaced, pass `rollbackOf` with that plan's id instead of `artifactPath`.
6. Stop. Don't execute. Say what comes next. For records, `/topia:sf:execute` runs `sf_records_execute`, and a person approves in its dialog. For a deploy, `/topia:sf:validate`, then `/topia:sf:deploy`. A person has to run those commands: each sets its mode for one turn.

The code computes counts, state, expiry, the plan hash, the artifact hash, and the reversibility class. Anything you send for those is ignored, and an `approval` field is stripped. Your text is informational, and it never enters a safety decision. Any later edit to the plan, its local values, or its brief voids the plan.

## Presenting a record preview

**Records have no dry run. Never call this preview a dry run.** Show the tool's lists unedited:

```text
This is a preview. Nothing was saved, and no automation ran.

Checked: <checked>
Not checked: <not_checked>
Automation on this object: <automation>
This list has blind spots. Email or callouts may fire and can't be recalled.
```

Anonymous Apex is banned, including with a savepoint. It runs arbitrary code, and not everything rolls back. For a high-risk change, recommend a sandbox rehearsal, and report the sandbox's type and age. See `salesforce/skills/data-steward.md`.

## Presenting the plan

In this order:

1. **What can't be undone, first.** Name the class from `salesforce/skills/references/reversibility.md`: `restorable`, `recycle-bin`, `forward-only`, `access`, or `irreversible`, with the service's fixed text.
2. For a deploy, what a redeploy can't restore: deleted field data, type changes, picklist replacements, and flow versions already run. Use the full list in that file.
3. Org, user, operation, object, and exact count.
4. Each field and its new value, or the components by type.
5. Whether the ids are frozen, or a query that will be re-run. Those are different plan types.
6. Dependencies, with coverage. Active automation, with blind spots.
7. Expiry. Your notes last, under "The assistant's notes".

Restore is a new approved plan, never part of this one. A git revert isn't an org rollback.

Follow `salesforce/skills/release-engineer.md` for deploys, and `salesforce/skills/data-steward.md` for records.

## Hosts and refusals

`sf_brief_confirm` exists only on Claude Code. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, `sf` commands, or a chat reply. If the person still wants a plan, it's written against an unconfirmed brief and carries `briefConfirmed: false`. Say that with the plan. No host without the `sf_` tools can execute one.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
