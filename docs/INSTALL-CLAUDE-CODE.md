# Install Topia on Claude Code

Two lines inside Claude Code. That's the whole install for 95% of users.

---

## Install (in Claude Code — no terminal needed)

Paste these into a Claude Code session:

```text
/plugin marketplace add linenoize/topia
/plugin install Topia@linenoize
```

Restart Claude Code if `/Topia:build` does not appear.

**That is the complete install.** When the plugin loads you get:

- All 66 skills (`/Topia:build`, `/Topia:plan`, …) and the `/topia` router command
- All 64 subagents
- All 11 discipline hooks — session-start, secrets-scan, quarantine, auto-format, typecheck, metrics-collector, pre-tool-guard, intent-router, context-watch, pre-compact, post-session-reflect
- File-based memory in `.topia/`

Nothing else is required.

---

## Optional: `/topia finalize` (still no terminal)

The plugin install covers the core experience. `/topia finalize` is a one-shot, in-chat command that opts you into the **extras**:

```text
/topia finalize
```

It will ask you which to enable:

| Extra | What it adds | Default |
|-------|--------------|---------|
| **System-wide dispatch hooks** | `readiness`, `guardian`, `completion-gate`, `dependency-doctor` fire even in repos without the plugin (writes to `~/.claude/settings.json`, gentle preset) | recommended |
| **agora-code MCP** | Persistent cross-project memory (requires Python 3.10+). Skills gracefully degrade to file-based `.topia/` without it | optional |
| **Project `.gitignore` rules** | Adds Topia-managed entries to `./.gitignore` for the current repo | optional |

Reversible at any time. Idempotent — re-run as often as you like. Writes `.topia/.finalized` so the first-run nudge stops appearing.

Flags:

- `/topia finalize --strict` — strict preset instead of gentle
- `/topia finalize --skip-agora` — skip the Python MCP step
- `/topia finalize --all` — enable everything (still respects `--skip-agora`)
- `/topia finalize --reset` — re-prompt next session

See [`commands/finalize.md`](../commands/finalize.md) for the full behavior contract.

---

## Skill names and commands

| Surface | Example |
|---------|---------|
| Plugin namespace (skills) | `/Topia:build`, `/Topia:plan` |
| Router command | `/topia build`, `/topia doctor` |

Both work when the plugin is enabled. The `Topia` prefix comes from `.claude-plugin/plugin.json` → `"name": "Topia"`.

---

## After install (each application repo)

| Step | Action |
|------|--------|
| Onboard | `/topia onboard` or `/Topia:onboard` |
| Rune migration | If `.rune/` exists: `/topia migrate-from-rune` (or run the CLI from a clone) |
| Verify | `/topia doctor` (or `node <skill-topia>/compiler/bin/topia.js doctor` from a clone) |

---

## Advanced

### CLI alternative (terminal)

For contributors, air-gapped installs, or users who prefer a clone:

```bash
git clone https://github.com/linenoize/topia.git
cd skill-topia && npm install
node compiler/bin/topia.js install
```

This is the equivalent of `/plugin install Topia@linenoize` + `/topia finalize` from the terminal.

