# Salesforce sub-plugin review — 2026-10-30

Scope: the uncommitted Salesforce addition (`salesforce/`, `commands/sf/`, `mods/lib/salesforce-env.ts`, the mods band, `docs/salesforce/`, `.topia/salesforce/`, gitignore and package changes) on top of v3.10.2. Five parallel reviews: service code, plugin integration, Salesforce best-practice research, vendor-package research, Topia-wide health.

Test state: `npm test` 1280 tests, 1277 pass, 0 fail, 3 skipped (includes 31 Salesforce cases). `tsc --noEmit` clean. `biome check .` clean. Passing tests mostly restate the happy path — see §2.4.

Priority key: **P0** breaks a safety invariant, leaks data, or breaks install. **P1** wrong behavior. **P2** quality.

**Status, 2026-11-01:** the findings below describe the code as reviewed on 2026-10-30. The cleanup phase has since fixed §2.1 #18 and #19, the canned-code half of #17, §2.2 #1 and #4, the Claude Code half of #5, and #9. It also added the committed build that §2.2 #3 asks for. Everything else is open.

---

## 2. Salesforce addition — findings

### 2.1 Service gate (salesforce/service)

| # | P | Finding | Fix | Why |
| --- | --- | --- | --- | --- |
| 1 | P0 | `tools.ts:572,652`: `artifactHash = args.artifactHash ?? plan.artifactHash`. Validate with X, execute with X, and X deploys without approval. | Ignore the arg, or refuse unless it equals `plan.artifactHash`. | The approval must bind the bytes that ship. |
| 2 | P0 | `mode` and `operation` come from caller args and are never checked. `records.execute_plan` runs under `mode: 'explain'`. | Map each mode to its allowed `toolClass()`. Derive the mode from the command, not from the args. | Read-only-by-default is the headline invariant. |
| 3 | P0 | Approval is a plain sha256 the agent can compute. `records.plan_update` stores a caller-supplied `approval`. Plan and store files are agent-writable. No production code calls `approvePlan` or writes an elevation. | Strip `approval` in `plan_update`. Approve only through a human action: the band button writes an HMAC with a key kept in the plugin store and never shown to the model, or an out-of-band confirm. | Otherwise "human approval" is self-attested. |
| 4 | P0 | `tools.ts:699` compares `plan.approval.at > plan.expiry` (two plan fields). The clock is never checked. Elevation expiry is a string compare (`plans.ts:106`). | Compare `Date.parse(...)` against `ctx.now` and reject NaN. Cap elevation TTL. Elevation is single-use. | Expired approvals currently execute. |
| 5 | P0 | `records.query` validates `fields` and `limit` but sends free-text `soql`. `fields:['Id'], limit:1, soql:'SELECT Email FROM Contact'` returns raw emails. `FIELDS(ALL)`, subqueries, `OFFSET`, and `FOR UPDATE` all pass. | Build SOQL from `{object, fields, where, limit}`, or parse it and check the real select list. Truncate rows to the cap. Run the PII test on the real fields. | Bounds and PII rules must apply to what actually runs. |
| 6 | P0 | `includeValues: true` is a caller flag, so the model can grant itself PII values. | Bind it to a recorded human `show-values` confirmation in the journal. | Same as #3. |
| 7 | P1 | `rerun-query` plans execute against `[]`. Equal counts don't bind which records change. | Freeze the ids at execute time and diff them against the preview. | Drift detection is the plan's promise. |
| 8 | P1 | No in-progress marker. A crash or concurrent call can run twice. `deployment.execute` has no ledger at all. Resume re-sends every id. | Exclusive-create a pending marker before the write. Track remaining ids. Add a ledger for deploys. | "Doesn't apply twice" is a stated invariant. |
| 9 | P1 | The destructive ceiling matches only `'delete'`/`'send'` (case-sensitive). `expectedCount` is plan-supplied. `ceiling \|\| 100` turns 0 into 100. | Make the operation an enum. Use `frozenRecordIds.length`. Use `??`. | The ceiling is trivially bypassed. |
| 10 | P1 | `allowedOperationClasses` on the org registry is never enforced. | Check it in `writeGate` and `readyRead`. | A read-only org can still be written. |
| 11 | P1 | Acknowledgements are forgeable: issue id = kind, compared to caller values. `acknowledgementKey` is unused. | Issue single-use tokens from the band and store them. | Stale-auth, refresh, and user-changed stops can be skipped. |
| 12 | P1 | A rate-limited `inspect` lets `deployment.validate` proceed without a verified org (`tools.ts:570`). | Handle the `rateLimit` variant as a block. | Live identity check is skipped. |
| 13 | P1 | The validation record's `planHash` is never compared at deploy. There is no validation age. | Require `validation.planHash === approvalHash(plan)` and an age under 10 days, which matches the quick-deploy window. | An old plan revision's validation is accepted. |
| 14 | P1 | Malformed plans or ids throw inside `attachStdio`. The unhandled rejection kills the server. | Validate plans with a schema. Wrap dispatch in try/catch and return JSON-RPC errors. | One bad call takes the service down. |
| 15 | P1 | `server.ts` is not MCP-conformant: no `inputSchema`, results not in `content[]`, errors inside `result`, responses sent to notifications, `JSON.parse` unguarded. Tool names contain dots, which Claude's tool-name rule `^[a-zA-Z0-9_-]{1,64}$` rejects. | Use `@modelcontextprotocol/sdk`. Rename tools to `org_inspect` and so on. | Claude Code will not load the tools as written. |
| 16 | P1 | `sf-cli.ts`: `spawn('sf', {shell:false})` fails on Windows (`sf.cmd`) and has no `error` handler. `sf org list users` lists CLI-authed users, not org users. Only 4 of ~16 adapter operations are mapped, and there is no live `Adapter`. | On Windows, resolve `sf.cmd` and run it through `cmd.exe /d /s /c` with metacharacter rejection. Resolve users with SOQL on `User`. Reject arguments starting with `-`. | The primary user is on Windows. |
| 17 | P1 | `gate.ts` is canned production code: 11 scripted scenarios returning constants and a hard-coded SOQL string. `tools.ts` never imports it. The `practice-review` journal event that `plan_update` requires is written only by `gate.ts`, so `plan_update` can never succeed in production. | Move it into test support. Write the practice-review event from a real reviewer call. | It looks like a gate and isn't one. |
| 18 | P0 | `gate.ts` and the tests contained client-identifying context: vendor, person, and institution names, object names, and domain terms. This is a public repo. | Replace with reserved-name fixtures (`Acme`, `ada@example.com`, `Widget__c`). | Repo rule: no personal or client data. Nothing is committed yet. |
| 19 | P2 | `document.ts`: `entry.id` is not passed through `safeId` (path traversal). `assertSeparateKinds` checks `[kind].length`, which is always 1. | Apply `safeId`. Delete or implement the check. | Fake guard. |
| 20 | P2 | Journal stores literal SOQL, so `WHERE LastName='…'` lands on disk and in git. Plan `before`/`after` are unredacted. Adapter messages are unredacted. Refusals aren't journaled. | Store SOQL with literals replaced by `:bind` placeholders. Journal refusals. | PII-by-default promise. |
| 21 | P2 | `redact.ts` key regex `/sid/i` redacts `President__c` and `Subsidiary__c`. The PII regex misses address, phone, mobile, birthdate, and description. `normalizeRoot` lowercases, so paths collide on Linux. The store is read-modify-write with no lock. | Anchor key matches (`^(sid\|session_?id)$`). Widen PII to field types from describe (email, phone, address), not names. | False redaction and false safety. |

