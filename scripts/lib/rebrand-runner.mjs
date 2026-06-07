/**
 * Tree walk + scoped replacement runner for port-rebrand / port-to-protopia.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'mcp-servers', '.topia']);
const EXTS = /\.(md|js|cjs|mjs|json|html|css|yml|yaml|svg|txt|mdc)$/;

const DEFAULT_SKIP_FILES = new Set([
  'scripts/lib/rebrand-pairs.js',
  'scripts/port-rebrand.mjs',
  'scripts/port-to-protopia.mjs',
  'scripts/sync-to-skill-topia.mjs',
  'scripts/fork-drift-check.mjs',
  'docs/FORK-SYNC.md',
]);

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

/**
 * @param {object} opts
 * @param {string} opts.root — repo root to rewrite
 * @param {[string, string][]} opts.replacements — tree-wide pairs
 * @param {{ file: string, pairs: [string, string][] }[]} opts.scoped — per-file pairs
 * @param {boolean} [opts.dryRun]
 * @param {Set<string>} [opts.skipFiles] — repo-relative paths to skip
 * @returns {{ changed: number, touched: string[] }}
 */
export function runRebrand({ root, replacements, scoped, dryRun = false, skipFiles = DEFAULT_SKIP_FILES }) {
  let changed = 0;
  const touched = [];

  for (const file of walk(root)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (skipFiles.has(rel)) continue;

    const orig = readFileSync(file, 'utf-8');
    const next = applyReplacements(orig, replacements);
    if (next !== orig) {
      if (!dryRun) writeFileSync(file, next, 'utf-8');
      changed++;
      touched.push(rel);
    }
  }

  for (const { file, pairs } of scoped) {
    const abs = path.join(root, file);
    let orig;
    try {
      orig = readFileSync(abs, 'utf-8');
    } catch {
      continue;
    }
    const next = applyReplacements(orig, pairs);
    if (next !== orig) {
      if (!dryRun) writeFileSync(abs, next, 'utf-8');
      if (!touched.includes(file)) {
        changed++;
        touched.push(file);
      }
    }
  }

  return { changed, touched };
}
