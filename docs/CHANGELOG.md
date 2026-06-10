# Changelog

All notable changes to Topia will be documented in this file.

---

## [3.3.2] — 2026-06-10

Discipline hooks now route through a stable launcher shim — the v3.3.1 `${CLAUDE_PLUGIN_ROOT}` approach did not actually work in `.claude/settings.json`.

### Fixed

- **`.claude/settings.json` dispatch hooks no longer rot on plugin upgrade.** `${CLAUDE_PLUGIN_ROOT}` is only expanded by Claude Code in a plugin's bundled `hooks/hooks.json`, **not** in user/project `settings.json` ([docs](https://code.claude.com/docs/en/hooks)) — so v3.3.1 replaced a stale absolute path with an unexpanded literal, both producing `Cannot find module …/topia.js`. Hooks now invoke a stable launcher at `<scope>/.claude/topia/hook-dispatch.cjs` (project ref via `${CLAUDE_PROJECT_DIR}`, global via absolute home path) that lives outside the versioned plugin cache and re-resolves the active install at runtime.

### Added

- **`compiler/assets/hook-dispatch-launcher.cjs`** — version-stable launcher; resolves the plugin via env → manifest-walk → newest-by-version cache scan, anchored on `.claude-plugin/plugin.json` (never a cache directory name, so namespace migrations resolve with no code change). Fail-open so a missing install never blocks a session.
- **`compiler/commands/hooks/launcher.js`** — launcher install + reference helpers.
- **`hooks/session-start/index.cjs`** — warns when a concrete hook path is stale, pointing users to `/topia finalize` for repair.

### Changed

- **`compiler/commands/hooks/resolve-topia-root.js`** — manifest-anchored resolution (`findPluginRootFromFile`) + generalized, namespace-agnostic cache scan replacing the hardcoded owner list.
- **`compiler/adapters/hooks/claude.js`**, **`compiler/commands/hooks/presets.js`** — emit + reference the launcher; broadened managed-command matching still strips legacy `topia.js` and `${CLAUDE_PLUGIN_ROOT}` entries for clean migration.
- **`docs/HOOKS.md`**, **`docs/TROUBLESHOOTING.md`** — document the launcher and corrected stale-path recovery.

---

## [3.3.1] — 2026-06-07

Hook dispatch commands use `${CLAUDE_PLUGIN_ROOT}` so discipline hooks survive plugin upgrades without re-running setup.

### Fixed

- **`compiler/commands/hooks/presets.js`** — `.claude/settings.json` dispatch hooks now use `node "${CLAUDE_PLUGIN_ROOT}/compiler/bin/topia.js" hook-dispatch"` instead of version-pinned absolute cache paths (fixes `MODULE_NOT_FOUND` after upgrading from e.g. protopia/Topia/2.0.2).
- **`compiler/commands/hooks/resolve-topia-root.js`** — also resolves via `CLAUDE_PLUGIN_ROOT` at CLI runtime.

### Changed

- **`docs/HOOKS.md`**, **`docs/TROUBLESHOOTING.md`** — document env-var dispatch pattern and stale-path recovery.

---

## [3.3.0] — 2026-06-06

Install flow clarity, team org policy skill, `topia memory seed` for agora-code users, and fork sync tooling for `protopia/skill-topia`.

### Added

- **Fork sync tooling** — [`docs/FORK-SYNC.md`](FORK-SYNC.md), [`scripts/sync-to-skill-topia.mjs`](../scripts/sync-to-skill-topia.mjs), [`scripts/port-to-protopia.mjs`](../scripts/port-to-protopia.mjs), [`scripts/fork-drift-check.mjs`](../scripts/fork-drift-check.mjs), shared [`scripts/lib/rebrand-pairs.js`](../scripts/lib/rebrand-pairs.js). Normal release direction: merge topia → skill-topia, then rebrand protopia identifiers.

