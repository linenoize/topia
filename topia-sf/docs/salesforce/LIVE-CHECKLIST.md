# Salesforce live checklist

Everything in the Salesforce sub-plugin was built and tested without a real org. No worker may log in or reach one. This is the runbook for a person, in the order to run it. **The release gate, at the end, is this checklist passing.**

| Level | Meaning | Status |
| --- | --- | --- |
| Unit | Service and mod tests | Passing |
| Fake CLI | The real adapter spawning a fake `sf`, on Windows and Linux | Passing |
| Flag snapshot | Every argv checked against CLI 2.156.8 flags | Passing |
| Fresh install | `git archive` of the tree, no `npm install`: `mcp.js` answers `initialize` and `tools/list`, and `runner.js` answers | Passing, in `fresh-install.test.js`. Not run from a marketplace |
| Live | A real sandbox and a real session | **Not done. This file.** |

## Before you start

The order matters. Sections 1 to 3 need no org. Sections 4 to 11 prove identity and the dialogs. Sections 12 to 17 only read. Sections 18 and 19 write, in a sandbox. Only the last section touches production, and only with a person watching.

- Use a sandbox with no live integrations, and a scratch project. Nothing before the last section needs production.
- Log in yourself, in your own terminal: `sf org login web --alias <alias> --instance-url <sandbox login URL>`. The flags on `sf org login web` and `sf org logout` aren't in the flag snapshot, because Topia never builds those commands. Confirm them with `--help`.
- Save outputs outside the repo. They hold org data. This repo stays free of client names, personal names, and real hosts.
- For each item, write down the result, the date, and `sf version`. If a real shape differs from what's described, fix the parser in `salesforce/service/sf-parse.ts` and the fake in `salesforce/service/test-fixtures/fake-sf/bin/run.js` together, and re-run the tests.

## 1. The MCP server loads

Docs say `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}` both resolve in a plugin's `mcpServers`, and `claude plugin validate` accepts the entry. Neither was seen on a real install.

1. Install the plugin from a marketplace, not from a folder. Start a session in the scratch project.
2. Run `/mcp`. Expect `plugin:topia-sf:topia-salesforce`, connected.
3. Confirm its tools are named `mcp__plugin_topia-sf_topia-salesforce__org_inspect` and so on, and that they sit behind tool search, as names only.
4. With no lock, ask the assistant to call `org_inspect`. Expect a refusal saying the project isn't activated.
5. Start a session from a subfolder of the project, with a lock on. Expect `org_inspect` to find the lock. If it says not activated, `CLAUDE_PROJECT_DIR` is not the root that `$.session.root()` gave the band, and the two need aligning.
6. In a project that never uses Salesforce, run `tasklist` or `ps`. Expect one idle `node .../bin/mcp.js`, and no `sf`. Record what the deferred tool names cost in `/context`.

## 2. Enable and disable, and the command name

The mod hooks both `enable` and `topia-sf:enable`, because which one `command.run` carries wasn't confirmed.

1. Run `claude --debug`, then `/topia-sf:enable`. Note which matcher fired in the debug log. Drop the other from `mods/index.tsx`. Do the same for disable.
2. Expect the promise in the command's answer, then a band row with **Okay to continue** and the project path. Press it.
3. Confirm `~/.claude/plugins/store/topia-salesforce.json` holds `sf:activation:<root>`, and that no `.topia/salesforce/activation.json` exists.
4. Run `/topia-sf:disable`, press the button, and confirm the key is gone and other projects' keys are not.
5. Delete `topia-salesforce.json` entirely and start a session in a project that never used Salesforce. Confirm no `node .../runner.js` spawns.
6. Put junk in `topia-salesforce.json`. Confirm the band says the lock can't be read, and that `org_inspect` refuses. Restore the file.

## 3. Install layouts

The resolver is tested against each layout built by hand. Confirm on real installs, and note `rootPath` and the node it picks:

- npm global on Windows, under `%APPDATA%\npm`
- npm global on Linux or macOS
- The Windows `.exe` installer, including its bundled `node.exe`
- The official tarball
- After an auto-update, under `%LOCALAPPDATA%\sf\client`
- A version manager: Volta, nvm, or pnpm shims
- `sf` not on PATH at all. Expect the band to say it couldn't confirm the CLI, naming what it tried

## 4. The `$.ui.ask` dialog inside a registered tool

The test kit runs this path and it passes, but the kit stands in for the host. Contract section 2 rests on it. Nothing writes to the org here.

1. In an activated project, run `/topia-sf:connect` and name the sandbox alias.
2. Confirm `mcp__topia-sf__sf_org_register` is listed, that a dialog opens, and that the tool call waits on it.
3. Note whether a permission prompt also appears. The hook answers in place of the tool, so we expect none.
4. Read the dialog. Confirm the class, org name, org id, instance host, username, and write access all show on separate lines, uncut. Record any length limit.
5. Press **Stop**. Expect a refusal, and no change to `orgs.json`.
6. Press Esc. Expect a refusal.
7. Type something under Other. Expect a refusal.
8. Approve. Expect `.topia/salesforce/orgs.json` with no username in it, and the username in the store. Confirm the band shows the live identity.
9. Repeat step 1 under `bypassPermissions`, and again under `auto`. The dialog must still appear. Record it if it doesn't, and stop: that breaks the contract.
10. Run it from `claude -p`. Expect a refusal, since nobody can answer.
11. Ask a subagent to call the tool. Expect a refusal before any dialog.
12. Note how the model reads the `{ result: string }` the hook returns.
13. Point the alias at a different sandbox with `sf alias set`, then run `/topia-sf:connect` for that same username after a refresh, or use a second login with the same username if you have one. Expect old and new side by side, and that only the typed org name approves.
14. Call `sf_org_register` on this sandbox with `role: 'writer'`. Expect a refusal saying a sandbox doesn't need a second user.

## 5. Live identity on the band

1. With a registered org, start a session. Expect the band to show class, org, id, user, and mode within seconds, without slowing the prompt. Time it.
2. Remove `sf` from PATH and restart. Expect a red stop row saying the CLI couldn't be confirmed, and no identity.
3. Log out of the org, then restart. Expect the expired-login notice, and no identity.
4. Register a write-capable user. Expect the permanent warning: "This CLI user can write directly. Topia's approval doesn't stop a shell command."
5. Register a read-only user. Expect no warning. **Run this with a user you believe is read-only, and read which permissions the probe reports.** If the probe calls that user a writer, or a writer read-only, stop: the band and the production gate both rest on it.
6. Run `org_inspect`, then `schema_describe`, then `records_query` for a bounded count. Expect the band to stay correct, and the journal under `.topia/salesforce/journal/` to hold binds, never literals.

