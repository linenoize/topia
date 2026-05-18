---
name: "web-vitals"
pack: "@Topia/ui"
description: "Core Web Vitals performance audit — measures LCP, CLS, FCP, TBT, INP, and Speed Index against Google thresholds. Identifies render-blocking resources, network dependency chains, layout shift culprits, missing preloads, caching gaps, and tree-shaking opportunities."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# web-vitals

Core Web Vitals performance audit — measures LCP, CLS, FCP, TBT, INP, and Speed Index against Google thresholds. Identifies render-blocking resources, network dependency chains, layout shift culprits, missing preloads, caching gaps, and tree-shaking opportunities. Framework-aware analysis for Next.js, Vite, SvelteKit, and Astro.

#### Workflow

**Step 1 — Detect build tooling and framework**
Read `package.json`, config files (`next.config.*`, `vite.config.*`, `svelte.config.*`, `astro.config.*`), and build scripts. Identify:
- Bundler: Webpack, Vite, Rollup, esbuild, Turbopack
- Framework: Next.js (App Router vs Pages), SvelteKit, Astro, Remix
- CSS strategy: Tailwind (content config), CSS Modules, global CSS
- Compression: gzip/brotli configuration
- Source maps: enabled in production? (should be external or disabled)

**Step 2 — Audit render-blocking resources**
Use Grep to scan HTML entry points and framework layouts for:
- `<link rel="stylesheet">` in `<head>` without `media` attribute — blocks first paint
- `<script>` tags without `async` or `defer` — blocks HTML parsing
- CSS `@import` chains — each import is a sequential network request
- Large inline `<style>` blocks (>50KB) — delays first paint

For each blocking resource, estimate impact: 0ms impact = note but don't prioritize. Focus on resources that delay FCP by >100ms.

**Step 3 — Analyze layout shift sources (CLS)**
Use Grep to find common CLS culprits:
- `<img>` and `<video>` without explicit `width` and `height` attributes — causes layout shift when media loads
- Dynamic content injection above the fold (`insertBefore`, `prepend`, or React `useState` toggling visibility)
- Web fonts without `font-display: swap` or `font-display: optional` — FOIT causes text layout shift
- Ads or embeds without reserved space (`aspect-ratio` or `min-height` on container)
- CSS animations that trigger layout (`top`, `left`, `width`, `height`) instead of composited properties (`transform`, `opacity`)

#### CLS Fix Patterns

```html
<!-- BEFORE: no dimensions → layout shift when image loads -->
<img src="/hero.jpg" alt="Hero" />

<!-- AFTER: explicit dimensions prevent CLS -->
<img src="/hero.jpg" alt="Hero" width="1200" height="630"
     class="w-full h-auto" loading="lazy" decoding="async" />
```

```css
/* Font display — prevent FOIT layout shift */
@font-face {
  font-family: 'Space Grotesk';
  src: url('/fonts/space-grotesk.woff2') format('woff2');
  font-display: swap; /* show fallback immediately, swap when loaded */
}

/* Reserve space for dynamic content */
.ad-container {
  min-height: 250px; /* match ad unit height */
  contain: layout;   /* prevent layout influence on siblings */
}
```

**Step 4 — Network dependency chain analysis**
Identify critical rendering path bottlenecks:
- **Waterfall chains**: Resource A loads → discovers Resource B → discovers Resource C. Each link adds latency. Fix with `<link rel="preload">` for critical assets.
- **Missing preconnects**: Third-party origins (fonts.googleapis.com, CDN, analytics) without `<link rel="preconnect">`. But verify the origin is actually used — unused preconnects waste connection resources.
- **Large payloads without compression**: JS/CSS bundles >100KB served without gzip/brotli. Check server response headers for `Content-Encoding`.
- **Duplicate requests**: Same resource fetched multiple times (common with CSS @import or uncoordinated dynamic imports).

