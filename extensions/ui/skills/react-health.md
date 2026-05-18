---
name: "react-health"
pack: "@Topia/ui"
description: "React codebase health scoring — 0-100 health score across 6 dimensions: state management, effects hygiene, performance patterns, architecture, bundle efficiency, and accessibility."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# react-health

React codebase health scoring — 0-100 health score across 6 dimensions: state management, effects hygiene, performance patterns, architecture, bundle efficiency, and accessibility. Detects anti-patterns that automated linters miss, quantifies technical debt, and produces a prioritized fix list.

#### Workflow

**Step 1 — Detect framework and React version**
Read `package.json` to identify: React version (17/18/19), framework (Next.js, Vite, Remix, Astro), compiler status (`react-compiler` or `babel-plugin-react-compiler`), and styling approach (Tailwind, CSS Modules, styled-components). Framework context changes which rules apply — Next.js has App Router-specific patterns, Vite has different chunking strategies.

**Step 2 — State and effects audit**
Use Grep to scan for these anti-patterns across all `*.tsx`, `*.jsx` files:

| Anti-Pattern | Grep Pattern | Why It's Bad |
|---|---|---|
| Derived state in useState | `useState.*=.*props\.` or `useEffect.*setState` that mirrors a prop | Causes sync bugs — compute during render instead |
| Unnecessary effects for data transform | `useEffect.*setState.*filter\|map\|reduce` | Runs after render for no reason — move to useMemo or compute inline |
| Missing cleanup in effects | `useEffect` without `return () =>` when subscribing | Memory leaks on unmount (WebSocket, intervals, event listeners) |
| State for ref-appropriate values | `useState` tracking DOM measurements, timers, previous values | Causes unnecessary re-renders — use useRef |
| Prop drilling > 3 levels | Component chains passing the same prop through 3+ files | Extract to Context or Zustand store |
| God component > 300 lines | Component files exceeding 300 LOC | Split into composed smaller components |

Score: count violations, weight by severity (critical=5, high=3, medium=1), calculate percentage against total component count.

**Step 3 — Dead code detection**
Scan for unused exports, orphaned files, and dead types:
- **Unused exports**: Use Grep to find all `export` declarations, then cross-reference with import statements across the codebase. Any export not imported anywhere (excluding entry points and barrel files) is dead.
- **Orphan files**: Use Glob to find all `.tsx`/`.ts` files, then check which are never imported. Exclude test files, config files, and entry points.
- **Duplicate components**: Find components with similar names or identical prop interfaces that could be consolidated.
- **Barrel file bloat**: Flag `index.ts` files that re-export everything — these break tree-shaking and increase bundle size.

**Step 4 — Bundle efficiency audit**
Check for common bundle bloat patterns:
- **Wholesale imports**: `import _ from 'lodash'` instead of `import groupBy from 'lodash/groupBy'` — can add 70KB+ to bundle
- **Moment.js usage**: Flag any `import moment` — suggest `date-fns` or `dayjs` (moment is 300KB with locales)
- **Icon library imports**: `import { Icon } from 'react-icons'` importing the full set — use specific pack imports
- **Missing dynamic imports**: Large components (charts, editors, modals) loaded eagerly — should use `React.lazy()` or Next.js `dynamic()`
- **Polyfill sprawl**: Check `browserslist` or `@babel/preset-env` targets — modern-only targets can drop 20-50KB of polyfills
- **CSS-in-JS runtime cost**: Flag `styled-components` or `@emotion/styled` in performance-critical paths — suggest extraction or Tailwind

**Step 5 — Performance patterns check**
Scan for React-specific performance issues:
- `React.memo` wrapping components that receive new object/array literals as props (memo is useless with `style={{}}` or `data={[...]}}`)
- Missing `key` prop on list items, or using array index as key on dynamic lists
- Inline function creation in JSX (`onClick={() => fn(id)}`) inside large lists (>50 items) without `useCallback`
- `useEffect` with missing dependencies (lint-suppressed with `// eslint-disable-next-line`)
- Context providers wrapping the entire app when only a subtree needs them (causes full-app re-renders)
- Unvirtualized lists rendering >50 items — flag for `@tanstack/react-virtual` or `react-window`

**Step 6 — Generate health report**
Produce a structured health report with scores:

```
React Health Report — [Project Name]
═══════════════════════════════════════
Overall Score: 72/100 (Needs work)

Dimension          Score   Issues Found
─────────────────────────────────────
State/Effects      65/100  3 derived states, 2 missing cleanups
Performance        78/100  1 unvirtualized list, barrel file bloat
Architecture       80/100  1 god component (412 lines)
Bundle Efficiency  60/100  lodash wholesale import, no dynamic imports
Dead Code          85/100  4 unused exports, 1 orphan file
Accessibility      70/100  6 icon buttons missing aria-label

Score Tiers: 75+ Great │ 50-74 Needs Work │ <50 Critical

Top 5 Fixes (by impact):
1. [CRITICAL] Replace lodash wholesale import → save ~70KB
2. [HIGH] Add React.lazy() to ChartPanel and RichEditor
3. [HIGH] Extract derived state from useEffect in UserList
4. [MEDIUM] Virtualize TransactionTable (renders 200+ rows)
5. [MEDIUM] Remove 4 unused exports in utils/
```

#### Sharp Edges

| Failure Mode | Mitigation |
|---|---|
| False positives on "unused exports" in library packages | Exclude files matching `package.json` `main`/`exports` entry points |
| Barrel file detection flags intentional public API re-exports | Only flag barrel files in `src/` not in package root |
| God component count includes generated files | Exclude files matching `*.generated.*`, `*.auto.*` patterns |