### 2.2 Plugin integration

| # | P | Finding | Fix | Why |
| --- | --- | --- | --- | --- |
| 1 | P0 | `ensure-gitignore.js` un-ignores `/.topia/salesforce/**` in **every user project**. That commits `activation.json` (absolute path and username), `session.json` (org id, user), journals (SOQL), plans, executions, validations, `pending-enable.json`, and `orgs.json`. | Keep `/.topia/*` ignored. Share team knowledge through `docs/salesforce/` only, or un-ignore an explicit allowlist such as `plans/`. | Violates "no personal data in repo; per-project stores". |
| 2 | P0 | No MCP server is registered (no `mcpServers` in plugin.json), so every `/topia-sf:*` command calls tools that don't exist. | Add `mcpServers.topia-salesforce` → `node ${CLAUDE_PLUGIN_ROOT}/salesforce/service/dist/mcp.js`, gated on activation. | Nothing works at runtime. |
| 3 | P0 | `salesforce/service/dist/` is gitignored, but marketplace installs are git clones, so `dist/cli.js` and the server are missing. | Commit built JS (like the hooks), or ship plain ESM `.js` with JSDoc types and drop the build step. | Install-time break. |
| 4 | P1 | The gitignore change is half-applied. `REQUIRED_PATTERNS` is unchanged, so existing projects return `already_ok` and never get the new lines. No test covers the block. | Moot once #1 is fixed. Otherwise add the patterns and a test. | New and existing projects behave differently. |
| 5 | P1 | `commands/sf/*.md` with `name: sf:ask` is the first subfolder and first colon name. No validator enumerates it. Cursor may not recurse. The mod hooks both `sf:enable` and `topia-sf:enable`. | Verify on a real install. If unsure, flatten to `commands/sf-ask.md` (`name: sf-ask`), as the other commands are. | Commands may not surface. |
| 6 | P1 | `session.start` awaits a node spawn (8s timeout) in **every** project, ungated. | Skip when there is no store key and no pending enable. Otherwise `void` it. | It slows every user who never uses Salesforce. |
| 7 | P1 | `turn.complete` refresh races session start and can clear the band and pending atom. Button handlers have no try/catch. `pressSalesforceEnable` ignores a failed file write. | Use a single in-flight refresh promise and handle errors. | Flaky band. |
| 8 | P1 | `mods/lib/salesforce-env.ts` duplicates `paths.ts` and `activation.ts`, and the copies have already drifted: the mod accepts an empty `user`, the service doesn't. | One source of truth, plus a parity test. | The lock can flip states. |
| 9 | P1 | "Irreversible, no off switch". Deleting the file re-creates it from the store. Every other mod has a `userConfig` toggle and a `/mods` override. | Keep "per-project only", but add a deliberate, journaled `sf:disable` (or a `userConfig` kill switch). | No uninstall path is a support and trust problem. "Irreversible" protects nothing the approval gate doesn't. |
| 10 | P2 | `files` ships `.ts` sources and `*.case.ts`. The publish workflow works only because `npm test` runs tsc first. | Add an `.npmignore` for cases and test output. Add an explicit `prepack` build. | Accidental correctness. |
| 11 | P2 | Mirrors: skill-topia's sync runs `npm test`, which now needs tsc. The topia4hermes scanner will likely flag `redact.ts` token patterns (`Bearer`, `access_token`, `00D…!`). | Run hermes-scan before release. Allowlist `redact.ts` or exclude the service from the Hermes mirror. | Release-blocking on the next sync. |

