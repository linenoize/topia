---
name: migrate-from-rune
description: Pull .rune/ memories into .topia/, optionally disable the rune-kit Claude Code plugin to prevent skill-name conflicts.
---

# migrate-from-rune

One-shot, interactive migration command for projects coming from rune-kit.

## What it does

1. **Detects** `.rune/` in the current project root and the rune-kit plugin at `~/.claude/plugins/cache/rune-kit/`.
2. **Prints a plan** showing exactly which files will be copied and whether the plugin will be disabled.
3. **Warns** about what happens if you decline (skill-name collisions, silent routing failures).
4. **Asks for confirmation** before any writes.
5. On **yes**:
   - Copies known state files (`decisions.md`, `conventions.md`, `progress.md`, `learnings.jsonl`, `adr/`, `features/`, etc.) from `.rune/` to `.topia/`.
   - Renames `~/.claude/plugins/cache/rune-kit/` → `rune-kit.disabled` so Claude Code stops loading it on next start.
   - Writes `.topia/migrated-from-rune.flag` so the session-start hook stops prompting.
6. On **skip** / **no**:
   - Writes `.topia/skip-rune-migration.flag` (skip only) so the prompt doesn't reappear. Aborting without skip leaves the prompt active for next session.

## When to run

The session-start hook prints a `=== topia: Rune migration recommended ===` banner if it detects `.rune/` OR the rune-kit plugin AND no migration/skip flag exists. Run this command at that point.

## Usage

```bash
# Preview the plan, no writes
node compiler/bin/topia.js migrate-from-rune --dry-run

# Interactive — asks before any changes
node compiler/bin/topia.js migrate-from-rune

# Force overwrite of existing .topia/ files (default: skip on conflict)
node compiler/bin/topia.js migrate-from-rune --force

# Non-interactive — auto-confirm (use in scripts)
node compiler/bin/topia.js migrate-from-rune --yes

# Suppress the session-start warning without migrating
node compiler/bin/topia.js migrate-from-rune --skip
```

## What's NOT done

- **agora-code memory push** is advisory only. The command prints a reminder, but pushing ADRs/learnings into agora-code's MCP is done by Claude (via `store_learning` calls) — the command can't reach the MCP from CLI.
- **Skill replacements** — Topia's skills already replace rune-kit's; the command never copies skills, only state files.
- **Settings.json edits** — the command never touches `~/.claude/settings.json`. Disabling rune-kit is done by renaming its plugin cache directory only.

## Reverting

If the migration was a mistake:

```bash
# Restore rune-kit
mv ~/.claude/plugins/cache/rune-kit.disabled ~/.claude/plugins/cache/rune-kit

# Remove the flag so the prompt re-fires
rm .topia/migrated-from-rune.flag
```

Copied files in `.topia/` are not auto-removed — delete them manually if needed.
