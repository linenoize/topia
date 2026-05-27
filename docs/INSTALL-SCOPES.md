# Install Scopes — User, Project, and Local

Claude Code plugins can be installed at three scopes. Topia works at any of them, but the *experience* changes meaningfully — especially around dispatch hooks, the `.topia/` state directory, and which other projects benefit. This page explains what each scope does, what works, and what fails.

If you just want a recommendation: **install at user scope, then run `/topia finalize` once.** That's the default for solo developers and matches the install instructions in the README. Read on if you're on a shared/team machine, sandboxing the plugin, or trying to figure out why a dispatch hook isn't firing in a sibling repo.

## The three scopes

When you run `/plugin install topia@linenoize` in the VS Code extension or terminal, the picker offers three scopes:

| Scope | Where it's stored | Who sees it | Best for |
|-------|------------------|-------------|----------|
| **User** | `~/.claude/settings.json` | You, in every repo on this machine | Solo dev, default choice |
| **Project** | `<repo>/.claude/settings.json` (committed) | Anyone who clones the repo | Teams that want everyone on the same plugin set |
| **Local** | `<repo>/.claude/settings.local.json` (gitignored) | Only you, only in this repo | Trying it out, sandboxing, project-specific overrides |

The CLI equivalent is `/plugin install topia@linenoize --scope <user|project|local>`. If you don't pass a flag, the picker asks.

## What each scope actually controls

The scope determines **which plugins are loaded** in a given Claude Code session. It does *not* directly control:

- Where `.topia/` state files live (always per-project, in the repo working dir)
- Where dispatch hooks fire (controlled by the separate `topia setup --global` vs `--here` flag, not the install scope)
- Where the agora-code MCP is registered (per-project in `.mcp.json` or per-user in `~/.claude/.mcp.json`)
- Which skills are available (all of them — every install scope ships the full 69-skill nexus)

So the picker question "install at user / project / local" is really just **"which sessions should be able to invoke `/topia:*`?"** Everything else is a separate decision made by `/topia finalize` or the relevant CLI command.

## What works and what fails per scope

### User scope (recommended)

```text
/plugin install topia@linenoize         # picker → "Install for you"
```

| Thing | Works? | Notes |
|-------|--------|-------|
| `/topia:build`, `/topia:plan`, etc. in any repo | ✓ | Skills load whenever Claude Code starts |
| `/topia onboard` in a fresh repo | ✓ | Writes `<repo>/.topia/` state |
| Dispatch hooks (readiness, guardian, completion-gate) global | ✓ after `/topia finalize` | Finalize wires them into `~/.claude/settings.json` |
| Dispatch hooks fire in repos *without* `.topia/` | ✓ after finalize | They're global once finalize ran |
| Teammates on other machines get the same plugin | ✗ | They install separately |
| Repo can be cloned and "just works" for new contributors | ✗ | Each contributor installs the plugin once |

This is the cleanest experience for one person on one machine.

### Project scope

```text
/plugin install topia@linenoize         # picker → "Install for this project"
```

The plugin entry is written to `<repo>/.claude/settings.json` and committed. Everyone who clones the repo gets the plugin enabled automatically (after the marketplace add step — which they still do once per machine).

| Thing | Works? | Notes |
|-------|--------|-------|
| Topia skills in *this* repo | ✓ | Loaded from project settings |
| Topia skills in *other* repos on the same machine | ✗ | Project scope is repo-bounded |
| Cloned by a teammate → plugin loads automatically | ✓ partial | They still need the marketplace registered. Use `docs/templates/team-claude-settings.json` to prompt for that on folder trust. |
| Dispatch hooks fire in this repo | ✓ after `/topia finalize --here` | Finalize writes them into `<repo>/.claude/settings.json` instead of `~/.claude/` |
| Dispatch hooks fire in sibling repos | ✗ | Project scope can't reach other repos. If you also want that, ALSO install at user scope (you can do both). |
| Discipline preset (gentle / strict) is per-repo | ✓ | Each project can pick its own |

The big foot-gun: you finalize at project scope, switch to another repo, and the `readiness` / `guardian` hooks don't fire. That's not a bug — project scope is bounded. Add user scope on top if you want machine-wide discipline.

### Local scope

```text
/plugin install topia@linenoize         # picker → "Install locally"
```

Same as project scope but written to `.claude/settings.local.json` (gitignored). The plugin is enabled only for you, only in this repo. Useful for:

- Trying the plugin on a repo where the team hasn't committed to it yet
- A sandboxed install that doesn't pollute your other repos
- Testing a new Topia version without disturbing your stable user-scope install

Failures match project scope plus: teammates don't see it (the file is gitignored).

## Common confusion: "I ran finalize but dispatch hooks don't fire in my other repo"

Almost always one of:

1. You ran `/topia finalize` in project scope (it wrote hooks to `<repo>/.claude/settings.json`, not `~/.claude/settings.json`). Re-run finalize with the "system-wide" option, or run `node <topia>/compiler/bin/topia.js setup --global --preset gentle` from a clone.
2. You ran `/topia finalize --here` explicitly. Same fix.
3. Your other repo's `.claude/settings.json` has explicit `enabledPlugins` that doesn't list `topia@linenoize`. Project-scope plugin entries override user-scope ones for that repo.
4. You installed Topia at local scope only. Switch to user scope.

