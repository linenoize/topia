# Salesforce in Topia

Topia's Salesforce tools can change your org only after you approve the exact change in a dialog. That applies to Topia's tools, not to everything the assistant can do. The assistant can also run shell commands as you, and if your Salesforce CLI login can write, a shell command can write too. This approval slows that down, but it can't prevent it. To make it a hard limit, connect production with a read-only Salesforce user, and log in as a write-capable user only when you intend to make a change.

**Status: experimental, for testing. Use a sandbox.** Please don't use it on production yet. This feature hasn't run against a live org. It was built and tested against a fake Salesforce CLI that returns documented JSON. [LIVE-CHECKLIST.md](LIVE-CHECKLIST.md) lists what a person still has to confirm, and it's the release gate.

Testing it? [LIVE-CHECKLIST.md](LIVE-CHECKLIST.md) is the runbook, and its section 19b lists the open findings. If a result looks wrong or an operation stops with `unknown`, open an issue at https://github.com/linenoize/topia/issues with the step and the `sf version`. Don't paste org data, usernames, or tokens.

## Quickstart

You need Node 22 or later, the Salesforce CLI (`sf`), and Claude Code in a terminal. Start with a sandbox. Each project turns this on by itself, and every other project stays off.

1. **Log in yourself, in your own terminal.** The assistant never logs in, and never sees a token.

   ```text
   sf org login web --alias acme-sbx --instance-url <your sandbox login URL>
   ```

2. **Turn it on for this project.** Run `/topia:sf:enable`, then press **Okay to continue** in the band above the prompt. It applies to the path it shows, and nowhere else.
3. **Register the org.** Run `/topia:sf:connect acme-sbx`. A dialog shows what a live check found. Approve it, and the band shows the org's class, name, id, user, and mode.
4. **Ask something.** `/topia:sf:ask How many Widget__c records have no owner?` The assistant clarifies the request, you confirm it in a dialog, and it reads. Personal values stay out of the answer unless you approve showing them.
5. **Plan a change.** `/topia:sf:plan`, then `/topia:sf:execute` for records, or `/topia:sf:validate` and `/topia:sf:deploy` for metadata. You run each of these commands yourself, because each one sets its mode for one turn.

Production takes more setup, and it's worth it. See [Production](#production).

## Which host can do what

A tool that needs a person opens a dialog from a hook, so it exists only where hooks and a person do. Everywhere else, Topia reads and plans, and can't change an org.

| | Claude Code, in a terminal | `claude -p`, or a remote connector | Cursor and others, with the server added by hand |
| --- | --- | --- | --- |
| Reads with no personal values | Yes | Yes | Yes |
| Plans, previews, check-only validation | Yes | Yes, marked `briefConfirmed: false` | Yes, marked `briefConfirmed: false` |
| Confirm a brief, show personal values | Yes | No | No |
| Register an org | Yes | No | No. Register in Claude Code first, on the same machine |
| Change an org, restore, run tests | Yes | No | No |
| The band, and the shell and file guards | Yes | In `claude -p`, guards deny, because nobody can be asked | No |

On Cursor, add the server to `.cursor/mcp.json` with `command: node`, `args: ["<plugin>/salesforce/service/bin/mcp.js"]`, and `env: { "CLAUDE_PROJECT_DIR": "<project>" }`. Turn the project on from your own terminal with `node <plugin>/salesforce/service/bin/cli.js enable`. It refuses piped input, and you type the project path.

## How a change goes

Each step binds to the one before it by hash, so an edit voids everything after it.