## 6. Whether the question text reaches the transcript

The approval screen for a record write holds record values, in the question text. So will a filter in `sf_show_values`. **This decides what those screens can include**, and until it's answered, treat the question text as reaching the model.

1. After section 4, search the session's file under `~/.claude/projects/` for the org id and for the approve label.
2. Ask the assistant, in the same session, what the dialog said, without letting it call anything.
3. Run `sf_brief_confirm` and `sf_show_values`, and repeat steps 1 and 2 for a value in the brief and a filter in the request.
4. Record the results: does the question text reach the transcript file, and does it reach the model? If either does, say so in `buildApprovalScreen`'s sample lines, or take the samples out.

## 7. Dialog limits

1. Propose a brief with long fields. Record where `$.ui.ask` cuts or wraps the question, and whether the options stay visible.
2. Record the longest option label that shows in full. `Update 3,000 Widget__c in Production` and `Show 2 fields on up to 50 Widget__c rows` are typical, and the docs ask for 1 to 5 words.
3. Under Other, type a name. Expect it to count only when exact, on a dialog that asks for one: the changed-org dialog in section 4, step 13.

## 8. Stamps

A hook rewrites the input of every stdio call. The test kit passes the rewrite through, and the real engine has not been seen doing it.

1. In an activated project, run `/topia-sf:query`, and let it reach `org_inspect`. Expect the call to run, and the result to say `"mode": "investigate"`, not read-only. If it says read-only, the `sfStamp` key isn't reaching the server.
2. If it fails with an argument error naming `sfStamp`, the engine checks the published schema after the hook. The fix is to publish `sfStamp` with a description that says only a hook sets it. Don't drop the check on the server.
3. Confirm `TOPIA_SF_HOOK_HOST=1` reaches the server from `plugin.json`. Ask the model to send `sfStamp` itself, and expect the hook to overwrite it.
4. Confirm the regular expression matcher `/^mcp__plugin_topia-sf_topia-salesforce__/` fires on the real tool names from section 1.
5. On Cursor, with the server added by hand and no flag, send `sfStamp`. Expect a refusal naming a host with no hooks.
6. Run `claude -p` in an activated project. Expect no stamp, reads with `briefConfirmed: false`, and a refusal from any `sf_` tool.

## 9. Mode and the command origin

1. Run `/topia-sf:plan` by typing it. Expect the band to say Plan during the turn, and Read-only after.
2. Confirm `e.origin.kind` is `composer` for a typed slash command. If a typed command arrives as something else, every mode reads read-only, and plan tools refuse.
3. Queue a command while a turn runs. The running turn's `turn.complete` may clear the mode before the command's turn starts. Record what happens. A refusal is safe but annoying.
4. Send a slash command by another route if you have one: a schedule, a peer session, or a plugin's `$.command.run`. Expect read-only.
5. Start a subagent during `/topia-sf:plan`. Expect its `org_inspect` to say read-only, and any plan tool or `sf_` tool to refuse.

## 10. `tool.check` under each permission mode

The guards rest on the docs' word that a hook's `ask` is a person's. None of this was run in a real session.

1. In an activated project, ask the assistant to run `sf org list`, under each of: default, `acceptEdits`, `auto`, and `bypassPermissions`. Expect a person's prompt each time, showing the `[topia salesforce guard]` reason. **If `bypassPermissions` or `auto` runs it without asking, record that and stop: the guard does not hold there, and the docs must say so.**
2. Under `auto`, confirm no classifier settles the ask, and that an allow rule for all of Bash doesn't either.
3. In `claude -p`, expect the same line to be denied, since nobody can be asked.
4. Add a settings rule that denies `Bash(sf:*)`. Expect a deny, not an ask.
5. In a project that's off, run `node <plugin>/salesforce/service/bin/runner.js enable`. Expect an ask. Decline, and confirm the lock isn't set.
6. Ask for a line with no `sf` in it, and time it. The guard should add nothing you can feel. Record how long a guarded line takes, since it spawns the runner to read the lock, and whether it ever outlasts the hook's budget. If it does, the `.catch` denies it.
7. Confirm `$.fs.stat` with `resolve` follows a symbolic link and a Windows junction to `.sfdx`. Expect a deny.
8. Read a brief, then ask for `WebFetch` and `curl`. Expect no prompt beyond the usual. Run `org_inspect`, then ask again. Expect a person's prompt each time.
9. Ask the assistant to run `sf org login web` and `sf org logout`. Expect a person's prompt, and decline both. These are for your own terminal.

## 11. The guard probe

1. Confirm `$.tool.check` works from inside a `tool.call` hook of a registered tool, and that `sf_brief_confirm` opens its dialog.
2. Load a plugin ahead of Topia that answers `tool.check` for Bash with `allow`. Expect a toast, and every `sf_` tool to refuse, naming the guard.
3. Note whether the probe's `sf org list --json` shows up in a prompt or a log. It runs nothing, and no dialog should open.

## 12. Real JSON shapes

Every shape came from CLI schemas and source, not an org. Run each in a temp folder and compare with the named parser. `<u>` is the username, and `q.soql` holds the query. Check these with `--json` and note the exit code.

