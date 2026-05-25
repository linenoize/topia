# Topia Multi-Platform Architecture

> Version: 1.0.0 | Status: Stable

## 1. Principles

0. **Windows paths** — agents must not run Git Bash `mkdir -p` with `C:\...` or `folder:C:\...` paths (creates empty `alembic;C`-style junk). See `docs/INSTALL-CLAUDE-CODE.md` and `scripts/scan-mangled-windows-dirs.js`.
1. **ALL skills on ALL platforms** — no Lite version, no skipping infrastructure skills.
2. **Zero knowledge loss** — every workflow step, constraint, HARD-GATE, sharp edge ships everywhere.
3. **Single source of truth** — `skills/*.md` is canonical. Other platforms get compiled output.
4. **Platform affects delivery format, not content quality.**
5. **Adapter pattern** — adding a new platform = one new adapter file (~100 LOC).

## 2. Platform Target Matrix

| Platform | Output Dir | File Format | Cross-Ref Mechanism | Subagent Support | Hook Support |
|----------|-----------|-------------|---------------------|-----------------|--------------|
| Claude Code | passthrough (no compile) | SKILL.md | `Skill("Topia:<name>")` | `context: fork`, `agent:` | hooks.json (JS) |
| Cursor | `.cursor/rules/` | `Topia-<name>.mdc` | `@file:Topia-<name>.mdc` | None | None (inline MUST) |
| Windsurf | `.windsurf/rules/` | `Topia-<name>.md` | Prose: "Follow Topia-<name> rule" | None | None (inline MUST) |
| Antigravity | `.agent/rules/` | `Topia-<name>.md` | File reference | None | None (inline MUST) |
| Generic | `.ai/rules/` | `Topia-<name>.md` | Prose reference | None | None (inline MUST) |

## 3. Compiler Architecture

### 3.1 Three-Stage Pipeline

```
  skills/*.md ──► PARSE ──► TRANSFORM ──► EMIT ──► .cursor/rules/*.mdc
  extensions/*.md              │                    .windsurf/rules/*.md
                               │                    .agent/rules/*.md
                          (middleware chain)
```

**Parse**: Extract frontmatter (YAML), body (markdown), and cross-references from SKILL.md files.
**Transform**: Apply platform-agnostic middleware functions (reference rewriting, tool name mapping, directive removal).
**Emit**: Write platform-specific output files with correct structure, naming, and wrapping.

### 3.2 Parser Output (Intermediate Representation)

```typescript
interface ParsedSkill {
  name: string;                    // from frontmatter
  description: string;             // from frontmatter
  layer: "L0" | "L1" | "L2" | "L3";
  model: "haiku" | "sonnet" | "opus";
  group: string;
  contextFork: boolean;            // context: fork present?
  agentType: string | null;        // agent: general-purpose, etc.
  body: string;                    // full markdown body
  crossRefs: CrossRef[];           // extracted Topia:<name> references
  toolRefs: ToolRef[];             // extracted tool name references
  hardGates: string[];             // <HARD-GATE> blocks
  sections: Map<string, string>;   // ## Section Name -> content
}

interface CrossRef {
  raw: string;       // "Topia:recon", "Topia:build"
  skillName: string; // "scout", "build"
  line: number;      // line number in source
  context: string;   // surrounding text for rewrite
}

interface ToolRef {
  raw: string;       // "Read", "Write", "Edit", "Glob", "Grep", "Bash", "TodoWrite"
  line: number;
  context: string;
}
```

### 3.3 Transform Pipeline

Transforms are composable middleware functions. Order matters.

```
1. stripFrontmatterDirectives  — remove context:fork, agent:, or rewrite for platform
2. rewriteCrossReferences      — Topia:build → platform-native reference
3. rewriteToolNames            — `Read` → platform equivalent or generic term
4. rewriteModelHints           — model: opus → remove or convert to comment
5. inlineHookConstraints       — hook behaviors → embedded MUST/NEVER rules
6. rewriteSubagentDelegation   — "Launch 3 parallel agents" → sequential workflow
7. addPlatformPreamble         — platform-specific header/metadata
8. addBranding                 — Topia attribution + Claude Code CTA
```

