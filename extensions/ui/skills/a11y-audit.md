---
name: "a11y-audit"
pack: "@Topia/ui"
description: "Accessibility audit beyond automated tools. Checks WCAG 2.1 AA compliance — focus management, screen reader compatibility, color contrast, ARIA patterns, keyboard navigation, focus traps, and skip navigation."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# a11y-audit

Accessibility audit beyond automated tools. Checks WCAG 2.1 AA compliance — focus management, screen reader compatibility, color contrast, ARIA patterns, keyboard navigation, focus traps, and skip navigation.

#### Workflow

**Step 1 — Automated scan**
Run `Bash: npx axe-core-cli <url> --reporter json` to capture all automated violations. Parse the JSON output and group by impact: critical → serious → moderate → minor.

**Step 2 — Manual WCAG 2.1 AA review**
Use Grep to find `onClick` on non-button elements (missing keyboard support), `<img` without `alt`, `aria-label` absence on icon-only buttons, and `outline: none` without a focus-visible replacement. Read flagged files and annotate each violation with the WCAG criterion it breaks.

**Step 3 — Emit audit report**
Produce a structured report: automated violations (count by impact), manual violations (file + line + fix), contrast ratios for brand colors (pass/fail at AA). Include a prioritized fix list.

**Step 4 — Focus trap audit + skip nav**
Scan for `Dialog`, `Modal`, `Drawer`, `Popover` components. Verify each has: a focus trap on open (`focus-trap-react` or `aria-modal`), returns focus to trigger on close, has an `aria-labelledby` referencing its title. Also check: first `<a>` in `<body>` is a "Skip to main content" link visible on focus (WCAG 2.4.1).

#### Example

```tsx
// VIOLATION: icon button with no accessible name
<button onClick={handleClose}>
  <XIcon />
</button>

// FIX: add aria-label; icon is decorative
<button onClick={handleClose} aria-label="Close dialog">
  <XIcon aria-hidden="true" />
</button>

// VIOLATION: div acting as button (no keyboard, no role)
<div onClick={handleSubmit}>Submit</div>

// FIX: use semantic element
<button type="button" onClick={handleSubmit}>Submit</button>
```

```tsx
// Focus trap pattern for modals (using focus-trap-react)
import FocusTrap from 'focus-trap-react'

export function Dialog({ open, onClose, title, children }: DialogProps) {
  return open ? (
    <FocusTrap focusTrapOptions={{ onDeactivate: onClose }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div className="bg-[var(--bg-card)] rounded-xl p-6 max-w-md w-full shadow-lg">
          <h2 id="dialog-title" className="text-h3 font-semibold mb-4">{title}</h2>
          {children}
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute top-4 right-4 focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
    </FocusTrap>
  ) : null
}
```

```html
<!-- Skip navigation link — must be FIRST focusable element in <body> -->
<a
  href="#main-content"
  class="
    sr-only focus:not-sr-only
    fixed top-4 left-4 z-[9999]
    px-4 py-2 rounded-md
    bg-[var(--primary)] text-white font-semibold text-sm
    focus-visible:ring-2 focus-visible:ring-offset-2
  "
>
  Skip to main content
</a>
```
