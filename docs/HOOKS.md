# Topia Hooks — Multi-Platform Auto-Discipline

Topia skills are libraries by default. `Topia hooks install` turns them into a **runtime**: your IDE auto-invokes `preflight`, `sentinel`, `dependency-doctor`, `completion-gate`, and `quarantine` at the right moments — before you commit insecure code, before you forget to run tests, before you ship a half-finished change, before you trust an untrusted external content blob.

Different AI IDEs expose different primitives. This doc explains what "auto-fire" actually means on each platform so you know what you're getting.

## Quick start (recommended)

```bash
# One command — interactive wizard asks scope/preset
Topia setup
```

The wizard handles 95% of cases. Use the explicit flags below only for CI / scripting / advanced multi-platform setups.

## Manual flags

```bash
# Auto-detect platforms (.claude/, .cursor/, .windsurf/, .antigravity/)
Topia hooks install --preset gentle

# Install GLOBALLY — every Claude Code session, regardless of project
Topia hooks install --preset gentle --global

# Target a specific platform (force-creates the platform dir if missing)
Topia hooks install --preset strict --platform cursor

# Install into every *detected* platform (safe — never creates new platform dirs)
Topia hooks install --platform all

# Preview without writing
Topia hooks install --dry

# Remove all Topia-managed entries (keeps your own)
Topia hooks uninstall

# Inspect wiring
Topia hooks status --platform all

# Drift report — does installed match the canonical preset?
Topia doctor --hooks
```

## `Topia setup` — interactive wizard

Run once per machine (or per project) to wire everything in one shot:

```
$ Topia setup

  Topia Setup Wizard
  ──────────────────
  Version:    2.17.1 (cached)

  Where to install hooks?
    [c] Current project — D:/MyProject/.claude/settings.json
    [g] Global          — ~/.claude/settings.json
         (every Claude Code session, regardless of project)

  Scope [c/g] (default c): g

  Preset:
    [g] gentle — advisory mode, hooks warn but never block (recommended)
    [s] strict — hooks BLOCK on violations (CI/AFK use)

  Preset [g/s] (default g): g

  Topia Setup Complete
  ──────────────────
  Scope:     GLOBAL (~/.claude/settings.json)
  Preset:    gentle
  Platforms: claude

  Verify:
    Topia doctor --hooks   # check drift
    Topia hooks status     # show wired skills
```

### Wizard scope options

| Choice    | Writes to                     | Use when                                                    |
|-----------|-------------------------------|-------------------------------------------------------------|
| `current` | `<cwd>/.claude/settings.json` | Project-specific config — different rules per project       |
| `global`  | `~/.claude/settings.json`     | One-shot for all Claude Code sessions, regardless of cwd    |

**Global mode** is what most users want for first-time setup.

### Non-interactive mode (CI / scripts)

Pass flags to skip prompts:

```bash
# Project install with gentle preset
Topia setup --here --preset gentle

# Global install with strict preset
Topia setup --global --preset strict

# Dry-run (preview without writing)
Topia setup --here --dry
```

Presets:

- `gentle` → WARN on findings, don't block the user.
- `strict` → BLOCK on findings, require explicit override.
- `off`    → equivalent to `Topia hooks uninstall`.

## Platform capability matrix

| Platform    | Maturity     | Pre-edit  | Pre-Bash   | Post-edit | Stop (completion-gate) | Native artifact                     |
|-------------|--------------|-----------|------------|-----------|------------------------|-------------------------------------|
| Claude Code | **stable**   | auto-fire | auto-fire  | auto-fire | **auto-fire**          | `.claude/settings.json` (JSON)      |
| Cursor      | beta         | rule-inject | —        | —         | —                      | `.cursor/rules/Topia-*.mdc`          |
| Windsurf    | beta         | workflow + cascade-rule | workflow | — | —                      | `.windsurf/workflows/` + `.windsurf/rules/` |
| Antigravity | experimental | rule-inject | —        | —         | —                      | `.antigravity/rules/Topia-*.md`      |

**Capability reading:**

- `auto-fire` = native Claude primitive, true runtime behavior.
- `rule-alwaysApply` / `rule-glob` = best-effort rule injection, agent still decides.
- `workflow + cascade-rule` = user-invoked `/Topia-context-inject` + a cascade reminder.
- `—` = platform can't host the entry. `Topia hooks status` lists skipped entries.