| Command | Parser | Check |
| --- | --- | --- |
| `node <entry> version --verbose --json` | `confirmCli` in `sf-cli.ts` | No `{status, result}` wrapper; `cliVersion` and `rootPath` present; `rootPath` holds the entry; how long the `npm view` it runs takes, online and offline |
| `sf org display --target-org=<u> --json` | `parseOrgDisplay` | `id`, `username`, `instanceUrl` |
| `SELECT Id, Name, IsSandbox, OrganizationType, InstanceName FROM Organization` | `parseOrganization` | One row, with those types |
| `SELECT Id, Username, Name, IsActive, Profile.Name FROM User WHERE Username = '<u>'` | `parseUser` | One row, `Profile` nested |
| `SELECT COUNT() FROM Account LIMIT 5` | `parseQueryResult` with `isCount` | `records: []`, `totalSize`, `done: true`. Confirm SOQL accepts `LIMIT` on `COUNT()`, and whether the count stops at it |
| `SELECT PermissionSet.PermissionsModifyAllData, PermissionSet.PermissionsModifyMetadata, PermissionSet.PermissionsCustomizeApplication, PermissionSet.PermissionsAuthorApex FROM PermissionSetAssignment WHERE AssigneeId = '<user id>'` | `writeAccess` | Those field names exist, and `PermissionSet` is nested |
| `SELECT SobjectType FROM ObjectPermissions WHERE ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '<user id>') AND (PermissionsCreate = true OR PermissionsEdit = true OR PermissionsDelete = true) LIMIT 1` | `writeAccess` | Accepted. Run it as a read-only user and as a writer, and confirm the probe tells them apart |
| `SELECT QualifiedApiName, Label FROM EntityDefinition WHERE Label LIKE '%account%' ORDER BY Label LIMIT 20` | `schema_describe` candidates | `EntityDefinition` has query limits. Confirm `LIKE` and `ORDER BY` work |
| `SELECT Action, Section, CreatedDate, CreatedById FROM SetupAuditTrail WHERE CreatedById = '<user id>' AND CreatedDate >= 2026-01-01T00:00:00Z AND CreatedDate <= 2026-12-31T00:00:00Z ORDER BY CreatedDate DESC LIMIT 5` | `audit_query` | Accepted |
| `sf sobject describe --target-org=<u> --sobject=Account --json` | `parseDescribe` | `result` is the raw describe. Note `filterable` on a long text field, `createable` and `updateable` on `LastActivityDate`, and whether field flags reflect this user's field security |
| `sf api request rest "/services/data/v66.0/analytics/reports/<report id>/describe" --method=GET --target-org=<u> --json` | `parseReportDescribe` | `result.statusCode`, `result.body.reportMetadata`, `reportExtendedMetadata.detailColumnInfo` |
| `sf api request rest "/services/data/v66.0/analytics/reports/<report id>?includeDetails=true" --method=GET --target-org=<u> --json` | `parseReportRun` | `allData`, `factMap`, `dataCells[].value`, and the `dataType` a report uses for ids and booleans. Confirm `v66.0` is served |
| `sf project retrieve start --target-org=<u> --metadata=ApexClass:<name> --target-metadata-dir=out --zip-file-name=retrieved.zip --unzip --wait=5 --json`, from a folder holding a minimal `sfdx-project.json` | `parseRetrieve`, `readRetrievedFiles` | Files land under `out/retrieved/`. `fileProperties` entries have `type` and `fullName`. Try a member that doesn't exist. Try `--target-metadata-dir` with no project too |

### What a read-only user can read

The production setup rests on this. In the sandbox, make a user with API access, read permissions, and View Setup and Configuration, and no create, edit, or delete. Register it, and run every read tool as it: `org_inspect`, `schema_describe`, `records_query`, `audit_query`, `reports_run`, `metadata_retrieve`, `metadata_diff`, `dependency_report`, and `packages_inventory`.

Record which refuse. A retrieve may need more than read permissions. If `metadata_retrieve` or `metadata_diff` can't run as a read-only user, the guide has to say so, and say what the smallest extra grant is. A refusal must read as denied, never as empty.

### Failures

| Cause it this way | Expect the name in `sf-parse.ts` |
| --- | --- |
| A username with no login | `NamedOrgNotFoundError` or similar, read as expired auth. A logged-out writer rests on this |
| Revoke the session or refresh token in Setup, then query | `INVALID_SESSION_ID` or `RefreshTokenAuthError`, read as expired auth |
| Query an object that doesn't exist | `INVALID_TYPE`, read as denied |
| Describe an object that doesn't exist | `NOT_FOUND`, read as not found |
| A query as a user with no access | `INSUFFICIENT_ACCESS`, read as denied |
| A report id that doesn't exist | A 404 with `errorCode`, read as not found |
| Rate limit, if you can reach one safely | `REQUEST_LIMIT_EXCEEDED` |

Any other name reads as `unknown`, which is safe but noisy. Add a name only when you've seen it, and never add it to expired auth because it looks close.

## 13. What values come back

The value gate is proven against describe shapes from the fake. On a real object, confirm:

1. A query mixing `Id`, a picklist, a checkbox, `Name`, and an email returns values only for the first three, and counts the rest.
2. A field the CLI user can't read through field security fails cleanly and doesn't read as empty.
3. A report with a person's name in a column returns a count and no name.

## 14. Plans and the audit comparison, on a real org

| Run this | Parser or code | Check |
| --- | --- | --- |
| `SELECT Id, SystemModstamp, Status__c FROM Widget__c WHERE Id IN ('...')` with 200 ids | `readBefore` in `plan-tools.ts` | Accepted at 200 ids. `SystemModstamp` comes back on every object you plan on |
| `SELECT Action, Section, CreatedDate FROM SetupAuditTrail WHERE CreatedById = '<id>' AND CreatedDate >= 2026-06-01T00:00:00.000Z ORDER BY CreatedDate DESC LIMIT 200` | `compareAudit` | Accepted with the milliseconds |
| `SELECT COUNT() FROM Widget__c WHERE LastModifiedById = '<id>' AND LastModifiedDate >= 2026-06-01T00:00:00.000Z` | `compareAudit` | Accepted |
| `SELECT Id FROM User WHERE Username = '<writer>' LIMIT 1`, as the read-only user | `userIdOf` in `audit.ts` | A read-only user can look up another user. If it can't, the session-start comparison reads as couldn't check |

1. **Confirm the permission.** Refusals and the guide name **View Setup and Configuration** as what reading Setup Audit Trail takes (`AUDIT_PERMISSION` in `audit.ts`). That comes from memory of the docs, not from an org. Take it from a user, and confirm the read fails with `INSUFFICIENT_ACCESS`. Give it back, and confirm it works. If another permission is what matters, fix the constant and the guide.
2. Make a setup change yourself, in the browser, as the CLI user. Start a session. Expect the band to name it, and to say that if you made it yourself, nothing is wrong.
3. Log in as a user with no access to Setup Audit Trail. Expect the band to say it couldn't check.
   A user with 200 or more setup changes in the window reads as cut short. Expect the dialog to say "200 or more setup changes in this window; not all were compared", on production too, and to let the person decide with the typed org name. Then make a second check and expect its query to still start at registration, because a capped check, a check that found something, and a failed check do not move the window. A clean check does; so does a finding the person saw on a write dialog and approved.
4. On a picklist, filter on a listed value, and on a value someone typed through the API on an unrestricted picklist. Expect the first to run, and the second to refuse.
5. Confirm a `LIKE` on a picklist is accepted, or take it off the list of operators in `soql.ts`.

