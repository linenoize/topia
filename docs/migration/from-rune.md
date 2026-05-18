# Migrating from rune-kit

Topia and [rune-kit](https://github.com/runedev/rune-kit) share lineage and overlap on ~30 skill names (`build`, `plan`, `scout`, `graft`, etc.). Running both as Claude Code plugins makes the router pick one non-deterministically — silently broken routing.

If you previously used rune-kit in a project, run `migrate-from-rune` once after installing Topia to:

1. Pull your `.rune/` state (decisions, ADRs, conventions, learnings) into `.topia/`.
2. Disable the rune-kit Claude Code plugin so it stops shadowing Topia.

## How it kicks off

After cloning Topia and starting Claude Code, the session-start hook detects `.rune/` AND/OR `~/.claude/plugins/cache/rune-kit/` and prints:

```
=== Topia: Rune migration recommended ===
  · Found .rune/ in this project (rune-kit's state directory)
  · Found rune-kit plugin at ~/.claude/plugins/cache/rune-kit

  Why migrate:
    1. Pull your prior decisions, ADRs, conventions, and learnings
       from .rune/ into .topia/ so this session can recall them.
    2. Disable rune-kit so it does not conflict with Topia. ...

  If you decline:
    · Past .rune/ context will stay unread by Topia skills.
    · rune-kit will keep shadowing Topia commands — expect silent
      routing surprises until one is removed.

  To proceed (preview first, then run):
    node compiler/bin/topia.js migrate-from-rune --dry-run
    node compiler/bin/topia.js migrate-from-rune

  To suppress this warning without migrating:
    node compiler/bin/topia.js migrate-from-rune --skip
```

## What gets copied

Files at the top of `.rune/` (the ones Topia recognises):

| `.rune/` source | → | `.topia/` target |
|---|---|---|
| `decisions.md` | → | `decisions.md` |
| `conventions.md` | → | `conventions.md` |
| `progress.md` | → | `progress.md` |
| `session-log.md` | → | `session-log.md` |
| `instincts.md` | → | `instincts.md` |
| `checkpoint.md` | → | `checkpoint.md` |
| `cumulative-notes.md` | → | `cumulative-notes.md` |
| `learnings.jsonl` | → | `learnings.jsonl` |
| `task-notes.md` | → | `task-notes.md` |
| `invariants.md` / `INVARIANTS.md` | → | same |

And directories:

| `.rune/` | → | `.topia/` |
|---|---|---|
| `adr/*` | → | `adr/*` (preserves ADR numbering) |
| `features/<name>/*` | → | `features/<name>/*` (requirements, plans, tasks) |
| `metrics/*` | → | `metrics/*` |

**Conflict handling:** If a target file already exists in `.topia/`, it is **skipped** by default. Pass `--force` to overwrite.

## What gets disabled

If `~/.claude/plugins/cache/rune-kit/` exists, the directory is renamed to `~/.claude/plugins/cache/rune-kit.disabled`. Claude Code stops loading it on next start.

Restart Claude Code after the migration to fully unload rune-kit from the current session.

## What doesn't happen automatically

- **agora-code push.** The migration command can't reach the agora-code MCP from CLI. After migrating, if agora-code is registered, ask Claude to push the imported ADRs and learnings into agora-code via `store_learning` calls. The next `build`, `idea`, or `neural-memory` invocation will then see them via `recall_learnings`.
- **Settings edits.** `~/.claude/settings.json` is never touched. The only filesystem change outside your project root is the rune-kit cache rename.
- **Skill imports.** Topia's skills already replace rune-kit's. The migration never copies skills, only state.

## Flag files (idempotency)

After the migration runs once, two possible markers may exist in `.topia/`:

| File | Meaning |
|---|---|
| `migrated-from-rune.flag` | Migration completed. Session-start hook stops warning. |
| `skip-rune-migration.flag` | User declined and explicitly suppressed warnings. |

If neither flag is present, the session-start hook keeps showing the prompt every session.

## Reverting

```bash
# Restore rune-kit
mv ~/.claude/plugins/cache/rune-kit.disabled ~/.claude/plugins/cache/rune-kit

# Remove the migration flag so the prompt fires again
rm .topia/migrated-from-rune.flag

# (Optional) remove the imported state — there is no auto-cleanup
# rm .topia/decisions.md .topia/conventions.md  ...etc
```

## Command reference

```bash
# Preview only, no writes
topia migrate-from-rune --dry-run

# Interactive — default behaviour
topia migrate-from-rune

# Overwrite existing .topia/ files
topia migrate-from-rune --force

# Non-interactive (CI / scripts)
topia migrate-from-rune --yes

# Suppress session-start warning without migrating
topia migrate-from-rune --skip
```
