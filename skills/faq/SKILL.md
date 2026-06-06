---
name: faq
description: "Lists Topia's HTML entry points (docs, guides, skill index, nexus diagram, live visualizer) with one-shot open-in-browser commands. Use when the user asks 'where are the docs?', 'how do I see the skill graph?', or `/topia:faq`."
metadata:
  author: topia
  version: "1.0.0"
  layer: L3
  model: haiku
  group: docs
  tools: "Bash, Read"
---

# faq

## Purpose

Surface every HTML entry point Topia ships — bundled docs in the plugin cache, the GitHub Pages mirror, and the on-demand visualizer — with a copy-pasteable "open in browser" command for each. This skill exists because new users who installed via the plugin manager have no obvious way to find the rendered docs; everything lives in the read-only plugin cache.

This is a read-only listing skill. It does not generate or modify files.

## Triggers

- `/topia:faq` — primary invocation
- `/topia faq` — router alias
- User asks "where are the docs", "show me the topia docs", "how do I see the skill graph", "what HTML files ship with topia"

## Steps

### Step 1 — Locate TOPIA_ROOT

Run the same locate-cache bash used by `/topia finalize`:

```bash
TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/topia/* 2>/dev/null | head -1)"
if [ -z "$TOPIA_ROOT" ]; then
  TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/Topia/* 2>/dev/null | head -1)"
fi
if [ -z "$TOPIA_ROOT" ] && [ -f "compiler/bin/topia.js" ]; then
  TOPIA_ROOT="$(pwd)"
fi
echo "TOPIA_ROOT=$TOPIA_ROOT"
```

If `$TOPIA_ROOT` is still empty, tell the user the plugin cache wasn't found, suggest `/plugin install topia@linenoize`, and skip the cache-backed entries (still show the GitHub Pages links).

### Step 2 — Present the entry-point list

Render this list to the user. For each entry, show: what it is, where it lives, and one open-in-browser command (pick the user's OS — `start` on Windows, `open` on macOS, `xdg-open` on Linux; if uncertain, show all three).

```markdown
## Topia documentation & visualizations

### Bundled HTML (ships with the plugin)

| Page | Location | What it is |
|------|----------|------------|
| **Main docs** | `$TOPIA_ROOT/docs/index.html` | Topia landing — install, what it does, why. |
| **Guides** | `$TOPIA_ROOT/docs/guides/index.html` | Workflow walkthroughs and how-tos. |
| **Skill index** | `$TOPIA_ROOT/docs/skills/index.html` | Every skill grouped by layer, with descriptions. |
| **Nexus diagram (static)** | `$TOPIA_ROOT/docs/assets/nexus-diagram.html` | Pre-rendered skill graph showing the nexus shape. |

### Generated on demand

| Page | Command | What it is |
|------|---------|------------|
| **Live nexus visualizer** | `/topia visualize` | Interactive skill-graph for THIS project. Writes `<project>/.topia/nexus.html` and opens it in your browser. Auto-detects synapses + pulses from the current install. |

### Online (always current — useful if no plugin cache)

- **Main docs:** https://linenoize.github.io/topia
- **Guides:** https://linenoize.github.io/topia/guides
- **Source on GitHub:** https://github.com/linenoize/topia
- **CHANGELOG:** https://github.com/linenoize/topia/blob/main/docs/CHANGELOG.md

### Markdown docs (for terminal reading or `Read` tool)

- `INSTALL-CLAUDE-CODE.md` — install guide
- `INSTALL-SCOPES.md` — user vs project vs local scope, cache versioning, upgrade safety
- `HOOKS.md` — the 15 plugin hooks + how to extend
- `ARCHITECTURE.md` — the nexus structure, layers, synapses, pulses
- `MULTI-PLATFORM.md` — how the compiler targets Cursor / Windsurf / Antigravity / Codex
- `TROUBLESHOOTING.md` — common issues
- `NEXUS-GLOSSARY.md` — terminology (synapse, pulse, nexus, fork, etc.)
```

### Step 3 — Offer to open one

After presenting the list, ask which entry the user wants to open. If they pick one, invoke the OS-appropriate opener with the resolved absolute path:

- **Windows:** `start "" "$TOPIA_ROOT/docs/index.html"` (the empty quotes are required by `start`)
- **macOS:** `open "$TOPIA_ROOT/docs/index.html"`
- **Linux:** `xdg-open "$TOPIA_ROOT/docs/index.html"`
- **WSL:** `wslview "$TOPIA_ROOT/docs/index.html"` (or `explorer.exe "$(wslpath -w "$TOPIA_ROOT/docs/index.html")"`)

For the live visualizer entry, run `/topia visualize` (which is itself a `topia.js` invocation — the router in `commands/topia.md` handles it).

## Output Format

```text
Topia documentation & visualizations

Bundled HTML (ships with the plugin):
  - Main docs: <abs path>
  - Guides:    <abs path>
  - Skill index: <abs path>
  - Nexus diagram: <abs path>

Generated on demand:
  - Live nexus visualizer — run /topia visualize

Online:
  - https://linenoize.github.io/topia
  - https://github.com/linenoize/topia

Want me to open one? (pick by name, or "no")
```

## Calls (outbound connections)

- None — `faq` is a pure read-only listing skill. The only command it dispatches is the user-chosen OS opener (`start` / `open` / `xdg-open` / `wslview`), which is a shell action, not a skill call.

## Called By (inbound connections)

- `topia:tut` (L3): when the user picks "show me the docs" from the tutorial menu.
- Direct user invocation via `/topia:faq` or `/topia faq`.

## Constraints

1. MUST detect TOPIA_ROOT before referencing cache-backed paths — never print a path that doesn't exist.
2. MUST include the GitHub Pages fallback links so the skill is still useful when the cache lookup fails.
3. MUST NOT write any file — read-only.
4. MUST NOT launch a browser without the user's confirmation — print commands instead, let the user copy or pick.
5. MUST use the case-insensitive cache lookup (try `topia/` then `Topia/`) so users upgrading from v2.x aren't stranded.

## Sharp Edges

| Edge | Impact | Mitigation |
|------|--------|------------|
| Plugin cache may be empty (user installed via local clone) | MEDIUM | Detect missing cache and fall back to GitHub Pages links + the cwd if it looks like the topia repo |
| `wslview` not installed in every WSL distro | LOW | Offer `explorer.exe "$(wslpath -w <path>)"` as a fallback. Don't assume Linux defaults work on WSL. |
| Version-stale TOPIA_ROOT after upgrade | LOW | Resolve TOPIA_ROOT freshly per invocation — never cache it across sessions |
| `start` on Windows requires empty quoted title | LOW | Use `start "" "$path"` — bare `start "$path"` treats the path as a window title |

## Done When

- The user has seen the entry-point list with at least the cache-backed sections rendered (or the explicit "cache not found" fallback message + GitHub Pages links).
- If the user picked an entry, the corresponding open command was offered with their OS's syntax.
- Skill emits `docs.listed`.

## Cost Profile

- **Model:** `haiku` — pure listing + Bash dispatch, no reasoning required.
- **Tokens:** ~500–800 output tokens for the menu; minimal input.
- **Latency:** sub-second (one Bash call for cache locate + render).
- **Side effects:** none beyond the optional user-confirmed browser open.
