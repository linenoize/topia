# Troubleshooting Topia

Common issues and how to fix them.

---

## 1. Skill Not Found

**Symptoms:**
- `/topia <name>` returns "Command not found"
- Claude says "I don't have a skill named <name>"

**Fixes:**
- **Run `Topia doctor`**: Checks if skills are compiled correctly for your platform.
- **Check `.claude/settings.json`**: Ensure the plugin path is correct in `installed_plugins`.
- **Re-init**: Run `npx @linenoize/topia init` to re-generate platform rule files.
- **Pathing**: If using Cursor/Windsurf, ensure you are in the project root where `.cursor/rules` or `.windsurf/rules` live.

---

## 2. Hooks Not Auto-Firing

**Symptoms:**
- You edit a file and `preflight` doesn't run.
- You run a shell command and `sentinel` doesn't run.

**Fixes:**
- **Re-install hooks**: `npx @linenoize/topia hooks install --preset gentle`.
- **Check Scope**: If you installed with `--global`, check `~/.claude/settings.json`. If local, check `<project>/.claude/settings.json`.
- **IDE Support**: Remember that only Claude Code has 100% hook parity. Cursor and Windsurf use "best effort" rule injection. See [`HOOKS.md`](HOOKS.md) for the capability matrix.

---

## 3. High Token Usage / Cost

**Symptoms:**
- Claude usage dashboard shows high token counts for simple tasks.
- `team` skill is blowing the budget.

**Fixes:**
- **Use `build` instead of `team`**: `team` is for large multi-file refactors. For 90% of tasks, `build` is more efficient.
- **Disable unused skills**: Run `npx @linenoize/topia init --disable <names>` to prune skills you don't need.
- **Check context window**: If context is > 80% full, Claude gets "chatty" and less efficient. Use `/compact` (Claude Code) to clear history.

---

## 4. Signal Loops

**Symptoms:**
- `build` gets stuck in a loop (e.g., test → debug → fix → test → debug...).

**Fixes:**
- **Mental Break**: Use `Topia:brainstorm` to challenge the current approach.
- **Manual Intervention**: Stop the agent, fix the environment issue (e.g., missing dependency) that's causing the test failure, and resume.
- **Limit Depth**: Topia has built-in loop prevention (max 2 visits per skill), but some complex cycles can still emerge.

---

## 5. Environment Mismatches

**Symptoms:**
- `verification` fails because of a missing tool (e.g., `npm`, `python`).
- `sentinel-env` flags a missing binary.

**Fixes:**
- **Install the tool**: Topia uses your local environment. If the skill needs `biome`, you must have it installed.
- **Check PATH**: Ensure the tool is in your shell's PATH.