Each transform is a pure function: `(skill: ParsedSkill, config: PlatformConfig) => ParsedSkill`.

### 3.4 Emitter

Each platform adapter provides an emitter that:
1. Determines output file path and name
2. Wraps content in platform-specific format (e.g., Cursor .mdc frontmatter)
3. Writes the file

## 4. Platform Adapter Interface

```typescript
interface PlatformAdapter {
  /** Platform identifier */
  name: string;

  /** Where compiled rules go, relative to project root */
  outputDir: string;

  /** File extension for rule files */
  fileExtension: string;

  /**
   * Transform a cross-reference like "Topia:build" into platform-native format.
   * @param skillName - e.g., "build"
   * @param context - surrounding sentence for contextual rewrite
   * @returns replacement string
   */
  transformReference(skillName: string, context: string): string;

  /**
   * Transform Claude Code tool names to platform equivalents.
   * @param toolName - e.g., "Read", "Edit", "Bash"
   * @returns platform-appropriate term
   */
  transformToolName(toolName: string): string;

  /**
   * Generate platform-specific file header/frontmatter.
   * @param skill - parsed skill data
   * @returns string to prepend to file
   */
  generateHeader(skill: ParsedSkill): string;

  /**
   * Generate platform-specific file footer (branding, CTA).
   * @returns string to append to file
   */
  generateFooter(): string;

  /**
   * Transform subagent/parallel execution instructions.
   * @param instruction - original parallel execution text
   * @returns sequential workflow text, or platform equivalent
   */
  transformSubagentInstruction(instruction: string): string;

  /**
   * Platform-specific post-processing on final output.
   * @param content - fully transformed markdown
   * @returns final output string
   */
  postProcess(content: string): string;
}
```

### 4.1 Adapter: Claude Code (Passthrough)

```javascript
// adapters/claude.js
module.exports = {
  name: "claude",
  outputDir: null, // no compilation — source IS the output
  fileExtension: ".md",
  transformReference: (name, ctx) => ctx, // no change
  transformToolName: (name) => name,      // no change
  generateHeader: () => "",
  generateFooter: () => "",
  transformSubagentInstruction: (inst) => inst,
  postProcess: (content) => content,
};
```

### 4.2 Adapter: Cursor