**Reading the matrix:**

- `auto-fire` = the IDE invokes Topia automatically on the matching event (true hook parity).
- `rule-inject` = the IDE injects guidance text into the agent prompt when editing matching files. Best-effort — the agent may skip it.
- `workflow` = user-triggered only (`/Topia-preflight`). Topia also installs a cascade-rule to remind the agent to invoke it.
- `—` = not supported by the platform. `Topia hooks status` flags this so you know which guarantees are missing.

## What gets installed

For each platform, Topia writes artifacts that can be re-run idempotently and removed cleanly.

### Claude Code (`.claude/settings.json`)

Merges into the `hooks` object, preserving any user-authored entries. Topia entries are identified by the `npx --yes @linenoize/topia hook-dispatch <skill>` command signature — no comment markers needed.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "npx --yes @linenoize/topia hook-dispatch preflight --gentle" }] },
      { "matcher": "Bash",        "hooks": [{ "type": "command", "command": "npx --yes @linenoize/topia hook-dispatch sentinel --gentle" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "npx --yes @linenoize/topia hook-dispatch dependency-doctor --gentle" }] }
    ],
    "Stop": [
      { "matcher": ".*", "hooks": [{ "type": "command", "command": "npx --yes @linenoize/topia hook-dispatch completion-gate --gentle" }] }
    ]
  }
}
```

### Cursor (`.cursor/rules/Topia-*.mdc`)

Three auto-attach rules:

- `Topia-preflight.mdc` — `alwaysApply: true`, fires before any source-file edit.
- `Topia-sentinel.mdc` — glob-scoped to `**/*.sh`, `Dockerfile`, `.github/workflows/*.yml`, `.env*`.
- `Topia-dependency-doctor.mdc` — scoped to manifest / lockfile edits.

No `completion-gate` equivalent — Cursor has no Stop-hook primitive. Invoke manually via `/topia completion-gate` before wrapping up.

### Windsurf (`.windsurf/workflows/` + `.windsurf/rules/`)

Two artifacts per skill:

- **Workflows** (`Topia-preflight.md`, etc.) — user-invoked via `/Topia-preflight` slash command.
- **Cascade rules** (`Topia-preflight-rule.md`, etc.) — inject "run /Topia-preflight first" into the agent prompt when editing matching globs.

Cascade rules approximate auto-fire but the user still has to run the workflow command. This is a Windsurf platform limitation.

### Antigravity (`.antigravity/rules/Topia-*.md`)

Experimental — mirrors Cursor's rule-injection pattern because Antigravity doesn't yet expose a tool-level hook primitive. Status may change as the platform matures.

## Idempotency & safety

- **Signature-based detection**: Claude hooks are identified by command substring, Cursor/Windsurf/Antigravity files by `Topia-managed: true` frontmatter + `@linenoize/topia hook-dispatch` signature. No HTML-comment markers.
- **User entries preserved**: Every adapter's `uninstall` walks the artifact directory and removes only files that carry the Topia signature. User-authored rules, workflows, and hooks in the same directory are untouched.
- **Re-run safe**: `install` replaces Topia entries in-place; two consecutive runs produce byte-identical output.
- **Malformed JSON**: `.claude/settings.json` with broken JSON throws an actionable error instead of overwriting — fix manually or delete and re-install.

## Choosing a preset

- Start with `gentle` while you learn how the hooks feel. WARN mode surfaces findings in your terminal without blocking work.
- Switch to `strict` once you trust the signal. BLOCK mode refuses the tool call until you address the finding.
- Use `--platform all --preset strict` for team/shared machines where you want maximum discipline everywhere.

## Limitations

- Only Claude Code gets `Stop` (completion-gate) auto-fire. Every other platform requires manual `/topia completion-gate` invocation.
- Cursor/Windsurf/Antigravity rule-injection is best-effort — the underlying LLM still decides whether to read and apply the rule. `strict` mode on these platforms is advisory, not enforced.
- `Topia hooks status --platform all` is the single source of truth for "what am I actually getting on this machine." Check it after install.

See also: `docs/MULTI-PLATFORM.md` (skill compilation matrix).