1. **Clarify.** `brief_propose` stores the request, and `sf_brief_confirm` shows it to you, rendered by code. Investigation and plan tools refuse until you confirm. A chat reply doesn't count.
2. **Plan.** `dependency_report` lists what uses what. `records_plan_update` freezes the record ids and their before-state, or `deployment_plan` hashes the artifact. A plan holds a structured payload. The code computes its counts, hash, expiry, and reversibility class.
3. **Preview.** Records have no dry run. `records_preview` says what it checked and what only a save would exercise. Metadata has a real check: a check-only deploy with `RunLocalTests`. That runs code in the org, so a zip with no Apex is validated by `deployment_validate` (on a host with hooks), and a zip that holds Apex is validated by `sf_deployment_validate`, where a person answers a dialog that says "This runs code in the org".
4. **Approve.** `sf_records_execute` or `sf_deployment_execute` reads the org again, and opens a dialog built from what it just read: class, org, user, operation, exact count, new values, samples, automation, and what can't be undone. Production needs the org name typed. Nothing the assistant writes can approve it, and its own text sits below a rule, labelled as not checked.
5. **Verify.** After a write, the service re-reads the frozen ids and reports fields that moved beyond the plan. After a deploy, it checks the components, retrieves again, and reads Setup Audit Trail. `/topia:sf:verify` reads any of this again later, and sends nothing.
6. **Restore.** `/topia:sf:restore` builds a new plan with its own approval, for records still holding what was written. Records changed since are listed, not overwritten.

`dependency_report` is advisory. Every result states its coverage and its blind spots: dynamic references are invisible, one query reads at most 2,000 rows, and not every metadata type is indexed. It can't show that a change is safe.

**Anonymous Apex is banned.** That includes running it with a savepoint as a stand-in for a dry run. It runs arbitrary code, and not everything rolls back: a sent email or a callout has already left. The CLI commands Topia can build have no route to it.

**Don't install sf-skills' `salesforce-development` plugin alongside Topia.** Its hooks also run on `sf` lines in the shell, so two guards answer one command, and a denial gets hard to read. Its production check takes a confirmation marker the model writes itself, which is not a person's approval. Together, the two give a false picture of what's protected.

## Production

A write through the shell can't be stopped from this machine. A Salesforce user with no write permission can't write through anything, so that's where the hard limit lives. Set production up with two users.

**1. A read-only user for everyday use.** Give it API access and read permissions, and no create, edit, or delete. It needs **View Setup and Configuration** too, so Topia can read Setup Audit Trail. Log in as it, then register it:

```text
sf org login web --alias acme-prod --instance-url <your My Domain URL>
```

Then `/topia:sf:connect acme-prod`. The dialog says what this user can write, from a live probe of its permissions. If it can write, the band says so permanently: "This CLI user can write directly. Topia's approval doesn't stop a shell command."

**2. A write-capable user, logged in only for the change.** In your own terminal, log in through a browser, with MFA. The assistant can't complete this, and it never runs these commands:

```text
sf org login web --instance-url <your My Domain URL>
```

The first time, register it as the writer: run `/topia:sf:connect <that username>`, and ask for `role: 'writer'`. The read-only user has to be registered first. The writer stays in the service store on this machine, and never reaches `orgs.json`.

**3. Make the change.** Writes, restores, validations, and test runs target the writer. Reads stay with the read-only user. If the writer isn't logged in, those tools refuse, and tell you what to run.

**4. Log out when you're done.** The result reminds you, and the band says "Writer still logged in" until a look finds it gone. Topia doesn't do this for you.

```text
sf org logout --target-org <that username>
```

**If the org has only one user that can write,** the dialog at registration offers **Accept one user for writes**, with the promise above in front of you. That user then reads and writes, you've given up the hard limit, and the band keeps saying so. A later registration without that answer ends it.

A sandbox needs none of this. Its one user reads and writes. But see the risks below: a sandbox can hold copied production data and live integrations.

### Two refusals you may meet

**Setup Audit Trail can't be read.** Topia compares it with the journal before a change, to find anything made outside Topia. On production, a change stays refused until this works, and the refusal names who needs **View Setup and Configuration**. On a sandbox, the dialog says "Couldn't check" first, and you decide. Any other comparison that can't finish reads the same way. A comparison that ran but only saw part of the window is different: if the user made 200 or more setup changes in it, the dialog says "200 or more setup changes in this window; not all were compared", on production as well, and you decide, with the org name typed on production. (If Salesforce says the trail came back cut short with fewer rows, the dialog says that instead.) The audit detects. It isn't a safety boundary. After a check that came back clean, or whose finding you saw on a write dialog and approved, each check looks back only to that point, which keeps a busy admin under the cap. A finding that only reached the session band, or on a dialog you declined, does not move it, so it shows again on the next dialog. The record-count comparison uses the same window for the journal as for the org.

