---
name: "@Topia/ui"
description: Frontend UI patterns — React health scoring, Core Web Vitals auditing, design systems, color palettes, typography, component architecture, landing page sections, accessibility audits, animation patterns, and design decision mapping.
metadata:
  author: skill-topia
  version: "0.3.0"
  layer: L4
  price: "$12"
  target: Frontend developers
  format: split
---

# @Topia/ui

> Design intelligence data: [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT) — 161 palettes, 84 styles, 73 font pairings, 99 UX guidelines. Located at `references/ui-pro-max-data/`.

## Purpose

Frontend development accumulates invisible debt: ad-hoc color variables, mismatched font pairings, prop-drilled components, untested accessibility, janky animations, React anti-patterns, and slow page loads — all before you even decide what the product should *look* like. This pack addresses all layers systematically. Ten skills cover the full UI lifecycle: React codebase health scoring, Core Web Vitals performance auditing, token consistency, color palette selection, typography pairing, component composability, landing page structure, design-domain mapping, WCAG compliance, and motion polish. Run any skill independently or chain all ten as a comprehensive UI health check + design foundation generator.

**Anti-AI Design Contract** (enforced by all skills in this pack):
- NO gradient blob heroes (purple → pink → blue)
- NO default indigo/violet (#6366f1) unless it IS the brand color
- NO Lucide icons — use Phosphor Icons (`@phosphor-icons/react`) or Huge Icons
- NO uniform card grids — vary sizes, establish visual hierarchy
- NO centered hero formula (big title + subtitle + 2 buttons stacked)

## Triggers

- Auto-trigger: when `*.tsx`, `*.svelte`, `*.vue`, CSS/Tailwind files detected in project
- `/topia design-system` — generate or enforce design tokens
- `/topia palette-picker` — select a curated color palette by product type
- `/topia type-system` — select a typography pairing by product tone
- `/topia component-patterns` — refactor component architecture
- `/topia landing-patterns` — generate landing page section structure
- `/topia design-decision` — map product domain to full style recommendation
- `/topia a11y-audit` — run accessibility audit
- `/topia animation-patterns` — add or refine motion design
- `/topia react-health` — score React codebase health (0-100)
- `/topia web-vitals` — audit Core Web Vitals and performance
- Called by `build` (L1) when frontend task is detected
- Called by `review` (L2) when UI code is under review
- Called by `design` (L2) when visual design decisions needed

## Skills Included

| Skill | Model | Description |
|-------|-------|-------------|
| [react-health](skills/react-health.md) | sonnet | React codebase health scoring — 0-100 score across 6 dimensions: state management, effects hygiene, performance patterns, architecture, bundle efficiency, and accessibility. |
| [web-vitals](skills/web-vitals.md) | sonnet | Core Web Vitals performance audit — LCP, CLS, FCP, TBT, INP against Google thresholds. Identifies render-blocking resources, layout shift culprits, missing preloads, and tree-shaking opportunities. |
| [design-system](skills/design-system.md) | sonnet | Generate and enforce design system tokens — colors, typography, spacing, shadows, border radius. Consolidates ad-hoc values into a structured token file with full dark/light theme support. |
| [palette-picker](skills/palette-picker.md) | sonnet | Color palette database organized by product type. 25 curated palettes covering fintech, healthcare, education, gaming, ecommerce, SaaS, social, news/content, productivity, and developer tools. |
| [type-system](skills/type-system.md) | sonnet | Typography pairing database — 22 font pairings organized by product vibe. Each pairing includes Google Fonts URL, Tailwind config, size scale, weight mapping, and line height ratios. |
| [landing-patterns](skills/landing-patterns.md) | sonnet | Landing page section patterns — 12 section archetypes with HTML structure hints, Tailwind classes, responsive rules, and conversion-focused copy guidance. Anti-AI design rules enforced. |
| [design-decision](skills/design-decision.md) | sonnet | Product domain → style mapping. Outputs complete design recommendation: visual style, palette, typography pairing, component aesthetic, and design-system.md scaffold. |
| [component-patterns](skills/component-patterns.md) | sonnet | Component architecture patterns — compound components, render props, composition, slots. Detects prop-heavy components and guides refactoring toward composable architectures. |
| [a11y-audit](skills/a11y-audit.md) | sonnet | Accessibility audit beyond automated tools. Checks WCAG 2.1 AA compliance — focus management, screen reader compatibility, color contrast, ARIA patterns, keyboard navigation, focus traps. |
| [animation-patterns](skills/animation-patterns.md) | sonnet | Motion design patterns — micro-interactions, page transitions, scroll animations, loading states. CSS transitions, Framer Motion, or GSAP based on project stack. Always respects prefers-reduced-motion. |

## Tech Stack Support

| Framework    | Styling            | Components    | Motion              |
|--------------|--------------------|---------------|---------------------|
| React 19     | TailwindCSS 4      | shadcn/ui     | Framer Motion       |
| Next.js 16   | CSS Custom Props   | Radix UI      | Framer Motion       |
| SvelteKit 5  | CSS Custom Props   | Custom        | View Transitions API|
| Vue 3        | TailwindCSS 4      | Headless UI   | Vue Transitions     |
| Astro 5      | TailwindCSS 4      | Astro Islands | View Transitions API|

## Connections

```
Calls → asset-creator (L3): generate design assets (icons, illustrations)
Calls → design (L2): escalate when full design review is needed
Calls → perf (L2): react-health and web-vitals feed findings to perf for deeper analysis
Calls → verification (L3): react-health triggers verification after fix application
Called By ← review (L2): when UI code is being reviewed
Called By ← build (L1): when frontend task detected
Called By ← launch (L1): pre-launch UI quality gate
Called By ← scaffold (L1): when bootstrapping a new frontend project
Called By ← preflight (L2): react-health runs as pre-commit quality gate on React projects
design-decision → palette-picker: feeds palette slug to token generation
design-decision → type-system: feeds pairing name to font config generation
landing-patterns → palette-picker: pulls palette for section styling
landing-patterns → type-system: pulls font pairing for section copy
react-health → web-vitals: health report feeds into vitals audit for bundle-to-load correlation
web-vitals → react-health: slow LCP/TBT traces back to bundle bloat identified by react-health
```

## Constraints

1. MUST respect `prefers-reduced-motion` on every animation — no exceptions.
2. MUST NOT overwrite original component files during refactor — emit to `*.refactored.tsx` or provide a diff.
3. MUST target WCAG 2.1 AA as the minimum bar for all a11y recommendations (AAA where feasible).
4. MUST use project's existing stack (detect from `package.json`) before suggesting new dependencies.
5. MUST enforce Anti-AI design rules: no gradient blobs, no default indigo, Phosphor Icons not Lucide, no uniform card grids.
6. MUST use Google Fonts CDN only for external font loading — no other external font services.
7. Color palettes MUST include colorblind-safe alternatives (deuteranopia minimum).

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Token generation produces semantic tokens without primitives, causing theme switching to break | HIGH | Always emit 3-layer token structure: primitive → semantic → component |
| Compound component refactor breaks controlled state (open/value props lost) | HIGH | Audit for controlled vs uncontrolled patterns before emitting scaffold |
| axe-core misses ARIA live region issues and dynamic content violations | MEDIUM | Supplement automated scan with manual Grep for `setState`/store updates that modify visible content |
| Framer Motion animations ship without `useReducedMotion` check | HIGH | Grep for `motion.` usage post-edit; flag any missing the hook |
| Design token enforcement flags third-party library hardcoded values | LOW | Scope Grep to `src/` only; exclude `node_modules` and generated files |
| palette-picker recommends palette without contrast verification | HIGH | Always run contrast check in Step 4 before emitting palette.css |
| type-system recommends decorative font for body copy (Cormorant at 14px) | MEDIUM | Flag any pairing where body font is display/serif — warn readability at small sizes |
| landing-patterns emits centered hero formula (the anti-pattern) | HIGH | Enforce split-hero or asymmetric-hero as defaults; centered-hero requires explicit opt-in |
| design-decision recommends glassmorphism for data-dense dashboard | MEDIUM | Block glassmorphism recommendation when product domain is fintech, devtools, or productivity |
| Focus trap missing on modal — keyboard users trapped in page behind overlay | CRITICAL | a11y-audit Step 4 must scan all Dialog/Modal/Drawer/Popover components before audit closes |

## Done When

- React health score generated (0-100) with per-dimension breakdown; top 5 fixes listed by impact; dead code inventory complete
- Web Vitals report produced with all 6 metrics against thresholds; render-blocking resources identified; CLS culprits found; image optimization recommendations emitted
- Token file generated with 3-layer structure; hardcoded values replaced or flagged with diffs; dark/light theme switcher emitted
- Palette selected, CSS custom properties emitted, contrast ratios verified (≥ 4.5:1 body, ≥ 3:1 large text), colorblind alternatives noted
- Font pairing selected, Google Fonts link emitted, Tailwind fontFamily config emitted, type scale CSS variables written
- Component refactor scaffold emitted; original files untouched; slot patterns applied where applicable
- Landing section sequence composed; Anti-AI rules verified; responsive audit at 375/768/1280px complete; conversion checklist passed
- Design system .md generated with color, typography, component, and anti-pattern rules for the product domain
- Axe-core scan shows zero critical/serious violations; focus trap audit complete; skip nav link present
- All animations pass `prefers-reduced-motion` audit; page transition pattern implemented

## Cost Profile

~24,000–38,000 tokens per full pack run (all 10 skills). Individual skill: ~2,000–5,000 tokens. Sonnet default. Use haiku for detection scans (Step 1 of each skill); escalate to sonnet for generation, refactoring, and report writing. Use `design-decision` first when starting a new project — it reduces token cost of subsequent skills by pre-scoping palette and typography choices.
