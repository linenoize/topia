---
name: finalize
description: Step 2 of Claude Code install — run after /plugin install topia@linenoize. Wires discipline hooks, optional agora-code MCP, team org policy (org.md), and project gitignore. Still in chat, no terminal required for most users.
---

# /topia finalize

**Step 2 of install.** Run this in Claude Code immediately after:

```text
/plugin marketplace add linenoize/topia
/plugin install topia@linenoize
```

Step 1 (plugin) gives you skills and plugin hooks. **Finalize** turns on the discipline layer most teams expect — and sets up team policy in `.topia/org/org.md`.

## If you skip finalize

You still have:

| Works without finalize | Missing without finalize |
|------------------------|---------------------------|
| All `/topia:*` skills and `/topia` router | **Dispatch hooks** (`readiness`, `guardian`, `completion-gate`, `dependency-doctor`) in repos that are not actively loading the plugin |
| Plugin hooks (session-start, secrets-scan, quarantine, metrics, …) | **Cross-repo discipline** — opening a random folder in Claude may not auto-run readiness/guardian on edits |
| File-based `.topia/` memory in projects you onboard | **agora-code MCP** (persistent semantic memory) unless installed manually |
| Manual `/topia guardian`, `/topia readiness`, etc. | **Project `.gitignore` helpers** for Topia state files |
| | **Interview-driven `org.md`** — guardian/readiness use generic template policy until you run org-config |

**Bottom line:** skipping finalize is fine for a quick try. For day-to-day coding across multiple repos — especially **teams** — run finalize once per machine, then org-config + onboard per repo.

## What finalize does

1. **System-wide dispatch hooks** (recommended) — `readiness`, `guardian`, `completion-gate`, `dependency-doctor` in `~/.claude/settings.json` (gentle preset by default).
2. **Team org policy** (recommended for teams) — invokes **org-config** to interview and write `.topia/org/org.md`.
3. **agora-code MCP** (optional) — Python 3.10+ persistent memory.
4. **Project `.gitignore`** (optional) — Topia-managed ignore rules in the current repo.
5. **`doctor`** verify at the end.

Writes `.topia/.finalized` so the session-start menu stops nudging (per repo).

## Behavior (what Claude does when this command is invoked)

You are running inside Claude Code with access to `Bash`. Follow these steps:

### Step 0 — Handle flag-only short-circuits

**If the user passed `--dismiss`:** write `.topia/.dismissed` and exit. No prompts, no hook setup.

```bash
mkdir -p .topia
printf 'dismissed: %s\n' "$(date -Iseconds)" > .topia/.dismissed
echo "First-run menu dismissed for this repo. Delete .topia/.dismissed to bring it back."
```

Then return — do NOT proceed to Step 1.

**If the user passed `--reset`:** delete `.topia/.finalized`. Continue to Step 1 only if the user also asked to re-finalize.

### Step 1 — Locate the plugin cache

```bash
TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/topia/* 2>/dev/null | head -1)"
if [ -z "$TOPIA_ROOT" ]; then
  TOPIA_ROOT="$(ls -dt ~/.claude/plugins/cache/linenoize/Topia/* 2>/dev/null | head -1)"
fi
if [ -z "$TOPIA_ROOT" ]; then
  if [ -f "compiler/bin/topia.js" ]; then
    TOPIA_ROOT="$(pwd)"
  fi
fi
echo "TOPIA_ROOT=$TOPIA_ROOT"
```

If neither path resolves, stop: "Plugin cache not found. Run `/plugin install topia@linenoize` first."

### Step 2 — Ask what to enable

Use **AskUserQuestion** (multiSelect: true). Present these as **recommended defaults pre-selected** where noted:

| Option | What it adds | Default |
|--------|----------------|---------|
| **System-wide dispatch hooks (gentle)** | readiness / guardian / completion-gate / dependency-doctor globally | **recommended — on** |
| **Team org policy (`org.md`)** | Runs `/topia org-config` interview → `.topia/org/org.md` for guardian/readiness | **recommended for teams — on** |
| **agora-code persistent memory** | Python MCP | optional |
| **Project `.gitignore` rules** | Topia entries in `./.gitignore` | optional |

If the user picks **none**, explain the [skip table](#if-you-skip-finalize), write `.topia/.finalized`, and exit.

### Step 3 — Run selected steps

**Dispatch hooks:**

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" setup --global --preset gentle --yes
```

Use `strict` if user passed `--strict`.

**Team org policy:**

Do NOT only run bash — invoke the **org-config** skill per [`commands/org-config.md`](org-config.md) and [`skills/org-config/SKILL.md`](../skills/org-config/SKILL.md). Ensure `.topia/org/` exists:

```bash
mkdir -p .topia/org
```

If `org.md` is missing, copy from `$TOPIA_ROOT/.topia/org/org.md` when present, or create minimal structure per ORG-CONFIG docs. Then run the interview and write the file.

**agora-code:** (unchanged from prior finalize — pip install, .mcp.json merge, memory seed, packs detect)

**`.gitignore`:** (unchanged — install dry-run or append block)

### Step 4 — Verify

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" doctor
```

### Step 5 — Write flag and report

```bash
node -e "require('fs').mkdirSync('.topia',{recursive:true})"
node -e "require('fs').writeFileSync('.topia/.finalized','finalized: '+new Date().toISOString()+'\\n')"
```

Print summary:

- What was enabled vs skipped
- **Next per-repo steps:** `/topia onboard` in each application repo; commit `.topia/org/` for teams
- Restart Claude Code if dispatch hooks were installed

## Flags

- `/topia finalize` — interactive (default)
- `/topia finalize --strict` — strict preset for dispatch hooks
- `/topia finalize --skip-agora` — skip Python MCP
- `/topia finalize --skip-org` — skip org-config interview
- `/topia finalize --all` — enable all non-interactive (respects `--skip-agora`, `--skip-org`)
- `/topia finalize --reset` / `--dismiss` — as before

## What this is NOT

- Does **not** install the plugin (Step 1).
- Does **not** replace **per-repo onboard** — run `/topia onboard` in each codebase after finalize.

## Reverting

```bash
node "$TOPIA_ROOT/compiler/bin/topia.js" hooks uninstall --platform claude
pip uninstall agora-code
rm .topia/.finalized
```
