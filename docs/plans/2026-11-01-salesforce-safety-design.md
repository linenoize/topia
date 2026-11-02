# Salesforce sub-plugin: safety design contract

Status: binding for phases C1 to C6. Where this differs from the older phase text, this wins. It comes from a red-team review of the design and from research against `@salesforce/cli` 2.156.8 and the v68 Salesforce guides.

## 1. The promise

Use this wording in `docs/salesforce/README.md` and `/topia:sf:enable`:

> Topia's Salesforce tools can change your org only after you approve the exact change in a dialog. That applies to Topia's tools, not to everything the assistant can do. The assistant can also run shell commands as you, and if your Salesforce CLI login can write, a shell command can write too. This approval slows that down, but it can't prevent it. To make it a hard limit, connect production with a read-only Salesforce user, and log in as a write-capable user only when you intend to make a change.

The hard boundary lives in Salesforce. Everything local defends against accidents and prompt injection, not a determined agent running as the same OS user. Never describe local checks as more than that. Do not add HMACs, keys, or integrity hashes stored on the same machine.

## 2. Who serves which tool

| Tool | Served by | Why |
| --- | --- | --- |
| `org_inspect`, `schema_describe`, `metadata_diff`, `audit_query`, `users_resolve`, `reports_describe`, `packages_inventory` | stdio MCP server | No personal values. `users_resolve` lists users, so it takes 3 characters or more, and a subagent can't call it |
| `metadata_retrieve` | stdio MCP server | Configuration types only, from an allowlist (§6). Report, Dashboard, Document, ContentAsset, StaticResource, EmailTemplate, CustomMetadata, Group, Queue, and any type not on the list are withheld, and the result names what was withheld |
| `records_query`, `reports_run` | stdio MCP server | Counts, plus only fields proven safe (§6). No personal values |
| `brief_propose`, `practice_record`, `records_plan_update`, `deployment_plan`, `dependency_report`, `records_preview` | stdio MCP server | Check-only, no org change |
| `deployment_validate` | stdio MCP server, **with a stamp, and a zip with no Apex** | A check-only job runs every local test in the org. It refuses a zip that holds `ApexClass` or `ApexTrigger`, and it refuses outright with no stamp. Test failures come back as counts only |
| `vendor_findings_list`, `vendor_fingerprint`, `vendor_finding_add`, `vendor_finding_reverify` | stdio MCP server | Notes under `docs/salesforce/vendors/`. No org change, no username |
| `sf_brief_confirm`, `sf_show_values`, `sf_ack_issue` | **mod only** (`$.tool.register`) | A person must answer |
| `sf_records_execute`, `sf_deployment_execute`, `sf_tests_run`, `sf_restore_plan_execute`, `sf_org_register` | **mod only** | A person must approve at execution |
| `sf_deployment_validate` | **mod only** | A zip that holds Apex runs model-written code in the org when it is validated, so a person approves in a dialog that says "This runs code in the org". Picking up a validation already started reads, and opens no dialog |

- `users_resolve` returns names and usernames, because a person must confirm which user is meant. It's the one stdio exception to "no personal values".
- The commands that lead to person-gated tools: `/topia:sf:execute` runs an approved record plan through `sf_records_execute`, `/topia:sf:deploy` runs `sf_deployment_execute`, and `/topia:sf:restore` runs `sf_restore_plan_execute`.
- Stdio tool names match `^[a-zA-Z0-9_-]{1,64}$`. No dots anywhere.
- Mod-only tools do not exist on Cursor, remote connectors, or `claude -p`. Those hosts get reads without personal values, and plans. State this plainly. HTTP mode is removed.
- A person-gated tool runs like this: a `tool.call` hook builds the screen from a fresh live check, awaits `$.ui.ask`, compares the answer to the label exactly, then runs `salesforce/service/bin/runner.js` through `$.process.run`, passing the pinned plan bytes on stdin. The runner never re-reads the plan file. A dismissal or any other answer refuses.
- Approval state lives in that hook call, or in `$.state` if it must span calls. It never lives on disk.

## 3. Clarifying the request

Confirmation is enforced by code, not by prompt text.