### Found by the correctness review, to settle on an org

1. **Custom object triggers.** `ApexTrigger.TableEnumOrId` is read as the object's name for a standard object and its Id for a custom one (`readAutomation` asks `EntityDefinition.DurableId` and queries by both). On a custom object that has an active trigger, run `records_preview` and expect the trigger to be listed. If `DurableId` is not what `TableEnumOrId` holds, the lookup finds nothing and the preview says triggers could not be read, which is safe and wrong.
2. **Sandbox type and age.** The contract asks that a sandbox's type and age be reported. Only the prompts say so today. The type (Developer, Partial, Full) lives in `SandboxInfo`, which a sandbox cannot read about itself, and `Organization.CreatedDate` is not confirmed to be the last refresh. Read both on a sandbox, then decide whether the registration should record them. Until then it is guidance only.
3. **`sf update` layout.** After `sf update` on an installer-based CLI, expect `<data>/client/bin/sf` to be a redirect stub and the real CLI to be at `<data>/client/<version>/bin/run.js`. The resolver picks the newest version it finds there. Confirm on Windows and on macOS.
4. **Scrubbed environment.** A machine that needs `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SF_USE_GENERIC_UNIX_KEYCHAIN`, or the libsecret bus (`DBUS_SESSION_BUS_ADDRESS`, `XDG_RUNTIME_DIR`) to log in should work from here. Try behind a TLS-inspecting proxy, and on Linux without a keychain.
5. **Retrieve size.** A retrieve of more than 2,000 files reads in full, and one over 20,000 fails. Deploy something with several thousand files to a sandbox.

## 15. `dependency_report`

Nothing about `MetadataComponentDependency` has been seen on a real org. The fake's rows are a guess at the shape, and the blind spots in the result come from what's known about the API, not from a test.

| Run this | Parser or code | Check |
| --- | --- | --- |
| `SELECT MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentType = 'ApexClass' AND RefMetadataComponentName = '<class>' LIMIT 2000`, with `--use-tooling-api` | `dependency.ts` | Accepted. Those field names exist. Save the rows |

1. Run it as an admin, and as the read-only user. Does the read-only user get rows, a denial, or an empty list? **An empty list for a user who can't see would read as "nothing found".** If that's what happens, the result has to say so.
2. On a class with a known caller, compare with Setup's "Where is this used?". Record what the tool misses.
3. Try `CustomField` with the field's name, with and without its suffix and object. Record which form finds it, and put that in the tool's description. The result's blind spot on field names is a guess until then.
4. Find something with over 2,000 references if you can. Expect `cut-at-limit` and `partial: true`, and confirm the row limit is what the result says.
5. Confirm a dynamic reference, a class named in a string, doesn't appear, and that every result says it wouldn't.
6. Find out whether production serves this object. If it doesn't, `dependency_report` reads as denied there, and `/topia-sf:plan` lists that as its coverage.

## 16. Package inventory

Every query came from the guides and upstream's source, and every shape in the fake is a guess at what they return. Use a sandbox with at least one managed package installed, and one with none if you can. Save outputs outside the repo: package names and namespaces belong in your project's docs, never here.

### Does the list match?

1. Run `packages_inventory`. Compare names, namespaces, and versions with Setup, Installed Packages. Does `InstalledSubscriberPackage` return what you expected?
2. Note whether `SubscriberPackage` and `SubscriberPackageVersion` come back nested, and whether all four version parts are numbers. Does the build number make a version look different from what Setup shows?
3. If you can, install a package with no namespace. Expect it listed with `namespace: null`, and a note that its components weren't checked.

### Which objects can this CLI user read?

Run each one twice, as a read-only user and as an admin, with `sf data query --target-org=<u> --file=q.soql --json`. Add `--use-tooling-api` where it says Tooling. Record for each: rows, denied, or an error name.

| Query | API | Check |
| --- | --- | --- |
| `SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage` | Tooling | Which permission it needs. Whether a user without it gets an error or an empty list. **Empty would read as "no package came back"** |
| `SELECT NamespacePrefix, Name FROM ApexTrigger WHERE NamespacePrefix != null LIMIT 2000` | Tooling | Managed triggers listed. `Name` has no prefix |
| `SELECT NamespacePrefix, Name FROM ApexClass WHERE NamespacePrefix != null LIMIT 2000` | Tooling | Managed classes listed. `Name` has no prefix |
| `SELECT NamespacePrefix, DeveloperName FROM FlowDefinition WHERE NamespacePrefix != null LIMIT 2000` | Tooling | Packaged flows listed |
| `SELECT NamespacePrefix, QualifiedApiName FROM EntityDefinition WHERE NamespacePrefix != null LIMIT 2000` | Tooling | `EntityDefinition` has query limits. Confirm `!= null` is accepted, and whether it raises `EXCEEDED_ID_LIMIT`. `QualifiedApiName` holds the prefix |
| `SELECT NamespacePrefix, Name FROM PermissionSet WHERE NamespacePrefix != null AND IsOwnedByProfile = false LIMIT 2000` | Standard | Packaged permission sets listed |
| `SELECT NamespacePrefix, AllowedLicenses, UsedLicenses, Status FROM PackageLicense` | Standard | Which value a site license shows in `AllowedLicenses`. The parser accepts -1 |
| `SELECT Name, TotalLicenses, UsedLicenses, Status FROM UserLicense` | Standard | Counts only |
| `SELECT DeveloperName, TotalLicenses, UsedLicenses FROM PermissionSetLicense` | Standard | Counts only |

Any error name not in `sf-parse.ts` reads as `unknown`: listed as not checked, or a stop if it hits the package list. Add a name only when you've seen it.

### The rest of the path

1. Time `packages_inventory`. It starts nine CLI processes at once. If that's slow or hits a limit, run them in sequence.
2. Run `/topia-sf:vendor fingerprint`, then `add-finding`, in the scratch project. Read both files. Confirm no username, and that the package name reads as it does in Setup.
3. Run `schema_describe` on an object with a packaged field, and `metadata_retrieve` on a packaged member you can retrieve. Expect the finding on both. Confirm the prefix appears the way the matcher expects: `vendorco__Name`. A managed class referred to as `vendorco.Name` isn't matched.
4. Upgrade the package in the sandbox, if you can. Expect the same describe to show the finding as stale, with `vendor-version-drift`. Re-verify it and expect that to clear.
5. Find out what a sandbox refresh does to `InstalledSubscriberPackage` and the org id. A new org id is a stop under contract section 4, before any of this runs.

