# Troubleshooting Topia

Common issues and how to fix them.

---

## 0. CLI Path Errors

**Symptoms:**
- `node compiler/bin/topia.js` → "Cannot find module" or "No such file"
- `topia: command not found`
- `Fatal: The "path" argument must be of type string. Received undefined` on `init` or `build`
- Ran `--platform cursor` and nothing happened (or only help text)

**Causes:**
- `node compiler/bin/topia.js` is a **relative path inside the Topia repo or plugin cache**, not your application project.
- The bare `topia` command is only on PATH after `npm link` or global install from a clone — the Claude plugin does not add it.
- Passing `--platform` without the `init` subcommand shows help instead of compiling.
- Older Topia builds had a `topiaRoot` / `TopiaRoot` casing bug in `init` / `build` (fixed in current source).

**Fixes:**
- **Find the CLI:** from a clone run `node compiler/bin/topia.js where`; from plugin cache see [`INSTALL.md`](INSTALL.md#finding-the-cli).
- **Full init command:** `node "<path>/compiler/bin/topia.js" init --platform cursor` (not just `--platform cursor`).
- **Claude-only users:** use `/topia doctor` and `/topia finalize` in chat — no terminal required for core skills.
- **Cursor with plugin only:** plugin install does not compile Cursor rules — run `init --platform cursor` from your project.
- **Upgrade Topia** if you hit the undefined `path` error on a recent install.

---

## 1. Skill Not Found

**Symptoms:**
- `/topia <name>` returns "Command not found"
- Claude says "I don't have a skill named <name>"

**Fixes:**
- **Run `topia doctor`** (in chat: `/topia doctor`; terminal: see [§0 CLI Path Errors](#0-cli-path-errors)).
- **Check `.claude/settings.json`**: Ensure the plugin path is correct in `installed_plugins`.
- **Re-init (non-Claude):** `node "<path-to-topia>/compiler/bin/topia.js" init --platform cursor` from your project root.
- **Pathing**: If using Cursor/Windsurf, ensure you are in the project root where `.cursor/rules` or `.windsurf/rules` live.

---

## 2. Hooks Not Auto-Firing

**Symptoms:**
- You edit a file and `readiness` doesn't run.
- You run a shell command and `guardian` doesn't run.

**Fixes:**
- **Re-install hooks**: `node compiler/bin/topia.js setup --global --preset gentle` (or `/topia finalize` in chat).
- **Stale version paths**: If Stop/PreToolUse hooks error with `Cannot find module .../plugins/cache/.../topia.js` (or `.../hook-dispatch.cjs`), your `settings.json` points at a plugin path that an upgrade removed. Re-run setup above — current Topia routes hooks through a **stable launcher** at `<scope>/.claude/topia/hook-dispatch.cjs` that lives outside the versioned plugin cache and re-resolves the active install at runtime, so hooks survive upgrades. (Older Topia baked an absolute cache path, or `${CLAUDE_PLUGIN_ROOT}` which Claude Code does **not** expand in `settings.json` — both rot on upgrade.) On the next session, Topia also prints a one-line warning when it detects a stale hook path.
- **Check Scope**: If you installed with `--global`, check `~/.claude/settings.json`. If local, check `<project>/.claude/settings.json`.
- **IDE Support**: Remember that only Claude Code has 100% hook parity. Cursor and Windsurf use "best effort" rule injection. See [`HOOKS.md`](HOOKS.md) for the capability matrix.

---

## 3. High Token Usage / Cost

**Symptoms:**
- Claude usage dashboard shows high token counts for simple tasks.
- `team` skill is blowing the budget.

**Fixes:**
- **Use `build` instead of `team`**: `team` is for large multi-file refactors. For 90% of tasks, `build` is more efficient.
- **Disable unused skills**: Run `node compiler/bin/topia.js init --disable <names>` to prune skills you don't need.
- **Check context window**: If context is > 80% full, Claude gets "chatty" and less efficient. Use `/compact` (Claude Code) to clear history.

---

## 4. Signal Loops

**Symptoms:**
- `build` gets stuck in a loop (e.g., test → debug → fix → test → debug...).

**Fixes:**
- **Mental Break**: Use `topia:brainstorm` to challenge the current approach.
- **Manual Intervention**: Stop the agent, fix the environment issue (e.g., missing dependency) that's causing the test failure, and resume.
- **Limit Depth**: Topia has built-in loop prevention (max 2 visits per skill), but some complex cycles can still emerge.

---

## 5. Environment Mismatches

**Symptoms:**
- `verification` fails because of a missing tool (e.g., `npm`, `python`).
- `guardian-env` flags a missing binary.

**Fixes:**
- **Install the tool**: Topia uses your local environment. If the skill needs `biome`, you must have it installed.
- **Check PATH**: Ensure the tool is in your shell's PATH.

---

## 6. Cursor Hook JSON Parse Errors

**Symptoms:**
- Hooks output channel shows `JSON Parse Error: Unexpected token 'T', "Topia-hook"...` on `postToolUse` or `sessionStart`.
- Agent edits are blocked: `hook-dispatch ... returned invalid JSON`.
- `stop` hook fails with `bun : The term 'bun' is not recognized`.

**Causes:**
- Cursor loads Claude Code / third-party hooks and requires **valid JSON on stdout** for every command hook.
- Older Topia builds printed plain text (`Topia-hook: …`, `[topia: .topia/ …]`) instead of JSON.
- A `bun run …` stop hook in `~/.cursor/hooks.json` is from Cursor’s docs example — Topia plugin hooks use `node`, not Bun.

**Fixes:**
- **Update Topia** to a build that includes `hooks/lib/cursor-io.cjs` and JSON-aware hook scripts (this repo).
- **Settings → Hooks**: remove any `bun run` hook you did not add intentionally, or install [Bun](https://bun.sh).
- **Third-party skills**: with “Third-party skills” enabled, both plugin `hooks/hooks.json` and `.claude/settings.json` dispatch hooks run in Cursor — ensure both are updated.
- **Debug**: open the **Hooks** tab in Cursor Settings and the **Hooks** output channel for the exact command and stderr.
- **Re-install dispatch hooks** after updating: `node compiler/bin/topia.js setup --here --preset gentle` (or `--global`).
- **Note**: `Topia hooks install --platform cursor` installs `.cursor/rules/Topia-*.mdc` rules only, not native `.cursor/hooks.json` entries.
