#!/usr/bin/env node
/**
 * port-rebrand.mjs — re-stamp upstream (protopia/skill-topia) identifiers
 * to this fork's (linenoize/topia) identifiers.
 *
 * This is the public linenoize/topia fork. Upstream is protopia/skill-topia
 * (private client). When pulling code from upstream, every URL, plugin slug,
 * marketplace id, and cache path must flip from protopia → linenoize before
 * we commit. The author identity token `skill-topia` is INTENTIONALLY
 * preserved (see package.json `author`, plugin.json `author.name`).
 *
 * USAGE
 *   node scripts/port-rebrand.mjs            # apply replacements in place
 *   node scripts/port-rebrand.mjs --dry-run  # print what would change, don't write
 *
 * SAFE TO RE-RUN. Every replacement is idempotent: running on an
 * already-rebranded tree produces zero changes. The script's own file is
 * skipped so the source-mapping table is not corrupted by its own contents.
 *
 * SCOPE
 *   • URLs:        @protopia/skill-topia → @linenoize/topia
 *                  github.com/protopia/skill-topia → github.com/linenoize/topia
 *                  protopia.github.io/skill-topia → linenoize.github.io/topia
 *   • Marketplace: name "protopia" → "linenoize" (in .claude-plugin/marketplace.json
 *                  and consuming source — install.js MARKETPLACE_ID,
 *                  resolve-topia-root.js cache lookup).
 *   • Plugin id:   Topia@protopia → Topia@linenoize (install instructions).
 *   • Cache paths: ~/.claude/plugins/cache/protopia/Topia → cache/linenoize/Topia
 *   • Marketing:   "Protopia marketplace" → "linenoize marketplace"
 *
 * WHAT THIS DOES NOT TOUCH
 *   • `author: "skill-topia"` (string-equal token, never adjacent to a URL).
 *   • Historical CHANGELOG/ROADTODO entries that mention upstream by name in
 *     a non-URL/instruction context.
 *   • References to "Protopia" as a brand metaphor in design discussions
 *     (those have been hand-edited where appropriate — this script does not
 *     try to neutralize brand voice).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = path.join('scripts', 'port-rebrand.mjs');

const DRY_RUN = process.argv.includes('--dry-run');

const SKIP_DIRS = new Set(['node_modules', '.git', 'mcp-servers']);
const EXTS = /\.(md|js|cjs|mjs|json|html|css|yml|yaml|svg|txt|mdc)$/;

// Order matters: longest / most specific first so we never partially rewrite a
// longer form by hitting its prefix. Each replacement is idempotent — applying
// twice produces the same output as applying once.
const REPLACEMENTS = [
  // npm scope (literal and regex-escaped)
  ['@protopia/skill-topia', '@linenoize/topia'],
  ['@protopia\\/skill-topia', '@linenoize\\/topia'],

  // Full repo URLs (HTTPS + bare slug)
  ['https://github.com/protopia/skill-topia', 'https://github.com/linenoize/topia'],
  ['github.com/protopia/skill-topia', 'github.com/linenoize/topia'],

  // GitHub Pages
  ['https://protopia.github.io/skill-topia', 'https://linenoize.github.io/topia'],
  ['protopia.github.io/skill-topia', 'linenoize.github.io/topia'],

  // Bare org/repo slug (markdown references)
  ['protopia/skill-topia', 'linenoize/topia'],

  // Plugin install id (Claude Code surface)
  ['Topia@protopia', 'Topia@linenoize'],

  // Plugin cache paths (resolve-topia-root.js + docs/install.js fallbacks)
  ['cache/protopia/Topia', 'cache/linenoize/Topia'],
  ['plugins/cache/protopia/skill-topia', 'plugins/cache/linenoize/topia'],

  // Marketing/brand strings tied to the marketplace concept (NOT brand voice)
  ['Protopia marketplace', 'linenoize marketplace'],
  ['Protopia Claude Code marketplace', 'linenoize Claude Code marketplace'],
];

// Single-file pinpoint replacements. These are too specific for a tree-wide
// substitution but still mechanical and idempotent.
const SCOPED = [
  {
    file: '.claude-plugin/marketplace.json',
    pairs: [
      ['"name": "protopia"', '"name": "linenoize"'],
      ['"name": "Protopia"', '"name": "linenoize"'],
    ],
  },
  {
    file: 'compiler/commands/install.js',
    pairs: [
      ["const MARKETPLACE_ID = 'protopia';", "const MARKETPLACE_ID = 'linenoize';"],
      ['<path-to-skill-topia>', '<path-to-topia>'],
    ],
  },
  {
    file: 'docs/templates/team-claude-settings.json',
    pairs: [
      ['"protopia": {', '"linenoize": {'],
    ],
  },
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (EXTS.test(name)) files.push(full);
  }
  return files;
}

function applyReplacements(text, pairs) {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

let changed = 0;
const touched = [];

// Tree-wide pass
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  if (rel === SELF.split(path.sep).join('/')) continue;

  const orig = readFileSync(file, 'utf-8');
  const next = applyReplacements(orig, REPLACEMENTS);
  if (next !== orig) {
    if (!DRY_RUN) writeFileSync(file, next, 'utf-8');
    changed++;
    touched.push(rel);
  }
}

// Scoped pinpoint pass
for (const { file, pairs } of SCOPED) {
  const abs = path.join(ROOT, file);
  let orig;
  try {
    orig = readFileSync(abs, 'utf-8');
  } catch {
    continue;
  }
  const next = applyReplacements(orig, pairs);
  if (next !== orig) {
    if (!DRY_RUN) writeFileSync(abs, next, 'utf-8');
    if (!touched.includes(file)) {
      changed++;
      touched.push(file);
    }
  }
}

const verb = DRY_RUN ? 'Would update' : 'Updated';
console.log(`${verb} ${changed} file${changed === 1 ? '' : 's'}:`);
for (const t of touched) console.log(`  ${t}`);
if (DRY_RUN) console.log('\n(dry run — no files written)');
