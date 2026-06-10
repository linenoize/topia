> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
Inventory the UI surface of this detected stack (from stack profile) application — every widget, button, form, table, and action a user can interact with — and trace each one all the way to data.

Arguments: $ARGUMENTS

Tasks:
1. Read:
   - `CLAUDE.md`
   - `docs/architecture/progress.md`
   - `docs/architecture/entry-points.md`
   - `docs/architecture/module-map.md` (if present)
   - `docs/architecture/data-models.md` (if present)
2. If this stack has no frontend (check CLAUDE.md stack summary and the `(read UI_SURFACE_HINTS from the active stack profile)` block below), write a minimal `docs/architecture/ui-surface-map.md` stating "No UI surface detected — this stack is headless" with evidence, then stop.
3. Otherwise, inventory the UI surface using the hints below. For each UI element, capture:
   - **page / route** it lives on
   - **element type** (button, form, table, list, card, modal, drawer, nav item, etc.)
   - **action triggered** (emit, submit, navigate, mutation)
   - **handler** (file + function)
   - **endpoint(s) called** — cross-link to `entry-points.md#endpoint-...`
   - **service / module involved** — cross-link to `module-map.md#module-...`
   - **entities read / written** — cross-link to `data-models.md#entity-...`
   - **side effects** (navigation, toast, modal open, socket emit, analytics)

## Stack-specific UI hints

(read UI_SURFACE_HINTS from the active stack profile)

## Output

Write `docs/architecture/ui-surface-map.md` with these sections:

### Page catalog

Table of all pages/routes. Each row: route path, page component, primary purpose, key widgets on it (link to their widget anchors).

### Widget catalog

One subsection per widget, using the anchor `### Widget name {#widget-{page}-{name}}`. Include:
- element type and what it displays
- what the user can do with it
- full trace: widget → handler → endpoint → service → entity
- evidence (file paths and line numbers for each hop)
- confidence label

### UI → data summary table

A single flat table: widget slug | triggers | endpoint | service | entity. This is the "quick answer" view of the map and becomes a primary input to `references/passes/flowchart.md`.

### Mermaid overview

One `flowchart LR` grouping pages → widgets → endpoints (sampled — include the 10–15 highest-traffic or highest-value widgets, not all of them). Every node uses the slug ID and a `click` directive per the cross-linking conventions in `references/conventions.md`.

Example diagram shape:

```mermaid
flowchart LR
  subgraph Dashboard
    widget-dashboard-revenue-card
    widget-dashboard-orders-table
  end
  widget-dashboard-revenue-card --> endpoint-get-api-metrics-revenue
  widget-dashboard-orders-table --> endpoint-get-api-orders
  endpoint-get-api-metrics-revenue --> module-metrics --> entity-order
  endpoint-get-api-orders --> module-orders --> entity-order
  click widget-dashboard-revenue-card "./ui-surface-map.md#widget-dashboard-revenue-card"
  click endpoint-get-api-metrics-revenue "./entry-points.md#endpoint-get-api-metrics-revenue"
  click module-metrics "./module-map.md#module-metrics"
  click entity-order "./data-models.md#entity-order"
```

### Backlinks

List which steel threads, workflows, and entry-points files reference these widgets.

## Rules

- Evidence-first: cite the file + function for every widget, handler, and endpoint mapping. No invented clicks.
- Group by page, not by element type. A user's mental model is page-first.
- If a widget is decorative or navigation-only (no API call, no mutation), note it briefly but don't bulk out the catalog with it.
- If the UI is a separate repository (common with SPAs + backend APIs), say so and scope this doc to the parts you can see.
- Confidence labels on every entry: **confirmed** if you traced the full handler, **likely** if the binding is conventional but unverified, **speculative** if inferred from naming only.
