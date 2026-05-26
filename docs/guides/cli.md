# Topia CLI

The Topia CLI compiles 66 AI coding skills into any IDE platform. One skill toolkit, every editor.

---

## Quick Start

**Step 1** -- Install and initialize in your project:

```bash
cd your-project
node compiler/bin/topia.js init
```

Topia auto-detects your platform (Cursor, Windsurf, Antigravity) and compiles skills into the correct format.

**Step 2** -- Start your AI assistant:

```bash
# Cursor / Windsurf / Antigravity / Generic
# Open your editor -- skills are loaded automatically from the rules directory.

# Claude Code -- no compilation needed, Topia runs as a native plugin:
claude
```

**Step 3** -- Verify the setup:

```bash
node compiler/bin/topia.js doctor
```

That's it. 66 skills are now active in your AI assistant.

> **Pro Tip**: For Claude Code, use the linenoize marketplace (no compilation):
> `/plugin marketplace add linenoize/topia` then `/plugin install topia@linenoize`.
> See [`docs/INSTALL-CLAUDE-CODE.md`](../INSTALL-CLAUDE-CODE.md).

---

## Commands

### `Topia init`

Interactive setup. Detects your platform, creates `topia.config.json`, and compiles all skills in one step.

```bash
node compiler/bin/topia.js init
```

```
  +---------+
  |  Topia  |
  +---------+

  -> Detected: cursor
  -> Created topia.config.json
  -> Built 66 skills + 10 extensions to .cursor/rules/
```

**Flags**:

| Flag | Description | Example |
|------|-------------|---------|
| `--platform <name>` | Override auto-detection | `Topia init --platform windsurf` |
| `--extensions <list>` | Enable specific extension packs | `Topia init --extensions @Topia/ui,@Topia/backend` |
| `--disable <skills>` | Disable specific skills | `Topia init --disable video-creator,asset-creator` |

If Claude Code is detected (`.claude-plugin/` exists), init exits early with a message -- no compilation needed.

---

### `Topia build`

Recompile skills using existing config. Run after updating Topia or changing `topia.config.json`.

```bash
node compiler/bin/topia.js build
```

```
  [parse]     Discovering skills...
  [transform] Platform: cursor
  [transform] Resolved 142 cross-references
  [transform] Resolved 87 tool-name references
  [emit]      66 skills + 10 extensions

  -> Built 67 files to .cursor/rules/
```

**Flags**:

| Flag | Description | Example |
|------|-------------|---------|
| `--platform <name>` | Override config platform | `Topia build --platform windsurf` |
| `--output <dir>` | Override output directory | `Topia build --output ../other-project` |
| `--disable <skills>` | Disable specific skills | `Topia build --disable trend-scout` |

> **Pro Tip**: Use `--output` to compile Topia into multiple projects from a single source.

---

### `Topia doctor`

Validate compiled output. Checks that all skill files exist, cross-references resolve, and config is valid.

```bash
node compiler/bin/topia.js doctor
```

Exits with code 0 if healthy, code 1 if issues found. Useful in CI pipelines.

**Flags**:

| Flag | Description |
|------|-------------|
| `--platform <name>` | Override config platform |

---

### `Topia help`

Show available commands and flags.

```bash
node compiler/bin/topia.js help
```

---

## Platforms

Topia compiles to 8 platforms. Each gets skills in its native format.

| Platform | Output Directory | File Format | Detection Marker |
|----------|-----------------|-------------|------------------|
| Claude Code | _(native plugin)_ | `.md` (SKILL.md) | `.claude-plugin/` |
| Cursor | `.cursor/rules/` | `.mdc` | `.cursor/` |
| Windsurf | `.windsurf/rules/` | `.md` | `.windsurf/` |
| Antigravity | `.agent/rules/` | `.md` | `.agent/` |
| Codex | `.codex/` | `.md` | `.codex/` |
| OpenCode | `.opencode/rules/` | `.md` | `.opencode/` |
| Generic | `.ai/rules/` | `.md` | _(fallback)_ |
| OpenClaw | `.openclaw/Topia/` | `.md` + manifest | `.openclaw/` |

