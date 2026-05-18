---
name: "type-system"
pack: "@Topia/ui"
description: "Typography pairing database — 22 font pairings organized by product vibe. Each pairing includes Google Fonts URL, Tailwind config, size scale from display to caption, weight mapping, and line height ratios."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# type-system

Typography pairing database — 22 font pairings organized by product vibe. Each pairing includes Google Fonts URL, Tailwind config, size scale from display to caption, weight mapping, and line height ratios. Decision tree maps product type and tone to the right pairing.

#### Workflow

**Step 1 — Detect product tone**
Read `CLAUDE.md` or ask: "What is the product tone?" Classify: modern-tech | editorial | playful | corporate | developer | luxury | humanist | brutalist | minimal.

**Step 2 — Recommend pairing**
Apply the decision tree. Output the top 2 pairings with rationale (brand signal, readability score, Google Fonts load weight).

**Step 3 — Generate @font-face / config**
Emit the `<link>` preconnect + stylesheet tag for Google Fonts. Emit Tailwind `fontFamily` config. Emit a CSS type scale (`--text-display` through `--text-caption`).

**Step 4 — Verify readability**
Check: body size ≥ 14px, line-height ≥ 1.5 for body, ≤ 1.25 for headings. Flag any contrast failure using the project's background token.

#### Decision Tree

```
Product Tone          → Pairing
──────────────────────────────────────────────────────────
modern tech / saas    → Space Grotesk + Inter
editorial / blog      → Playfair Display + Source Serif 4
playful / kids / app  → Fredoka + Nunito
corporate / enterprise→ IBM Plex Sans + IBM Plex Serif
developer tools / CLI → JetBrains Mono + Inter
luxury / fashion      → Cormorant Garamond + Montserrat
humanist / health     → DM Sans + DM Serif Display
brutalist / bold      → Bebas Neue + IBM Plex Mono
minimal / productivity→ Inter + Inter (weight-only hierarchy)
gaming / esports      → Rajdhani + Exo 2
```

#### Pairing Reference

```html
<!-- Space Grotesk + Inter (modern-tech / saas) -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">

<!-- Playfair Display + Source Serif 4 (editorial) -->
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,400&family=Source+Serif+4:wght@400;600&display=swap" rel="stylesheet">

<!-- Fredoka + Nunito (playful) -->
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&family=Nunito:wght@400;600&display=swap" rel="stylesheet">

<!-- IBM Plex Sans + IBM Plex Serif (corporate) -->
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600&display=swap" rel="stylesheet">

<!-- JetBrains Mono + Inter (developer tools) -->
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">

<!-- Cormorant Garamond + Montserrat (luxury) -->
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,400&family=Montserrat:wght@400;500;700&display=swap" rel="stylesheet">

<!-- DM Sans + DM Serif Display (humanist / health) -->
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Serif+Display&display=swap" rel="stylesheet">
```

```css
/* Type scale — Space Grotesk + Inter pairing */
:root {
  --font-display:  'Space Grotesk', system-ui, sans-serif;
  --font-body:     'Inter', system-ui, sans-serif;
  --font-mono:     'JetBrains Mono', monospace;

  /* Scale */
  --text-display:  clamp(2.5rem, 5vw, 4.5rem); /* 40–72px */
  --text-h1:       clamp(2rem,   4vw, 2.5rem);  /* 32–40px */
  --text-h2:       clamp(1.375rem, 2.5vw, 1.75rem); /* 22–28px */
  --text-h3:       1.125rem;  /* 18px */
  --text-body:     1rem;      /* 16px */
  --text-small:    0.875rem;  /* 14px */
  --text-caption:  0.75rem;   /* 12px */

  /* Leading */
  --leading-tight:  1.2;
  --leading-snug:   1.35;
  --leading-normal: 1.5;
  --leading-relaxed:1.75;
}

h1, h2, h3 { font-family: var(--font-display); line-height: var(--leading-tight); }
body        { font-family: var(--font-body);    line-height: var(--leading-normal); }
code, pre   { font-family: var(--font-mono); }

/* Financial numbers — always mono + bold */
.number, .price, .stat {
  font-family: var(--font-mono);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
```

```js
// tailwind.config.js — font pairing extension
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        display: ['Space Grotesk', 'system-ui', 'sans-serif'],
        body:    ['Inter',         'system-ui', 'sans-serif'],
        mono:    ['JetBrains Mono','monospace'],
      },
      fontSize: {
        'display': ['clamp(2.5rem, 5vw, 4.5rem)', { lineHeight: '1.1' }],
        'h1':      ['clamp(2rem, 4vw, 2.5rem)',   { lineHeight: '1.2' }],
        'h2':      ['1.75rem',  { lineHeight: '1.3' }],
        'h3':      ['1.125rem', { lineHeight: '1.4' }],
      }
    }
  }
}
```