```html
<!-- Preload critical resources discovered late in the waterfall -->
<link rel="preload" href="/fonts/inter-var.woff2" as="font"
      type="font/woff2" crossorigin />
<link rel="preload" href="/hero-image.webp" as="image"
      fetchpriority="high" />

<!-- Preconnect to third-party origins ACTUALLY used -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
```

**Step 5 — Tree-shaking and code splitting audit**
Check bundler configuration and import patterns:

| Issue | Detection | Fix |
|---|---|---|
| Barrel file re-exports break tree-shaking | `index.ts` with `export * from` or `export { A, B, C, ... }` importing everything | Import directly from source: `import { Button } from './Button'` not `from '.'` |
| `sideEffects: false` missing in package.json | Check `package.json` `sideEffects` field | Add `"sideEffects": false` (or list files with side effects like CSS imports) |
| No code splitting at route level | Framework routes without `React.lazy()` or `dynamic()` | Next.js does this automatically; Vite needs manual `React.lazy()` |
| Vendor chunk too large (>250KB) | Check build output for single large chunk | Configure `splitChunks` (Webpack) or `manualChunks` (Vite/Rollup) |
| CSS not purged | Tailwind without `content` config, or unused CSS classes shipping | Verify `tailwind.config.js` `content` paths cover all template files |

**Step 6 — Image optimization audit**
Scan for image-related performance issues:
- Serving JPEG/PNG when WebP/AVIF would save 30-60% bandwidth — check `<img>` `src` extensions
- Missing `loading="lazy"` on below-the-fold images
- Missing `fetchpriority="high"` on LCP image (hero image, above-the-fold banner)
- Images served at full resolution without responsive `srcset` — wastes bandwidth on mobile
- No `<picture>` element for art direction (different crops for mobile/desktop)

```html
<!-- Optimized responsive image with modern formats -->
<picture>
  <source srcset="/hero.avif" type="image/avif" />
  <source srcset="/hero.webp" type="image/webp" />
  <img
    src="/hero.jpg"
    alt="Product dashboard showing real-time analytics"
    width="1200" height="630"
    class="w-full h-auto"
    fetchpriority="high"
    decoding="async"
  />
</picture>

<!-- Below-the-fold: lazy load -->
<img src="/feature.webp" alt="..." loading="lazy" decoding="async"
     width="600" height="400" class="w-full h-auto" />
```

**Step 7 — Generate performance report**
Produce a structured report with Core Web Vitals thresholds:

```
Web Vitals Audit — [Project Name]
═══════════════════════════════════════
Thresholds (Good / Needs Improvement / Poor):
  LCP:  < 2.5s  / < 4.0s  / > 4.0s
  FCP:  < 1.8s  / < 3.0s  / > 3.0s
  CLS:  < 0.1   / < 0.25  / > 0.25
  INP:  < 200ms / < 500ms / > 500ms
  TBT:  < 200ms / < 600ms / > 600ms
  TTFB: < 800ms / < 1.8s  / > 1.8s

Top Issues (by estimated impact):
1. [HIGH] Hero image served as 2.4MB PNG — convert to WebP, save ~1.5MB
2. [HIGH] 3 render-blocking stylesheets in <head> — defer non-critical CSS
3. [MEDIUM] 4 images missing width/height — causes CLS on load
4. [MEDIUM] lodash imported wholesale — tree-shake or replace with lodash-es
5. [LOW] Font preconnect to unused origin — remove to free connection slot
```

#### Sharp Edges

| Failure Mode | Mitigation |
|---|---|
| Recommending image lazy-load on LCP element | Never lazy-load the LCP image — it must load eagerly with `fetchpriority="high"` |
| Flagging render-blocking CSS that's actually critical | Distinguish critical (above-fold) CSS from non-critical before recommending defer |
| Tree-shaking audit false positives on CSS-in-JS | CSS `import './styles.css'` is a side effect — don't flag as unused |
| Preconnect removal breaks actual resource loading | Always verify zero requests went to the origin before recommending removal |
