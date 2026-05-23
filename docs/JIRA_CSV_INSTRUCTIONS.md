# Jira CSV Generation Instructions (Feature/Task/Bug Only)

## 1. Goal

Generate a **CSV file** of Jira issues for your target Jira project that can be imported into Jira.
Each row is a single Jira issue (`Feature`, `Task`, or `Bug`), sized to fit within a sprint and written so that:

- stakeholders can quickly recognize what request the issue is addressing,
- developers can execute the work with minimal ambiguity,
- testers can validate completion,
- future AI agents can reliably parse the intent and scope.

The instruction set must preserve the original business language while also translating it into a structured technical ticket.

---

## 2. Core Principle: Translation, Not Replacement

When a stakeholder creates or describes work, the goal is **not** to replace their language with purely technical Jira language.
The goal is to **translate** their request into a form that remains recognizable to them while also being actionable for engineering.

Every ticket should therefore do two things at once:

1. Preserve the stakeholder’s wording or intent in clear, non-technical language.
2. Convert that request into a clear, scoped, testable unit of work.

If a stakeholder later opens the issue, they should be able to tell within a few seconds:

- what request this issue maps to,
- what part of the product it affects,
- whether it covers the concern they raised,
- whether the work is done.

---

## 3. CSV Format

Output a **valid CSV** with a **header row** and one row per issue.

Required columns (in this order if possible):

1. `Issue Type`
2. `Summary`
3. `Description`
4. `Parent`
5. `Priority`
6. `Assignee`
7. `Labels`

Rules:

- Use commas as separators; quote values that contain commas or line breaks.
- Leave cells blank when unknown, especially `Assignee` and `Parent`.
- Use plain text only; no formulas, comments, or spreadsheet logic.
- When asked specifically for CSV, output only the CSV text and nothing else.

---

## 4. Allowed Issue Types and When to Use Them

Agents must use **only** these Jira issue types:

- `Feature`
  - For user-facing or operator-facing capabilities and changes.
  - Use for new UI behavior, new dashboard capability, new Hermes behavior, admin-facing workflow changes, and business-facing functional additions.
- `Task`
  - For internal, technical, or operational work that does not stand on its own as a business-facing feature.
  - Use for refactors, cleanup, migration work, tooling, instrumentation, configuration, technical enablement, or implementation support work.
- `Bug`
  - For defects in existing behavior.
  - Use for incorrect API behavior, broken UI behavior, PII exposure, inconsistent search, incorrect exports, workflow failures, or routing issues.

Change requests:

- Represent change requests as either `Feature` or `Task`.
- Always add the label `change-request` in the `Labels` column.

No other issue types, such as Epic, Story, or Sub-task, should be used in the CSV unless explicitly requested.

---

## 5. Naming Standard for Human Readability

The `Summary` is the first thing a stakeholder will scan.
It should be readable by a non-technical person in under 10 seconds.

### 5.1 Summary rules

The `Summary` should:

- be short, usually about 6–12 words,
- describe one clear piece of work,
- lead with the business-facing object or workflow,
- use product language stakeholders already use,
- avoid hiding the real outcome behind technical jargon.

### 5.2 Preferred naming pattern

Use this pattern when possible:

`[domain/context] [surface or artifact] [specific action or purpose]`

Examples:

- `Recruiting email job approval`
- `Recruiting email job share`
- `Recruiting email feedback`
- `Opportunities dashboard detail view`
- `Hermes opportunity import foundation`
- `Dashboard CSV export strips restricted PII`

### 5.3 Avoid abstract technical-only titles

Avoid summaries that are technically correct but hard to scan, such as:

- `Transactional email client action URL mapping`
- `Case normalization variance by endpoint family`
- `Dashboard object lifecycle refactor`

Instead, prefer titles that help a stakeholder immediately identify the user-facing thing involved.

Bad:

- `Transactional email client action URLs`

Better:

- `Recruiting email job approval actions`

### 5.4 Use stakeholder vocabulary where possible

If the business uses a specific term, use that term in the title and overview.
For example:

