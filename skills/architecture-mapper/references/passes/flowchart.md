> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Compose a unified, drillable system flowchart for this detected stack (from stack profile) codebase by stitching together the per-layer diagrams from earlier passes.

Arguments: $ARGUMENTS

This is a pure **composition** pass. It does not re-analyze code — it reads the architecture docs already produced and composes their findings into one navigable diagram file.

## Prerequisites

This command assumes earlier passes produced at least:

- `docs/architecture/module-map.md`
- `docs/architecture/entry-points.md`
- `docs/architecture/data-models.md`

And optionally (used if present):

- `docs/architecture/ui-surface-map.md` (frontend present)
- `docs/architecture/background-jobs.md`
- `docs/architecture/integrations.md`
- `docs/architecture/steel-threads.md`
- `docs/architecture/data-flow.md`

If none of the required files exist, write a short `docs/architecture/system-flowchart.md` noting the prerequisite gap and stop.

## Tasks

1. Read every available architecture doc in `docs/architecture/`.
2. Extract the addressable nodes (anchor slugs) for: UI widgets, endpoints, modules, entities, jobs, integrations.
3. Compose:
   - **Top-level system flowchart** (`flowchart LR`). Shows all major layers as subgraphs — UI, API, Services, Data, Async, Integrations — with arrows between layers representing actual connections found in the other docs. Target 30-60 nodes; if more, sample the highest-value ones and note the sampling.
   - **Per-entity overlay diagrams** — for the 3-5 most important entities (`references/passes/data-model-map.md` flags these), one `flowchart LR` each showing every path that reads or writes that entity.
   - **Per-steel-thread mini-flowcharts** — condensed `flowchart LR` views of the top 3-5 steel threads, one per thread, using the same slug nodes so they compose visually with the top-level diagram.
4. Every node in every diagram uses the canonical slug and emits a `click` directive per `CLAUDE.md` — no exceptions.
5. Write `docs/architecture/system-flowchart.md`.

## Output structure

```markdown
# System flowchart

_Composite of all earlier architecture passes. Click any node to jump to its canonical entry._

## Top-level system view
<mermaid flowchart LR with subgraphs: UI, API, Services, Data, Async, Integrations>

## Per-entity views
### entity-{name} {#view-entity-{name}}
<mermaid flowchart LR — every path that touches this entity>

## Steel-thread views
### thread-{slug} {#view-thread-{slug}}
<condensed flowchart for this thread>

## Gaps
_Nodes present in other docs but not traceable to this diagram, and why._

## Backlinks
_Other docs that should link back here: INDEX.md, final-report.md, steel-threads.md._
```

## Rules

- **No new analysis.** If a connection isn't already in one of the architecture docs, don't invent it for the diagram. Flag it in the Gaps section instead.
- **Click directives are mandatory** on every slug node. A node without a click target means the thing isn't in its canonical file yet — fix the canonical file first, then add the node.
- **Sample the top-level.** 200 nodes is unreadable. Pick the 30-60 that best represent the system; note the sampling strategy at the top of the diagram.
- **Subgraphs mirror CLAUDE.md's mission categories.** UI → API → middleware → controllers → services → data → async → integrations. Keep layers left-to-right.
- Confidence per connection isn't shown in the diagram (it would be noise), but note any deliberately omitted low-confidence connection in the Gaps section.