1. `brief_propose` takes `{objective, environment, subjects[], change, blockingQuestions[]}`, canonicalizes it, stores it locally, and returns `briefId` and `briefHash`. The model cannot set a hash, status, or approver.
2. `sf_brief_confirm` shows the stored brief, rendered by code and never from model arguments. Options: `Confirm`, `Change it`, `Stop`. On `Confirm`, the mod records `{briefHash, at}` in `$.state`.
3. The mod's `tool.call` hook stamps every stdio call with `{mode, agentId, confirmedBriefHash}`, overwriting anything the model sent.
4. Investigation and plan tools require `briefId`.
   - With a stamp, a brief that isn't confirmed is refused, and the refusal is journaled.
   - With no stamp (a host without hooks), the call runs read-only and the result carries `briefConfirmed: false`. Those hosts have no person-gated tools, so this limits nothing that writes. `deployment_validate` starts a job in the org, so it is the one stdio tool that refuses outright with no stamp.
   - The stamp is an accident guard. On a plugin launch where the hook did not run, a stamp the model sent is believed. That is why a validation that runs Apex needs a dialog and not a stamp.
5. A labeled candidate lookup (`users_resolve`, or `schema_describe` with `purpose: 'candidate'`) may run before confirmation. It returns a list to confirm, never a pick.
6. The chain: `briefHash` → plan → validation → execution. Each record holds the previous hash, and any edit voids everything after it.

**Mode.** Mode is an accident guard, not the boundary. It lives in `$.state`, is set only when `command.run` has `e.origin.kind === 'composer'`, and resets to read-only on the main loop's `turn.complete`. If `e.agentId` is set, it is read-only and person-gated tools are denied. Use an explicit command-to-tools table with a test for each row. Never derive it from a tool class.

## 4. Org identity

- Registration stores `{orgId, username, instanceUrl, isSandbox}`. After that, target by **username**, never by alias, because an alias can be re-pointed silently.
- The identity check is one SOQL query through `--target-org <username>`: `SELECT Id, Name, IsSandbox, OrganizationType, InstanceName FROM Organization`, plus the current user. `org display` isn't proof: it returns cached values when refresh fails and has no sandbox flag.
- Compare the live result to the registry before every write, and again after it. Normalize 15 and 18 character ids first. A mismatch after a write is reported as "written to the wrong org", with details.
- An org-id change is **never** acknowledgeable. It requires re-registering, with old and new side by side, and a typed org name when the id or class changes. Delete the `refreshed` branch.
- Production comes from live `IsSandbox`, never from `class` in a file. `orgs.json` may only **narrow** limits. Ceilings and allowed classes are constants in code. `orgs.json` holds no username.
- At registration, probe the user's write permissions. If the user can write, the band says so permanently: "This CLI user can write directly. Topia's approval doesn't stop a shell command."

## 5. Running the CLI