- use `opportunity` instead of `job` when that is the external or customer-facing product language,
- use `view` instead of `tile` when that better matches product documentation and stakeholder language,
- use `approval email` instead of `transactional email` when that is what the stakeholder is actually looking for.

---

## 6. Description Requirements

Every description must have **two layers**:

1. a brief, non-technical layer for stakeholder readability,
2. a structured implementation layer for engineering and testing.

The issue should answer:

- what request this came from,
- why it matters,
- who it affects,
- what part of the product it touches,
- what behavior is expected,
- how to validate it.

### 6.1 Required description structure

Agents must structure every description in this order:

1. **Original request**
2. **Overview (non-technical)**
3. **Audience & surface**
4. **Ticket interpretation**
5. **Problem / behavior**
6. **Part of the application**
7. **Expected vs actual**
8. **Validation & tests**
9. **Acceptance criteria**
10. **Open questions / decisions** (only if needed)

---

## 7. Description Section Guidance

### 7.1 Original request

This section is mandatory.

It should capture either:

- the stakeholder’s exact wording, or
- a very close plain-English paraphrase.

Purpose:

- preserve recognizability,
- make the issue traceable back to the original ask,
- reduce confusion when stakeholders revisit Jira later.

Examples:

- `Send an approval email for manually added opportunities.`
- `Make this work like the other page.`
- `I want to see all the recruiting emails clearly listed.`

Do **not** rewrite this section into engineering language.
Keep it as the business-facing request.

### 7.2 Overview (non-technical)

The first 2–4 sentences after the original request should be understandable by a non-technical stakeholder.
Explain:

- why this matters,
- who is affected,
- what gets better when complete.

Avoid code terms here.
Use business or workflow language.

Good examples of phrasing:

- `Admins need to clearly approve manually submitted opportunities without being overwhelmed by bulk-imported items.`
- `This change makes the recruiting workflow easier to understand by separating each email into its own visible work item.`
- `This bug creates a trust and compliance risk because exported data includes fields that should not be shared.`

### 7.3 Audience & surface

Clarify who sees the issue and where it appears.

Include:

- **Audience:** Admin, SuperAdmin, Operator, Alumni, internal support, internal staff, etc.
- **Surface:** specific page, flow, dashboard view, Hermes panel, email, API, or import process.

This section should help both stakeholders and developers understand scope quickly.

### 7.4 Ticket interpretation

This section is mandatory.

It translates the original request into the actual Jira unit of work.
It should explain:

- what this ticket does cover,
- what this ticket does not cover,
- how the request has been scoped into one issue.

Examples:

- `This ticket covers the approval email sent for manually submitted opportunities only. It does not cover bulk-imported opportunity approvals.`
- `This ticket covers the button actions linked from the approval email, not the email template itself.`
- `This ticket creates the backend foundation needed for opportunity import so downstream dashboard work can proceed with realistic mock data.`

This is the bridge between stakeholder language and engineering execution.

### 7.5 Problem / behavior

Explain the problem or desired change in one short paragraph.

- For `Bug`: describe the incorrect current behavior in plain language.
- For `Feature`: describe the missing capability or desired workflow.
- For `Task`: describe the technical risk, debt, dependency, or enablement purpose.

Keep this section at the workflow level before discussing code or file paths.

### 7.6 Part of the application

Now identify where in the system the work lives.

List:

- frontend components or modules,
- backend endpoints and controllers,
- models, cron jobs, routing, config, or import flows,
- email templates or automation pieces where relevant.

Use short bullets with file paths or function names when known.

### 7.7 Expected vs actual

This section is required for `Bug` issues and recommended for `Feature` and `Task` issues.

- **Expected:** describe the target behavior in concrete, observable terms.
- **Actual:** describe what happens now.

Prefer specific comparisons over vague statements.

Good:

- `The approval email should send only for opportunities created through the manual submission wizard.`
- `The dashboard export should match the same row set and visible columns as the filtered UI table.`

Avoid vague language such as:

- `Should work correctly`
- `Should behave like before`
- `Should make this better`

