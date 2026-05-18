---
name: "design-decision"
pack: "@Topia/ui"
description: "Product domain → style mapping. Given a product category, outputs a complete design recommendation: visual style, palette, typography pairing, component aesthetic, and a design-system.md scaffold."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# design-decision

Product domain → style mapping. Given a product category, outputs a complete design recommendation: visual style, palette, typography pairing, component aesthetic, and a `design-system.md` scaffold. Bridges the gap between "I need to build a UI" and "I know exactly what it should look like."

#### Workflow

**Step 1 — Classify product domain**
Read `CLAUDE.md`, `README.md`, or ask: "What problem does this product solve? Who uses it?" Map to one of the 9 domains below.

**Step 2 — Recommend style stack**
Apply the domain → style matrix. Output: visual style name, palette slug, typography pairing, component aesthetic, and 3 reference patterns to avoid ("do NOT do X").

**Step 3 — Generate design-system.md**
Emit a `design-system.md` file in the project root (or `.topia/`) with: color tokens (CSS custom properties), font pairing (Google Fonts link), spacing scale, component aesthetic rules, and anti-patterns for this domain.

#### Domain → Style Matrix

The matrix below provides default mappings. When `references/ui-pro-max-data/styles.csv` is available, query it for **84 additional styles** with industry-specific parameters — filter by domain column for expanded recommendations beyond these 10 defaults.

```
Domain            Style              Palette              Typography         Component Aesthetic
─────────────────────────────────────────────────────────────────────────────────────────────
Fintech/Trading   Dark + Precision   midnight-profit      Space Grotesk+Mono  Dense tables, data overlays
Healthcare        Clean + Calm       clean-clinic         DM Sans+DM Serif    Rounded, soft, spacious
Education         Warm + Friendly    warm-academy*        Fredoka+Nunito       Illustrated, playful cards
Gaming            Dark + Neon        neon-arena           Rajdhani+Exo 2      Hard edges, glow effects
Ecommerce         Trust + Focused    trust-cart           Inter+Inter          Product-first, clean CTA
SaaS/Dashboard    Precision + Flex   slate-precision      Space Grotesk+Inter  Data-dense, sidebar nav
Social/Community  Vibrant + Engaged  gradient-social*     Inter+Inter          Avatar-heavy, reaction UX
News/Content      Readable + Neutral neutral-ink*         Playfair+Source Serif Wide columns, drop caps
Productivity      Minimal + Calm     calm-focus*          Inter+Inter (weight) Almost no decoration
DevTools          Terminal + Crisp   terminal-dark        JetBrains Mono+Inter Code blocks, mono emphasis

* Palette not shown in palette-picker example block — generate with same CSS custom props pattern.
```

#### Extended Data (UI/UX Pro Max)

When `references/ui-pro-max-data/` exists:
- `styles.csv` — 84 styles with color params, animation, WCAG levels, mobile flags
- `typography.csv` — 73 font pairings with Google Fonts URLs, Tailwind config, mood keywords
- `ui-reasoning.csv` — 161 industry-specific reasoning rules (filter by domain)
- Query: filter CSV by domain/category column → get expanded recommendations

#### Style Characteristic Reference

```
glassmorphism    When: premium SaaS landing, dark bg hero. Avoid: dense data tables (illegible).
                 CSS: background: rgba(255,255,255,0.05); backdrop-filter: blur(12px);
                      border: 1px solid rgba(255,255,255,0.1); border-radius: 16px;

neubrutalism     When: bold brand statement, startup, creative tool. Avoid: healthcare, finance.
                 CSS: border: 2px solid #000; box-shadow: 4px 4px 0 #000;
                      background: #ffe600; (or other saturated fill)

claymorphism     When: education, kids, consumer apps. Avoid: enterprise, B2B data tools.
                 CSS: border-radius: 20px; box-shadow: 0 8px 0 rgba(0,0,0,0.15),
                      inset 0 -4px 0 rgba(0,0,0,0.1); (inflated, soft look)

aurora/gradient  When: landing page hero ONLY, used sparingly. AVOID as overall theme.
                 CSS: background: conic-gradient(from 180deg at 50% 50%, ...); opacity: 0.15;
                      (subtle, behind content — never the main visual)

flat/minimal     When: productivity, devtools, content. Best default for B2B SaaS.
                 CSS: No shadows except --shadow-sm. Single accent color. Whitespace-heavy.

dark-precision   When: fintech, devtools, monitoring. Default dark bg with high-contrast accents.
                 CSS: bg #0f172a or darker; mono fonts for data; green/red semantic signals.
```

#### Example — Generated design-system.md

```markdown
# Design System: [Product Name]

## Domain
SaaS Dashboard — B2B productivity tool for engineering teams

## Visual Style
Flat/Minimal with Slate Precision palette. Dark mode default.
Do NOT use gradient blobs, glassmorphism panels, or Lucide icons.

## Color Tokens
[→ See palette.css — generated by palette-picker, slate-precision]

## Typography
Pairing: Space Grotesk (headings, 600–700) + Inter (body, 400–500)
[→ See Google Fonts link in type-system output]

## Component Rules
- Cards: bg-card + border border-[var(--border)] + rounded-lg. NO drop shadows on cards.
- Buttons: primary = bg-primary text-white. ghost = border + transparent bg.
- Icons: Phosphor Icons only. Weight: regular for UI, fill for status indicators.
- Data tables: zebra stripe with bg-elevated on odd rows. Mono font for numbers.

## Anti-Patterns for This Domain
- No centered hero with 2-button CTA
- No gradient backgrounds
- No uniform card grid (vary card sizes by content importance)
```
