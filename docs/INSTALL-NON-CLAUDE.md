# Install Topia on Cursor, Windsurf, Codex, and other non-Claude IDEs

Topia's Claude plugin gives you `/topia:*` skills inside Claude Code. **It does not compile rule files for Cursor, Windsurf, Codex, Antigravity, OpenCode, or OpenClaw.** Those editors need a one-time `init` step from a terminal.

Hub page with all paths: [`INSTALL.md`](INSTALL.md).

---

## Cursor marketplace plugin

Topia ships a Cursor plugin manifest at `.cursor-plugin/plugin.json` (skills, agents, commands, and lifecycle hooks). Install from **Cursor Settings → Plugins** once the listing is published.

| If install fails with `gitPath` / unsafe source path | What to do |
|------------------------------------------------------|------------|
| Stale empty cache from a prior failed clone | Delete empty folders under `~/.cursor/plugins/cache/` (Windows: `%USERPROFILE%\.cursor\plugins\cache\`) and retry |
| Testing before marketplace refresh | Local smoke-test (below) |

**Local smoke-test** (dev / pre-publish):

```bash
# Unix — symlink the clone into Cursor's local plugins dir
mkdir -p ~/.cursor/plugins/local
ln -sfn /path/to/topia ~/.cursor/plugins/local/topia

# Windows PowerShell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.cursor\plugins\local" | Out-Null
New-Item -ItemType Junction -Force -Path "$env:USERPROFILE\.cursor\plugins\local\topia" -Target "C:\path\to\topia"
```

Restart Cursor and confirm Topia skills/commands load with no `gitPath` error.

**Plugin skills ≠ project rules.** Marketplace/local plugin install exposes skills and commands to the agent. Compiling `.cursor/rules/*.mdc` into an application repo still requires `init --platform cursor` (steps below).

---

## Prerequisites

- **Node.js 18+**
- **Topia source** — one of:
  - Git clone: `git clone https://github.com/linenoize/topia.git`
  - Already installed the Claude plugin? Use the cache path (see [Finding Topia](#finding-topia) below)
- Your **project directory** (where you want `.cursor/rules/`, `.codex/skills/`, etc.)

---

## Quick install (3 steps)

### 1. Find Topia

Run **once** to locate the CLI (copy the path it prints):

```bash
# From a clone:
node compiler/bin/topia.js where

# From plugin cache (Unix):
TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/topia/* 2>/dev/null | head -1)"
node "$TOPIA_ROOT/compiler/bin/topia.js" where
```

Set a shell variable for the rest of this guide:

```bash
export TOPIA_CLI="$TOPIA_ROOT/compiler/bin/topia.js"   # or your clone path
```

### 2. Initialize your project

From **your project root** (not the Topia repo):

```bash
cd /path/to/your-project
node "$TOPIA_CLI" init --platform cursor
```

| Platform | Flag | Output directory |
|----------|------|------------------|
| Cursor | `--platform cursor` | `.cursor/rules/*.mdc` |
| Windsurf | `--platform windsurf` | `.windsurf/rules/*.md` |
| Codex | `--platform codex` | `.codex/skills/` |
| Antigravity | `--platform antigravity` | `.agent/rules/*.md` |
| OpenCode | `--platform opencode` | `.opencode/skills/` |
| OpenClaw | `--platform openclaw` | `.openclaw/skills/` |
| Generic | `--platform generic` | `.ai/rules/*.md` |

If the IDE markers already exist (e.g. `.cursor/`), `init` auto-detects the platform and you can omit `--platform`.

### 3. Open your IDE

Rules load from the output directory automatically. No daily terminal use required.

Verify:

```bash
node "$TOPIA_CLI" doctor
```

---

## After Topia upgrades

When you update Topia (new clone pull or `/plugin update topia@linenoize`), recompile:

```bash
node "$TOPIA_CLI" build
```

Run from the same project directory that has `topia.config.json`.

---

## Hooks and auto-discipline

Non-Claude IDEs have **partial** hook parity compared to Claude Code. Cursor supports command hooks via `.cursor/hooks.json`; Windsurf and others rely more on inline MUST rules in compiled output.

| Platform | Hook support | Install |
|----------|--------------|---------|
| Claude Code | Full | `/topia finalize` (no terminal) |
| Cursor | Command hooks | `node "$TOPIA_CLI" hooks install --platform cursor --preset gentle` |
| Windsurf | Best-effort rules | Same with `--platform windsurf` |
| Codex / others | Inline constraints in rules | `init` embeds constraints; no runtime hooks |

Full matrix: [`HOOKS.md`](HOOKS.md)

---

## L4 extension packs

All 10 `@Topia/*` packs ship with Topia. `init` auto-detects stack signals and writes `.topia/active-packs.json`. Re-detect anytime:

```bash
node "$TOPIA_CLI" packs detect
```

---

## VS Code and other agents

VS Code Copilot and similar agents without a dedicated adapter use **`--platform generic`** (output: `.ai/rules/`). Point your agent's rules/config at that directory per your tool's docs.

If you also run **Claude Code inside VS Code**, install the plugin in Claude's terminal and run `init` for the host editor — see [Hybrid setup in INSTALL.md](INSTALL.md#hybrid-claude-code-terminal--another-ide).

---

## Finding Topia

| Source | CLI path |
|--------|----------|
| Clone at `~/topia` | `~/topia/compiler/bin/topia.js` |
| Claude plugin cache | `~/.claude/plugins/cache/linenoize/topia/<version>/compiler/bin/topia.js` |

**Do not use** bare `node compiler/bin/topia.js` from your application repo — that relative path does not exist there.

**Do not use** `npx @linenoize/topia` unless the package is published to your npm registry. Prefer clone or plugin cache paths above.

---

## Common mistakes

| Mistake | What to do instead |
|---------|-------------------|
| Cursor marketplace install fails with `gitPath` / unsafe source path | Confirm `.cursor-plugin/plugin.json` exists in the install; clear empty `~/.cursor/plugins/cache/` dirs and retry, or use the local smoke-test above |
| Installed Claude plugin, opened Cursor, no project rules | Run `init --platform cursor` in the project (plugin skills alone do not write `.cursor/rules/`) |
| Ran `topia init` but `topia` command not found | Use `node "/full/path/to/.../topia.js" init …` |
| Ran `--platform cursor` without `init` | Full command: `… topia.js init --platform cursor` |
| Edited files inside plugin cache | Cache is replaced on upgrade — edit your project `.topia/` instead |

More fixes: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