```javascript
// adapters/cursor.js
module.exports = {
  name: "cursor",
  outputDir: ".cursor/rules",
  fileExtension: ".mdc",

  transformReference(skillName, context) {
    // Topia:build → @Topia-build.mdc (Cursor file reference)
    return context
      .replace(/`Topia:${skillName}`/g, `\`@Topia-${skillName}.mdc\``)
      .replace(/topia:${skillName}/g, `@Topia-${skillName}.mdc`);
  },

  transformToolName(toolName) {
    // Cursor uses same tool names but without the Skill() invocation system
    const map = {
      "Read": "read the file",
      "Write": "write the file",
      "Edit": "edit the file",
      "Glob": "search for files by pattern",
      "Grep": "search file contents",
      "Bash": "run a terminal command",
      "TodoWrite": "track progress with todos",
    };
    return map[toolName] || toolName;
  },

  generateHeader(skill) {
    // Cursor .mdc frontmatter format
    return [
      "---",
      `description: "${skill.description}"`,
      `globs: []`,
      `alwaysApply: ${skill.layer === "L0"}`,
      "---",
      ""].join("\n");
  },

  generateFooter() {
    return [
      "",
      "---",
      "> Topia Skill Toolkit — https://github.com/linenoize/topia",
      "> Full experience with subagents, hooks, and adaptive routing: use Topia on Claude Code."].join("\n");
  },

  transformSubagentInstruction(instruction) {
    return instruction
      .replace(/Launch \d+ (parallel )?agents?/gi, "Execute the following steps sequentially")
      .replace(/as independent Task agents/gi, "one at a time")
      .replace(/PARALLEL EXECUTION:/gi, "SEQUENTIAL EXECUTION:");
  },

  postProcess(content) {
    // Remove context: fork and agent: lines from any remaining references
    return content
      .replace(/^context: fork\n/gm, "")
      .replace(/^agent: general-purpose\n/gm, "");
  },
};
```

### 4.3 Adapter: Windsurf

```javascript
// adapters/windsurf.js
module.exports = {
  name: "windsurf",
  outputDir: ".windsurf/rules",
  fileExtension: ".md",

  transformReference(skillName, context) {
    // Prose reference: "Follow the Topia-<name> rule"
    return context
      .replace(/`Topia:${skillName}`/g, `the \`Topia-${skillName}\` rule file`)
      .replace(/topia:${skillName}/g, `the Topia-${skillName} rule file`);
  },

  transformToolName(toolName) {
    // Windsurf uses generic terms
    const map = {
      "Read": "read the file",
      "Write": "write/create the file",
      "Edit": "edit the file",
      "Glob": "find files matching a pattern",
      "Grep": "search for text in files",
      "Bash": "run a shell command",
      "TodoWrite": "track task progress",
    };
    return map[toolName] || toolName;
  },

  generateHeader(skill) {
    return `# Topia-${skill.name}\n\n> Layer: ${skill.layer} | Group: ${skill.group}\n\n`;
  },

  generateFooter() {
    return [
      "",
      "---",
      "> Topia Skill Toolkit — https://github.com/linenoize/topia",
      "> Full experience with subagents, hooks, and adaptive routing: use Topia on Claude Code."].join("\n");
  },

  transformSubagentInstruction(instruction) {
    return instruction
      .replace(/Launch \d+ (parallel )?agents?/gi, "Execute the following steps in order")
      .replace(/as independent Task agents/gi, "sequentially")
      .replace(/PARALLEL EXECUTION:/gi, "SEQUENTIAL EXECUTION:");
  },

  postProcess(content) {
    return content
      .replace(/^context: fork\n/gm, "")
      .replace(/^agent: general-purpose\n/gm, "");
  },
};
```

### 4.4 Adapter: Google Antigravity

```javascript
// adapters/antigravity.js
module.exports = {
  name: "antigravity",
  outputDir: ".agent/rules",
  fileExtension: ".md",
  // Same patterns as windsurf — Antigravity uses markdown rules in .agent/
  // Inherits windsurf patterns with different outputDir
  // ... (identical transform logic, different header)

  generateHeader(skill) {
    return `# Topia-${skill.name}\n\n> Topia ${skill.layer} Skill | ${skill.group}\n\n`;
  },
};
```

### 4.5 Adding a New Platform

Create one file: `compiler/adapters/<platform>.js` implementing the `PlatformAdapter` interface. Register it in `compiler/adapters/index.js`. Done. No other changes needed.

## 5. Cross-Reference Resolution

The toolkit is Topia's core value. Here is how it works per platform:

### 5.1 Reference Patterns in Source

```
Pattern 1: `Topia:build`                     — backtick-wrapped reference
Pattern 2: Topia:build                        — bare reference
Pattern 3: Use `Topia:recon`                 — instruction to invoke
Pattern 4: REQUIRED SUB-SKILL: Use `Topia:X` — hard requirement
Pattern 5: invoke `Topia:debug`              — conditional invocation
Pattern 6: → invoke `Topia:plan`             — flow arrow reference
```

### 5.2 Resolution Strategy

The parser uses a regex to find all `Topia:<name>` patterns and records them as `CrossRef` entries. The transformer then rewrites each based on the platform adapter.

```javascript
// Cross-reference regex (handles both backtick-wrapped and bare)
const CROSS_REF_PATTERN = /`?Topia:([a-z][\w-]*)`?/g;
```

### 5.3 Platform-Specific Output

| Source | Claude Code | Cursor | Windsurf / Antigravity |
|--------|------------|--------|------------------------|
| `Use Topia:recon` | `Use Topia:recon` (unchanged) | `Use @Topia-scout.mdc` | `Follow the Topia-scout rule file` |
| `REQUIRED SUB-SKILL: Use Topia:plan` | unchanged | `REQUIRED: Follow @Topia-plan.mdc` | `REQUIRED: Follow the Topia-plan rule file` |
| `invoke Topia:debug` | unchanged | `follow @Topia-debug.mdc` | `follow the Topia-debug rule file` |

### 5.4 Nexus Integrity Check

After compilation, the `Topia doctor` command verifies:
- Every cross-reference target exists as an output file on the target platform
- No dangling references (skill A references skill B, but B was disabled in config)
- Layer discipline preserved (L3 does not reference L1 in compiled output)

## 6. Tool Name Transformation

### 6.1 Transformation Map

Tool names appear in backticks in SKILL.md files. The transformer rewrites them contextually:

```javascript
const TOOL_PATTERNS = {
  // Pattern: `ToolName` in instruction context
  // Match: Use `Read` to examine | Use `Bash` to run
  regex: /Use `(Read|Write|Edit|Glob|Grep|Bash|TodoWrite)`/g,

  // Also match standalone references
  standalone: /`(Read|Write|Edit|Glob|Grep|Bash|TodoWrite)`/g,
};
```

### 6.2 Contextual Rewriting (Not Blind Replace)

The transformer preserves the instruction intent:

| Source | Cursor / Windsurf Output |
|--------|--------------------------|
| `Use Read to examine key files` | `Read the key files to examine them` |
| `Use Bash to run tests` | `Run tests in the terminal` |
| `Use Glob to find files matching` | `Find files matching the pattern` |
| `Use Grep to search for patterns` | `Search file contents for patterns` |
| `Use Write to create test files` | `Create the test files` |
| `Use Edit for modifying existing files` | `Modify the existing files` |
| `TodoWrite: [...]` | `Track progress: [...]` |

The key insight: other platforms have the same capabilities (read, write, search, run commands) but without named tool APIs. The instructions become natural language that any AI agent can follow.

## 7. Hook Constraint Inlining

Claude Code hooks (hooks.json) enforce behaviors programmatically. Other platforms get these as inline rules.

### 7.1 Hook-to-Instruction Mapping

| Hook | Type | Inlined Instruction |
|------|------|---------------------|
| `secrets-scan` | PreToolUse(Bash) | `MUST NOT: Never run commands containing hardcoded secrets, API keys, or tokens. Scan all shell commands for secret patterns before execution.` |
| `auto-format` | PostToolUse(Edit) | `MUST: After editing JS/TS files, ensure code follows project formatting conventions (Prettier/ESLint).` |
| `typecheck` | PostToolUse(Edit) | `MUST: After editing .ts/.tsx files, verify TypeScript compilation succeeds (no type errors).` |
| `context-watch` | PreToolUse(Edit) | `SHOULD: Monitor your context usage. If working on a long task, summarize progress before context fills up.` |
| `pre-tool-guard` | PreToolUse(Read) | (no equivalent needed — platform handles file access) |
| `metrics-collector` | PostToolUse(Skill) | Cursor: native `postToolUse` via `.cursor/hooks.json`; Claude: plugin hook |
| `token-meter` | PostToolUse(*) | Cursor + Claude: estimates tool I/O tokens (chars × 0.25) |
| `session-start` | SessionStart | (no equivalent — platform handles session init) |
| `pre-compact` | PreCompact | `MUST: Before summarizing/compacting context, save important decisions and progress to project files.` |
| `post-session-reflect` | Stop | `SHOULD: Before ending, save architectural decisions and progress to .topia/ directory for future sessions.` |

### 7.2 Injection Strategy

Hook instructions are injected as a `## Platform Constraints` section at the top of EVERY compiled skill file (after the header, before the first skill section). This ensures the AI agent sees them regardless of which skill it reads.