Stable clone location (optional convention):

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/linenoize/topia.git ~/.claude/skills/skill-topia
cd ~/.claude/skills/skill-topia && npm install && node compiler/bin/topia.js install
```

**Windows path pitfall (Git Bash `mkdir -p`):** Never pass Windows absolute paths or `folder:C:\...` hybrids:

| Bad | Stray folder created |
|-----|----------------------|
| `mkdir -p C:\CodeBase\tools\proj\screenshots` | `C?CodeBase?tools?...` or `CCodeBasetoolsprojscreenshots` |
| `mkdir -p alembic:C:\CodeBase\tools\proj\alembic` | `alembic;C`, `app;C`, `tests;C` (empty) |

Use relative dirs from the project root, `node -e "require('fs').mkdirSync('.topia',{recursive:true})"`, or `node path/to/skill-topia/scripts/ensure-dir.mjs .topia`. Scan for damage: `node path/to/skill-topia/scripts/scan-mangled-windows-dirs.js --root .`

On Windows PowerShell, use the version folder name instead of the `*` glob (e.g. `2.0.5`), or run from a clone:

```powershell
cd path\to\skill-topia
node compiler/bin/topia.js setup --global --preset gentle
```

**Do not use `npx @linenoize/topia`** unless the npm package is published to your registry — a private GitHub repo does not make npm work.

### Scriptable / CI

```bash
claude plugin marketplace add linenoize/topia
claude plugin install Topia@linenoize
node compiler/bin/topia.js install --yes --skip-agora     # finalize non-interactively
```

### Private GitHub repo

Set `GITHUB_TOKEN` or `GH_TOKEN` with `repo` scope, then use the same `/plugin` commands. See [Claude plugin marketplaces — private repositories](https://code.claude.com/docs/en/plugin-marketplaces#private-repositories).

### Team auto-install

Merge [`docs/templates/team-claude-settings.json`](templates/team-claude-settings.json) into each repo's `.claude/settings.json` (or your org template). Teammates are prompted to add the linenoize marketplace when they trust the project folder.

### Two hook layers (reference)

1. **Plugin hooks** (`hooks/hooks.json`) — loaded automatically when the plugin is enabled. These are the 11 hooks listed above and need no extra install.
2. **Dispatch hooks** (added by `/topia finalize` or `topia setup --global`) — writes `node …/compiler/bin/topia.js hook-dispatch` entries into `~/.claude/settings.json` so `readiness`/`guardian`/`completion-gate`/`dependency-doctor` apply system-wide.

Plugin hooks alone cover the essentials. Dispatch hooks are the "extras" that `/topia finalize` enables.

---

## Updates

Claude Code only offers an update when the **published catalog version** is newer than your cached plugin. That version comes from `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (both must match `package.json` — use `node scripts/bump-version.js X.Y.Z` before you push a release).

### Pull a new release (users)

```text
/plugin marketplace update protopia
/plugin update Topia@linenoize
/reload-plugins
```

Restart Claude Code if skills or hooks still look stale after `/reload-plugins`.

**Local clone instead of marketplace:** `git pull` in the skill-topia directory, then `/reload-plugins`.

### After updating

| What | Needed after update? |
|------|----------------------|
| Skills (`/Topia:*`, `/topia …`) | No — picked up from the new plugin tree after reload/restart. |
| Plugin hooks (session-start, secrets-scan, quarantine, …) | No — they use `${CLAUDE_PLUGIN_ROOT}` and follow the installed plugin automatically. |
| Dispatch hooks (`readiness`, `guardian`, `completion-gate`, `dependency-doctor` from `topia setup --global`) | **Re-run setup once** — `~/.claude/settings.json` stores a fixed path to `topia.js` in the plugin cache; a new version folder may leave dispatch hooks pointing at the old copy. |

**Re-wire dispatch hooks** (recommended after every plugin update if you use `setup --global`; always safe):

```bash
node ~/.claude/plugins/cache/linenoize/Topia/*/compiler/bin/topia.js setup --global --preset gentle
```

On Windows, replace `*` with the version folder (e.g. `2.0.2`), or run from your clone:

```powershell
cd path\to\skill-topia
node compiler\bin\topia.js setup --global --preset gentle
```

**Optional checks:**

```bash
node <path-to-topia>/compiler/bin/topia.js doctor --hooks
```

**Per application repo** (only when release notes call for it — e.g. `.topia/` path normalization): `/topia onboard` or `node …/skills/onboard/scripts/onboard-invariants.js --root .` in that project. Routine skill updates do not require re-onboard.

### Publish a release (maintainers)

```bash
node scripts/bump-version.js X.Y.Z    # package.json, plugin.json, marketplace.json, docs/index.html
# Edit CHANGELOG.md and README "What's New" manually
node scripts/version-sync-check.js
claude plugin validate .
git commit && git push
```

Users can then run the **Pull a new release** steps above.

---

## Validate before publishing changes

From the repo root:

```bash
claude plugin validate .
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin not in menu | `/plugin marketplace add linenoize/topia` then install; restart Claude |
| `/topia` missing | `/reload-plugins` or restart |
| Hooks not firing | Re-run `node …/topia.js setup --global`; `node …/topia.js doctor --hooks` |
| `npm 404` on `@linenoize/topia` | Expected if unpublished — use `node …/topia.js` from clone or plugin cache, not `npx` |
| Relative path install fails | Add marketplace via **git** (`linenoize/topia`), not a raw URL to `marketplace.json` only |
| Update: Plugin "Topia" not found | Marketplace id must match `plugin.json` → use `Topia@linenoize`. Run `/plugin marketplace update linenoize` then `/plugin update Topia@linenoize`. |

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
