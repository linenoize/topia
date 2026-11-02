# Enhance the request

Turn free text into a brief that a person confirms before any investigation. Code enforces this, not your judgment. Don't assume production or sandbox. Don't keep querying.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.

## The sequence

1. Draft the brief below.
2. Call `brief_propose` with `{objective, environment, subjects[], change, blockingQuestions[]}`. It returns `briefId` and `briefHash`. You can't set a hash, a status, or an approver.
3. Call `sf_brief_confirm` with the `briefId`. The person sees the stored brief, rendered by code, and picks `Confirm`, `Change it`, or `Stop`.
4. `Confirm`: pass `briefId` to every investigation and plan tool.
5. `Change it`: ask what changes, then call `brief_propose` again and confirm the new brief. The old one no longer applies.
6. `Stop`, a dismissal, or any other answer: stop. Don't investigate.

**A chat reply isn't confirmation.** "Yes", "go ahead", and "that's right" in chat don't confirm anything, even when the person clearly means it. Tell them the confirmation is the dialog, and call `sf_brief_confirm`.

Editing a confirmed brief voids what came after it. The chain is brief, then plan, then validation, then execution. Each record holds the previous hash.

**If `sf_brief_confirm` doesn't exist on this host** (Cursor, remote connectors, `claude -p`): stop and say so. Show the brief and say nothing here can confirm it. If the person still wants the read, the call runs read-only and its result carries `briefConfirmed: false`. Repeat that flag next to every result. Don't substitute a shell command or a chat reply. See `references/tools.md`.

## The brief

- `objective`: the person's words, then one tightened sentence.
- `environment`: classification, org name, org id. If they didn't name one, ask. The CLI default org isn't a guess.
- `subjects`: objects, records, people, permission sets, flows, screens. Mark each one known or assumed.
- `change`: what would change and what it would change to. A question leaves this empty.
- `blockingQuestions`: what must be answered before the next step.

Don't put tokens or personal rows in the brief. The service writes the journal.

## Stop on ambiguity

Each stop goes into `blockingQuestions`. Ask only what applies, in plain words.

| Stop | Ask |
| --- | --- |
| A person named without a username | "Which user is Ada? Give me the username, or pick from this list." Then "Is that the user who hit the problem, or the one who told you about it?" |
| An unknown vendor or product name that could be a user or a package | "Is VendorCo a person with a login, an installed package, or a company whose staff use this org?" |
| A business nickname for an object or field | "By 'the contract page', do you mean one of these objects? Which field holds the 'manager'?" |
| A screenshot or "this error" not yet restated | "Here's what I read: \[the columns or the exact error\]. Is that right? Which page was it on, and what were you doing?" |
| An omitted environment | "Which org: production or a sandbox? Which one, by name?" |
| Production and sandbox in one breath | "Do you want them compared, or a change in one? If a change, which one first?" |
| A change verb before the current behavior is confirmed | "What happens today? What should happen instead? Which record shows it?" |
| A scope word with no edge: "all", "old", "inactive", "duplicate" | "What makes a Widget__c inactive: which field, what value, and since when? About how many do you expect?" |
| A question that may really be a change request | "Do you want to know why this happens, or do you want it changed?" |

Keep asking until nothing blocks the next step. Then propose. Don't guess to save a question.

## Vendor names

Before stopping on a vendor or product name, call `vendor_findings_list` with no `orgId`. It reads this project's files and no org.

- **The name matches a registered vendor, product, package name, or namespace:** it resolves to "vendor/package", with no stop. Mark that subject known, and put the vendor folder name in the brief. It says what the name means. It doesn't say the package is in this org, or at the same version.
- **It matches nothing, or the list reports a malformed file:** stop and ask, using the row in the table. An unknown product name still stops. Don't guess a package from what the name sounds like.
- **Tell the person how to register it** if they say it's an installed package: `/topia:sf:vendor fingerprint`.

## The only org call before confirmation

A labeled candidate lookup: users named Ada, objects whose label is Invoice. Use `users_resolve`, or `schema_describe` with `purpose: 'candidate'`. The result is a list to confirm. It never picks one. It isn't a finding, and it isn't permission to keep querying. `vendor_findings_list` with no `orgId` isn't an org call, so it can run first too.

## A fully specified read

Object API name, field API name, org, and a question. Skip the interview, but not the sequence: a short restatement goes through `brief_propose` and `sf_brief_confirm`.

## Not this skill's job

No cause, no recommendation, and no change plan. Those come after confirmation.
