# Versioning Policy

> **H2 Document** — Semver policy for Topia core and L4 extension packs.

---

## Core Plugin Versioning

The Topia plugin uses semantic versioning (`MAJOR.MINOR.PATCH`):

| Version | When to bump | Example |
|---------|-------------|---------|
| **PATCH** (`1.0.N`) | Bug fixes, content corrections in SKILL.md | Fixing a wrong command in `verification`, correcting a Sharp Edge |
| **MINOR** (`1.N.0`) | New features, new connections, new sections added | Adding a new `## Done When` condition, new nexus synapse |
| **MAJOR** (`N.0.0`) | Breaking change to skill interface or output contract | Renaming a skill, changing output format structure, removing a section |

**Current version:** `3.3.0`

---

## Release Process (npm publish via CI)

Publishing to npm is automated by `.github/workflows/npm-publish.yml`. You do **not** run `npm publish` by hand.

**One-time setup (per repo):**

1. npmjs.com → Access Tokens → Generate New → **Automation** type. Automation tokens bypass 2FA for publish operations; Classic/Publish tokens do not and will hang CI on an OTP prompt.
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret named `NPM_TOKEN`.

**To cut a release:**

1. Bump the version in `package.json`, `.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json` (keep them in sync — `npm run version-check` enforces this).
2. Update `docs/CHANGELOG.md` and the `docs/index.html` version badge (the `prepublishOnly` gate hard-fails on drift).
3. Commit and push to `main`.
4. Tag and push the tag:

   ```bash
   git tag v3.2.2 && git push origin v3.2.2
   ```

The workflow then runs `npm ci` → `npm test` → verifies the tag matches `package.json` → `npm publish --access public --provenance`. The `--provenance` flag attaches a signed attestation tying the published tarball to the GitHub commit (requires a public repo + the `id-token: write` permission already set in the workflow).

**Dry run before a real release:** Actions tab → "Publish to npm" → Run workflow. `dry_run` defaults to true, so it packs and validates without writing to the registry.

---

## What Counts as a Breaking Change?

A breaking change is any modification that would cause a **calling skill to fail or produce incorrect output** without code changes on its end.

### Breaking (MAJOR bump required)
- Renaming a skill (e.g., `guardian` → `security-guard`)
- Changing the structure of `## Output Format` in a way callers depend on
- Removing a section that callers parse (e.g., removing `## Calls`)
- Changing skill layer assignment (L2 → L3 changes invocation context)
- Removing an existing connection from `## Calls` or `## Called By`

### Non-breaking (MINOR or PATCH)
- Adding new skills (MINOR)
- Adding new connections (MINOR)
- Adding `## Sharp Edges`, `## Done When`, or documentation content (PATCH)
- Fixing incorrect commands or examples (PATCH)
- Clarifying constraint wording without changing behavior (PATCH)
- Updating `## Cost Profile` estimates (PATCH)

---

## Skill API Stability Contract

Each skill's **stable API** consists of:
1. Skill name (used in `## Calls` references across the toolkit)
2. `## Output Format` structure (the contract for calling skills)
3. Layer assignment (L1/L2/L3)
4. Required input parameters (documented in `## Executable Steps`)

Everything else (Sharp Edges, Done When, Cost Profile, wording improvements) is non-API and can change freely.

---

## L4 Extension Pack Versioning

L4 packs version independently of the core. Each `PACK.md` has its own `metadata.version`.

L4 packs start at `0.1.0` (experimental). When stable:
- `1.0.0` = skill interface is locked, callers can rely on output format
- Minor bumps = new skills added to pack (additive, non-breaking)
- Major bumps = skill renamed, removed, or output format changed

**L4 packs MUST NOT change their nexus synapse interface (how they connect to L1-V3 core) in a patch release.** Connection changes are at minimum a minor version bump.

---

## Version in SKILL.md Frontmatter

Every `SKILL.md` has a `metadata.version` field:

```yaml
metadata:
  version: "1.0.0"
```

This tracks the individual skill's version, independent of the plugin version. Use it to:
- Track which skills have been updated in a release
- Help users identify if their cached version is outdated
- Signal to CI that a skill's contract changed

**Convention:** When the plugin bumps MAJOR, all skill versions bump to match (e.g., all skills go to `1.0.0`). For MINOR/PATCH, only the modified skills bump.
