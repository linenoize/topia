#!/usr/bin/env node
/**
 * Scan a directory tree for folders created by Git Bash mkdir on Windows.
 *
 * Common artifacts:
 *   - `{name};C` or `{name}:C` — e.g. `alembic;C`, `app;C` (bash mkdir `alembic:C/...`)
 *   - `C?CodeBase?...` — backslash escapes in `C:\CodeBase\...`
 *   - `CCodeBase...` — fused path with no separators
 *
 * Usage: node scripts/scan-mangled-windows-dirs.js [--root <path>] [--depth N]
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

/** @param {string} name */
function isSuspectDirName(name) {
  if (/;C$/i.test(name)) return 'semicolon-C suffix (bash mkdir e.g. alembic:C/...)';
  if (/^[^/\\]+:C$/i.test(name)) return 'colon-C suffix';
  // Fused absolute path: C + mangled colon (U+F03A, ?, etc.) + CodeBase...
  if (/^C(?:\uF03A|:|\?)[A-Za-z]/i.test(name) && !name.includes(path.sep)) {
    return 'fused C:CodeBase path (bash mangled C:\\...)';
  }
  if (/^CCodeBase/i.test(name)) return 'fused CCodeBase path (backslashes eaten as escapes)';
  if (/^C\?/i.test(name) || (/\?/.test(name) && /^C/i.test(name) && !name.includes(path.sep))) {
    return 'backslash-escape mangling';
  }
  if (name === 'C:' || name === 'C?') return 'lone drive fragment';
  return null;
}

function scan(dir, depth = 0, maxDepth = 6) {
  const hits = [];
  if (depth > maxDepth) return hits;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const full = path.join(dir, ent.name);
    let childCount = 0;
    try {
      childCount = readdirSync(full).length;
    } catch {
      /* skip */
    }
    const reason = isSuspectDirName(ent.name);
    if (reason) {
      hits.push({ path: full, name: ent.name, reason, childCount, empty: childCount === 0 });
    }
    hits.push(...scan(full, depth + 1, maxDepth));
  }
  return hits;
}

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const depthFlag = argv.indexOf('--depth');
const root =
  rootFlag >= 0 ? argv[rootFlag + 1] : process.cwd();
const maxDepth = depthFlag >= 0 ? Number(argv[depthFlag + 1]) : 6;

const hits = scan(path.resolve(root), 0, maxDepth);
if (hits.length === 0) {
  console.log(`No mangled Windows-style folder names under ${root}`);
  process.exit(0);
}
console.log(`Suspect folders under ${root} (${hits.length}):\n`);
for (const h of hits) {
  console.log(`  ${h.empty ? '[empty]' : `[${h.childCount} entries]`} ${h.path}`);
  console.log(`    name: ${JSON.stringify(h.name)}`);
  console.log(`    reason: ${h.reason}`);
}
console.log('\nLikely cause: Git Bash `mkdir -p` with Windows paths like `alembic:C:\\...` or `C:\\...\\subdir`.');
console.log('Safe cleanup: delete empty suspect folders after confirming they are not real project dirs.');