- **`topia:org-config`** (L2) + `/topia org-config` command — interview-driven setup for `.topia/org/org.md` (teams, roles, policies, approval flows, governance level). `guardian` and `readiness` inject `<ORG-POLICY>` from this file at compile time.
- **`topia memory seed`** — imports `.topia/` decisions, ADRs, and conventions into agora-code SQLite (idempotent via `.topia/.agora-seed.json` content hash).
- **`docs/INSTALL.md`** — unified install guide (Claude Code Step 1 plugin + Step 2 finalize + per-repo onboard/org-config).
- **`docs/INSTALL-NON-CLAUDE.md`** — Cursor / Windsurf / Antigravity / Codex path via `topia init`.
- **`hooks/agora-learn-commit`** + **`hooks/lib/agora-detect.cjs`** — post-commit learning hook for agora-code when installed.
- **`compiler/__tests__/init-cli.test.js`**, **`compiler/__tests__/memory-seed.test.js`** — coverage for init and memory-seed flows.

### Changed

- **README install section** — two-step model: `/plugin install` then `/topia finalize`; per-repo onboard → org-config → doctor; team policy section for `org.md`.
- **`commands/finalize.md`** — org-config interview as Step 2b; `--skip-org` flag.
- **`compiler/bin/topia.js`** — `init` subcommand improvements; `memory seed` wired; install/help text updated.
- **`compiler/commands/install.js`** — expanded orchestration and flags.
- **`skills/onboard/scripts/detect-l4-packs.js`** — richer L4 pack auto-detection.
- **Author identity** — `skill-topia` → `topia` across package.json, plugin.json, marketplace.json, LICENSE.
- **Session-start menu** — lists `/topia org-config` alongside finalize / onboard / doctor / faq / tut.

### Counts

- Skills: 69 → **70** (added `org-config`).

### Tests

- 1119 pass, 0 fail, 3 skipped (1122 total).

---

## [3.2.2] — 2026-05-26

Fixes `agora-code memory-server` crashing on Windows + Python 3.13 — downstream user reported `OSError [WinError 6] "The handle is invalid"` followed by an `AttributeError` on `_empty_waiter`. Also adds tag-driven npm publishing via CI.

### Added