## 17. Cursor

Cursor does not read `mcpServers` from `plugin.json`, so a person has to add the server. None of this has been run.

1. Confirm `/topia-sf:*` commands appear. If nested names don't work, flatten them to `commands/sf-*.md`.
2. Confirm `${CLAUDE_PLUGIN_ROOT}` expands in command markdown.
3. Add the server to `.cursor/mcp.json`, with `command: node`, `args: ["<plugin>/salesforce/service/bin/mcp.js"]`, and `env: { "CLAUDE_PROJECT_DIR": "<project>" }`.
4. In your own terminal, run `node <plugin>/salesforce/service/bin/cli.js enable`, and type the project path. Confirm that piping the path in refuses.
5. Confirm reads work, and that no `sf_` tools exist. An org can't be registered from Cursor, so this needs a Claude Code session first, on the same machine.

## 18. A record write, in a sandbox

Nothing about writes has touched a real org. Use a scratch custom object with a few records, a validation rule you can trip, and a trigger or flow that sets another field.

1. `/topia-sf:plan`: `brief_propose`, `sf_brief_confirm`, the practice review, `records_preview`, `records_plan_update`, on three records. Expect a plan under `.topia/salesforce/plans/` holding ids and hashes, and no values.
2. Read the preview. Expect `checked` and `not_checked`, and your trigger and flow in `automation`. Nothing in it may say dry run.
3. `/topia-sf:execute`, then call `sf_records_execute`. Read the dialog: class, org, id, host, username, operation, object, exact count, each new value, three samples before and after, automation, the reversibility class first, and the assistant's text below the rule. Record what's cut.
4. Press **Stop**. Expect no write, and no ledger under `topia-salesforce-local/`.
5. Run it again, and press the label. Expect `status: done`, and the three records changed in the org. Check `LastModifiedById` yourself.
6. Confirm the result holds counts and ids, and no record value. Confirm `sideEffects` names the field your automation set, with a count.
7. `/topia-sf:verify`. Expect the same status, and nothing written.
8. **Report partial on purpose.** Write a plan over three records where one trips your validation rule, and execute it. Expect `status: partial`, zero done, the record that failed listed with `FIELD_CUSTOM_VALIDATION_EXCEPTION`, and the others untouched, because this path is all or nothing. Confirm in the org that nothing changed.
9. **Do it over 200.** A plan over 205 records, with one tripping the rule. Expect Bulk, a screen that says records can partly succeed, `status: partial`, 204 done, the failure listed by id, and the CSVs under `topia-salesforce-local/<project>/results/`, not in the project.
10. Delete a ledger file, then call `sf_records_execute` on that plan. Expect a report and no dialog, with the records counted as done. Then cut a ledger file in half. Expect a stop, and the file left as it was.
11. Kill the runner while a Bulk job is running: `Stop-Process` on it from your own terminal. Call again. Expect the same job picked up, and no second job in Setup, Bulk Data Load Jobs.
12. `/topia-sf:restore` on the plan from step 5. Change one of the records by hand first. Expect a dialog over two, one conflict listed, and that record untouched after. Confirm the automation fired again.
13. `/topia-sf:restore` on a soft delete. Expect counts from the Recycle Bin, and guidance. Restore one from Setup yourself, and ask again.
14. **Setup Audit Trail unavailable, on a sandbox.** Take the permission from section 14 away from the CLI user, then execute a plan. Expect the dialog to open with "Couldn't check" as its first line, and the label to still approve. Give the permission back.

### What the record write assumes

| Assumption | Where | Check |
| --- | --- | --- |
| `sf api request rest <path> --method=PATCH --header=Content-Type:application/json --body=@<file>` reads the body from the file, and sends it | `argsFor`, `records.collections` | A real write. Confirm the `@` form on Windows paths |
| The path `/services/data/v66.0/composite/sobjects` is served | `COLLECTIONS_PATH` | Same call. v66.0 is hard-coded, as it is for reports |
| The answer is `result.statusCode: 200`, `result.body` as an array, one row per record, in order, and a failed row can have no `id` | `parseCollections` | Trip a rule on the second of three records, and save the output |
| The other rows in a failed batch carry `ALL_OR_NONE_OPERATION_ROLLED_BACK` | `runRecordsWrite` | Same output. If the name differs, those rows read as failed, not untouched, and only the report suffers |
| A save moves `SystemModstamp` even when the value didn't change | `classifyRecord` | Update a record to the value it holds. If it doesn't move, a plan like that reads as untouched after it ran |
| A `SELECT ... WHERE Id IN (...)` of 200 ids fits the REST URI limit (the docs say 16,384 bytes; jsforce sends the query as a GET) | `READ_CHUNK` | Plan and write over 1,000 records on a sandbox. A thousand ids would be 26,000 bytes, so this is the number the code was lowered to. If 200 is refused with a long field list, lower the constant |
| The org returns a 15 character reference as 18, a multi-select picklist in definition order, and an empty string as null (REST docs: response ids are always 18 characters; the rest is from behavior) | `sameValue`, with the field type | Update a lookup with a 15 character id, a multi-select with its values reversed, and a text field to `''`. Expect `done`, not `partial`. If a long text area comes back with `\r\n` for `\n`, the comparison already treats them as equal for that type |
| Bulk API 2.0 ignores an empty cell on update, and `#N/A` clears the field (Bulk API guide) | `csvCell` | Bulk-update a text field to `''` on a few records. Expect it cleared |
| A failed all-or-none Collections write answers 200 with one row per record. It may answer 400 with those rows instead | `parseCollections` | Trip a rule on one of three records. Save the status code. Either is read, and a 400 with a plain error list is still a rejection |
| A resume that retries a refused record goes through Bulk, so the others are not rolled back again | `retriesRefused` | Fail one record of three, change nothing, and approve the resume. Expect two done and one failed, not three rolled back |
| A Bulk job whose id was never printed (the CLI died after closing the job) can run later, and nothing here can find it | `runRecordsWrite`, `reconcileRecords` | **Not handled in code.** Finding it needs a listing of ingest jobs, which is not on the closed list of REST paths. Kill the CLI between the close and the id, then see whether the job runs. Until then, a plan left `unknown` after a failed Bulk start should not be replaced by a new plan over the same ids until the org's Bulk Data Load Jobs page (Setup) shows no queued job |
| `sf data update bulk --wait=0` prints `{jobId}`, and `sf data delete bulk --wait=0` prints `{jobInfo: {id}, records}` | `parseBulkStart` | Run both, and save the output. A `data delete bulk` also checks the job after starting it, so a failure there can follow a job that exists. It reads as unknown |
| `--wait=0` parses as a duration of zero on `data update bulk`, which has no default | `argsFor` | Same run |
| `GET /services/data/v66.0/jobs/ingest/<id>` returns `state`, `object`, `operation`, `numberRecordsProcessed`, `numberRecordsFailed`, with `operation` as `update` or `delete` | `parseBulkJob` | Save one while it runs and one after |
| `sf data bulk results` writes its CSVs to the working folder and names them in its answer, and fails with `JobInProgressError` and `NoRecordsError` | `parseBulkResults` | Run it during a job, after one, and after a job that processed nothing. Those two names come from the message keys, not from output |
| The failed CSV has `sf__Error`, and `Id` as sent, and `sf__Error` starts with the status code and a colon | `failedRows` | Open one |
| A rate limit reads as `REQUEST_LIMIT_EXCEEDED` on each of these | `classify` | If you can reach one safely |
| A plan of 10,000 ids fits through `$.process.run` | `MAX_PINNED_CHARS` | stdout stops at 4 MiB, and a plan over 3 MiB refuses. Find out how many records that is on your object |
| `UserRecordAccess` takes `RecordId IN` with 200 ids, returns those fields, and works for this user | `readAccess` | Run it as a read-only user and a writer |
| `ApexTrigger` by `TableEnumOrId` on Tooling, and `FlowDefinitionView` by `TriggerObjectOrEvent.QualifiedApiName` and `TriggerType`, list what's active on an object | `readAutomation` | Compare with Setup on an object with both. If a query is refused, the list reads as could not be read, and that's safe but useless |
| Describe's `updateable` reflects this user's field security | `recordsPreview` | Take a field away by field-level security, then preview it. Record the answer. The preview says it's unconfirmed until this is settled. Also object-level `updateable` and `deletable` |