Only relevant hooks are injected per skill — a skill that never uses `Edit` does not get the auto-format instruction.

## 8. CLI Commands

### 8.1 `Topia init`

Interactive setup for a new project.

```
$ npx Topia init

? Select your AI platform:
  ❯ Claude Code (native plugin — no compilation needed)
    Cursor
    Windsurf
    Google Antigravity
    Other / Generic

? Select extension packs to enable:
  ◉ @Topia/ui
  ◉ @Topia/backend
  ◯ @Topia/devops
  ◯ @Topia/mobile
  ◯ @Topia/security
  ...

? Disable any core skills? (advanced)
  All 66 skills enabled by default. Enter skill names to disable, or press Enter to keep all.

✓ Created topia.config.json
✓ Run `npx Topia build` to compile rules for Cursor
```

For Claude Code: `Topia init` detects the platform and outputs "No compilation needed — Topia is already active via the plugin system."

### 8.2 `Topia build`

Compile skills for the configured platform.

```
$ npx Topia build

[parse]     66 skills parsed (0 errors)
[parse]     10 extension packs parsed
[transform] Platform: cursor
[transform] Rewriting 215 cross-references
[transform] Rewriting 112 tool name references
[transform] Inlining 5 hook constraints
[transform] Converting 12 subagent instructions to sequential
[emit]      Writing 64 skill files to .cursor/rules/
[emit]      Writing 10 extension files to .cursor/rules/
[emit]      Writing 1 index file (Topia-index.mdc)
[verify]    All cross-references resolve ✓
[verify]    No dangling references ✓

✓ Built 79 rule files in .cursor/rules/ (345ms)
```