- **`.github/workflows/npm-publish.yml`** — pushing a `v*` tag (e.g. `git tag v3.2.2 && git push origin v3.2.2`) runs `npm ci` → `npm test` → tag/version guard → `npm publish --access public --provenance`. Removes the manual `npm publish` + 2FA OTP step; CI authenticates with an npm **Automation** token stored as the `NPM_TOKEN` repo secret. A `workflow_dispatch` dry-run path validates packing without writing to the registry. See [`docs/VERSIONING.md`](VERSIONING.md#release-process-npm-publish-via-ci).

### Fixed

- **`mcp-servers/agora-code/agora_code/memory_server.py` :: `serve_memory()`** — read stdin via a thread executor (`loop.run_in_executor(None, sys.stdin.readline)`) on Windows. Upstream uses `asyncio.connect_read_pipe(sys.stdin)`, which requires an IOCP-compatible (overlapped) handle. Windows console handles aren't IOCP-compatible, and the non-overlapped pipes that Node.js parents (Claude Code, Cursor) create with `CreatePipe()` aren't either — so `connect_read_pipe` raises `WinError 6`. On Python 3.13 the failure is masked by an `AttributeError` on `_empty_waiter` (CPython regression in `asyncio.proactor_events`). The patched path works on both interactive console handles and inherited non-overlapped pipes, and is identical to upstream on non-Windows.

### Notes

- Topia fork patch — marked with a "Modified (Topia fork, 2026-05-26)" comment in the source per Apache 2.0 §4(b).
- Documented in [`mcp-servers/agora-code/NOTICE-TOPIA.md`](../mcp-servers/agora-code/NOTICE-TOPIA.md) under "Local patches" so future upstream syncs preserve it. The `rsync` snippet in NOTICE-TOPIA blows the patch away on every refresh — re-apply manually after each.
- Non-Windows users see no change.
- Three workarounds we previously suggested (downgrade to Python 3.11/3.12, use WSL, hand-patch) are no longer needed for users who reinstall `agora-code` from this version's vendored copy: `pip install --force-reinstall ~/.claude/plugins/cache/linenoize/topia/<version>/mcp-servers/agora-code`.

---

## [3.2.1] — 2026-05-26

Critical install fix driven by downstream user report: `/plugin install topia@linenoize` failed with `git@github.com: Permission denied (publickey)` for any user without GitHub SSH keys configured.

### Fixed

- **Marketplace plugin source switched from `{ source: "github", repo: ... }` to `{ source: "url", url: "https://github.com/linenoize/topia.git" }`.** Claude Code's plugin manager resolves the `github` source type to an SSH URL (`git@github.com:owner/repo`), which fails for the majority of users — most never set up GitHub SSH keys. The `url` source with an explicit `https://...git` URL forces HTTPS so the clone works for everyone. Same install command from the user's side (`/plugin install topia@linenoize`); they just won't get the SSH error anymore.
- **`scripts/port-rebrand.mjs`** — SCOPED entry for marketplace.json now rewrites both upstream's `"./"` form AND any stale `{ source: "github", repo: ... }` form to the new HTTPS `url` object. Idempotent — re-running on an already-fixed tree is a no-op.
- **`scripts/__tests__/marketplace.test.js`** — assertions updated to verify the `url` source shape with an explicit `https://` URL.

### Notes

- Upgrade path for existing users: run `/plugin marketplace update linenoize` then `/plugin install topia@linenoize` again. Existing installs are not affected (the SSH issue only blocks fresh clones).
- The plugin cache path is unchanged. The plugin name, displayName, all skill namespaces, and every command are unchanged. This is a pure source-URL fix.

---

## [3.2.0] — 2026-05-26

Adds two L3 discoverability skills and a WSL note on the cache-path quirk.

### Added

- **`topia:faq`** — lists every HTML entry point Topia ships (bundled docs in the plugin cache, GitHub Pages mirror, on-demand visualizer) with copy-pasteable open-in-browser commands for Windows / macOS / Linux / WSL. Use when a user can't find the docs or asks "where's the skill graph?" Read-only.
- **`topia:tut`** — re-shows the structured first-run menu (finalize / onboard / doctor / faq / help) with current completion status. Mirrors the heuristics in `hooks/session-start/index.cjs` `detectFinalizeNudge()` so check-marks reflect real state. Replays unconditionally — useful after the session-start menu has been dismissed. Beginner / intermediate / advanced *tutorial tracks* are not yet shipped; this is the menu re-entry point for v3.2.0.
- **Session-start menu** now lists `/topia:faq` and `/topia:tut` alongside `finalize` / `onboard` / `doctor`, so new users discover them.
- **WSL section in `docs/INSTALL-SCOPES.md`** — explains that DrvFs honors NTFS case-insensitivity for `/mnt/c/...` paths, so the lowercase plugin-cache path resolves correctly even when the on-disk directory is `Topia/`. Documents the rare per-directory case-sensitivity escape hatch and notes both `commands/finalize.md` and `compiler/commands/hooks/resolve-topia-root.js` fall back to the capital-T form to cover it.

### Counts

- Skills: 67 → **69** (added `faq`, `tut`).

### Tests

- All 1097 → 1109 pass, 0 fail, 3 skipped. (12 new tests exercise the new skills via the validate-skills integration suite.)

---

## [3.1.3] — 2026-05-26

Cleanup driven by a user report of a `cache\linenoize\Topia\3.1.1` path showing the legacy capital-T directory name even after upgrading to v3.x.

### Fixed

- **`commands/finalize.md`** — the bash that locates the plugin cache referenced `cache/linenoize/Topia/` (capital T from the v2.x days). Flipped to lowercase `topia/` (canonical since v3.0.0). The capital-T path is now a secondary fallback so users upgrading from v2.x on case-insensitive filesystems aren't stranded.
- **`docs/INSTALL-CLAUDE-CODE.md`** — the post-update "re-wire dispatch hooks" command flipped from `cache/linenoize/Topia/*` to `cache/linenoize/topia/*`. Added a note explaining the Windows / macOS case-preservation behavior so users seeing the capital-T directory on disk don't panic.

### Docs

- **`docs/INSTALL-SCOPES.md`** — new "How the plugin cache is laid out" section explaining versioned cache directories, what survives an upgrade vs what doesn't (with a table mapping every Topia-managed file to "survives upgrade? yes/no"), and the common "I edited a file in the cache and now it's gone" gotcha. The cache holds plugin source and is replaced wholesale by every upgrade; user-editable state lives in `<project>/.topia/`, never in the cache. Specifically calls out that `<project>/.topia/org/org.md` is the live org policy, while `cache/.../docs/ORG-CONFIG.md` is just the template.
- **Windows case-preservation note** in INSTALL-SCOPES.md — NTFS and default APFS are case-insensitive but case-preserving, so v2.x installs that created the `Topia/` directory keep that capitalization on disk through v3.x upgrades. Functionally fine; cosmetically jarring. Documented so users don't worry.

### Notes on parity with upstream

We are operationally ahead of `protopia/skill-topia` v2.1.0 (their latest at `abf71b3` — no new upstream commits since our last port). Every skill, hook, and script they ship is present in our fork, plus the v3.0.0 rename, the v3.1.x UX work, this v3.1.3 cleanup, and the lowercase `linenoize/topia` rebrand. The only files upstream has that we don't are their `.github/` directory (CI workflows, issue/PR templates) and `.mcp.json` — none of which affect runtime behavior. Worth porting separately because they need adapting for the `linenoize` org, not a mechanical rebrand.

---

## [3.1.2] — 2026-05-26

Install hardening + post-install UX work driven by downstream reports of users either failing to install the plugin or installing it and never realizing they should run `/topia finalize`.

### Changed

- **Marketplace plugin source switched from `"./"` to an explicit GitHub object.** The relative-path source only resolved when the marketplace was added via git shorthand or git URL. Users who added the catalog via a direct URL to `marketplace.json` got "path not found" errors. The new `"source": { "source": "github", "repo": "linenoize/topia" }` form works for *all* four supported install paths (git shorthand, git URL, direct URL, local clone). Trade-off: when added via git shorthand the plugin is now cloned twice — once for the marketplace, once for the plugin install — but the cache hit on the second clone makes this near-instant.
- **`scripts/port-rebrand.mjs` SCOPED entry for marketplace.json** now also rewrites `"source": "./"` → the GitHub form, so future syncs from upstream don't re-introduce the relative path.
- **Session-start first-run nudge is now a structured menu** with per-step completion indicators (`[ ]` / `[x]`). Lists `/topia finalize`, `/topia onboard`, `/topia doctor`, `/topia --help`. Each step auto-checks itself the next session once detected (e.g. running `/topia onboard` writes `.topia/DEVELOPER-GUIDE.md`, which the menu then treats as "onboard done"). The whole menu auto-suppresses once both finalize and onboard are detected, and can be hidden manually with `/topia finalize --dismiss`. Replaces the silent one-line "first-run tip" that downstream users reported skipping.
- **`/topia finalize --dismiss`** added as a flag-only short-circuit. Writes `.topia/.dismissed` and exits — does NOT run finalize, does NOT install hooks. For users who want to silence the menu without committing to extras.

### Docs

- **`docs/INSTALL-SCOPES.md`** (new) — covers user / project / local install scopes, what each controls, what fails per scope (including the common "I ran finalize but dispatch hooks don't fire in my other repo" foot-gun), and when to pick which.
- **README install-paths matrix** — explicit table of which `/plugin marketplace add` forms work, with the v3.1.2 fix that unblocked direct-URL adds.
- **Troubleshooting row updated** in `docs/INSTALL-CLAUDE-CODE.md` to point at the v3.1.2 fix instead of just telling users to use git shorthand.

---

## [3.1.1] — 2026-05-25

### Changed

- **Doctor: clearer "no config" copy for Claude Code installs** — the message used to read `No topia.config.json found — running source-only checks`, which downstream users reported as alarming. It now reads `No topia.config.json — source-only mode (normal for Claude Code installs)` and surfaces the `topia init --platform <name>` command for users who want to compile for Cursor / Windsurf / Antigravity. The per-check skip line is reworded to `Not required for Claude Code (reads SKILL.md directly)`. Behavior unchanged — the file is still never auto-written for Claude-only projects because Claude reads `SKILL.md` directly.
- **Doctor: print the `git rm --cached` fix command when tracked `.topia/` files are detected.** The warning previously listed offending files without telling the user how to untrack them (`.gitignore` cannot retroactively untrack already-committed files). The fix command is now appended to the warnings, with paths shell-quoted when they contain spaces.

---

## [3.1.0] — 2026-05-25

Ports upstream `protopia/skill-topia` v2.1.0 (`abf71b3`). Rebrand to `linenoize/topia` (lowercase plugin name preserved from v3.0.0) applied via `scripts/port-rebrand.mjs`.

### Added

- **`context-lifecycle` skill (L3)** — manages context window lifecycle: headless checkpoints on pre-compact and `git push`, PostCompact re-injection of project state, all-tool context-watch metrics.
- **`hooks/git-push-checkpoint/`** — captures a session checkpoint right before `git push` so the work shipped to remote is tied to a recoverable snapshot.
- **`hooks/post-compact/`** — re-injects critical project state after a context compaction so the next turn starts hydrated rather than cold.
- **`hooks/tool-collector/`** — per-tool token usage metrics (extends `token-meter` from v2.0.6).
- **`hooks/lib/checkpoint-runner.cjs`** — shared checkpoint runner used by the new lifecycle hooks.
- **`scripts/capture-metrics-baseline.js`** — records a metrics baseline for regression detection.
- **`scripts/__tests__/checkpoint-from-hook.test.js`** + **`compiler/__tests__/analytics-context.test.js`** — coverage for the new lifecycle path.

### Changed

- **Token analytics** — `compiler/analytics.js` and `hooks/lib/token-meter.cjs` now surface expensive sessions and per-tool token use.
- **`validate-signals`** wired into CI via `scripts/validate-signals.js`.
- **`hooks/context-watch`** rewritten to track all tool dispatches, not just skill invocations.
- **`hooks/pre-compact`** / **`hooks/post-session-reflect`** updated for the lifecycle workflow.
- Skill cross-refs added: `audit`, `build`, `context-engine`, `context-pack`, `neural-memory`, `recall`, `rescue`, `session-bridge`, `team` now call `context-lifecycle` where appropriate.
- Skill count: 66 → **67** (added `context-lifecycle`).
- Synapses: 298 → 308. Pulses: 44 → 47.

### Port mechanics

- `scripts/port-rebrand.mjs` SCOPED entry for `.claude-plugin/plugin.json` now also restores `displayName: "Topia"` (upstream lacks the field; without this, every future sync would silently drop the cosmetic brand label).

---

## [3.0.0] — 2026-05-25

### Breaking

- **Plugin renamed to lowercase `topia`** — `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` now use `"name": "topia"` (was `"Topia"`). This makes the install ID, on-disk cache path, and skill namespace prefix all match the lowercase `linenoize/topia` GitHub slug and the `topia` CLI binary name. `displayName: "Topia"` is preserved so the `/plugin` picker still shows the capitalized brand. Reason: Claude Code plugin lookups are case-sensitive — users routinely typed `/plugin install topia@linenoize` (lowercase) and got "Plugin topia not found in marketplace linenoize".
- **Skill namespace flipped to lowercase `topia:` prefix** — invocations are now `/topia:build`, `/topia:plan`, etc. (previously the capitalized prefix). The compiler's cross-reference detector is case-insensitive (`/[Tt]opia:/`), so legacy capital-T references in user-authored SKILL.md / docs continue to be recognized and rewritten correctly.

### Migration

Existing v2.x installs must reinstall under the new lowercase ID:

```text
/plugin uninstall Topia@linenoize
/plugin marketplace update linenoize
/plugin install topia@linenoize
/reload-plugins
```

Or edit `~/.claude/settings.json` directly and rename the `"Topia@linenoize"` key to `"topia@linenoize"`, then restart Claude Code.

Already-installed hooks (`Topia-managed: true` marker in cursor/windsurf/antigravity rule files and `.claude/settings.json` entries) keep working — the marker string is unchanged and the resolver checks both `cache/linenoize/topia` (new) and `cache/linenoize/Topia` (legacy) so dispatch hooks continue to find the CLI after upgrade.

---

## [2.0.8] — 2026-05-25

### Fixed

- **`validate-signals`** — parse SKILL.md frontmatter with `\r?\n` so Windows CRLF checkouts report signals correctly (was silently returning 0 signals).
- **`hooks-install` test** — pass `topiaRoot` in `--platform all` tests so cursor adapter does not depend on plugin cache layout.
- **Line endings** — add `.gitattributes` (`eol=lf` for `*.md`, `*.js`, `*.cjs`, `*.mjs`, `*.json`) to prevent CRLF parser regressions on Windows.

---

## [2.0.7] — 2026-05-25

### Added

- **`scripts/scan-mangled-windows-dirs.js`** — detect empty junk folders from Git Bash `mkdir -p` on Windows (`alembic;C`, fused `CCodeBase…`, etc.).
- **`scripts/ensure-dir.mjs`** — cross-platform relative-path mkdir helper for agents.

### Changed

- **Windows path guidance** — onboard, finalize, safeguard, test skills and install docs warn against Bash `mkdir -p` with `C:\…` or `folder:C:\…` paths; prefer Node `mkdirSync` or `ensure-dir.mjs`.
- **`docs/MULTI-PLATFORM.md`** — documents the Windows mkdir pitfall.

---

## [2.0.6] — 2026-05-25

### Added

- **Token metrics** — `hooks/token-meter`, shared `hooks/lib/token-meter.cjs` and `metrics-buffer.cjs`; sessions record measured/estimated tokens, compaction events, and platform. `docs/TOKEN-METRICS.md` and baseline template.
- **Analytics CLI** — `topia analytics` / `topia metrics --json` with token overview, trends, and savings vs `.topia/metrics/baseline.json`.
- **Cursor hooks adapter** — expanded `compiler/adapters/hooks/cursor.js` for token-meter install paths and dashboard token panels.

### Changed

- **Metrics hooks** — `context-watch`, `metrics-collector`, `post-session-reflect`, and `pre-compact` write token fields into `.topia/metrics/sessions.jsonl`.
- **`skills/audit`** — Phase 8 reports token stats and baseline delta; shortcut documents `topia metrics` / `topia analytics`.
- **`commands/topia.md`** — documents analytics/metrics commands alongside remote finalize flow.

---

## [2.0.5] — 2026-05-23

### Changed

- **`.topia/active-packs.json`** — no longer tracked in git; stays local per workspace. Onboard still writes it; only `.topia/org/` remains committable under `.topia/*`.
- **Gitignore / doctor** — removed `!/.topia/active-packs.json` exception from canonical Topia gitignore block and tracked-path checks.
- **Onboard docs** — commit step stages `CLAUDE.md` and `.topia/org/` only.

---

## [2.0.3] — 2026-05-22

### Fixed

- **`.gitignore`** — `build/` → `/build/` so `skills/build/` (L1 orchestrator) is no longer ignored; skill is tracked in git for all clones.
- **Nexus visualizer** — renders `## Calls` synapse edges (cyan) with Cross-refs / Synapses / Signals toggles; stats show synapse count.

### Changed

- **Memory pipeline** — `journal` calls `neural-memory` after ADRs; Journal Update includes a memory digest; `plan` / `recon` / `research` / `build` use `topia:neural-memory`; session-start hook prints a memory checklist.
- **`topia status`** — reports agora-memory and neural-memory MCP registration separately.
- **`validate-nexus.js`** — parses table-row Calls entries via `compiler/lib/synapse-tables.js`.
- **Docs** — `NEXUS-GLOSSARY` and agora integration doc clarify journal vs neural-memory vs agora backends.

---

## [2.0.1] — 2026-05-20

### Added

- **linenoize Claude Code marketplace** — restored `.claude-plugin/marketplace.json` (`protopia` catalog, `Topia` plugin). End users install via `/plugin marketplace add linenoize/topia` and `/plugin install Topia@linenoize`.
- **`docs/INSTALL-CLAUDE-CODE.md`** — marketplace vs clone install, hook layers, updates, troubleshooting.
- **`docs/templates/team-claude-settings.json`** — optional `extraKnownMarketplaces` + `enabledPlugins` snippet for team repos.

### Changed

- **`topia install`** — registers the plugin via marketplace add + install when `marketplace.json` is present; falls back to `claude plugin add .`.
- **`README.md`** — marketplace install documented as the recommended Claude Code path.
- **`package.json` `files`** — includes `.claude-plugin/` for npm publishes.

---

## [2.0.0] — 2026-05-19

### Breaking changes

- **Nexus terminology** — mesh → nexus, connections → synapses, signals → pulses across CLI, docs, and compiler output. `topia doctor --nexus` replaces `--mesh` (alias kept one release).
- **Skill renames** — `sentinel`→`guardian`, `preflight`→`readiness`, `graft`→`integrate`, `scout`→`recon`, `sentinel-env`→`guardian-env`. Run `topia migrate-v1` to rewrite `.topia/` state files.
- **Hook dispatch** — presets wire `readiness` and `guardian`; v1 names still accepted with deprecation warning.

### Added

- **`compiler/nexus-constants.js`** — single source of truth for stats and branding footer.
- **`docs/NEXUS-GLOSSARY.md`** — canonical Nexus / Synapse / Pulse / Maestro definitions.
- **`docs/NEXUS-RULES.md`** — cross-cutting skill rules (replaces MESH-RULES).
- **`topia migrate-v1`** — migrates v1 skill references in `.topia/` project state.
- **`docs/migration/v1-to-v2.md`** — upgrade guide.
- **`topia status`** — memory health (agora-code), nexus density, layer emojis, pulse section.

### Changed

- **`topia visualize`** — writes `.topia/nexus.html` (was `mesh.html`).
- **`scripts/validate-nexus.js`** — synapse validation (`validate-mesh.js` re-exports for compatibility).
- **Platform hook adapters** — Cursor/Windsurf/Antigravity rules use v2 skill IDs.

---

## [1.2.1] — 2026-05-18

### Added
- **`topia install` command** — one-shot orchestrator that replaces the manual 5-step setup. Pre-flights rune-kit conflicts (offers migrate / abort / skip), registers the plugin with Claude Code (`claude plugin add .`), wires discipline hooks globally, installs the agora-code MCP if Python 3.10+ is available, registers it in `.mcp.json`, and runs `topia doctor` to verify. Cross-platform binary detection for `claude`, `python3` / `python` / `py`, `pip3` / `pip`. Flags: `--dry-run`, `--here`, `--preset`, `--skip-agora`, `--skip-rune-check`, `--yes`.
- **`scripts/postinstall.js`** — fires after every `npm install`, prints the one-command next-step. Quiet in CI and when run as a transitive dependency.
- **`docs/ORG-CONFIG.md`** — explains `.topia/org/org.md`: what each section drives (Teams / Roles / Policies / Approval Flows / Governance Level), when to edit, how to verify changes took effect, what happens if the file is missing or malformed.

### Changed
- **`README.md` install section** — replaces the 5-step manual flow with the single `node compiler/bin/topia.js install` command. Documents the `--dry-run`, `--here`, `--preset`, `--skip-agora`, `--yes` flags. Adds an explicit "restart Claude Code after install" note and a pointer to `.topia/org/org.md` + `docs/ORG-CONFIG.md`.
- **`.topia/org/org.md`** — opening note now points users at `docs/ORG-CONFIG.md` for the full field reference and re-emphasises the "re-run `topia setup` after editing" step.
- **`package.json`** — added `"postinstall": "node scripts/postinstall.js"`.

---

## [1.2.0] — 2026-05-18

### Added
- **`topia migrate-from-rune` command** — interactive migration for projects coming from [rune-kit](https://github.com/Rune-kit/rune). Pulls `.rune/` state (decisions, ADRs, conventions, learnings, features) into `.topia/`, then renames `~/.claude/plugins/cache/rune-kit/` to `.disabled` so Claude Code stops loading it. Conflict-safe (existing `.topia/` files preserved unless `--force`), idempotent (writes `.topia/migrated-from-rune.flag`), reversible (`--skip` writes a suppression flag, `mv rune-kit.disabled rune-kit` restores).
- **Session-start hook detection** — `hooks/session-start/index.cjs` now detects `.rune/` and the rune-kit plugin on every session. If neither flag (`migrated-from-rune.flag` or `skip-rune-migration.flag`) is present, prints a prominent warning explaining the routing-conflict risk and pointing at the migration command. Self-suppressing once a flag is written.
- **`docs/migration/from-rune.md`** — full migration guide (what gets copied, what gets disabled, how to revert).
- **`commands/migrate-from-rune.md`** — slash-command definition for `/topia migrate-from-rune`.
- **Doctor: `Frontmatter conformance` check** — verifies every SKILL.md declares the six required metadata fields (`author`, `version`, `layer`, `model`, `group`, `tools`). Warns if any are missing.

### Changed
- **`compiler/bin/topia.js`** — new `migrate-from-rune` subcommand wired with `--dry-run` / `--force` / `--skip` / `--yes` flags.
- **Doctor: `Required sections` extended** — now requires `Purpose` and `Constraints` in addition to `Sharp Edges`, `Done When`, `Cost Profile`. Added `## Purpose` headings to `scout`, `test`, `verification` SKILL.md files where the intro paragraph existed without the heading.
- **Repo URLs updated** — moved from `github.com/skill-topia/Topia` to `github.com/linenoize/topia`; npm package `@skill-topia/topia` → `@linenoize/topia`; landing page links + install instructions + hook-detection regexes updated across ~32 files. CLI command stays `topia`; author identity is `topia`.
- **Docs trimmed** — deleted `docs/USER-GUIDE-CYCLE.md` and `docs/DEVELOPER-CYCLE.md` (163 lines of content redundant with `docs/index.html` "How it works" + "Scenarios" sections and `docs/GETTING_STARTED.md`).

---

## [1.1.0] — 2026-05-16

### Added
- **Vendored agora-code MCP server** at `mcp-servers/agora-code/` — persistent memory + codebase intelligence for AI coding agents (Apache 2.0, vendored from [thebnbrkr/agora-code](https://github.com/thebnbrkr/agora-code)). Provides MCP tools: `store_learning`, `recall_learnings`, `get_file_symbols`, `search_symbols`, `recall_file_history`, `complete_session`, `list_sessions`, `get_memory_stats`. Opt-in — requires Python 3.10+ and `pip install ./mcp-servers/agora-code`.
- **`docs/mcp-integrations/agora-code.md`** — integration guide with install, MCP registration, per-skill usage, graceful-degradation contract, and caveats (Python dependency, hook overlap with `topia hooks install`, upstream drift policy).
- **`mcp-servers/agora-code/NOTICE-TOPIA.md`** — Apache 2.0 attribution + vendoring metadata + upstream refresh procedure.

### Changed
- **`skills/journal/SKILL.md`** — new "Optional MCP Integration" section: when `agora-memory` MCP is registered, ADR writes additionally call `store_learning` and session end calls `complete_session`. File-based persistence remains source of truth.
- **`skills/build/SKILL.md`** — Phase 1 Step 2.5 (new): optional `recall_learnings` call before `idea` gate, surfaces past similar features/bugs from agora-code if available.
- **`skills/idea/SKILL.md`** — Step 1.2 (Neural Memory Retrieval): now also calls agora-code's `recall_learnings` when available, merged with neural-memory results.
- **`skills/neural-memory/SKILL.md`** — new "Optional MCP Backend: agora-code" section: routes capture/recall/symbol-lookup/file-history to agora-code when both MCPs are registered.

---

## [1.0.0] — 2026-05-15

Initial internal release of Topia — an interconnected skill ecosystem for AI coding assistants.

### Core
- **65 skills** wired into a 5-layer mesh:
  - **L0 Router** (1): `skill-router`
  - **L1 Orchestrators** (5): `build`, `team`, `launch`, `rescue`, `scaffold`
  - **L2 Workflow Hubs** (~30): `plan`, `scout`, `idea`, `debug`, `fix`, `test`, `review`, `guardian`, `design`, `db`, `mcp-builder`, …
  - **L3 Utilities** (~27): `research`, `verification`, `git`, `journal`, `worktree`, `constraint-check`, `sast`, …
- **203 sync connections** + **44 async signals** between skills, with reciprocal `Called By` tracking enforced by `topia doctor`.
- **5-layer rule**: L1 calls L2/L3, L2 calls L2/L3, L3 calls nothing (with documented exceptions for `team` meta-orchestration).

### Multi-platform compiler
- Single `skills/` source of truth compiles to Claude Code (native plugin), Cursor, Windsurf, Antigravity, Codex, OpenCode, and a generic target.
- CLI commands: `topia init`, `build`, `doctor`, `status`, `visualize`, `hooks install`.
- Runtime layer wires `readiness` / `guardian` / `completion-gate` / `quarantine` as native hooks on Claude Code, Cursor, Windsurf, Antigravity.

### Workflow enforcement
- Step 0 prerequisite checks on every skill — e.g., `build` requires an approved plan, `fix` requires a diagnosis from `debug`, `deploy` requires passing `verification` + `guardian`.
- `Mandatory Skill Routing` table in `CLAUDE.md` maps user intent → skill, blocking casual ad-hoc work.

### Extension packs (10)
`@Topia/ui`, `@Topia/backend`, `@Topia/devops`, `@Topia/mobile`, `@Topia/security`, `@Topia/ecommerce`, `@Topia/ai-ml`, `@Topia/content`, `@Topia/analytics`, `@Topia/chrome-ext`.

### Internal-only
- No marketplace distribution. Install by cloning the repo and pointing Claude Code at the directory.
- Author: `topia`. License: MIT.