## 19. A deploy, in a sandbox

Use a scratch project and one small Apex class with a test. Build a folder in metadata format, with a `package.xml` at its root.

1. `/topia-sf:plan`, then `deployment_plan`. `/topia-sf:validate`. Expect `project deploy start --dry-run --metadata-dir <zip> --single-package --test-level=RunLocalTests --async`, then a pick-up.
2. Confirm the job in Setup, Deployment Status, is check-only, with your tests run.
3. **Settle the project question.** Run the validate command by hand from an empty folder with no `sfdx-project.json`. If it works, set `DEPLOY_WORKSPACE` to `bare` in `sf-cli.ts`. Keep the one function. This is research item 2.
4. `/topia-sf:deploy`. Read the dialog. Expect the components from the zip, Runs code, the test level, the job id and age, and what a redeploy can't restore first. Press **Stop**, then run it again and press the label.
5. Expect `status: done`, with `components`, `retrieve`, `audit`, and `identity` all passed. **`retrieve` is the one to watch.** Salesforce rewrites XML on the way in, so a byte compare may fail on metadata that deployed fine. If it fails on anything but Apex source, the compare in `differencesFromZip` has to learn to normalize per type. A false failure stays failed, and it's safe, but it's noise.
6. Change the class in Setup after validating, then `/topia-sf:deploy`. Expect a stop naming drift, and nothing shipped.
7. Deploy the same class again unchanged. Expect `components` failed, because it shows neither changed nor created, even though the job succeeded. Decide whether that's what you want for a no-op.
8. Deploy a `destructiveChanges.xml` that removes a test field. Expect Deletes on the screen, and `deleted: true` in the result. Then find out what a redeploy of the snapshot does to that field, and whether its data comes back. Research says it likely doesn't.
9. Take the rollback offer: `deployment_plan` with `rollbackOf`, then validate, then deploy. Expect the old class back.
10. Start a long deploy, then `sf_deployment_execute` with `cancel: true`. Expect its own dialog. Expect `Canceling` to read as not stopped, and `Canceled` to be followed by a retrieve. Try one that's already finalizing, and record what the CLI says.
11. **`sf_tests_run`.** Run it at each level, and pick the result up by run id. Then one with a failing test.
12. **No local tests.** In a sandbox with no Apex tests, validate. Expect a refusal saying the job completed no tests. Confirm what the job reports: `numberTestsCompleted` of 0 is what the code reads.
13. **A manifest as the CLI writes it.** Run `sf project generate manifest` (or write one by hand from the Metadata API docs) and plan over it. Expect it to be read. Then add a space inside a tag (`<name >`), and expect the plan to be refused with where it stopped. Whether Salesforce itself accepts those spellings is not settled, and the refusal does not depend on it.
14. **A large screen.** Run `/topia-sf:deploy` on a plan with 40 components. Record whether the whole screen shows. A screen that's cut hides what's approved, and that's a stop.

### What the deploy assumes