**A `package.xml` Topia can't read the plain way.** Topia reads a manifest only in the form the Salesforce CLI writes: a plain `<Package>` in the metadata namespace, `<types>` blocks with `<members>` and one `<name>`, no comments, CDATA, attributes, prefixes, spaces inside a tag, or entities beyond `&amp; &lt; &gt; &quot; &apos;`. Anything else is refused when you plan, with the place it stopped, because a spelling Topia skips could still be read by Salesforce, and then the dialog and the Apex gate would show less than ships. Topia doesn't try to read every XML form. The same goes for `destructiveChanges*.xml`. Files in `classes/`, `triggers/`, `pages/`, `components/`, `lwc/` and `aura/` are also checked against the manifest, and one the manifest doesn't name is refused. Other kinds of file aren't matched against it.

**The org has no local Apex tests.** Production deploys stay refused. Production ships only by quick deploy of a validation that ran tests, so no test run means no quick deploy, and a full deploy is banned. Add a test class, in the org or in the deploy, then validate again. A sandbox validation has to complete tests too.

## What can be undone

The code picks the class and its wording, and the dialog shows it first. The assistant's own recovery notes sit below the rule.

| Class | Applies to | What you're told |
| --- | --- | --- |
| `restorable` | Record update | Old values are saved. Restoring is a new plan, automation fires again, and records changed since are listed, not overwritten |
| `recycle-bin` | Record soft delete | Usually 15 days, but it can purge after 2 hours. There's no CLI undelete, so a person restores from Setup. Topia checks with `--all-rows` before offering guidance |
| `forward-only` | Metadata deploy | No undo. Restoring means deploying the pre-deploy snapshot as a new change, and what a redeploy can't restore is shown first: deleted field data, type changes, picklist replacements, flow versions already run |
| `access` | Permission grant | The assignment can be removed. Access already used can't be undone |
| `irreversible` | Sends, callouts, hard delete, merges | Hard delete and merge are not offered at all. Sends and callouts can't be recalled |

A git revert is not an org rollback.

## What this cannot do

These stay true however careful the tools are.

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

## The tools

| Tool | Reads | Returns values |
| --- | --- | --- |
| `org_inspect` | Live identity, by SOQL on `Organization` and the current user | Org and user facts |
| `schema_describe` | An object's fields, or candidate objects for a label | Labels, and whether each field returns values |
| `records_query` | A bounded count from structured filters | Ids, booleans, picklists, and date-only system fields. Everything else is counted |
| `users_resolve` | Candidate users. It never picks one | Name and username, so a person can confirm |
| `audit_query` | Setup Audit Trail for one user and a window | Action, section, time, and actor. Free text is withheld |
| `reports_describe` | A report's columns and which columns it filters | No filter values |
| `reports_run` | The row count, through the same gate | Ids and booleans. A cut-short or malformed result is partial |
| `metadata_retrieve` | Named metadata, in a temp folder | Configuration files only (code, schema, layouts, automation, access settings), with known secret elements redacted and flagged. Reports, dashboards, documents, content, static resources, email templates, and any type Topia doesn't list are withheld, and the result names them. No Topia tool returns those |
| `metadata_diff` | Org against project source, or two orgs | Which files match, by hash. No text |
| `dependency_report` | `MetadataComponentDependency`, through Tooling SOQL | What uses a component, and what it uses, with coverage and blind spots. Advisory |
| `brief_propose` | Nothing in the org | Stores the clarified request off the repo, and returns its id and hash |
| `practice_record` | Nothing in the org | Stores a review's measurements off the repo. A quality check, never evidence of safety |
| `records_preview` | Ids, access, and active automation | What it checked and what it didn't. No values |
| `records_plan_update`, `deployment_plan` | The frozen ids, or the artifact's bytes | Writes a plan. Nothing changes in the org |
| `deployment_validate` | Starts a check-only deploy with tests, for a zip with no Apex, on a host with hooks | Whether it counts, and why not. Test failures are counts only. With no stamp, or a zip that holds Apex, it refuses |
| `sf_deployment_validate` | The same, for a zip that holds Apex. A person answers first | The same. Reading a validation already started opens no dialog |
| `deployment_verify` | A plan's ledger against the org | Status and counts. Nothing is sent |
| `packages_inventory` | Installed packages, namespaced components, and license counts | Names, versions, and counts. Managed code stays hidden |
| `vendor_findings_list` | The vendor notes in this project, and optionally the live version | Status, version, and any file that doesn't parse |