### 2.3 Architecture decision forced by research

**The official `@salesforce/mcp` (Salesforce DX MCP server) README announces end of life on 2026-11-02.** Do not wrap it. Two viable paths:

1. **Keep the in-house `sf` CLI adapter (recommended now).** It already follows the right shape: closed argv, explicit alias, default org refused. Finish the live `Adapter`, register it as a proper MCP server, and fix §2.1.
2. **Salesforce Hosted MCP** gives per-user OAuth and server-side audit. Salesforce's own pages conflict on whether it is beta or GA. Revisit it as a second adapter behind the same `Adapter` interface once it is confirmed GA.

Hard gates the research supports (enforce in code):
- Production deploys only via quick deploy of a validation id under 10 days old.
- Test level and 75% coverage met.
- An explicit org alias on every write, never `DEFAULT_TARGET_ORG` or `ALLOW_ALL_ORGS`.
- No delete or anonymous Apex without human approval.
- Surface the 2,000-row report cap. This is already in place, and the Analytics API limit confirms it.
- Treat `MetadataComponentDependency` results as advisory. Its row limits conflict across API versions, and dynamic references are invisible.

Advice only, not gates: permission-set-led design (profile permission retirement was cancelled in June 2026, but this is still recommended), integration users on "Minimum Access – API Only Integrations", audit-trail export cadence (SetupAuditTrail keeps about 180 days), and flows without a trigger order (Well-Architected anti-pattern → Flow Trigger Explorer).

### 2.3a sf-skills (forcedotcom/sf-skills)

Evaluated at `219a84a` (release 1.68.0): 260 skills, Apache-2.0, weekly releases with renames.

**Decision: port the prose. Do not vendor the repo or install it alongside Topia.**
- Most of its skills generate, deploy, write records, run anonymous Apex, or grant permissions, which conflicts with this plugin's gate.
- Its descriptions are routing-aggressive, and the `salesforce-development` plugin's `PreToolUse Bash(sf *)` hooks would intercept `/topia-sf:*` work.
- It does not depend on `@salesforce/mcp`.