| Assumption | Where | Check |
| --- | --- | --- |
| `--metadata-dir <zip> --single-package` takes a zip this service wrote, with `package.xml` at its root and a fixed date on every entry | `writeZip`, `deployArgs` | Steps 1 and 4 |
| `--async` on validate, start, quick, and cancel prints `{id, done: false, status, files}` and exits 0 | `parseDeployRun` | Save each |
| `project deploy report --job-id --target-org` exits 0 for any status, with the job in `result` | `parseDeployRun` | Save one for each of: in progress, succeeded, failed, canceled. Source says exit 0. The exit codes 1, 68, and 69 are handled too |
| The report holds `checkOnly`, `success`, `done`, `createdBy`, `startDate`, `runTestsEnabled`, the test and component counts, `rollbackOnError`, `ignoreWarnings`, and `details.componentSuccesses` with `componentType`, `fullName`, `changed`, `created`, `deleted` | `acceptValidation`, `runChecks` | Save one. `changed` and friends may come back as strings. The parser takes both |
| `createdBy` is the user id of the CLI user | `acceptValidation` | Compare. A mismatch reads as another user's job, and every deploy refuses |
| `componentSuccesses` lists exactly the manifest's members, plus a row for `package.xml` | `acceptValidation` | **Likely to differ.** A `CustomObject` may list its fields as extra rows, and a bundle may list one row per file. The comparison is strict, so a difference refuses every deploy of that type, and that's safe. Loosen it per type only after seeing the real rows |
| A check-only job with `--test-level=RunLocalTests` reports `runTestsEnabled: true` and `numberTestsCompleted` above 0 | `acceptValidation` | Save one. An org with no local tests can't pass this, by decision |
| Salesforce refuses a spent validation with `CannotQuickDeployError` or a name holding `INVALID_ID_FIELD` | `parseDeployRun` | The last section, production run, step 8. Any other name reads as unknown, and it's never retried |
| `~/.sf/deploy-cache.json` maps a job id to an object holding `target-org` | `jobCacheProblem` | Open the file. If the shape differs, the check stops working silently, and the CLI's cache can again beat `--target-org` |
| `project retrieve start --manifest --target-metadata-dir --zip-file-name --unzip` leaves files under `<dir>/retrieved/`, maybe under `unpackaged/`, and may list `package.xml` as a `Package` in `fileProperties` | `retrieveManifest` | Save a tree. A retrieve that names components and leaves no files reads as unknown |
| `project deploy cancel --async` prints an id and a status, and `report` then shows `Canceling`, then `Canceled` | `runCancel` | Step 10. |
| With `SF_ORG_API_VERSION` scrubbed, a config's `org-api-version` doesn't drop the cancel below API 65, where a cancel can succeed with data committed | `scrubEnv` | Check `sf config list` in the temp project. Research D.4 |
| `apex run test --test-level --result-format=json --code-coverage --json` returns `{testRunId}` when given no `--wait` | `parseApexRun` | Save one |
| `apex get test` returns `{summary, tests}` and exits 100 on a failed test, with `summary.outcome` naming a run still going | `parseApexRun` | Save one mid-run, one passed, and one failed. `FullName`, `Outcome`, `Message`, and `StackTrace` are from types, not output |

## 19a. What the person reads (security review fixes)

Run these in a sandbox before the release gate. They check the claims in the safety design that no fake can check.

1. Plan an update to a text field with a value that holds a line break and a zero-width space. Open the dialog. Confirm the value shows in quotes with \n and \u{200b} written out, and the character count matches what you typed.
2. Plan a value longer than 120 characters. Confirm the dialog says it was cut, gives the full length, and shows a hash. Compute SHA-256 of the value yourself and compare the first 16 characters.
3. Plan a change of 12 fields with 120-character values. Record whether the whole dialog shows without scrolling or cutting, and where it cuts if it does. The cap is 8,000 characters in `approval-screen.ts` (`SCREEN_LIMIT`). With samples, this plan is about 12,500 characters before the budget, so expect the dialog to say how many sampled records were left out to fit, with every field and value still there in full. Also record how long a dialog can be before it cuts, because the samples are the part that gives way first. If the real limit is lower, lower the cap.
4. Plan an update to a `User` record. Confirm "Changes access" shows above the values.
5. Deploy a zip with a `ConnectedApp`, a `NamedCredential`, and a made-up type name. Confirm the flags line names all three kinds, and never says "none".
6. Validate a zip that holds an Apex class. Confirm `deployment_validate` refuses, and `sf_deployment_validate` opens a dialog that says it runs code in the org. Answer **Stop**, and confirm no job started in the org (Setup, Deployment Status).
7. Compare the type names in `salesforce/service/metadata-types.ts` with the current Metadata API Developer Guide, and fix any that are spelled differently. The table was written from memory.
8. In a project with Salesforce on, ask the assistant to search your home folder, then `~/.claude/plugins`. Both should be refused. Then turn Salesforce off for the project and ask again: both should go through, as they did before Topia had a Salesforce part. A search that starts inside the store (`~/.claude/plugins/store/topia-salesforce-local`) stays refused either way.
9. **Locks, on a real machine.** The fakes cannot suspend a machine. (a) Start a write that takes a few minutes, then suspend the machine for over 15 minutes and resume it. In the first seconds after resume, ask for the same plan from another session. Expect "another run is going", and that the first run finishes. Topia waits one heartbeat (11 seconds) before it takes over a lock that looks 15 minutes old but whose process is alive, and a live run touches its lock every 10 seconds, so a takeover here means timers did not fire after resume. (b) Stop the runner process with a signal that cannot be caught (`kill -STOP`, or suspend it in Process Explorer) for over 30 seconds while it is inside the lock takeover. That window is two file calls wide, so it cannot be hit on purpose, and the code only narrows it: a lock is removed only while it still reads as it did when it was judged free. Note any run that hangs for an hour, since its lock then frees by design.

## 19b. Open review findings

Independent reviews found these. They are not fixed. Decide each one before the release gate, and write the decision here.

**Decide or fix before release:**

| Finding | What happens | Suggested answer |
| --- | --- | --- |
| Drift can pass on an empty retrieve | A retrieve that returns `success: true` with no components shows no drift, and everything reads as "added". That's right for brand-new components and wrong for existing ones. Check on a real org whether an existing component can come back empty | If it can, compare against what the org lists, and treat a mismatch as `unknown` |
| A model can set `confirmed-in-org` | `vendor_finding_reverify` accepts this status with no person, if the evidence names the org id. The status then shows as "Known vendor behavior" | Add a dialog, or label the status as model-asserted |
| Deletes don't show cascades | `Delete 3 Account` shows a count of 3. Child records may go too, which also gets past the record ceiling | Show child relationships with cascade delete on the screen, and check the real behaviour here |

**Lower priority:**

| Finding | What happens |
| --- | --- |
| Stale mode after an interrupt | If an interrupted turn doesn't fire `turn.complete`, execute mode carries into the next prompt. Dialogs still apply, so this affects the accident guard only |
| The band can show another org | With two registered orgs, a read on the sandbox rewrites the band just before a production dialog. The dialog stays correct |
| A literal `#N/A` text value | It fails late in a bulk write, because the CLI's CSV writer uses that text for null |
| The retrieve allowlist | Some allowed metadata types can carry people's addresses |
| The scrubbed environment | The CLI's environment passes through `NODE_EXTRA_CA_CERTS` and a keychain setting, beyond the design's list. This was deliberate, so that corporate proxies work |

**What can still turn a project on:** the guard asks about known spellings, but any command that avoids them can still run the service's activation code. A person's own process could too. Section 13 of the design says so.

## 20. The release gate

3.11.0 shipped these tools early, labelled experimental, so people can test them. This gate now decides when that label comes off, and when they go to skill-topia and topia4hermes.

Everything above ran in a sandbox. This section is the only one that touches production, and it passes or fails the release.

### The production run

Run this with a person watching, on a change you'd make anyway, after sections 18 and 19 pass. A production org has no way to rehearse this path, because the writer rules come from the live flag.