`topia doctor --hooks` from a clone will tell you which settings files have dispatch hook entries and which don't.

## Common confusion: "Tracked but should be ignored — `.topia/...`"

`/topia onboard` writes `.topia/DEVELOPER-GUIDE.md`, `.topia/contract.md`, etc. into the repo. The default `.gitignore` block (added by `/topia finalize`) excludes everything in `.topia/` *except* `.topia/org/`. But:

- If you ran `/topia onboard` *before* you ran `/topia finalize`, the state files got committed first.
- `.gitignore` can't retroactively untrack already-committed files. You need `git rm --cached`.

The doctor surfaces this with a specific command:

```text
Fix: git rm --cached .topia/contract.md .topia/decisions.md ... && git commit -m "chore: untrack .topia/ session state"
```

After that the files are untracked and the gitignore block keeps them out.

## How the plugin cache is laid out (and what survives an upgrade)

Claude Code stores each installed plugin version in its own directory under `~/.claude/plugins/cache/<marketplace-owner>/<plugin-name>/<version>/`. For Topia, that's `~/.claude/plugins/cache/linenoize/topia/3.1.3/` for v3.1.3.

```text
~/.claude/plugins/cache/
└── linenoize/
    └── topia/
        ├── 3.1.0/    ← left over from a previous version
        ├── 3.1.2/    ← left over from a previous version
        └── 3.1.3/    ← active version
```

When you upgrade with `/plugin update topia@linenoize`, Claude Code clones the new version into a *new* subdirectory. The old one stays until Claude Code's cache cleanup runs (or you remove it manually). The resolver in `compiler/commands/hooks/resolve-topia-root.js` picks the highest available version — so the upgrade is atomic from the user's perspective.

### What survives an upgrade

This is the key distinction users get wrong:

| Where it lives | Survives upgrade? | What goes here |
|----------------|-------------------|----------------|
| `cache/linenoize/topia/<version>/` | **Replaced** by each new version | Plugin source: skills, hooks, scripts, ref docs. Treat as read-only — edits here are discarded on the next install. |
| `cache/.../docs/ORG-CONFIG.md` | Replaced (it's the *template*) | Reference doc showing the org-config schema. Read it, don't edit it here. |
| `<project>/.topia/org/org.md` | **Yes** — always preserved | **Your actual org policy.** Where `guardian` / `readiness` read team rules from. Edit this one. |
| `<project>/.topia/*.md` (state, ADRs, decisions) | Yes — outside cache | Session state and project memory. Auto-managed by skills like `journal`, `session-bridge`, `onboard`. |
| `~/.claude/settings.json` | Yes — separate file | Dispatch hooks (from `/topia finalize`), plugin enable flags. Survives any plugin upgrade. |
| `<project>/.claude/settings.json` or `.local.json` | Yes — outside cache | Project- or local-scope plugin enable flags, per-repo dispatch hooks. |

### Common gotcha: "I edited a file in the cache and now it's gone"

You probably opened a file like `cache/linenoize/topia/3.1.2/docs/ORG-CONFIG.md`, made changes, then ran `/plugin update`. The new version went into `cache/linenoize/topia/3.1.3/` with the upstream template content — your edits are still in `3.1.2/` if cache cleanup hasn't deleted it, but the resolver is now using `3.1.3/`, so functionally your changes are gone.

The right move: copy the file you wanted to customize into `<project>/.topia/org/org.md` (for org config) or use the appropriate `.topia/` state file. Those live in your project, are tracked by you (or gitignored if private), and are untouched by plugin upgrades.

### Windows case-preservation quirk

NTFS (and default APFS on macOS) is **case-insensitive but case-preserving.** If you installed Topia at v2.x — when the plugin was named `Topia` (capital T) — the cache directory was created as `cache/linenoize/Topia/`. When v3.x flipped the canonical name to lowercase, Claude Code's writes go through the same case-insensitive lookup and *into* the existing `Topia/` directory. The directory name on disk doesn't get rewritten to lowercase, but everything still works because the OS treats both forms as the same path.

If you want the directory to display as lowercase, uninstall and reinstall the plugin (Claude Code will create the new directory with the canonical lowercase name). On Linux or case-sensitive macOS volumes, you'd see *two* directories after upgrade — `Topia/` from v2.x and `topia/` from v3.x — and the resolver tries `topia/` first.

### WSL on Windows

When Claude Code on Windows shells out through WSL (which is common — many users have it as their default `Bash`), the Linux side accesses the cache via `/mnt/c/Users/<user>/.claude/plugins/cache/linenoize/topia/`. WSL's DrvFs honors the underlying NTFS case-insensitivity for `/mnt/c/...` paths, so lowercase lookups still resolve to a directory created as `Topia/` — same behavior as native Windows access. You don't need to do anything special.

The one edge case: WSL2 lets you enable per-directory case sensitivity via `fsutil.exe file SetCaseSensitiveInfo`. If a user opted into that on the cache directory (rare and deliberate), lowercase lookups would fail when the on-disk name is `Topia/`. Every Topia path lookup falls back to the capital-T form for exactly this reason — `commands/finalize.md` and `compiler/commands/hooks/resolve-topia-root.js` both try both spellings.

## When in doubt

User scope + `/topia finalize` covers 90% of cases. Pick that unless you have a specific reason not to.
