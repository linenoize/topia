---
name: architecture-mapper
description: "Reverse-engineer an unfamiliar or legacy codebase into a drillable, cross-linked architecture knowledge base — per repo or across a polyrepo. Use to map how a system starts, wires together, and flows; or to refresh those docs after code changes. Read-mostly: writes only under docs/, never application code."
metadata:
  author: topia
  version: "0.1.0"
  layer: L2
  model: opus
  group: knowledge
  tools: "Read, Glob, Grep, Write, Edit, Bash"
  emit: architecture.mapped, docs.updated
  listen: codebase.scanned
---

# architecture-mapper

## Purpose

Turn a codebase nobody fully understands into a **navigable knowledge base**:
how it boots, how actors enter, how requests flow through
route→middleware→service→data, what runs in the background, what integrations
exist, what the core entities and steel-threads are — every claim grounded in
`file:line` and labeled **confirmed / likely / speculative**. Output is a set
of **cross-linked** Markdown docs (anchor slugs + clickable Mermaid + a
`## Backlinks` section per file) so a human or a future agent can drill from a
steel-thread into a module into an entity without leaving the docs.

Stack-neutral by design: a generic scaffold + per-stack "hunt hints" selected
at run time. Stack-specific facts about a *particular* product are supplied as
an **applied profile**, never hard-coded into this skill.

## Triggers

- `/topia architecture-mapper` — full map (the run-all pipeline)
- `/topia architecture-mapper refresh` — incremental update after code changed (scoped off git history; the post-merge command)
- `/topia architecture-mapper index` | `report` — re-link / re-summarize only
- Called by `onboard` when a repo has no architecture docs yet
- Called by `audit` / `improve-architecture` when they need a current map

## Calls (outbound)

- `recon` / `scanner` (L2/L3): scan the repo for entry points, routes, models, jobs — do not reimplement scanning here
- `team` (L1): in a polyrepo, fan out one mapping stream per repo (optional, large targets)
- `journal` (L3): record unknowns / ADRs for genuinely opaque areas

## Called By (inbound)

- `onboard` (L1): when bootstrapping context for a repo with no docs
- `audit` (L2): to compute / refresh the architecture picture
- `improve-architecture` (L2): consumes the map as its starting point
- `build` (L1): when architecture docs are stale relative to changed code

## Data Flow

### Feeds Into →
- `improve-architecture` (L2): the module/entity map → refactor-candidate scoring
- `onboard` (L1): per-repo `CLAUDE.md` + `docs/architecture/` → session context
- `review` (L2): the steel-threads/connections → blast-radius reasoning

### Fed By ←
- `recon` / `scanner` (L2/L3): raw scan (entry points, routes, schemas, jobs) ← what the map is built from

## Workflow

**Full map** (`/topia architecture-mapper`) — runs the passes in order,
checkpointing into `docs/architecture/progress.md`; safe to resume:

1. bootstrap → repo-inventory → module-map
2. entry-trace → ui-surface-map → request-lifecycle
3. data-model-map → background-jobs → integrations-map
4. steel-threads → workflows → data-flow
5. flowchart → critic (link-health) → index → report

Pass logic lives in `references/passes/*.md`; per-stack hunt hints in
`references/stacks/*.md`; cross-link conventions in `references/conventions.md`.
For large/legacy targets: sample by directory, don't enumerate; checkpoint
after each pass; trust the filesystem as state (re-derive from the docs, not
from re-reading source).

**Refresh** (`/topia architecture-mapper refresh`) — incremental, scoped to
what changed (see `references/passes/refresh.md`):
- `git log -1 --format=%H -- docs/architecture` → last docs commit; diff to `HEAD`
- update only the docs whose subject changed; preserve anchors, labels, Backlinks
- if no source changed in range → report "docs already current" and stop

**Applied profile** — if the caller supplies a stack profile (e.g. a product's
repo map / connections / known smells), treat it as **input context**, not as
content to copy verbatim; verify its claims against current source before
restating them.

## Output Format

```
docs/architecture/
  INDEX.md          # hub + drill-down entry point
  repo-inventory.md  module-map.md  entry-points.md
  api-lifecycle.md   data-models.md  background-jobs.md  integrations.md
  ui-surface-map.md  steel-threads.md  workflows.md  data-flow.md
  system-flowchart.md  final-report.md  progress.md  unknowns.md
# + per-repo: CLAUDE.md (when mapping a single repo for onboarding)
```

## Returns

| Field | Type | Description |
|-------|------|-------------|
| `status` | enum | `MAPPED` / `REFRESHED` / `NO_CHANGES` / `BLOCKED` |
| `docs_written` | string[] | paths created or updated this run |
| `link_health` | object | `{ checked, broken }` from the critic pass |
| `unknowns` | string[] | opaque areas recorded in `unknowns.md` |

## Constraints

1. MUST be read-only on application code — write only under `docs/` (and a repo-root `CLAUDE.md` when explicitly mapping for onboarding). — _it documents, it doesn't change behavior._
2. MUST label every architectural claim **confirmed / likely / speculative** and cite `file:line`. — _ungrounded maps rot into fiction._
3. MUST keep product/stack-specific facts in an **applied profile**, never hard-coded in the skill. — _the skill is reusable; instances are not._
4. MUST scope `refresh` to changed code only; do not rewrite unchanged docs. — _smaller diffs review faster and avoid churn._
5. MUST NOT invent runtime behavior or apply pattern labels ("microservice", "CQRS", "hexagonal") without specific code evidence.
6. MUST follow the cross-link conventions (anchor slugs, clickable Mermaid ≥80% of addressable nodes, `## Backlinks`).

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| README claims trusted over code | HIGH | verify in source; README is a hint, not truth |
| Full re-map run on every small change | MEDIUM | use `refresh` mode; full map only when many areas moved |
| Cross-repo relative links that break when one repo is checked out alone | MEDIUM | reference siblings by designation (e.g. `org/repo`), not relative paths |
| Stack facts leaking into the generic skill | HIGH | applied profile only; never commit instance data into `references/` |

## Self-Validation

```
SELF-VALIDATION (run before emitting output):
- [ ] every doc ends with a ## Backlinks section
- [ ] all intra-doc anchor links resolve (run the critic/link-health pass)
- [ ] ≥80% of addressable Mermaid nodes carry a click directive
- [ ] no {{placeholder}} tokens remain in any generated file
- [ ] every non-trivial claim carries a confidence label + file:line
IF ANY check fails → fix before reporting done.
```

## Done When

- The pass set completed and `INDEX.md` + `final-report.md` exist (full map), OR only the changed docs were updated (refresh)
- Link-health pass reports 0 broken anchored links
- `unknowns.md` records anything genuinely opaque
- Structured report emitted (see Returns)

## Cost Profile

Full map: **high** (multi-pass; often parallel per-repo streams on a polyrepo) — opus.
Refresh: **low** (scoped to a git diff) — sonnet is sufficient.

**Scope guardrail:** Do not refactor or modify application code — only
produce or refresh documentation. Refactor opportunities go to
`improve-architecture`; this skill maps, it does not change.