`vendor_fingerprint`, `vendor_finding_add`, and `vendor_finding_reverify` write only under `docs/salesforce/vendors/`. None of these tools changes an org.

These exist only in Claude Code, with a person present, because each opens a dialog. What a person grants in one lives in session memory, so no file can grant it.

| Tool | What it does |
| --- | --- |
| `sf_org_register` | Registers an org, or with `role: 'writer'`, its second user |
| `sf_brief_confirm`, `sf_ack_issue` | Confirms a brief, or acknowledges a notice |
| `sf_show_values` | Shows values the tools withhold, after saying where they go |
| `sf_records_execute` | Runs an approved record plan |
| `sf_deployment_execute` | Applies a validated deploy, or cancels one |
| `sf_restore_plan_execute` | Runs a restore as a new plan |
| `sf_tests_run` | Runs Apex tests. They run code in the org |

## The checks around the tools

These stop accidents and casual injection. **They are a speed bump, not a boundary.** The hard limit is a Salesforce user that can't write.

| Check | What it does | What gets past it |
| --- | --- | --- |
| Clarify first | With a stamp, investigation and plan tools refuse until a person confirms the brief in a dialog. A chat reply doesn't count | A host without hooks has no way to confirm, so its reads and plans run and say `briefConfirmed: false`. It can't validate a deploy: that starts a job in the org, and it needs a stamp |
| Mode | Only a command typed at the prompt sets it. It ends with the turn, and a subagent is always read-only. A table in `salesforce/service/modes.ts` says which command reaches which tool | It guards against accidents. A person can type any command |
| Shell guard | In a project that's on, a line naming `sf`, `sfdx`, `run.js`, `@salesforce/cli`, `.sfdx`, `.sf/`, the plugin store, `salesforce/service`, or `.claude/settings` needs a person's yes. So does anything that could turn a project on, in any project: the runner, `cli.js enable`, `activation.js`, or the store's file name. Package runners (`npm exec`, `yarn`, `bun x`) and wrappers like `setsid` are read through | A command spelled through a variable, a script written first and run later, a browser, or computer use |
| File guard | File tools can't reach those paths, judged by where they really land. A `Grep` or `Glob` is judged by its search root too: in a project that is on, a search from a folder that holds the plugin store (home, `~/.claude`, `/`) is refused. In a project that is off, which includes every project of someone who never used Salesforce, only a search that starts inside the Salesforce store itself is, and home, `~/.claude` and `/` search as they always did. A project rooted at home that is on can't run a path-less search; name a folder. They can read, but not write, `.topia/salesforce/` | The shell, and anything else that isn't a file tool |
| After org text | Once a session has read org text, `WebFetch`, `WebSearch`, `Monitor` with a socket, network-looking shell lines, and any MCP tool outside Topia's that isn't read-only (named get, list, read, describe, whoami, or resolve) need a person's yes | A filter can't catch every way out. Don't read data you can't afford to lose in a session with outbound tools |
| Guard probe | A tool that needs a person asks the permission chain about a line the guard always catches, and refuses if the guard didn't answer | A plugin above Topia can answer anything over it. It only shows the guard is in the chain now |

At session start, and before a change, Topia compares Setup Audit Trail and `LastModifiedById` with the journal, and shows anything by the reader or the writer that the journal doesn't hold. If it can't check, the band says it couldn't, and never reads that as clean.