| Port into | From sf-skills | What |
| --- | --- | --- |
| `investigate`, `navigator`, `/sf:inspect` | `skills/platform-metadata-discovery-get` | An empty result is not absence. A partial dependency check is never a full impact analysis. What runs on an object. |
| `release-engineer`, `/sf:validate`, `/sf:deploy` | `skills/platform-metadata-deploy` | Validation bound to the org, quick deploy by job id within 10 days, deploy order. Keep our service-enforced approval, not their `CONFIRM_PROD=1`. |
| `practice-review`, `automation-reviewer`, `/sf:review-flow` | `platform-architecture-analyze/references/*` | Well-Architected rubric, split into what is observable and what needs human review. |
| `data-steward`, `/sf:query`, the SOQL builder | `skills/platform-soql-query/references/` | Selectivity rules, anti-patterns, `WITH USER_MODE`. Ban `FIELDS(ALL)`, which they recommend. |
| `automation-reviewer`, `/sf:diagnose`, `/sf:test` | `platform-apex-generate`, `platform-apex-logs-debug`, `platform-apex-test-run` | Bulkification, security, and governor-limit triage, as checklists only. Strip anonymous Apex and write examples. |
| `security-reviewer`, `/sf:review-access` | `skills/platform-permission-set-generate` | Least-privilege and dependent-permission checklist. |
| `packages.inventory` | `skills/dx-org-analyze/references/collection-details.md` | `InstalledSubscriberPackage`, `PackageLicense`, and `ManageableState` queries. Port the queries, not the Python. |

Attribution: `salesforce/THIRD_PARTY_NOTICES.md`, a header on each ported file, and a pin file that flags upstream drift.

### 2.4 Invariants with no test

Plan expiry and elevation expiry. The validate→execute artifact override. Mode gating (one test runs `org.inspect` under `execute`). A forged `approval` via `plan_update`. `plan_update` without a practice-review event. The practice-review ban on `deployment.execute` and `tests.run`. A SOQL that doesn't match `fields`/`limit`, `FIELDS(ALL)`, and subqueries. Rerun-query writes. Concurrent or crash double-execution. A ceiling of 0 and the operation spelling. Forged acknowledgements. `tests.run`. Rate limit on validate. **Each P0/P1 fix lands with its failing test first.**

---

## 3. Vendor-specific notes

### 3.1 Confirmation: no method exists today

The only vendor handling is:
- a rule that a vendor name stays a vendor rather than a user (`enhance-request.md`, `investigate.md`), and
- a hard-coded vendor name in the canned `gate.ts`.

There is no vendor or package registry, no entry kind for "this org behaves differently because package X is installed", no link between a finding and a package version, and no re-check after an upgrade. `document.ts` supports only `observed | intent | preference | decision`.

### 3.2 Why packages must be discovered

No public source showed the first target vendor's product as a Salesforce managed package or named a namespace. So the plugin must **discover** a package inside the org, not hard-code it. Object names in the old fixtures were unverified local assumptions.

### 3.3 Recommended design: vendor overlays

**Files (committed, team knowledge, no PII):**

```
docs/salesforce/vendors/<vendor>/package.md        # fingerprint
docs/salesforce/vendors/<vendor>/findings/<id>.md  # one behavior delta per file
```

`package.md` records the following, each line with evidence and last verified:
- vendor
- product
- package name
- namespace prefix
- installed version (major.minor.patch) per org
- dependencies
- package licenses and who holds them
- package-owned permission sets, triggers, flows, custom settings and custom metadata (the feature switches)

Each finding (`<id>.md`) has the existing seven required fields (scope, owner, evidence, last verified, rationale, dependencies, uncertainty), plus:

- **package / namespace / pinned version**: the version the finding was verified against.
- **orgs**: which org ids. Production and sandbox are verified separately.
- **standard behavior vs observed behavior**: "Delete - All should allow delete; package trigger `ns__X` blocks it".
- **component**: the namespaced trigger, flow, validation rule or setting responsible, or "opaque — managed code hidden".
- **status**: `suspected` → `confirmed-in-org` → `vendor-confirmed`. Vendor ticket ref.
- **admin impact and workaround**: what the admin must do differently. Can it be changed (subscriber-editable) or not (managed)?
- **re-verify on**: package upgrade, sandbox refresh, Salesforce release.