### 7.8 Validation & tests

Every ticket must include how to prove it is done.

Agents should specify:

1. **Manual validation**
   - Which page or workflow to open.
   - What data/setup is required.
   - What to click.
   - What outcome to verify.

2. **API or integration validation** when relevant
   - HTTP method and route.
   - Key parameters.
   - Authentication requirement.
   - Expected result or state change.

3. **Automated tests** when relevant
   - Unit or integration cases.
   - Edge cases.
   - Regression checks.

This section must be specific enough for another developer, tester, or AI agent to execute without guessing.

### 7.9 Acceptance criteria

Acceptance criteria are the yes/no checklist for completion.
They must:

- be testable,
- stay within the scope of the ticket,
- use observable outcomes,
- avoid implementation ambiguity.

Good examples:

- `An approval email is sent only when an opportunity is created through the manual submission wizard.`
- `Bulk-imported opportunities do not generate approval emails.`
- `The approval email contains working approve and reject actions.`
- `Clicking an approval action updates the opportunity state correctly.`
- `The issue title and overview clearly identify this as the recruiting approval email flow.`

Avoid vague criteria such as:

- `Works like the other page`
- `Handles approvals properly`
- `Looks good`

When stakeholders reference an existing page or flow using shorthand such as `make this like that other page`, translate that into explicit comparison criteria.
For example:

- matching layout sections,
- matching action availability,
- matching state changes,
- matching user-visible labels,
- matching error handling.

### 7.10 Open questions / decisions

Use this section only when required.

Include unresolved decisions that block accurate implementation or ticket creation.
Examples:

- whether this applies to manually submitted opportunities, bulk-imported opportunities, or both,
- whether reminder emails are part of MVP,
- whether a dashboard screen is a new view or a widget,
- whether the feature name should follow external product vocabulary.

If something is unresolved, do not hide the ambiguity.
State it clearly.

---

## 8. Type-Specific Guidance

### 8.1 For Features

Use `Feature` when the issue describes business-visible capability.

Guidance:

- emphasize user or operator value in the overview,
- name the issue using the visible workflow or artifact,
- make the ticket interpretation explicit if the request could be split several ways,
- prefer one feature per user-facing artifact when that artifact is independently understandable.

Important rule for communication-heavy workflows:

- When multiple distinct emails exist, create separate issues per email when the stakeholder expects to scan them individually.
- If reminders are materially different behaviors, separate them.
- If button wiring or backend action handling is inseparable from a single email flow, either include it explicitly in the same feature or clearly state why it is split.

### 8.2 For Tasks

Use `Task` when the issue is implementation support, technical enablement, cleanup, refactor, migration, or internal reliability work.

Guidance:

- explain why this work matters to delivery, maintainability, reliability, or downstream execution,
- identify the systems touched,
- describe the dependency it unlocks,
- use current state vs target state if expected vs actual is awkward.

Important restriction:

- Do not use `Task` merely because the work is backend.
- If the work creates a recognizable business-facing capability, prefer `Feature`.

### 8.3 For Bugs

Use `Bug` when existing behavior is wrong.

Guidance:

- describe the broken behavior clearly,
- include at least one reproduction path,
- include expected behavior in observable terms,
- call out security, data integrity, or compliance risk when relevant.

---

## 9. Sizing and Splitting Work

To keep tickets manageable and sprint-friendly:

- each issue should represent one coherent unit of value or one coherent unit of technical change,
- each ticket should be completable by one developer in a single sprint,
- if a ticket describes multiple user-facing artifacts, split it,
- if a stakeholder wants to scan a list of distinct things, prefer one issue per distinct thing.

Split tickets when:

- they involve different emails,
- they affect different major views,
- they require different owner skills,
- they can ship independently,
- one part is blocked by product decisions while another part is not.

Examples of good splitting:

- separate approval email from feedback email,
- separate email template behavior from dashboard export behavior,
- separate Hermes import foundation from dashboard rendering work,
- separate bulk import handling from manual wizard handling.

---

