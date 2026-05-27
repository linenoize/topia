---
name: finalize
description: One-shot finalize-install. Run inside Claude Code after `/plugin install topia@linenoize` to enable the optional pieces (system-wide dispatch hooks, agora-code persistent memory, project .gitignore) without leaving the chat. Idempotent — safe to re-run.
---

# /topia finalize

The marketplace install (`/plugin install topia@linenoize`) is already complete for the core experience: all 69 skills, all 66 subagents, the 15 plugin hooks (session-start, secrets-scan, quarantine, metrics-collector, …), and file-based `.topia/` memory all work the moment the plugin is enabled.

This command finalizes the **optional** extras:

1. **System-wide dispatch hooks** (`readiness`, `guardian`, `completion-gate`, `dependency-doctor`) wired into `~/.claude/settings.json` so they fire even in repos that haven't loaded the plugin.
2. **agora-code MCP** — optional Python-based persistent memory. Skills gracefully degrade to file-based `.topia/` without it.
3. **Project `.gitignore`** — add Topia-managed ignore rules to the current repo.
4. **`doctor`** verify at the end.

After a successful run, writes `.topia/.finalized` so the session-start nudge stops firing.

## Behavior (what Claude does when this command is invoked)

You are running inside Claude Code with access to `Bash`. Follow these steps:

### Step 0 — Handle flag-only short-circuits

Before doing anything else, parse the user's command for flag-only modes that should not run the full finalize flow:

**If the user passed `--dismiss`:** write `.topia/.dismissed` and exit. No prompts, no hook setup. This is the "just hide the first-run menu, I'm not ready to commit to anything" path. Reversible.

```bash
mkdir -p .topia
printf 'dismissed: %s\n' "$(date -Iseconds)" > .topia/.dismissed
echo "First-run menu dismissed for this repo. Delete .topia/.dismissed to bring it back."
```

Then return — do NOT proceed to Step 1.

**If the user passed `--reset`:** delete `.topia/.finalized` (existing behavior — re-prompts next session). After deleting, continue to Step 1 only if the user also asked to re-finalize; otherwise stop.

### Step 1 — Locate the plugin cache

Run:

```bash
# Canonical path is lowercase (plugin name is `topia` as of v3.0.0). Linux/macOS
# are case-sensitive; the legacy capital-T directory is also checked as a fallback
# for users who upgraded from v2.x on a case-insensitive filesystem.
TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/topia/* 2>/dev/null | head -1)"
if [ -z "$TOPIA_ROOT" ]; then
  TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/Topia/* 2>/dev/null | head -1)"
fi
if [ -z "$TOPIA_ROOT" ]; then
  # Fallback: maybe the user is in a clone of the repo
  if [ -f "compiler/bin/topia.js" ]; then
    TOPIA_ROOT="$(pwd)"
  fi
fi
echo "TOPIA_ROOT=$TOPIA_ROOT"
```

If neither path resolves, stop and tell the user: "Plugin cache not found. Run `/plugin install topia@linenoize` first, or clone the repo and re-run this command from inside the clone."

### Step 2 — Ask the user which extras to enable

Use **AskUserQuestion** with three options (multiSelect: true):

- **System-wide dispatch hooks (gentle preset)** — recommended. Wires readiness/guardian/completion-gate/dependency-doctor into `~/.claude/settings.json`. Reversible with `topia hooks uninstall`.
- **agora-code persistent memory (MCP)** — optional Python 3.10+ install. Adds cross-project semantic memory. Skip if you don't have Python or don't want it.
- **Project `.gitignore` rules** — adds Topia-managed entries to `./.gitignore` if a repo is present in the cwd.

If the user picks none, write the `.topia/.finalized` flag and exit politely — they've opted out, no further nudges.

### Step 3 — Run the selected steps

For **dispatch hooks**:

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" setup --global --preset gentle --yes
```

If the user explicitly asked for strict preset, replace `gentle` with `strict`.

For **agora-code**:

```bash
# Probe Python 3.10+
PY="$(python3 -c 'import sys; print(sys.version_info[0]==3 and sys.version_info[1]>=10)' 2>/dev/null)"
if [ "$PY" = "True" ]; then
  pip install "$TOPIA_ROOT/mcp-servers/agora-code"
  # Then register the MCP server in the project's .mcp.json (only if user wants it project-scoped)
else
  echo "Skipping agora-code — Python 3.10+ not found. You can install later: pip install $TOPIA_ROOT/mcp-servers/agora-code"
fi
```

If agora-code installs cleanly AND the cwd is a project root (has `.git/` or `package.json`), offer to append the MCP server entry to `.mcp.json`:

```json
{ "mcpServers": { "agora-memory": { "command": "agora-code", "args": ["memory-server"] } } }
```

Use Read/Edit to merge safely — never overwrite an existing `.mcp.json`.

For **`.gitignore`**:

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" install --skip-rune-check --skip-agora --yes --dry-run 2>&1 | grep -i gitignore
# If the user wants it applied for real, drop --dry-run.
```

Or just append the canonical Topia ignore block to `./.gitignore` directly (only if it's missing — grep first).

### Step 4 — Verify

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" doctor
```

Show the user the final output.

### Step 5 — Write the flag and report

```bash
node -e "require('fs').mkdirSync('.topia',{recursive:true})"
node -e "require('fs').writeFileSync('.topia/.finalized','finalized: '+new Date().toISOString()+'\\n')"
```

**Windows:** Do not use Git Bash `mkdir -p` with absolute paths. It creates empty junk folders:

| Bad | Artifact |
|-----|----------|
| `mkdir -p C:\...\screenshots` | `C?CodeBase?...` fused folder |
| `mkdir -p alembic:C:\...\alembic` | `alembic;C`, `app;C`, … |

Use relative paths only, or `node scripts/ensure-dir.mjs .topia` from the Topia repo. Scan: `node scripts/scan-mangled-windows-dirs.js --root .`

Print a one-paragraph summary:
- ✅ what was enabled
- ⊘ what was skipped (and why, if it failed)
- next step: "restart Claude Code so dispatch hooks load"

## Flags / argument handling

The slash command takes no required arguments. Recognized free-form intent:

- `/topia finalize` — interactive (default)
- `/topia finalize --strict` — assume strict preset for dispatch hooks
- `/topia finalize --skip-agora` — skip the Python MCP step
- `/topia finalize --all` — enable everything non-interactively (still respects `--skip-agora`)
- `/topia finalize --reset` — delete `.topia/.finalized` and re-prompt next session
- `/topia finalize --dismiss` — write `.topia/.dismissed` so the first-run menu in session-start stops appearing in this repo. Does **not** finalize, does **not** install hooks. Use when the user wants to ignore the menu permanently without enabling extras. The flag is per-repo (lives in `.topia/`) so other repos are unaffected. Reversible: delete `.topia/.dismissed` to bring the menu back.

## What this is NOT

- It does **not** install the plugin itself — that's `/plugin install topia@linenoize`.
- It does **not** add new skills or agents — those are already loaded by the plugin.
- It does **not** modify project source code.
- It does **not** push secrets or telemetry anywhere — all writes are local.

## Reverting

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" hooks uninstall --platform claude   # remove dispatch hooks
pip uninstall agora-code                                                     # remove MCP
rm .topia/.finalized                                                         # re-enable nudge
```
