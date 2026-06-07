# Fork sync: topia → skill-topia

`linenoize/topia` is the **source of truth**. `protopia/skill-topia` is the **branded fork** (different npm scope, GitHub org, marketplace owner, cache paths). Content is shared; identifiers are not.

## Canonical clones

| Repo | Path | Remote |
|------|------|--------|
| topia | `C:\CodeBase\topia` | `origin` → `github.com/linenoize/topia` |
| skill-topia | `C:\CodeBase\Protopia\skill-topia` | `origin` → `github.com/protopia/skill-topia`, `upstream-topia` → topia |

Use one skill-topia clone only. Retire duplicate paths (e.g. `C:\CodeBase\skill-topia`).

## Normal release flow

After shipping a topia release (tag or `main` bump):

```bash
# From topia repo
node scripts/sync-to-skill-topia.mjs --target C:/CodeBase/Protopia/skill-topia
```

This will:

1. `git fetch upstream-topia` in the fork
2. `git merge upstream-topia/main`
3. Run `port-to-protopia` (linenoize → protopia identifiers)
4. Run tests + `topia doctor` in the fork

Then in the fork:

```bash
cd C:/CodeBase/Protopia/skill-topia
node scripts/bump-version.js 3.x.x    # match topia version if needed
git add -A
git commit -m "feat: parity port from linenoize/topia v3.x.x"
git push origin main
```

## Scripts

| Script | Direction | When |
|--------|-----------|------|
| [`scripts/sync-to-skill-topia.mjs`](../scripts/sync-to-skill-topia.mjs) | topia → fork | **Default** after each topia release |
| [`scripts/port-to-protopia.mjs`](../scripts/port-to-protopia.mjs) | rebrand in fork | After merge, or `--no-merge` rebrand-only |
| [`scripts/port-rebrand.mjs`](../scripts/port-rebrand.mjs) | fork → topia | **Rare** — reverse port only |
| [`scripts/fork-drift-check.mjs`](../scripts/fork-drift-check.mjs) | check | CI or pre-release sanity |
| [`scripts/lib/rebrand-pairs.js`](../scripts/lib/rebrand-pairs.js) | shared tables | Do not edit one direction without the other |

### Flags

```bash
node scripts/sync-to-skill-topia.mjs --target <path> [--dry-run] [--no-merge] [--ff-only] [--skip-verify]
node scripts/port-to-protopia.mjs [--root <path>] [--dry-run]
node scripts/fork-drift-check.mjs --target <path>
```

## Merge conflicts

If merge fails, resolve conflicts in shared content dirs first:

- `skills/`, `hooks/`, `compiler/`, `commands/`, `agents/`, `extensions/`

Keep **fork-owned** values in:

- `.claude-plugin/marketplace.json` — `protopia` owner, `protopia/skill-topia` repo
- `.claude-plugin/plugin.json` — author `skill-topia`, repo URLs
- `package.json` — `@protopia/skill-topia`, author, repository
- `.github/` — adapt separately; do not blindly copy linenoize CI
- `.topia/org/org.md` — org-specific policy

Then re-run:

```bash
node scripts/sync-to-skill-topia.mjs --target C:/CodeBase/Protopia/skill-topia --no-merge
```

## Hotfix overlay (rsync)

For a tiny urgent patch without merge noise:

```bash
rsync -av --delete \
  --exclude=.git --exclude=node_modules --exclude=.claude-plugin \
  --exclude=package.json --exclude=README.md --exclude=.github \
  C:/CodeBase/topia/ C:/CodeBase/Protopia/skill-topia/

node scripts/port-to-protopia.mjs --root C:/CodeBase/Protopia/skill-topia
```

Use merge for releases; rsync for single-file hotfixes.

## Verification checklist

In the fork after sync:

```bash
npm test
node compiler/bin/topia.js doctor
node scripts/version-sync-check.js
```

Smoke in Claude Code: `/plugin install topia@protopia`

## Drift check

```bash
node scripts/fork-drift-check.mjs --target C:/CodeBase/Protopia/skill-topia
```

Exits non-zero when the fork lacks commits present on topia `main`.

## What never syncs verbatim

- `scripts/port-rebrand.mjs` — topia-only (reverse port tool)
- linenoize `.github/workflows/*` — needs Protopia-specific adaptation
- Historical CHANGELOG entries — append new fork entries; do not rewrite upstream references
