# Getting Started — Your First 5 Minutes with Topia

> New to Topia? This guide takes you from zero to your first disciplined feature ship in under 5 minutes.

**Install paths:** [`INSTALL.md`](INSTALL.md) — pick Claude (no terminal) or Cursor/Codex (one-time compile).

**What you'll learn:**
1. Install Topia for your IDE
2. Run your first `/topia-build` to ship a real feature
3. Understand what just happened (and why it was different from "vanilla" AI coding)

---

## Prerequisites

- **Node.js 18+** (only if you use Cursor, Codex, or other non-Claude IDEs — check: `node --version`)
- One of: **Claude Code**, **Cursor**, **Google Antigravity**, **OpenAI Codex**, **OpenCode**, or **OpenClaw**
- A project directory — existing or empty

---

## Step 1: Install (30 seconds)

### Claude Code (plugin — no terminal)

**Step 1 — plugin:**

```text
/plugin marketplace add linenoize/topia
/plugin install topia@linenoize
```

**Step 2 — finalize (recommended):**

```text
/topia finalize
```

Without finalize, skills work but dispatch hooks and team `org.md` policy may not apply across repos. See [`INSTALL-CLAUDE-CODE.md`](INSTALL-CLAUDE-CODE.md).

**Per repo:** `/topia onboard` → `/topia org-config` (teams) → `/topia doctor`

### Cursor / Codex / other IDEs

One-time compile from **your project root** (not inside the Topia repo):

```bash
node "<path-to-topia>/compiler/bin/topia.js" init --platform cursor
```

Find `<path-to-topia>` with a clone or `node "<path>/compiler/bin/topia.js" where`. Full guide: [`INSTALL-NON-CLAUDE.md`](INSTALL-NON-CLAUDE.md).

| Assistant | What Topia writes |
|-----------|------------------|
| Claude Code | Native plugin — `/topia <name>` in chat |
| Cursor | `.cursor/rules/*.mdc` |
| Antigravity | `.agent/rules/*.md` |
| Codex | `.codex/skills/` |
| OpenCode | `.opencode/skills/` |
| OpenClaw | `.openclaw/skills/` |

Verify:

- **Claude:** `/topia doctor` in chat
- **Other IDEs:** `node "<path-to-topia>/compiler/bin/topia.js" doctor` from your project

You should see: nexus healthy, skills compiled (non-Claude).

### L4 extension packs (shipped vs workspace-enabled)

All 10 `@Topia/*` packs ship with Topia — they are not a separate install. What varies by project:

| Mechanism | What it does |
|-----------|----------------|
| **Shipped** | Pack files live in the plugin (Claude) or compile output (Cursor via `init`) |
| **Workspace** | `topia packs detect`, `topia install`, or `/topia onboard` writes `.topia/active-packs.json` |
| **Runtime** | `build` Phase 1.5 loads matching `PACK.md` when signals or `active-packs.json` align |

### agora-code memory (optional)

If you enabled agora during `/topia finalize` or `topia install`:

- `topia memory seed` imports existing `.topia/` decisions into agora's SQLite store
- Session start runs `agora-code inject` via Topia's hook (not agora's hook installer)
- Invoke `topia:recall` when agora-memory is registered — see [agora-code integration](mcp-integrations/agora-code.md)

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

Compare vanilla AI coding vs topia:

| Vanilla | With Topia |
|---------|-----------|
| Claude writes code first | `scout` reads codebase first |
| Tests written last (or skipped) | `test` writes FAILING tests first (enforced) |
| Commit whenever | `readiness` + `guardian` must pass |
| "Looks done" = done | `completion-gate` validates evidence |

**The toolkit makes Claude disciplined.** Not smarter — just less sloppy.

---

## Step 4: Turn On Auto-Discipline (optional but recommended)

### Claude Code

Run `/topia finalize` in chat (recommended) — no terminal.

### Cursor / other IDEs (terminal)

From a Topia clone or plugin cache path:

```bash
node "<path-to-topia>/compiler/bin/topia.js" hooks install --preset gentle --platform cursor
```

Presets:
- `gentle` (default) — warnings, not blocks
- `strict` — blocks commits that fail gates
- `off`    → uninstall

Now `readiness`, `guardian`, and `completion-gate` auto-fire on supported platforms. See [`HOOKS.md`](HOOKS.md) for parity by IDE.

---

## Step 5: Explore the Nexus

Terminal (from Topia clone or cache):

```bash
node compiler/bin/topia.js status       # project health dashboard
node compiler/bin/topia.js visualize    # interactive nexus graph
node compiler/bin/topia.js doctor       # validate install + nexus integrity
```

Claude users: `/topia doctor` and skill invocations cover daily use without these.

Read next:
- [`SKILLS.md`](SKILLS.md) — all 71 skills, categorized by intent
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — 5-layer architecture reference
- [`PULSES.md`](PULSES.md) — how skills auto-trigger each other
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — stuck? common fixes here

---

## Common First-Day Questions

**Q: Do I invoke skills by name or just talk to Claude?**
A: Both work. `/topia build add login` is explicit. "Add login to the app" works too — `skill-router` picks the right skill. Explicit is faster.

**Q: What if I already have skills/prompts set up?**
A: Topia writes to its own namespace (`.topia/`, plugin cache, `.cursor/rules/`, etc.). Your existing setup is untouched. Uninstall cleanly with `topia hooks uninstall`.

**Q: Does Topia work offline?**
A: Yes. All skills are local Markdown. Only `research`, `docs-seeker`, `trend-scout` need network.

**Q: I hit a bug. Where do I report it?**
A: Open an issue on GitHub. Include the SKILL.md path, the failing command, and verbose output (`topia doctor --hooks` is a good first attachment).

---

## Next Steps

1. **Build something real** — `/topia build` a feature you were already going to build this week
2. **Compare with/without** — run the same task with Topia disabled, measure tokens + correctness
3. **Read `docs/VISION.md`** to understand what Topia is and isn't
4. **Browse `docs/SKILLS.md`** for the full skill catalog

Welcome to disciplined AI coding.
