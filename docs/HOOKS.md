# Topia Hooks — Multi-Platform Auto-Discipline

Topia skills are libraries by default. `Topia hooks install` turns them into a **runtime**: your IDE auto-invokes `readiness`, `guardian`, `dependency-doctor`, `completion-gate`, and `quarantine` at the right moments — before you commit insecure code, before you forget to run tests, before you ship a half-finished change, before you trust an untrusted external content blob.

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
| Cursor      | beta         | rule-inject + **hooks.json** | —        | —         | sessionEnd / stop | `.cursor/rules/Topia-*.mdc` + `.cursor/hooks.json` |
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

Merges into the `hooks` object, preserving any user-authored entries. Topia entries are identified by their `hook-dispatch <skill>` command signature — no comment markers needed.

Hooks point at a **stable launcher shim** that Topia installs at `<scope>/.claude/topia/hook-dispatch.cjs` (project) or `~/.claude/topia/hook-dispatch.cjs` (global), referenced for project scope via `${CLAUDE_PROJECT_DIR}`. The launcher lives **outside** the versioned plugin cache, so it survives plugin upgrades; at hook runtime it resolves the *active* plugin install — anchored on the plugin manifest (`.claude-plugin/plugin.json`), never a cache directory name — and delegates to `compiler/bin/topia.js hook-dispatch`.

> Why not `${CLAUDE_PLUGIN_ROOT}` directly? Claude Code only expands `${CLAUDE_PLUGIN_ROOT}` for hooks declared in a plugin's bundled `hooks/hooks.json` — **not** in user/project `settings.json` ([docs](https://code.claude.com/docs/en/hooks)). And an absolute plugin-cache path pins to a version directory that upgrades delete (`Cannot find module .../cache/<owner>/topia/<version>/compiler/bin/topia.js`). The launcher avoids both traps.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs\" hook-dispatch readiness --gentle" }] },
      { "matcher": "Bash",        "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs\" hook-dispatch guardian --gentle" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs\" hook-dispatch dependency-doctor --gentle" }] }
    ],
    "Stop": [
      { "matcher": ".*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs\" hook-dispatch completion-gate --gentle" }] }
    ]
  }
}
```

### Cursor (`.cursor/rules/Topia-*.mdc` + `.cursor/hooks.json`)

**Discipline rules** (three auto-attach `.mdc` files):

- `Topia-readiness.mdc` — `alwaysApply: true`, fires before any source-file edit.
- `Topia-guardian.mdc` — glob-scoped to shell / infra / env files.
- `Topia-dependency-doctor.mdc` — scoped to manifest / lockfile edits.

**Metrics hooks** (native `.cursor/hooks.json`, installed by `topia hooks install --platform cursor`):

- `sessionStart` → session-start
- `postToolUse` → token-meter (all tools) + metrics-collector (Skill)
- `preCompact` → pre-compact (records **measured** context tokens)
- `sessionEnd` / `stop` → post-session-reflect (flush to `.topia/metrics/`)

Invoke `/topia completion-gate` manually before wrapping up — no native completion-gate on Cursor.

See [`TOKEN-METRICS.md`](TOKEN-METRICS.md) for token confidence tiers and baseline A/B setup.

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

## Cursor and third-party hooks

When **Third-party skills** is enabled in Cursor, Claude Code hook entries (plugin `hooks/hooks.json` and `.claude/settings.json` `hook-dispatch` commands) are mapped to Cursor events (`sessionStart`, `preToolUse`, `postToolUse`, `stop`, etc.). Cursor requires **JSON on stdout** for command hooks — plain-text lines cause parse errors.

Topia handles this via [`hooks/lib/cursor-io.cjs`](../hooks/lib/cursor-io.cjs):

- Detects Cursor using `CURSOR_VERSION`, `CURSOR_PROJECT_DIR`, or stdin `cursor_version` / `hook_event_name`.
- Plugin hooks (`session-start`, `quarantine`, `post-session-reflect`, `pre-tool-guard`) emit `{ additional_context }`, `{ permission }`, or `{}` as appropriate.
- `hook-dispatch` emits event-shaped JSON (`permission` for `preToolUse`, `additional_context` for `postToolUse`).

**Not topia:** a `stop` hook that runs `bun run …` comes from a user or team `~/.cursor/hooks.json` template, not from this repository. Remove it or install Bun.

**Debugging:** Cursor Settings → Hooks tab + Hooks output channel. See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) §6.

## Context lifecycle hooks (Claude Code plugin)

These ship in plugin [`hooks/hooks.json`](../hooks/hooks.json) and automate checkpoint + compact boundaries:

| Hook | Event | Behavior |
|------|-------|----------|
| `context-watch` | `PreToolUse` (all tools) | Counts tool calls; YELLOW/ORANGE/RED warnings aligned with `context-engine` |
| `pre-compact` | `PreCompact` | Headless `checkpoint-from-hook.js` → `.topia/checkpoint.md` + metrics |
| `post-compact` | `PostCompact` | Re-injects checkpoint + progress after `/compact` |
| `git-push-checkpoint` | `PreToolUse` (`Bash`, `git push`) | Checkpoint before push; recommends compact or new session |
| `tool-collector` | `PostToolUse` (all) | Per-tool totals → `.topia/metrics/tools.json` at session end |

Agent follow-up: invoke `topia:context-lifecycle` when hook messages appear. Baseline summary: `npm run metrics:baseline`.

## Limitations

- Only Claude Code gets native `Stop` (completion-gate) via settings presets without third-party mapping quirks.
- `PostCompact` and `git-push-checkpoint` require the Topia plugin hooks bundle (not Cursor `.cursor/hooks.json` alone unless extended). Cursor maps `Stop` → `stop` and also provides `sessionEnd` for metrics flush when `.cursor/hooks.json` is installed.
- Cursor/Windsurf/Antigravity **rule** install (`Topia hooks install --platform cursor`) is best-effort — the LLM still decides whether to read rules. Native Cursor `hooks.json` is separate from `.mdc` rules.
- `Topia hooks status --platform all` is the single source of truth for "what am I actually getting on this machine." Check it after install.

See also: `docs/MULTI-PLATFORM.md` (skill compilation matrix).