A stamp isn't proof. The server believes one only where the plugin manifest launched it, because only there can a hook have written it. A stamp on a host without hooks is refused. Nothing here is signed, on purpose: a key on the same machine wouldn't stop anyone who can already run commands as you. Those hosts have no tool that needs a person, so a forged stamp could only earn reads they already get, and a validation of a zip with no Apex. A zip with Apex needs a dialog, which is why a stamp isn't enough for it.

## What gets committed

Commit `docs/salesforce/`, `.topia/salesforce/orgs.json`, and `.topia/salesforce/plans/`. The Topia `.gitignore` block allows only those two paths under `.topia/salesforce/`.

These stay on the machine, because they hold paths, usernames, or query values:

| File | What it holds |
| --- | --- |
| `journal/` | One JSONL file per correlation id, with SOQL (literals replaced by binds), refusals, and counts |
| `executions/`, `validations/` | Run records |

The lock, the usernames of the reader and the writer, and the session snapshot live in `topia-salesforce.json` in the plugin store under `~/.claude`, keyed by project root. No file in a project can turn Salesforce on.

Briefs, plan values, before-state, practice reviews, ledgers, pre-images, deploy zips, rollback snapshots, and bulk result files live in the plugin store too, under `topia-salesforce-local/`, keyed by project root. Pre-images and bulk result files can hold personal values. A committed plan holds ids, field names, counts, and hashes, and it binds those local values by hash.

Logs live in the plugin store, keyed by project root. Logs, journal files, and the local store are removed after 30 days.

A project set up before this list existed ignores all of `.topia/salesforce/`. Nothing leaks. Add the lines from the block to share the registry and plans.

## Notes this tree can hold

Entries in a project's `docs/salesforce/` each have scope, owner, evidence, last verified, rationale, dependencies, and uncertainty. Observed org state, reviewed intent, and personal preferences stay in separate files.

| Folder | What it holds |
| --- | --- |
| `orgs/` | Observed org state |
| `architecture/` | Reviewed intent and shape |
| `object-model/` | Objects and fields |
| `automation/` | Flows, rules, Apex boundaries |
| `permissions/` | Permission sets and sensitive fields |
| `reporting/` | Reports and what a row cap means |
| `integrations/` | Callouts and outside systems |
| `runbooks/` | How to validate, deploy, and recover |
| `decisions/` | Confirmed decisions from `/topia:sf:document` |
| `vendors/` | One folder per vendor package: `package.md` and `findings/<id>.md`, from `/topia:sf:vendor` |
| `preferences/` | Personal preferences |
| `known-limitations/` | What is still uncertain |

## If a vendor package is installed

A managed package can make Salesforce behave differently from standard, and you can't read its code. Topia doesn't know any vendor in advance. It finds what's in your org, and you record what you learn in this project. Those notes get committed, so they hold no personal values.

First steps:

1. **Run the inventory in a sandbox, then in production.** `/topia:sf:vendor fingerprint` lists what's installed and writes `vendors/<vendor>/package.md`. Run it in each org. Read what it says wasn't checked: a CLI user with limited access gets a partial list.
2. **Ask the vendor** for the namespace, version history, install and upgrade guide, and release notes. Keep their reference numbers.
3. **Record each difference as `suspected`** with `/topia:sf:vendor add-finding`. It stays `suspected` until you reproduce it in a sandbox. Then `/topia:sf:vendor reverify` moves it to `confirmed-in-org`, with evidence that names the org. `vendor-confirmed` needs a vendor ticket.
4. **Pin every finding to the installed version.** The tool does this, reading the version from the org.
5. **Re-run the inventory after each package upgrade or sandbox refresh.** A finding pinned to another version shows as stale, with a notice, until you check it again and re-verify it.

Once a finding exists, a tool result that touches that namespace carries it: "Known vendor behavior: A package trigger blocks the delete, verified v1.4.2 on 2026-11-02, status suspected." The status always shows, because `suspected` isn't fact.

What this can't tell you: managed code is hidden, so a short component list doesn't mean a package does little, and "nothing recorded" doesn't mean no difference exists.
