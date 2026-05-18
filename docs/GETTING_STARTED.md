# Getting Started — Your First 5 Minutes with Topia

> New to Topia? This guide takes you from zero to your first disciplined feature ship in under 5 minutes.

**What you'll learn:**
1. Install Topia in your project
2. Run your first `/topia build` to ship a real feature
3. Understand what just happened (and why it was different from "vanilla" AI coding)

---

## Prerequisites

- **Node.js 18+** (check: `node --version`)
- One of: **Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **OpenAI Codex**, or **OpenCode**
- A project directory — existing or empty

---

## Step 1: Install (30 seconds)

From your project root:

```bash
npx @protopia/skill-topia init
```

This detects your AI assistant and writes the right config files:

| Assistant | What Topia writes |
|-----------|------------------|
| Claude Code | `.claude/` (plugin), skills invoke via `/topia <name>` |
| Cursor | `.cursor/rules/*.mdc` |
| Windsurf | `.windsurf/workflows/*.md` |
| Antigravity | `.antigravity/workflows/*.md` |
| Codex | `.codex/skills/` |
| OpenCode | `.opencode/skills/` |

Verify install:

```bash
npx @protopia/skill-topia doctor
```

You should see: `✓ 65 skills, 10 packs, mesh valid`.

---

## Step 2: Your First `/topia build` (3 minutes)

Open your AI assistant in the project and ask:

> `/topia build add a health check endpoint at /api/health that returns { status: "ok", uptime }`

Watch what happens:

```
[build] Starting feature implementation...
  ↳ [scout] Scanning codebase... Found Express app at src/server.js
  ↳ [plan] Drafting phase plan... Single-phase (small task)
  ↳ [test] Writing failing tests first (TDD RED)...
       src/__tests__/health.test.js — 3 tests FAIL ✓
  ↳ [fix] Implementing src/routes/health.js...
       Re-run tests → 3/3 PASS ✓ (TDD GREEN)
  ↳ [preflight] Checking logic, regressions, completeness... PASSED ✓
  ↳ [sentinel] Secret scan, OWASP top 10... PASSED ✓
  ↳ [verification] npm run test + lint + build... ALL PASS ✓
  ↳ [git] Committing: feat: add /api/health endpoint with uptime
```

That's **the toolkit in action**. Six skills cooperated — you didn't invoke any of them directly.

---

## Step 3: What Just Happened?

Compare vanilla AI coding vs Topia:

| Vanilla | With Topia |
|---------|-----------|
| Claude writes code first | `scout` reads codebase first |
| Tests written last (or skipped) | `test` writes FAILING tests first (enforced) |
| Commit whenever | `preflight` + `sentinel` must pass |
| "Looks done" = done | `completion-gate` validates evidence |

**The toolkit makes Claude disciplined.** Not smarter — just less sloppy.

---

## Step 4: Turn On Auto-Discipline (optional but recommended)

By default, Topia skills only run when you invoke them. To auto-fire quality gates on every tool use:

```bash
npx @protopia/skill-topia hooks install --preset gentle
```

Presets:
- `gentle` (default) — warnings, not blocks
- `strict` — blocks commits that fail gates
- `off`    → uninstall

Now `preflight`, `sentinel`, and `completion-gate` auto-fire on every file edit. No more "remember to invoke the skill."

---

## Step 5: Explore the Mesh

```bash
npx @protopia/skill-topia status       # project health dashboard (neofetch-style)
npx @protopia/skill-topia visualize    # interactive mesh graph (Canvas 2D)
npx @protopia/skill-topia doctor       # validate install + mesh integrity
```

Read next:
- [`SKILLS.md`](SKILLS.md) — all 65 skills, categorized by intent
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — 5-layer architecture reference
- [`SIGNALS.md`](SIGNALS.md) — how skills auto-trigger each other
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — stuck? common fixes here

---

## Common First-Day Questions

**Q: Do I invoke skills by name or just talk to Claude?**
A: Both work. `/topia build add login` is explicit. "Add login to the app" works too — `skill-router` picks the right skill. Explicit is faster.

**Q: What if I already have skills/prompts set up?**
A: Topia writes to its own namespace (`.topia/`, `.claude/plugins/Topia/`, etc.). Your existing setup is untouched. Uninstall cleanly with `Topia hooks uninstall`.

**Q: Does Topia work offline?**
A: Yes. All skills are local Markdown. Only `research`, `docs-seeker`, `trend-scout` need network.

**Q: I hit a bug. Where do I report it?**
A: Open an issue in the internal git repo. Include the SKILL.md path, the failing command, and the verbose output (`Topia doctor --hooks` is usually a good first attachment).

---

## Next Steps

1. **Build something real** — `/topia build` a feature you were already going to build this week
2. **Compare with/without** — run the same task with Topia disabled, measure tokens + correctness
3. **Read `docs/VISION.md`** to understand what Topia is and isn't
4. **Browse `docs/SKILLS.md`** for the full skill catalog

Welcome to disciplined AI coding.