1. **The reader.** In your own terminal, `sf org login web --alias <alias> --instance-url <My Domain URL>`, as a read-only user. `/topia-sf:connect <alias>`. Expect the dialog to say no write access, and to explain that a write takes a second user. Approve. Expect no write warning on the band.
2. **A reader that can write.** Run `/topia-sf:connect` with a write-capable user, read the dialog, and press **Stop**. Expect it to say the user can write, to show the promise word for word, and to offer **Accept one user for writes**. Nothing changes.
3. **No writer.** With a plan ready, run `/topia-sf:execute`. Expect a refusal saying no writer is registered, with the steps.
4. **Register the writer.** Log in as a write-capable user, in your own terminal, through the browser, with MFA. `/topia-sf:connect <username>`, with `role: 'writer'`. Approve. Confirm `sf:writer:<root>:<org id>` is in `topia-salesforce.json`, and that `orgs.json` holds neither username. Expect the band to say "Writer still logged in".
5. **Logged out.** `sf org logout --target-org <username>`. Take a turn. Expect the band to clear within that turn or the next. Run `/topia-sf:validate`. Expect a refusal with the login steps, and no stop row on the band.
6. **Validate.** Log the writer in. `/topia-sf:validate`. Expect `project deploy validate --metadata-dir <zip> --single-package --test-level=RunLocalTests --async`, as the writer, then `passed`.
7. **Deploy.** `/topia-sf:deploy`. Expect the dialog to show the writer's username, to have no button that approves, and to ask for the org name. Type it wrong. Expect a refusal. Type it right. Expect `project deploy quick --job-id=<id> --target-org=<writer> --async`, and a new deploy id. Confirm in Setup. Expect the result to carry `afterThis`, with the logout command.
8. **A spent validation.** Validate again, then deploy something else in the org by hand, then `/topia-sf:deploy`. Expect a refusal asking to validate again, and **no `project deploy start` in the log**. Find out which step refused: the job fetch, or quick itself. This is what "any later deployment voids all validations" looks like, and research only has that from a search excerpt.
9. **A record write.** `/topia-sf:plan`, then `/topia-sf:execute`, on a small change you'd make anyway. Expect the writer's username on the screen, and a typed org name. Confirm `LastModifiedById` is the writer.
10. **After the writer logs out.** `sf org logout --target-org <username>`. `/topia-sf:verify`, in a new session. Expect it to read as the reader, and to say plainly what the reader can't see. Record whether a read-only user can read a deploy's status. Expect the session-start comparison to look up the writer through the reader, and to find nothing unexplained.
11. **Optional, if you can do it safely.** Take View Setup and Configuration from the writer, try a change, and expect a refusal naming the permission and the user. Give it back.

### Pass criteria

All of these, at the commit that gets tagged:

1. Every section from 1 to 19, and the production run, has a row below with a date, a CLI version, and **Pass**. A step you couldn't run says why, and a person accepts that in the notes.
2. None of these happened. Any one blocks the release until it's fixed or the guide says plainly that the claim doesn't hold:
   - A `$.ui.ask` dialog didn't open under `bypassPermissions` or `auto` (section 4, step 9).
   - A person-gated tool ran for a subagent, or from `claude -p` (sections 4, 8, and 9).
   - The shell guard let an `sf` line through without asking under some permission mode (section 10, step 1).
   - The write probe got a read-only user or a writer wrong (section 5, step 5).
   - An approval screen was cut so that part of the change was hidden (sections 7 and 19).
   - Question text reached the transcript or the model, and the screens and the guide don't say so (section 6).
   - Any write landed outside what the dialog showed, any record got a second write, or a full deploy ran on production.
   - A wrong-org write wasn't reported as one.
3. Every parser fix went into the fake too, and `npm run build:sf` was run.
4. `npm run ci`, `claude plugin test .`, and `claude plugin validate .` pass.
5. The README's **Status** line and the CHANGELOG say what was run live, and no longer say it hasn't run.

| Section | Date | CLI version | Result | Notes |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
| 11 | | | | |
| 12 | | | | |
| 13 | | | | |
| 14 | | | | |
| 15 | | | | |
| 16 | | | | |
| 17 | | | | |
| 18 | | | | |
| 19 | | | | |
| Production run | | | | |

### Release steps

Only after the pass criteria hold.

1. **topia.** Move **Unreleased** in `docs/CHANGELOG.md` under the next version's heading. Run `node scripts/bump-version.js <next>`, commit, and create a new tag `v<next>`. Never move an existing tag: the plugin updater goes by the version string, and a moved tag is invisible to anyone installed. Push.
2. **skill-topia.** Port as one commit from `origin/main`: upstream's tree for everything but `.github/`, its own branding kept, tagged at the same version. See `docs/FORK-SYNC.md`. New paths to carry: `salesforce/`, `commands/sf/`, `docs/salesforce/`, `docs/plans/`, the `mcpServers` block in `.claude-plugin/plugin.json`, and `package.json` and `package-lock.json` with `typescript` and `@types/node`.
3. **topia4hermes.** Run `node scripts/sync.mjs`, then `python -I scripts/hermes-scan.py`. It has to exit 0 with verdict `caution`.

What was found about these mirrors, reading them without changing them:

- **skill-topia, `tsc` in `npm test`.** No workflow edit is needed for that. Its CI runs `npm ci` and `npm run ci`, and both come from `package.json`, which the port carries, so `tsc` comes along with its dev dependencies. The plugin name stays `topia` there, so the tool prefix `mcp__plugin_topia-sf_topia-salesforce__` still matches.
- **skill-topia, Node 20.** Its `ci.yml` pins Node 20, while topia's tests 22, 24, and 26, and `engines` says 22 or later. The service refuses a Node under 22. That job was already red at v3.10.0 and v3.10.1, and workflow edits can't be pushed to that repo with the token at hand. So run `npm run ci` there on Node 22 or later before pushing, and expect its hosted CI to stay red until a person with workflow scope changes that one line.
- **topia4hermes, the scan.** `scripts/sync.mjs` copies only `skills/`, and this feature changes nothing under `skills/`. So `salesforce/service/redact.ts` and its token patterns never reach that mirror, and no allowlist is needed. This release is a version-only sync there. If `salesforce/` is ever mirrored, exclude the service, because `redact.ts` holds the patterns a scanner would trip on.
- **topia4hermes, `tsc`.** It runs no npm step. Its CI is the scan.
