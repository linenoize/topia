#!/usr/bin/env node
/**
 * Cross-platform mkdir for agents (avoids Git Bash Windows path bugs).
 *
 * Usage: node scripts/ensure-dir.mjs <relative-dir> [more dirs...]
 * Example: node scripts/ensure-dir.mjs .topia .topia/metrics screenshots
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('Usage: node scripts/ensure-dir.mjs <dir> [dir...]');
  process.exit(1);
}

const cwd = process.cwd();
for (const rel of dirs) {
  if (path.isAbsolute(rel)) {
    console.error(`Refusing absolute path (use relative dirs from project root): ${rel}`);
    process.exit(1);
  }
  if (/[;]|:[A-Za-z]/.test(rel) && !rel.startsWith('.topia')) {
    console.error(`Suspicious path (colon/semicolon drive fragment): ${rel}`);
    process.exit(1);
  }
  const target = path.join(cwd, rel);
  mkdirSync(target, { recursive: true });
  console.log(`created ${path.relative(cwd, target) || '.'}`);
}