## 10. Parent, Priority, Assignee, and Labels

### 10.1 Parent

For this project’s imported tickets:

- leave `Parent` blank for all `Feature`, `Task`, and `Bug` issues unless explicitly instructed otherwise.

### 10.2 Priority

Use Jira’s standard priority values:

- `Highest`
- `High`
- `Medium`
- `Low`
- `Lowest`

Rules:

- default to `Medium` when not specified,
- use `High` or `Highest` only for security, PII exposure, data integrity, severe workflow breakage, or urgent delivery-critical dependency,
- use `Low` or `Lowest` for minor polish, low-impact cleanup, or non-urgent technical debt.

### 10.3 Assignee

- Leave `Assignee` blank unless explicitly provided.

### 10.4 Labels

Labels help identify domain, surface, and concern.

Guidelines:

- use short, lower-case labels,
- add 1–4 labels per issue,
- align labels to existing product vocabulary when possible.

Recommended label types:

- **Domain or system:** `dashboard`, `api`, `analytics`, `engagement-stream`, `hermes`, `auth`, `communities`, `recruiting`
- **Artifact or flow:** `email`, `approval`, `feedback`, `import`, `export`, `wizard`
- **Concern:** `reporting`, `security`, `ui`, `performance`, `compliance`
- **Type marker:** `change-request`

Important rule:

- Labels should support filtering, but the issue summary must still make sense without relying on labels alone.

---

## 11. CEO Readability Check

Before finalizing any ticket, apply this review:

1. Can a non-technical stakeholder understand the summary without opening code or comments?
2. Can they tell which visible workflow, email, page, or process this belongs to?
3. Can they recognize their original request inside the description?
4. Can they tell whether this ticket covers the thing they asked for?
5. If they scan a list of similar issues, can they distinguish them quickly?

If the answer to any of these is no, rewrite the summary, original request, overview, or ticket interpretation.

---

## 12. Output Requirements for Agents

When generating Jira CSV content for this project:

1. Use only `Feature`, `Task`, or `Bug` as `Issue Type`.
2. Produce a CSV with the header row:
   - `Issue Type,Summary,Description,Parent,Priority,Assignee,Labels`
3. For each row:
   - choose the appropriate `Issue Type`,
   - write a concise, stakeholder-readable, single-focus `Summary`,
   - write a structured `Description` using the required section order,
   - preserve the original request in clear, non-technical language,
   - include a clear ticket interpretation,
   - leave `Parent` blank unless otherwise directed,
   - set `Priority` realistically, defaulting to `Medium` when unspecified,
   - leave `Assignee` blank unless explicitly given,
   - add labels that identify domain, artifact, and concern, including `change-request` where applicable.
4. When asked specifically for CSV, return only the CSV content and no surrounding explanation.

---

## 13. Minimal Description Template

Use this template when generating issue descriptions:

```text
Original request
- [stakeholder wording or close paraphrase]

Overview (non-technical)
- [why this matters, who it affects, what improves]

Audience & surface
- Audience: [roles]
- Surface: [page, email, flow, API, import, dashboard, etc.]

Ticket interpretation
- [what this ticket includes]
- [what this ticket excludes, if important]

Problem / behavior
- [plain-language explanation of the issue or desired capability]

Part of the application
- [frontend files/modules]
- [backend endpoints/controllers/models/jobs]

Expected vs actual
- Expected: [target behavior]
- Actual: [current behavior]

Validation & tests
- Manual: [steps]
- API/integration: [checks]
- Automated: [test coverage]

Acceptance criteria
- [criterion 1]
- [criterion 2]
- [criterion 3]

Open questions / decisions
- [only if needed]
```

---

## 14. Final Reminder

A good Jira ticket for this project is not just technically complete.
It is also:

- recognizable to the stakeholder,
- clear to the developer,
- testable for QA,
- parseable for automation,
- scoped tightly enough to avoid ambiguity.

When forced to choose between technically clever wording and stakeholder-readable wording, prefer stakeholder-readable wording and then add the technical precision lower in the description.
