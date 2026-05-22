# Install Topia on Claude Code

Topia ships as a native Claude Code plugin with an optional **Protopia marketplace** catalog. Use the marketplace flow for the normal plugin menu experience; use `topia install` when you have cloned the repo locally.

---

## Recommended: marketplace + plugin menu

Works for any machine with Claude Code — no manual clone required for the plugin itself.

### In Claude Code (interactive)

```text
/plugin marketplace add protopia/skill-topia
/plugin install Topia@protopia
/reload-plugins
```

Then wire global discipline hooks (one-time per machine). **Do not use `npx @protopia/skill-topia`** unless the package is published to your npm registry — a private GitHub repo does not make npm work.

**After marketplace install** (auto-finds the plugin cache):

```bash
node ~/.claude/plugins/cache/protopia/Topia/*/compiler/bin/topia.js setup --global --preset gentle
```

On Windows PowerShell, use the version folder name instead of `*` (e.g. `2.0.1`), or run from a clone:

```powershell
cd path\to\skill-topia
node compiler/bin/topia.js setup --global --preset gentle
```

Restart Claude Code if `/Topia:build` or `/topia build` does not appear.

### CLI (scriptable)

```bash
claude plugin marketplace add protopia/skill-topia
claude plugin install Topia@protopia
# Then wire hooks from the installed plugin (see "node … setup" above), or from a clone.
```

### Private GitHub repo

Set `GITHUB_TOKEN` or `GH_TOKEN` with `repo` scope, then use the same commands. See [Claude plugin marketplaces — private repositories](https://code.claude.com/docs/en/plugin-marketplaces#private-repositories).

### Team auto-install (optional)

Merge [`docs/templates/team-claude-settings.json`](templates/team-claude-settings.json) into each repo’s `.claude/settings.json` (or your org template). Teammates are prompted to add the Protopia marketplace when they trust the project folder.

---

## Alternative: clone + `topia install`

For contributors or air-gapped installs. Uses the marketplace catalog from your local clone when `marketplace.json` is present.

```bash
git clone https://github.com/protopia/skill-topia.git
cd skill-topia
npm install
node compiler/bin/topia.js install
```

Restart Claude Code afterward.

Stable clone location (optional convention):

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/protopia/skill-topia.git ~/.claude/skills/skill-topia
cd ~/.claude/skills/skill-topia && npm install && node compiler/bin/topia.js install
```

---

## After install (each application repo)

| Step | Action |
|------|--------|
| Onboard | `/topia onboard` or `/Topia:onboard` |
| Rune migration | If `.rune/` exists: `node path/to/skill-topia/compiler/bin/topia.js migrate-from-rune` |
| Team policy | Edit `skill-topia/.topia/org/org.md` in the clone, then `topia setup --global` |
| Verify | `node <skill-topia>/compiler/bin/topia.js doctor` |

---

## Skill names and commands

| Surface | Example |
|---------|---------|
| Plugin namespace (skills) | `/Topia:build`, `/Topia:plan` |
| Router command | `/topia build`, `/topia doctor` |

Both work when the plugin is enabled. The `Topia` prefix comes from `.claude-plugin/plugin.json` → `"name": "Topia"`.

---

## Two hook layers

1. **Plugin hooks** (`hooks/hooks.json`) — loaded automatically when the plugin is enabled (session-start, secrets-scan, quarantine, etc.).
2. **Dispatch hooks** (`topia setup --global`) — writes `node …/compiler/bin/topia.js hook-dispatch` entries into `~/.claude/settings.json` (local path from clone or plugin cache; not `npx` unless the npm package is published).

Most teams want **plugin install + `setup --global`**.

---

## Updates

Claude Code only offers an update when the **published catalog version** is newer than your cached plugin. That version comes from `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (both must match `package.json` — use `node scripts/bump-version.js X.Y.Z` before you push a release).

### Pull a new release (users)

```text
/plugin marketplace update protopia
/plugin update Topia@protopia
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
node ~/.claude/plugins/cache/protopia/Topia/*/compiler/bin/topia.js setup --global --preset gentle
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
| Plugin not in menu | `/plugin marketplace add protopia/skill-topia` then install; restart Claude |
| `/topia` missing | `/reload-plugins` or restart |
| Hooks not firing | Re-run `node …/topia.js setup --global`; `node …/topia.js doctor --hooks` |
| `npm 404` on `@protopia/skill-topia` | Expected if unpublished — use `node …/topia.js` from clone or plugin cache, not `npx` |
| Relative path install fails | Add marketplace via **git** (`protopia/skill-topia`), not a raw URL to `marketplace.json` only |
| Update: Plugin "Topia" not found | Marketplace id must match `plugin.json` → use `Topia@protopia`, not `skill-topia@protopia`. Run `/plugin marketplace update protopia` then `/plugin update Topia@protopia`. If you installed under the old id: `/plugin uninstall skill-topia@protopia` then `/plugin install Topia@protopia` |

See [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