**Flags:**
- `--platform <name>` — override platform from config
- `--skills <list>` — build only specific skills
- `--dry-run` — show what would be written without writing
- `--verbose` — show per-file transform details

### 8.3 `Topia sync`

Watch source skills and rebuild on change. For development/contribution.

```
$ npx Topia sync

[watch] Watching skills/ and extensions/ for changes...
[sync]  skills/build/SKILL.md changed → rebuilding Topia-build.mdc
[sync]  Built 1 file (45ms)
```

### 8.4 `Topia doctor`

Validate the compiled output.

```
$ npx Topia doctor

[check] Platform: cursor
[check] Config: topia.config.json ✓
[check] Output dir: .cursor/rules/ ✓
[check] Skill files: 64/64 present ✓
[check] Extension files: 14/14 present ✓
[check] Cross-references: 215/215 resolve ✓
[check] Layer discipline: no violations ✓
[check] Source freshness: all output files match source ✓
[warn]  2 skills disabled in config: browser-pilot, video-creator

✓ Topia installation healthy
```

## 9. Repository Structure

Directories in the Topia repo:

```
Topia/
├── compiler/                   # Multi-platform compiler
│   ├── cli.js                  # CLI entry point (Topia init/build/sync/doctor)
│   ├── parser.js               # SKILL.md → ParsedSkill IR
│   ├── transformer.js          # Platform-agnostic transform pipeline
│   ├── emitter.js              # IR → platform-specific output files
│   ├── watcher.js              # File watcher for Topia sync
│   ├── doctor.js               # Validation logic for Topia doctor
│   ├── adapters/               # Platform adapters
│   │   ├── index.js            # Adapter registry
│   │   ├── claude.js           # Passthrough (no-op)
│   │   ├── cursor.js           # .cursor/rules/*.mdc
│   │   ├── windsurf.js         # .windsurf/rules/*.md
│   │   ├── antigravity.js      # .agent/rules/*.md
│   │   └── generic.js          # .ai/rules/*.md (fallback)
│   └── transforms/             # Individual transform functions
│       ├── cross-references.js # Topia:<name> rewriting
│       ├── tool-names.js       # Read/Write/Edit/etc. rewriting
│       ├── frontmatter.js      # context:fork, agent:, model: handling
│       ├── subagents.js        # Parallel → sequential conversion
│       ├── hooks.js            # Hook behavior inlining
│       └── branding.js         # Footer CTA injection
├── package.json                # bin: { "Topia": "compiler/cli.js" }
├── skills/                     # Canonical source
├── extensions/                 # Canonical source
├── hooks/                      # Claude Code only
├── scripts/                    # Existing validation
└── docs/
    └── MULTI-PLATFORM.md       # THIS FILE
```

## 10. topia.config.json Schema

