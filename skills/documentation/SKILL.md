---
name: documentation
description: "Leadership-ready package generator. Produces feature folders, requirements, user stories, and Jira-compliant CSV tickets. Use after /topia plan and before /topia build to get stakeholder approval."
metadata:
  author: skill-topia
  version: "1.0.0"
  layer: L2
  model: sonnet
  group: creation
  tools: "Read, Write, Glob"
  emit: jira.csv.ready, docs.package.complete
  listen: plan.ready, adversary.passed
---

# documentation

## Purpose

Bridges the gap between technical planning and organizational approval. This skill synthesizes the output of `idea` (Requirements) and `plan` (Blueprints) into a professional "Leadership Package". It ensures that stakeholders have a clear, non-technical view of the work while providing engineers with importable Jira tickets.

## Triggers

- User explicitly runs `/topia documentation`
- Automatically suggested after `plan` or `adversary`
- User asks for "Jira tickets", "CSV", or "stories"

## Calls (outbound)

- `idea` (L2): read `requirements.md` from feature folder
- `plan` (L2): read `plan.md` and phase files from feature folder
- `adversary` (L2): read `adversary-report.md` when available for risk summary

## Called By (inbound)

- `build` (L1): when leadership package needed before implementation
- `plan` (L2): when plan output needs stakeholder-ready artifacts
- User: `/topia documentation` direct invocation

## Workflow

### Phase 1: Context Intake
1. **Identify Target**: Locate the active feature folder in `.topia/features/<name>/`.
2. **Read Inputs**: 
   - Load `requirements.md` (from `idea`).
   - Load `plan.md` and phase files (from `plan`).
   - Load `adversary-report.md` (if available).

### Phase 2: User Story Generation
1. **Draft Stories**: Convert phase tasks into Agile User Stories.
2. **Format**: `As a <role>, I want to <action>, so that <value>`.
3. **Criteria**: Map each phase's Acceptance Criteria to its corresponding story.

### Phase 3: Jira CSV Generation
1. **Adhere to Standards**: Follow `docs/JIRA_CSV_INSTRUCTIONS.md` strictly.
2. **Map Fields**:
   - `Issue Type`: Map phases to `Feature` (user-facing) or `Task` (internal).
   - `Summary`: 10-15 word sentence case summary.
   - `Description`: Must include both non-technical and technical layers.
   - `Priority`: Set based on impact (default: `Medium`).
   - `Labels`: Add relevant domain/surface labels.
3. **Write File**: Save to `.topia/features/<name>/jira-tickets.csv`.

### Phase 4: Leadership Briefing
1. **Generate Brief**: Create `leadership-brief.md` in the feature folder.
2. **Include**:
   - **Executive Summary**: 2-sentence value proposition.
   - **Timeline**: Estimated phases.
   - **Risk Assessment**: Summary of findings from `adversary`.
   - **Proof of Quality**: Mention planned test coverage.

## Constraints

1. **Strict CSV Format**: The Jira CSV must NOT have markdown around it when emitted as a file.
2. **Stakeholder Language**: Descriptions in the "Overview" section must be devoid of jargon.
3. **No Code**: This skill generates documentation and metadata only; it does not implement features.
4. **Consistency**: Summary in CSV must match the intent of the corresponding phase in the plan.

## Done When

- Feature folder `.topia/features/<name>/` contains:
  - `user-stories.md`
  - `jira-tickets.csv` (RFC-4180 compliant)
  - `leadership-brief.md`
- Total ticket count matches the number of implementation phases.

## Sharp Edges

Known failure modes for this skill. Check these before declaring done.

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Generating tickets without `requirements.md` and `plan.md` present | CRITICAL | Phase 1 MUST locate both inputs; if missing, abort and tell user to run `topia:idea` + `topia:plan` first |
| Jira CSV not RFC-4180 compliant (unescaped commas, quotes, newlines inside fields) | CRITICAL | Quote every field; escape embedded `"` as `""`; verify with a CSV linter before declaring done |
| Markdown fences around the CSV file content | HIGH | Constraint 1 — the `.csv` file must be raw CSV, not wrapped in ```` ``` ````; only the *preview shown to the user* may be fenced |
| Phase count ≠ ticket count | HIGH | Done-When requires 1:1 mapping; missing or duplicate tickets break import |
| User stories that paraphrase code instead of stating user value | HIGH | Story format `As a <role>, I want <action>, so that <value>` — the *value* clause is mandatory and non-technical |
| Leadership brief contains technical jargon | MEDIUM | Constraint 2 — Overview/Executive Summary in stakeholder language; technical detail belongs in ticket Description, not the brief |
| Acceptance criteria copy-pasted from plan instead of restated for testers | MEDIUM | Each story's AC must be testable by a non-author; rewrite plan's HOW into GIVEN/WHEN/THEN |
| Skipping `adversary-report.md` when it exists | MEDIUM | Risk Assessment section in the brief loses signal if adversary findings are not summarized |
| Writing implementation code to satisfy a Jira field | HIGH | Constraint 3 — documentation only. If a field needs code-level detail, point to a file path, don't inline code |
| Stale tickets after plan revision | MEDIUM | If `plan.md` is regenerated, re-run documentation to keep ticket/phase parity |

## Output Format

```
LEADERSHIP PACKAGE — <feature-name>
===================================
Feature folder: .topia/features/<name>/

Artifacts:
- user-stories.md — Agile stories with acceptance criteria
- jira-tickets.csv — RFC-4180 import file (N tickets)
- leadership-brief.md — Executive summary, timeline, risks

Ticket summary:
| Phase | Issue Type | Summary |
| ...   | ...        | ...     |
```

## Cost Profile

~1000-2000 tokens input, ~1000 tokens output. Sonnet for professional writing quality.