- Resolve the CLI once with our own `PATH` scan: absolute entries only, skipping the project and its `node_modules`. Then try the npm, installer, tarball, and auto-update layouts, and confirm with `version --verbose --json`. Fail closed, naming what was tried.
- Spawn `node --no-deprecation <entry>` with `shell:false`. **Never use cmd.exe.** Prefer a sibling `node.exe`, and require Node 22 or later. Always attach an `error` listener.
- Environment: an allowlist only (`PATH`, `SystemRoot`, `TEMP`, `TMP`, `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, explicit proxy settings), plus `NO_COLOR=1`, `FORCE_COLOR=0`, `SF_DISABLE_AUTOUPDATE=true`. No `SF_*`, `SFDX_*`, `NODE_OPTIONS`, or `NODE_TLS_REJECT_UNAUTHORIZED`.
- `cwd` is a private temp folder, except where a command needs a project (use a temp `sfdx-project.json`).
- Every call passes `-o` in `--flag=value` form. Reject values starting with `-`, and targets shaped like a token (`00D…!`, JWT). Pass SOQL with `-f <temp file>`, and delete the temp file afterwards.
- Argv is built per operation from a closed list. There is no route to: `sf apex run`, `--ignore-errors`, `--ignore-conflicts`, `--purge-on-delete`, `--hard-delete`, `--flags-dir`, `--use-most-recent`, `NoTestRun` or `RunRelevantTests` on production, or `api request rest` other than GET and the one fixed Collections path. `--ignore-warnings` only as an exception named in an approved plan.
- Exit codes: deploy 0 success, 1 failed or canceled, 68 partial, 69 in progress. A timeout or killed CLI means **unknown**, never stopped. The job keeps running.
- Validate adapter output with a parser per command. Output that doesn't parse is `unknown`, which is **never** acknowledgeable. Never map it to `expired-auth`.
- A checked-in flag snapshot taken from CLI 2.156.8 backs a test: every argv we can build uses only flags that exist on that command. CLI facts are from schemas and source, not an org, so the live checklist (§12) must confirm the output shapes.

## 6. Queries and personal data

- `records_query` takes `{object, fields[], where[], orderBy?, limit}`. `where` is structured: `[{field, op, value}]` with `op` from an enum, AND only. There is no free-text SOQL anywhere, including `rerunQuery`.
- Every field matches `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$` and resolves through live describe, parents included. Reject `FIELDS(...)`, subqueries, `TYPEOF`, `FOR UPDATE`, `toLabel`, and `OFFSET`.
- Escape string literals. For `LIKE`, escape `%` and `_` in the value too. Dates and numbers are type-checked literals.
- **Withheld unless proven safe.** Values return only for an allowlist: id, boolean, picklist, and date-only system fields. Everything else is counted, and the result says what was withheld. A boolean or picklist is also withheld when its name or label points at what a person wouldn't want read out (gender, health, diagnosis, salary, and similar), and on `Contact`, `Lead`, `User`, `Account`, `Individual`, `CampaignMember`, and `Case` only a short list of standard fields is returned.
- **`metadata_retrieve` returns configuration only.** A type not on the allowlist is withheld, named in the result, and never requested. Files under `reports/`, `dashboards/`, `documents/`, `email/`, `staticresources/`, and `contentassets/` are dropped even if a retrieve brings them back. No Topia tool returns what is withheld. A person can retrieve it with the Salesforce CLI in their own terminal.
- `sf_tests_run` returns test names and outcomes. A failure message and a stack trace can quote the records a test read, so they are not returned. A validation's test failures come back as counts.
- A withheld field cannot appear in `where`, `orderBy`, or `GROUP BY` without `sf_show_values`, which closes the count oracle.
- `sf_show_values` warns at the moment of asking that approved values go to the model provider and stay in local transcripts.
- `reports_run` goes through the same gate. A malformed result counts as partial.
- All org-authored text (labels, help text, record values, flow descriptions) is wrapped in one delimiter with a fixed notice, on every tool. After a session reads org text, `tool.check` turns `WebFetch` and network-looking Bash into a person's ask. State the residual: a filter can't catch every outbound path.

## 7. Plans

- A plan carries a structured payload: `{object, operation, changes: [{field, value}], frozenRecordIds}` for records, or `{artifactPath, artifactHash, destructive}` for deploys. `operation` is an enum: `update`, `delete`. **No upsert or insert in v1.**
- The plan hash covers the whole plan minus `approval`. Not a field list.
- The code computes counts, `stateHash`, and expiry. Model text (`businessObjective`, notes) is informational only and never enters a safety decision.
- Committed plans hold ids, field names, counts, and hashes. Values, before-images, free text, and `rerunQuery` literals go to the local store, off the repo.

### The approval screen

Everything here is computed by code at that moment. It must show:

- Class, org name, org id, instance host, and username, from a fresh live check.
- Operation, object API name, and exact count from `ids.length`.
- Each field and its new value, as the exact string: in quotes, with every control, invisible, bidi, tag, line-break, and unusual space character written out as an escape (\n, \u{202e}), and the exact character count. A value over 120 characters shows its start, its full length, and a SHA-256 of the whole, and says it was cut. A value whose cut-off part holds a hidden character, or that holds half of a character pair, is refused when the plan is written. A plan changes at most 12 fields. `null` (which clears a field) is shown bare, so no string can look like it.
- Facts come first, and values come after: flags, automation, and the production prompt are above every value, so a long value cannot push them out. The whole screen is capped at 8,000 characters. The identity, the count, every field and every value are always on it, in full and escaped. When the screen would be longer, the sampled records shrink first (fewer records, then none, and a line in the facts says how many were left out), and after that a long value is cut to its start, its length and its hash (a shorter start than 120 characters, and never one that would put a hidden character into the cut part). A change whose required facts still do not fit is refused, not trimmed further. The cap is a guess until the live checklist records the dialog's real limit.
- A write to an access object (`User`, `PermissionSetAssignment`, `Group`, `GroupMember`, `UserRole`, `Profile`, a `*Share` object, and similar) carries "Changes access" among the facts.
- Three sampled records before and after, plus how many differ from the plan's before-state.
- Active triggers and record-triggered flows on the object, with "email or callouts may fire and can't be recalled, and this list has blind spots".
- For deploys: components by type (added, changed, deleted) read from the zip itself, with type and member names in quotes. Flags come from a table of metadata types (`metadata-types.ts`), and **an unknown type is flagged**: "Includes a type Topia does not recognise. Treat it as able to run code, change access, or open an outbound path". "Flags: none" appears only when every type in the zip is on the known-benign list. `ConnectedApp`, `NamedCredential`, `ExternalCredential`, `AuthProvider`, `RemoteSiteSetting`, `CspTrustedSite`, `Settings`, `SamlSsoConfig`, sharing types, `CustomObject`, and `Profile`, `PermissionSet`, `Group`, `Queue` and `Role` read "Changes access or opens an outbound path". The table was written from memory of the Metadata API guide and not checked against its PDF. Also shown: the test level the validation ran with, job id, and job age.
- Reversibility class (§9), with irreversible items **first**.
- Plan hash prefix and expiry.

Below a rule, labelled "The assistant's description (not checked)": `businessObjective`, with control characters, ANSI, bidi overrides, zero-width characters, and newlines stripped, capped at 200 characters.

The approve label names the act: "Update 3,000 Widget__c in Production". Don't reuse "Okay to continue" for approvals. For production, the person types the org name under "Other". Never present a practice-review result as evidence of safety.

## 8. Validating and previewing

**Records have no dry run. Nothing may be named one.** `records_preview` returns:

```json
{
  "checked": ["ids", "count", "before-values", "object-crud", "field-updateable", "record-access"],
  "not_checked": ["validation-rules", "triggers", "flows", "duplicate-rules", "assignment-rules", "restriction-rules", "sends"],
  "automation": []
}
```

- `record-access` uses `UserRecordAccess`, chunked at 200 ids.
- `automation` lists active triggers and flows on the object.
- Anonymous Apex with a savepoint is banned: not everything rolls back, and it runs arbitrary code.
- A sandbox rehearsal is recommended for high-risk changes. Report the sandbox's type and age, since data can drift.

**Metadata.**

| Org | Check | Apply |
| --- | --- | --- |
| Production | `project deploy validate --metadata-dir <zip> --test-level RunLocalTests` | `project deploy quick --job-id <id> -o <username>` |
| Sandbox | `project deploy start --dry-run --metadata-dir <zip> --test-level RunLocalTests`, because CLI help says not to use validate and quick on sandboxes | `project deploy start --metadata-dir <same zip>`, with the hash re-checked |

- The runner builds the zip in a private temp folder and hashes it, so `.forceignore` and working-tree edits can't change what ships. Fall back to a temp `sfdx-project.json` if the CLI requires a project.
- Accept a validation only if `checkOnly`, `success`, and `runTestsEnabled` are true, `numberTestsCompleted > 0`, `numberTestErrors === 0`, and it exited 0.
- Before quick deploy: fetch the job by id, and require check-only, succeeded, this org, this user, and a component list equal to the zip's. Age under 10 days counted from the validation **start**, with margin.
- Any later deployment voids all validations. On refusal, revalidate. **Never fall back to a full deploy.**
- **Verify after.** `componentSuccesses` must show the expected `changed` or `created`; a planned change showing neither is a failed outcome even with `success: true`. Re-retrieve with the same manifest and compare. Check `SetupAuditTrail`. A failed post-deploy check stays failed.
- **Records.** Re-query the frozen ids. Target fields must equal the intended values, and non-target captured fields are compared so automation side effects are reported, not hidden.

## 9. Reversible operations

Every plan has a code-computed class, with fixed text from code. The model's recovery text only appears under "The assistant's notes".

| Class | Applies to | What the person is told |
| --- | --- | --- |
| `restorable` | Record update | Old values are saved. Restoring is a new plan, automation fires again, and records changed since are listed, not overwritten |
| `recycle-bin` | Record soft delete | Usually 15 days, but it can purge after 2 hours. No CLI undelete, so a person restores from Setup. Topia checks with `--all-rows` before offering guidance |
| `forward-only` | Metadata deploy | No undo. Restoring means deploying the pre-deploy snapshot as a new change, and what a redeploy can't restore is shown first: deleted field data, type changes, picklist replacements, flow versions already run |
| `access` | Permission grant | The assignment can be removed. Access already used can't be undone |
| `irreversible` | Sends, callouts, hard delete, merges | Hard delete and merge are not offered at all. Sends and callouts can't be recalled |

**Order for a record write:**

1. Live identity check.
2. Re-read the frozen ids. Stop if the set or `SystemModstamp` changed.
3. Save the pre-image durably (temp file, fsync, rename) in the local store with a retention date, and journal its hash. **No pre-image, no write.**
4. Atomically write the ledger entry `started`.
5. Write. Up to 200 records: sObject Collections with `allOrNone: true`, parsing every row, because a top-level 200 can hide failed rows. Above 200: Bulk with an explicit `--wait 0` and `--line-ending`, persisting the job id before polling, and reporting it as capable of partial success.
6. Collect per-id results. Partial is reported as partial.
7. Re-query and reconcile.
8. Offer restore as a **new** plan with its own approval. It targets only ids whose current value still equals the written value.

**Ledger: exactly these states.**

- Missing: never started.
- Unreadable: **stop**, never treated as "not started".
- `started`: carries the job id. An in-progress or unreadable entry goes to **reconcile**: fetch job results by id, or re-read the ids and classify each as done, untouched, or changed by someone else. Report `unknown` when that can't decide.

Never re-send automatically. Each resume is a new approval over the remainder. Before-state is held per record. Deploys get a `started` entry with the deploy id, and a deploy that may have landed is queried, never retried. A cancel counts as done only at `Canceled`, and it's followed by a verify.

**Metadata order:** manifest, baseline retrieve, build and hash the zip, validate, approval, identity check, drift re-retrieve (this is the rollback snapshot), apply, verify, offer redeploy as a new plan.

## 10. Failing closed

- `readStore` and `readJson` distinguish missing from unreadable. Unreadable throws and refuses. All writes are atomic.
- **One source for the lock: the service's store** (`topia-salesforce.json` under the plugin store folder, keyed by project root). The mod reads and changes it only through `bin/runner.js`, and keeps no copy in `$.store`. Remove `.topia/salesforce/activation.json` and `copy-to-store`: there is no project lock file, so no file can activate anything.
- Enabling and disabling require a person:
  - Claude Code: the band's button, which calls the runner.
  - Other hosts: `node <plugin>/salesforce/service/bin/cli.js enable` or `disable`, run by the person in their own terminal. It refuses when stdin isn't a TTY, and the person must type the project path. This is a speed bump, not a boundary.
  - Remove `commit-enable` and `commit-disable`, and the reply-based path in `commands/sf/enable.md` and `disable.md`.
- Every guard hook has `.catch` that denies. `tool.check` guards use `.catch(() => ({ decision: 'deny' }))`. Guards are never gated on `isOn`.
- `tool.check` on Bash **and** PowerShell in an activated project: a person's ask for lines naming `sf`, `sfdx`, `run.js`, `@salesforce/cli`, `.sfdx`, `.sf/`, the plugin store, or `salesforce/service`. Deny file tools on those paths after resolving the real path. A `Grep` or `Glob` is judged by its search root as well: in an activated project a root that equals, or sits above, the plugin store (or `.sf` or `.sfdx`) is denied, and so is an absolute pattern that starts there. In a project that is off, only a root inside the Salesforce store itself (`topia-salesforce.json`, `-logs`, `-local`) is, so a person who never enabled Salesforce sees no change at home, in `~/.claude`, or at `/`. Tokenize, match in command position, and tag each denial with a source. `Monitor` is guarded as a shell. Package runners (`npm exec`, `pnpm exec`, `yarn`, `bun x`) and more wrappers are read through, and so is `$(echo sf)`. In any project, a person's ask is limited to what turns a project on or reaches the store: `runner.js` or `cli.js` followed by `enable` or `disable`, code that `require`s or `import`s the activation module, and the store's own three names. A `runner.js`, a `cli.js` or an `activation.ts` of someone else's goes by. Once a session has read org text, any MCP tool outside Topia's own that isn't read-only (named `get`, `list`, `read`, `describe`, `whoami`, or `resolve`) is a person's ask too. Document it as a speed bump.
- Compare `SetupAuditTrail` and `LastModifiedById` with the journal at session start and before writes, and report anything by this user that isn't in the journal.
- The journal isn't tamper-proof, and docs must not call it that.

## 11. Redaction

One choke point: every tool result passes through it, in `okResult`, `blocked`, and `refuse`.

- Parse JSON and XML where the input is structured, and walk it. Don't regex serialized text.
- Keys: normalize case and separators, then compare (`accesstoken`, `refreshtoken`, `clientsecret`, `sfdxauthurl`, `privatekey`, `password`, `sessionid`, `consumersecret`, and an anchored `sid`).
- Value patterns: `force://`, `00D…!`, `5Aep…`, and JWT shape.
- Parse `org display` in the adapter and keep only the needed fields, so a token can't reach a log.
- For retrieved metadata, redact known secret elements before returning the file, and flag it.
- Journal: SOQL with literals replaced by binds, and refusals recorded. Journal files get the same 30-day sweep as logs.

## 12. Verification levels

Be exact about which level a claim reached.

| Level | Meaning | Reachable here |
| --- | --- | --- |
| Unit | Service and mod tests | Yes |
| Fake CLI | The real adapter spawning a fake `sf` that returns documented JSON, including failures, timeouts, and partial results | Yes |
| Flag snapshot | Every argv checked against CLI 2.156.8 flags | Yes |
| Live | A real sandbox | **No.** No CLI login exists on this machine, and no worker may log in or reach a real org |

`docs/salesforce/LIVE-CHECKLIST.md` lists every check that needs a live sandbox or a person: output shapes, sandbox dry-run deploys, the `$.ui.ask` dialog in a real session, the `command.run` name, and Cursor. **The release gate is that checklist passing.**

## 13. Residual risks to tell users

1. Local files, journals, and plugin code can be changed by any process running as the user. Setup Audit Trail and `LastModifiedById` are the record of truth.
2. Text in an org can carry instructions, and data the assistant read could be sent elsewhere. Topia only partly restricts this.
3. An approval is only as good as what was read. The screen can't list every automation.
4. Sent email, callouts, external systems, and automation firing again on a retry or restore can't be undone.
5. A crash can leave a bulk job running in Salesforce. Topia reports `unknown` and reconciles. It doesn't guess.
6. Approved values go to the model provider and stay in local transcripts. Before-images stay on the machine for 30 days.
7. Sandboxes can hold copied production data and live integrations.
8. An agent with computer use or keystroke injection could answer a dialog. Don't enable those in a Salesforce session.
9. The file and shell guards are a speed bump. A search root, a command built from a variable, a script, a browser, or an MCP tool the filter doesn't know goes past them. The boundary is a Salesforce user that can't write, and a store that holds nothing worth reading.
10. Only a person should turn a project on. The guards ask on the runner, `cli.js`, the store's file name, and `activation.js`, but a command that builds those names from pieces gets past them, and any process running as the user can write the store file. This is a limit, not a closed hole.
11. The screen shows a long value's start and a hash, not the whole. A person approving a long value approves what they could read and a fingerprint of the rest.
12. A deploy's flags come from a table written from memory. An unknown type is flagged, but a type wrongly listed as benign is not.
13. A hook that did not run leaves a stamp the model sent in force. A validation that runs Apex therefore needs a dialog, and not a stamp.