```jsonc
{
  // Schema version
  "$schema": "https://linenoize.github.io/topia/config-schema.json",
  "version": 1,

  // Target platform — determines which adapter is used
  "platform": "cursor",  // "claude" | "cursor" | "windsurf" | "antigravity" | "generic"

  // Topia source location (default: node_modules/topia or global install)
  "source": "@linenoize/topia",

  // Core skills configuration
  "skills": {
    // All 64 enabled by default. Disable individual skills here.
    "disabled": [],

    // Per-skill overrides (rare — for advanced users)
    "overrides": {
      // Example: force a skill to always be included even in minimal builds
      // "build": { "alwaysApply": true }
    }
  },

  // Extension packs configuration
  "extensions": {
    // Which L4 packs are active for this project
    "enabled": [
      "@Topia/ui",
      "@Topia/backend",
    ]
    // Packs not listed here are not compiled into output
  },

  // Output configuration
  "output": {
    // Override output directory (default: platform-specific)
    "dir": null,

    // Generate an index file listing all skills
    "index": true,

    // Include cost profile section in output (some teams strip this)
    "includeCostProfile": true
  }
}
```

## 11. CI Pipeline

### 11.1 GitHub Actions: Build All Platforms

```yaml
# .github/workflows/build-platforms.yml
name: Build All Platforms

on:
  push:
    paths:
      - 'skills/**'
      - 'extensions/**'
      - 'compiler/**'
  pull_request:
    paths:
      - 'skills/**'
      - 'extensions/**'
      - 'compiler/**'

jobs:
  validate-source:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/validate-skills.js
      - run: node scripts/validate-nexus.js
      - run: node scripts/validate-pack.js

  build-platforms:
    needs: validate-source
    runs-on: ubuntu-latest
    strategy:
      matrix:
        platform: [cursor, windsurf, antigravity, generic]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node compiler/cli.js build --platform ${{ matrix.platform }} --output dist/${{ matrix.platform }}
      - run: node compiler/cli.js doctor --platform ${{ matrix.platform }} --output dist/${{ matrix.platform }}
      - uses: actions/upload-artifact@v4
        with:
          name: Topia-${{ matrix.platform }}
          path: dist/${{ matrix.platform }}/

  test-compiler:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm test
```

## 12. Branding and CTA

Every compiled skill file includes a footer that:
1. Attributes Topia as the source
2. Points to the full Claude Code experience (without being obnoxious)

### 12.1 Footer Template

```markdown
---
> **Topia Skill Toolkit** — 66 skills, 203 synapses
> Source: https://github.com/linenoize/topia
> For the full experience with subagents, hooks, adaptive routing, and nexus analytics — use Topia as a Claude Code plugin.
```

## 13. Personalization Flow

### 13.1 `Topia init` User Experience

```
$ node compiler/bin/topia.js init

  ╭─────────╮
  │  Topia  │
  ╰─────────╯

  Detected: .cursor/ directory → Cursor

  ? Confirm platform: Cursor
  ? Your project type: (select all that apply)
    ◉ Web Frontend (React, Vue, Svelte)
    ◉ Backend API (Express, FastAPI, etc.)
    ◯ Mobile (React Native, Flutter)
    ◯ DevOps (Docker, CI/CD)
    ◯ Trading / Finance
    ◯ AI / ML
    ◯ Game Development
    ◯ E-commerce
    ◯ SaaS Platform
    ◯ Content / Blog

  → Enabling: @Topia/ui, @Topia/backend (2 packs)
  → All 64 core skills enabled

  ✓ Created topia.config.json
  ✓ Built 79 rule files in .cursor/rules/
  ✓ Added .cursor/rules/ to .gitignore (compiled output)

  Next: Start coding. Topia skills are active in your AI assistant.
```

### 13.2 Platform Auto-Detection

```javascript
function detectPlatform(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, '.claude-plugin'))) return 'claude';
  if (fs.existsSync(path.join(projectRoot, '.cursor')))        return 'cursor';
  if (fs.existsSync(path.join(projectRoot, '.windsurf')))      return 'windsurf';
  if (fs.existsSync(path.join(projectRoot, '.agent')))         return 'antigravity';
  return 'generic';
}
```

### 13.3 Skill Enable/Disable

Users can disable skills they do not need:

```json
{
  "skills": {
    "disabled": ["browser-pilot", "video-creator", "asset-creator"]
  }
}
```

When a skill is disabled:
- Its file is NOT emitted
- Cross-references TO it from other skills get a note: `(skill disabled in topia.config.json)`
- Cross-references FROM it are irrelevant (file does not exist)
- `Topia doctor` warns about disabled skills that are referenced by enabled skills
