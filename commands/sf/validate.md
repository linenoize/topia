---
name: sf:validate
description: "Check-only Salesforce metadata validation with tests. Changes nothing in the org. Records have no equivalent."
disable-model-invocation: true
---

# /topia:sf:validate

<!-- Adapted from forcedotcom/sf-skills skills/platform-metadata-deploy/SKILL.md @219a84a, Apache-2.0; modified -->

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `validate`. No promote. Print the identity block first. Follow `salesforce/skills/release-engineer.md`. Pipeline order: inspect, diff, dependencies, validate, review, apply, verify.

1. The plan exists and names the org and the artifact. If not, go to `/topia:sf:plan`.
2. Look at the zip first. If the plan's artifact holds any `ApexClass` or `ApexTrigger`, call `sf_deployment_validate` with `{planId}`: a person answers a dialog that says it runs code in the org. If it holds none, call `deployment_validate` with `{orgId, briefId, planId}`. It refuses with no stamp, and a zip with Apex. On production it runs as the writer, because a quick deploy has to come from the user who validated. If the writer isn't logged in, it refuses and names the steps for the person's own terminal. The service builds and hashes the zip, retrieves a baseline with the same manifest, then picks the path from live `IsSandbox`:

| Org | What the service runs |
| --- | --- |
| Production | `project deploy validate --metadata-dir <zip> --test-level RunLocalTests` |
| Sandbox | `project deploy start --dry-run --metadata-dir <zip> --test-level RunLocalTests`, because CLI help says not to use validate and quick on sandboxes |

3. It comes back with a `state`. `in-progress` means the job is still running in the org: call `deployment_validate` again with the same `planId`, which starts nothing new. `passed` and `failed` are decided from what the org says about the job.
4. A validation counts only if `checkOnly`, `success`, and `runTestsEnabled` are true, `numberTestsCompleted` is above 0, `numberTestErrors` is 0, it exited 0, this user started it, and its component list equals the zip's. Show those values. A run with no tests doesn't count.
5. On failure, report `problems`, then the top component errors and test failures with the table in the skill, then stop. Nothing ignores an error to pass. Once it's fixed, `revalidate: true` starts a new job.
6. Report the job id and its start time, and what voids it:
   - **Any later deployment voids all validations**, by anyone.
   - More than 10 days since the validation started.
   - Any plan edit.
7. Say what a pass doesn't prove. It doesn't test how existing records behave, and it doesn't test flow behavior. It overwrites newer org changes without a conflict check.

This check applies to metadata only. Records have no dry run. See `salesforce/skills/data-steward.md`.

Never fall back to a full deploy when a validation is refused. Validate again. The next step is `/topia:sf:deploy`, which a person runs.

## Hosts and refusals

`deployment_validate` runs where the Topia hooks run, and only for a zip with no Apex. Other hosts are read-only and validate nothing. The next step, `sf_deployment_execute`, exists only on Claude Code. If `sf_brief_confirm` doesn't exist here, stop and say so, and treat this as work on an unconfirmed brief. Don't substitute Bash, PowerShell, or `sf` commands. The commands above are what the service runs, not commands for you.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