### Claude Code

Topia is a native Claude Code plugin. No compilation needed.

```bash
# Install as plugin (recommended)
claude plugin add linenoize/topia

# Or use Topia as a local plugin during development
claude --plugin-dir /path/to/Topia
```

Skills load directly from `skills/*/SKILL.md`. The CLI detects `.claude-plugin/` and skips compilation:

```
  -> Claude Code detected -- Topia works as a native plugin. No compilation needed.
```

### Cursor

Skills compile to `.cursor/rules/*.mdc` (Cursor's rule format).

```bash
node compiler/bin/topia.js init --platform cursor
```

Output: `.cursor/rules/Topia-build.mdc`, `.cursor/rules/Topia-plan.mdc`, etc.

Each skill file gets a Cursor-compatible header with `alwaysApply: false` frontmatter. Cross-references between skills are rewritten to `Topia-<skill-name>` format.

### Windsurf

Skills compile to `.windsurf/rules/*.md`.

```bash
node compiler/bin/topia.js init --platform windsurf
```

Output: `.windsurf/rules/Topia-build.md`, `.windsurf/rules/Topia-plan.md`, etc.

### Antigravity

Skills compile to `.agent/rules/*.md` (Google Antigravity format).

```bash
node compiler/bin/topia.js init --platform antigravity
```

Output: `.agent/rules/Topia-build.md`, `.agent/rules/Topia-plan.md`, etc.

### Generic

Fallback for any AI IDE that reads markdown rules from a directory.

```bash
node compiler/bin/topia.js init --platform generic
```

Output: `.ai/rules/Topia-build.md`, `.ai/rules/Topia-plan.md`, etc.

### OpenClaw

Skills compile to an OpenClaw plugin structure with manifest, TypeScript entry point, and skill files.

```bash
node compiler/bin/topia.js init --platform openclaw
```

Output structure:

```
.openclaw/Topia/
  openclaw.plugin.json       # Plugin manifest
  src/index.ts               # register(api) entry point
  skills/                    # Compiled skill files
    Topia-build.md
    Topia-plan.md
    Topia-skill-router.md
    ...
```

After building, add Topia to your OpenClaw config (`openclaw.json`):

```json
{
  "plugins": {
    "load": {
      "paths": ["./.openclaw/Topia"]
    },
    "entries": {
      "Topia": {
        "enabled": true
      }
    }
  }
}
```

The generated `src/index.ts` registers a `before_agent_start` hook that injects the skill-router instructions, so OpenClaw routes tasks through Topia skills automatically.

> **Pro Tip**: If you also use the NeuralMemory plugin, Topia coexists with it --
> NeuralMemory occupies the `memory` slot while Topia occupies `skills`.

---

## Auto-Detection

When you run `Topia init` without `--platform`, Topia checks for these markers in order:

| Priority | Marker | Platform |
|----------|--------|----------|
| 1 | `.claude-plugin/` | Claude Code (exits early) |
| 2 | `.cursor/` | Cursor |
| 3 | `.windsurf/` | Windsurf |
| 4 | `.agent/` | Antigravity |
| 5 | _(none found)_ | Prompts for selection |

If no marker is found, Topia shows the available platforms and asks you to choose. Unknown input defaults to `generic`.

---

## Configuration

`Topia init` creates a `topia.config.json` in your project root:

```json
{
  "$schema": "https://linenoize.github.io/topia/config-schema.json",
  "version": 1,
  "platform": "cursor",
  "source": "/path/to/Topia",
  "skills": {
    "disabled": []
  },
  "extensions": {
    "enabled": null
  },
  "output": {
    "index": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `platform` | string | Target platform (cursor, windsurf, antigravity, generic) |
| `source` | string | Path to Topia installation (auto-set by init) |
| `skills.disabled` | string[] | Skills to exclude from compilation |
| `extensions.enabled` | string[] or null | Extension packs to include (`null` = all) |
| `output.index` | boolean | Generate index file listing all compiled skills |

Edit this file directly, then run `Topia build` to recompile.

> **Pro Tip**: Commit `topia.config.json` to your repo so teammates get the same skill configuration.

---

## Extension Packs

Topia ships 14 free extension packs (L4 layer). Each adds domain-specific skills.

| Pack | Skills | Domain |
|------|--------|--------|
| `@Topia/ui` | 10 | UI component patterns, design systems, accessibility |
| `@Topia/backend` | 8 | API design, database patterns, auth, caching |
| `@Topia/devops` | 9 | CI/CD, Docker, Kubernetes, edge/serverless |
| `@Topia/mobile` | 9 | React Native, Flutter, deep linking, OTA |
| `@Topia/security` | 7 | OWASP, pen testing, threat modeling, supply chain |
| | 7 | Backtesting, quant analysis, market data |
| | 6 | Multi-tenancy, billing, onboarding, feature flags |
| `@Topia/ecommerce` | 7 | Cart, checkout, inventory, payments, tax |
| `@Topia/ai-ml` | 10 | LLM architecture, prompt patterns, RAG, agents |
| | 12 | Game loops, ECS, physics, multiplayer, audio |
| `@Topia/content` | 8 | CMS, SEO, i18n, MDX, video repurpose |
| `@Topia/analytics` | 7 | SQL patterns, A/B testing, funnels, dashboards |
| `@Topia/chrome-ext` | 6 | MV3 scaffold, messaging, storage, CWS publish |
| | 7 | Zalo OA messaging, webhooks, rate limiting |

**Enable specific packs**:

```bash
node compiler/bin/topia.js init --extensions @Topia/ui,@Topia/backend
```

**Enable all packs** (default):

```bash
node compiler/bin/topia.js init
# extensions.enabled = null means all packs are included
```

**Disable via config**:

```json
{
  "extensions": {
    "enabled": ["@Topia/ui", "@Topia/backend"]
  }
}
```

---

## Pro Tips

**CI Integration** -- Add Topia build to your CI pipeline to keep skills in sync:

```yaml
# .github/workflows/topia.yml
- name: Compile Topia skills
  run: node compiler/bin/topia.js build
- name: Validate output
  run: node compiler/bin/topia.js doctor
```

**Monorepo Setup** -- Compile to multiple packages from one Topia source:

```bash
node compiler/bin/topia.js build --output packages/frontend --platform cursor
node compiler/bin/topia.js build --output packages/backend --platform generic
```

**Selective Skills** -- Disable skills you don't need to reduce noise:

```bash
node compiler/bin/topia.js init --disable video-creator,asset-creator,trend-scout
```

**Keep Updated** -- Pull latest skills and recompile:

```bash
cd /path/to/topia && git pull
cd /your/project && node compiler/bin/topia.js build
```

---

## Troubleshooting

**"No platform configured"** when running `Topia build`:
- Run `Topia init` first to create `topia.config.json`.

**"Unknown platform"** during init:
- Check available platforms: `cursor`, `windsurf`, `antigravity`, `generic`.
- Claude Code users don't need the CLI -- install as a plugin instead.

**Skills not loading in Cursor**:
- Verify files exist in `.cursor/rules/`.
- Check that files have `.mdc` extension.
- Restart Cursor to pick up new rule files.

**Skills not loading in Windsurf / Antigravity**:
- Verify files exist in the correct rules directory.
- Check that your editor version supports the rules feature.

**"No topia.config.json found"** when running `Topia doctor`:
- Run `Topia init` to generate the config file.

**Build errors on specific skills**:
- Check the error output for the skill name and issue.
- Use `--disable <skill>` to skip problematic skills temporarily.
- Report issues at https://github.com/linenoize/topia/issues.
