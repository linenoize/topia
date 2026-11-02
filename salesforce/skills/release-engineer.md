<!-- Adapted from forcedotcom/sf-skills skills/platform-metadata-deploy/SKILL.md @219a84a, Apache-2.0; modified -->

# Release engineer

Inspect, diff, dependencies, validate, review, approve, apply, verify. In that order.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.

The service builds every command. The commands below explain what it runs, so you can describe it accurately. They aren't for you to type. Only `sf_deployment_execute` applies a deploy, and only after a person approves in its dialog. If it doesn't exist on this host, stop and say so. There's no substitute.

The CLI default org is never the target. The service targets a username and checks live org identity before and after a write. An alias proves nothing.

## The order

1. Manifest: the smallest scope that does the job.
2. Baseline retrieve with `metadata_retrieve`.
3. The service builds the zip and hashes it, so `.forceignore` and working-tree edits can't change what ships.
4. `deployment_validate`.
5. Review, then the person's approval.
6. Identity check, then a drift re-retrieve. That retrieve is the rollback snapshot.
7. Apply through `sf_deployment_execute`.
8. Verify.
9. Offer a redeploy as a new plan, if it's needed.

Don't retrieve over uncommitted files until that notice is acknowledged through `sf_ack_issue`.

## Deploy order within a change

Objects and fields, then permission sets, then Apex, then flows as drafts, then flow activation. Getting this wrong causes many field-level security and dependency failures. If a change spans these and fails on order, split it into separate plans.

Changing an active flow in production needs the "Deploy processes and flows as active" preference. Say so before validating.

## Production and sandbox are different paths

| Org | Check | Apply |
| --- | --- | --- |
| Production | `project deploy validate --metadata-dir <zip> --test-level RunLocalTests` | `project deploy quick --job-id <id> -o <username>` |
| Sandbox | `project deploy start --dry-run --metadata-dir <zip> --test-level RunLocalTests` | `project deploy start --metadata-dir <same zip>`, with the hash re-checked |

The sandbox path differs because CLI help says not to use validate and quick on sandboxes. The service decides from live `IsSandbox`, not from a label in a file.

Production quick-deploys the job a person approved, by its id, with `-o`. If Salesforce refuses that job, the only way forward is to validate again.

The sandbox `--dry-run` flag belongs to metadata deploys. It's a real check-only deployment. It doesn't exist for records, and nothing about records may be called one. See `data-steward.md`.

## When a validation counts

All of these must hold, read from the result:

- `checkOnly` is true.
- `success` is true.
- `runTestsEnabled` is true.
- `numberTestsCompleted` is above 0. An org with no local Apex tests can't pass this. On production that stops the deploy: no test run means no quick deploy, and a full deploy is banned.
- `numberTestErrors` is 0.
- It exited 0.

A validation with no tests doesn't count, whatever the top line says. Coverage: overall 75% with some coverage on each trigger for `RunLocalTests`. With `RunSpecifiedTests`, each deployed class and trigger needs 75% on its own.

## What voids a validation

- **Any later deployment voids all validations.** That includes a quick deploy, a regular deploy, or a package install, by anyone. Salesforce's help says so, though we've seen that page only as a search excerpt. Treat it as true.
- More than 10 days since the validation **started**. Leave a margin.
- It was already deployed.
- It belongs to another org.
- Any plan edit. The chain voids everything after the edit.

There's no reliable way to detect a later deployment in advance, so the refusal may be the first you hear of it.

**On refusal, revalidate. Never fall back to a full deploy.** A full deploy drops the proof that what ships is what was validated and approved. Offer one thing: run `deployment_validate` again, then come back for approval.

Before the dialog and again before applying, on both paths, the service fetches the job by id and requires check-only, succeeded, this org, this user, and a component list equal to the zip's. Don't argue with a refusal.

## What a passing validation doesn't tell you

Say the relevant ones before approval.

- A newer change in the org is overwritten, with no conflict check. A Setup change made after validation probably doesn't void it. The drift re-retrieve is what catches that.
- Tests don't see real data unless they use `SeeAllData`. So it says nothing about how existing records behave against a new required field or validation rule.
- It doesn't test flow behavior. Flow tests are separate.
- It doesn't cover sharing recalculation time, callouts, or managed-package side effects.
- A Master-Detail to Lookup change, or the reverse, can't be validated. The validation fails. Prove it with a full deploy to another sandbox.

## Reading failures

| Symptom | Likely cause | Direction |
| --- | --- | --- |
| `FIELD_CUSTOM_VALIDATION_EXCEPTION` | Validation rule or bad test data | Read the rule, then the test's data |
| `INVALID_CROSS_REFERENCE_KEY` | Missing dependency | Include the referenced metadata earlier |
| `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY` | Trigger, flow, or validation side effect | Read the automation on the object |
| Tests fail during deploy | Broken code or fragile tests | Find the root cause, fix through a new plan, revalidate |
| Field or object not found in a permission set | Wrong order | Objects and fields first |
| Flow invalid or version conflict | Dependency or activation | Deploy as a draft, verify, then activate |

Report the top component errors and test failures, then stop. Nothing ignores an error to get past it: the service has no route to `--ignore-errors`, and `--ignore-warnings` is only an exception named in an approved plan.

## Long-running and unknown

- Deploy exit codes: 0 success, 1 failed or canceled, 68 partial, 69 in progress.
- A timeout or a killed CLI means `unknown`, never stopped. The job keeps running. A deploy that may have landed is queried, never retried.
- A cancel goes through `sf_deployment_execute` with `cancel: true`, in its own dialog. It counts as done only at `Canceled`, and it's followed by a verify. `Canceling` means it isn't stopped yet.
- Quick deploy starts a new job with its own id. Report on that id, and keep the validation id for traceability.

## Verify after every deploy

A failed post-deploy check stays failed. Don't re-run it until it passes, and don't report the deploy as complete.

`sf_deployment_execute` runs these before it reports, and `deployment_verify` runs them again. Report its `checks`.

1. **Component results.** `componentSuccesses` must show the expected `changed` or `created`. A planned change showing neither is a failed outcome, even with `success: true`.
2. **Re-retrieve** with the same manifest and compare to what shipped. Include related components for profiles and permission sets.
3. **`SetupAuditTrail`.** Check who and when through `audit_query`. Report anything by this user that isn't in the journal.
4. **Type-specific checks.** Describe for fields. Active version for flows. Tests through `sf_tests_run`, if the plan calls for them.
5. **Report** what deployed, what failed, what was skipped, and the next safe action.

Partial is partial. Don't report it as complete.

## Reversibility

Every plan names its class from `references/reversibility.md`, with what can't be undone first. A metadata deploy is `forward-only`: there's no undo. Restoring means deploying the snapshot as a new approved plan, and that voids other validations too.

Show the items a redeploy can't restore before approval: deleted field data, type changes, picklist replacements, and flow versions already run. A git revert isn't an org rollback.

## Evidence limits

These output shapes come from CLI schemas and source, not a live org. The release gate is `docs/salesforce/LIVE-CHECKLIST.md`. If a result doesn't parse, it's `unknown`. Don't guess at the meaning.