**Service changes:**
1. Add an `EntryKind` `vendor-finding` in `document.ts`, with a `vendors/` folder and validation of the extra fields. `/topia-sf:document` accepts it. Optionally add a thin `/topia-sf:vendor` command with `fingerprint | add-finding | list | reverify`.
2. Add a read-only `packages.inventory` tool. It runs Tooling SOQL on `InstalledSubscriberPackage` (name, namespace, version) and `NamespacePrefix` queries on ApexTrigger, ApexClass, FlowDefinition, EntityDefinition and PermissionSet, plus `PackageLicense`/`UserPackageLicense` counts. Its output seeds `package.md`.
3. **Annotation:** when `schema.describe`, `metadata.retrieve`, `explain` or `diagnose` touches a component whose namespace is registered, attach the matching findings to the result ("Known vendor behavior: …, verified v1.4.2 on 2026-11-02"). This is how "Salesforce behaves differently here" reaches the admin at the moment it matters.
4. **Drift:** add an issue kind `vendor-version-drift`. When the live installed version ≠ a finding's pinned version, the finding shows as stale. Re-check it before relying on it, using the existing `stale-verification` notice pattern.
5. **Ambiguity:** `enhance-request` checks the vendor registry first. A registered vendor name resolves to "vendor/package", with no stop. An unknown product name still stops.
6. **Practice review** gets a fifth measurement: **vendor impact**. Does the change touch namespaced or managed components? Will a package upgrade overwrite it? Is a subscriber-editable setting the supported lever?
7. Keep literal vendor names out of service code. Vendor names live only in the user's project docs, never in the Topia repo.

**First steps for an admin with a vendor package:**
1. Run `packages.inventory` in the sandbox, then in production, and commit `package.md`.
2. Ask the vendor for the namespace, version history, install and upgrade guide, and release notes.
3. Record each observed difference as `suspected` until reproduced in the sandbox.
4. Pin every finding to the installed version, and re-run the inventory after each package upgrade or sandbox refresh.

---

## 4. Topia-wide issues (separate from Salesforce)

Nothing is broken for users. Doctor, the nexus, pack and signal validators, biome, and the version-sync check pass, and the version is 3.10.2 everywhere. CI no longer uses Node 20. The marketplace source is the HTTPS `url` form. `${CLAUDE_PLUGIN_ROOT}` appears only in `hooks.json`.

| # | P | Issue | Fix | Why |
| --- | --- | --- | --- | --- |
| T1 | P1 | `.claude-plugin/marketplace.json:3,13` says "69 skills". Actual is 71. | Change it to 71, and add marketplace.json to `version-sync-check`. | It's the text users see in the plugin browser, and no check covers it. |
| T2 | P1 | `hooks/hooks.json` sets no `timeout` on any hook. | 5–10s for guards, shorter for collectors. | A hung hook stalls the session. |
| T3 | P1 | `docs/ROADTODO.md:48-49` (65 skills, 203 synapses) and `docs/MULTI-PLATFORM.md:457` ("Writing 64 skill files" next to "71 parsed") are stale. | Update them, or label them as dated snapshots. | Contradicts the other docs. |
| T4 | P2 | `.gitattributes` lacks `*.ts`, `*.tsx`, `*.html`, `*.css`, and `hooks/run-hook`. That is the source of the LF→CRLF warnings. | Add `text eol=lf` entries, then `git add --renormalize .`. | `hooks/run-hook` is a shell script and breaks with CRLF. |
| T5 | P2 | `.stfolder/` and `.stignore` (Syncthing) are untracked and not ignored. | Add them to `.gitignore`, or to `.git/info/exclude`. | Noisy status, risk of an accidental commit. |
| T6 | P2 | Five orphan signal emitters (`jira.csv.ready`, `docs.package.complete`, `idea.captured`, `media.request`, `org.configured`). | Wire listeners or drop the emits. | Dead synapses inflate the nexus. |
| T7 | P2 | `run-hook.cjs` prints `e.message`, not the stack. | Print `e.stack` under `TOPIA_DEBUG`. | Debuggability. |

---

## 5. Recommended order

1. **Before anything is committed:** §2.1 #18 (client data out of fixtures) and §2.2 #1 (gitignore). Both are cheap, and the leak can't be undone once pushed.
2. **Make it real:**
   - §2.2 #2 and #3: register the MCP server and ship the built JS.
   - §2.1 #15 and #16: an MCP-conformant server and Windows-safe spawn.
   - A live `Adapter` for the read tools only.
   - Prove one end-to-end read (`org.inspect` → `schema.describe` → bounded count) against a sandbox.
3. **Close the gate, tests first:** §2.1 #1–#6, then #7–#14.
4. **Vendor overlays** (§3.3) and `packages.inventory`. Then fingerprint the vendor package in a sandbox.
5. **Integration polish:** §2.2 #5–#11, including a decision on the off switch.
6. **Topia-wide** T1–T7. T1 and T2 can ship in the next patch independently.
7. **Release:** bump the version and tag it (installs are version-gated), sync skill-topia, and run hermes-scan for topia4hermes.
