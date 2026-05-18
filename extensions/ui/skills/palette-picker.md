---
name: "palette-picker"
pack: "@Topia/ui"
description: "Color palette database organized by product type. 25 curated palettes covering fintech, healthcare, education, gaming, ecommerce, SaaS, social, news/content, productivity, and developer tools — each with CSS custom properties, Tailwind config extension, dark/light variants, and colorblind-safe alternatives."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# palette-picker

Color palette database organized by product type. 25 curated palettes covering fintech, healthcare, education, gaming, ecommerce, SaaS, social, news/content, productivity, and developer tools — each with CSS custom properties, Tailwind config extension, dark/light variants, and colorblind-safe alternatives.

#### Workflow

**Step 1 — Detect product type**
Read `CLAUDE.md`, `README.md`, or ask: "What does this product do?" Classify into one of: fintech | healthcare | education | gaming | ecommerce | saas | social | news-content | productivity | devtools.

**Step 2 — Recommend palette**
Apply the decision tree below. Output the top 2 palette candidates with rationale (mood, contrast profile, brand signal).

**Step 3 — Generate token file**
Emit `palette.css` with CSS custom properties for the chosen palette. Include both dark and light variants. Include Tailwind `theme.extend.colors` block.

**Step 4 — Verify contrast ratios**
Run contrast checks: primary text on background (≥ 4.5:1), large headings (≥ 3:1), interactive elements on their backgrounds. Flag any failure. Substitute colorblind-safe alternative if requested.

#### Decision Tree

The tree below provides 10 default palettes. When `references/ui-pro-max-data/colors.csv` is available, query it for **161 industry-specific palettes** with full dark/light variants, semantic tokens, and design psychology notes. Filter by domain column for expanded options.

```
Product Type          → Palette Recommendation
─────────────────────────────────────────────────
fintech / trading     → Midnight Profit (dark bg + green/red signals)
healthcare            → Clean Clinic (white/teal, high readability)
education / kids      → Warm Academy (amber/orange, approachable)
gaming                → Neon Arena (dark + electric cyan/magenta)
ecommerce             → Trust Cart (white + amber CTA + forest green)
saas / dashboard      → Slate Precision (slate-900 + blue-500 accents)
social / community    → Gradient Social (slate + violet/fuchsia gradient)
news / content        → Neutral Ink (off-white + near-black, serif-ready)
productivity / tools  → Calm Focus (gray-50 + indigo-700, minimal noise)
developer tools       → Terminal Dark (zinc-950 + emerald-400 mono)
```

#### Extended Palette DB (UI/UX Pro Max)

When `references/ui-pro-max-data/colors.csv` exists:
- 161 palettes with Primary, Secondary, Accent, Background, Foreground (dark+light)
- Semantic tokens: Card, Muted, Border, Destructive, Ring variants
- Design psychology notes per palette
- Query: `grep -i "<domain>" references/ui-pro-max-data/colors.csv` → get domain-matched palettes
- Anti-AI check: if selected palette uses #6366f1 (indigo) or #8b5cf6 (violet) as primary → flag and suggest alternatives from DB

#### Palette Reference

```css
/* ── PALETTE: Midnight Profit (Fintech/Trading) ─────────────── */
[data-palette="midnight-profit"][data-theme="dark"] {
  --bg-base:        #0c1419;
  --bg-card:        #121a20;
  --bg-elevated:    #1a2332;
  --text-primary:   #ffffff;
  --text-secondary: #a0aeb8;
  --border:         #2a3f52;
  --profit:         #00d084;   /* green — gains */
  --loss:           #ff6b6b;   /* red — losses */
  --accent:         #2196f3;
  /* Colorblind (deuteranopia): profit→#1e88e5, loss→#ffa726 */
}
[data-palette="midnight-profit"][data-theme="light"] {
  --bg-base:        #faf8f3;
  --bg-card:        #f5f0ea;
  --text-primary:   #0c1419;
  --text-secondary: #4a5568;
  --border:         #d1cfc9;
  --profit:         #059669;
  --loss:           #dc2626;
  --accent:         #1d4ed8;
}

/* ── PALETTE: Clean Clinic (Healthcare) ─────────────────────── */
[data-palette="clean-clinic"] {
  --bg-base:        #f0fafa;
  --bg-card:        #ffffff;
  --text-primary:   #0d1f2d;
  --text-secondary: #4b6070;
  --border:         #c7e8ea;
  --primary:        #0891b2;   /* cyan-600 */
  --secondary:      #0d9488;   /* teal-600 */
  --accent:         #06b6d4;
  --danger:         #ef4444;
  --success:        #16a34a;
}

/* ── PALETTE: Slate Precision (SaaS/Dashboard) ───────────────── */
[data-palette="slate-precision"][data-theme="dark"] {
  --bg-base:        #0f172a;
  --bg-card:        #1e293b;
  --bg-elevated:    #334155;
  --text-primary:   #f8fafc;
  --text-secondary: #94a3b8;
  --primary:        #3b82f6;   /* blue-500 */
  --success:        #10b981;
  --danger:         #ef4444;
  --warning:        #f59e0b;
}
[data-palette="slate-precision"][data-theme="light"] {
  --bg-base:        #ffffff;
  --bg-card:        #f8fafc;
  --bg-elevated:    #f1f5f9;
  --text-primary:   #0f172a;
  --text-secondary: #475569;
  --primary:        #2563eb;
}

/* ── PALETTE: Neon Arena (Gaming) ────────────────────────────── */
[data-palette="neon-arena"] {
  --bg-base:        #080c10;
  --bg-card:        #0f1520;
  --text-primary:   #e8f4f8;
  --text-secondary: #7a9ab0;
  --primary:        #00ffe0;   /* electric cyan */
  --secondary:      #ff2d78;   /* hot magenta */
  --accent:         #ffe600;   /* warning yellow */
  --border:         rgba(0, 255, 224, 0.15);
}

/* ── PALETTE: Trust Cart (Ecommerce) ─────────────────────────── */
[data-palette="trust-cart"][data-theme="light"] {
  --bg-base:        #ffffff;
  --bg-card:        #fafafa;
  --text-primary:   #111827;
  --text-secondary: #6b7280;
  --cta:            #f97316;   /* orange-500 — add-to-cart */
  --success:        #16a34a;   /* forest green — in stock */
  --trust:          #1d4ed8;   /* blue — secure badge */
  --border:         #e5e7eb;
}

/* ── PALETTE: Terminal Dark (Developer Tools) ────────────────── */
[data-palette="terminal-dark"] {
  --bg-base:        #09090b;   /* zinc-950 */
  --bg-card:        #18181b;   /* zinc-900 */
  --bg-elevated:    #27272a;   /* zinc-800 */
  --text-primary:   #fafafa;
  --text-secondary: #a1a1aa;
  --primary:        #34d399;   /* emerald-400 — code green */
  --accent:         #818cf8;   /* indigo-400 — links */
  --border:         #3f3f46;
  --comment:        #71717a;
}
```

```js
// tailwind.config.js — extending with palette tokens
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        profit:  'var(--profit)',
        loss:    'var(--loss)',
        primary: 'var(--primary)',
        'bg-base':  'var(--bg-base)',
        'bg-card':  'var(--bg-card)',
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
      }
    }
  }
}
```
