#!/usr/bin/env node
/**
 * fork-drift-check.mjs — warn when skill-topia is behind topia.
 *
 *   node scripts/fork-drift-check.mjs --target C:/CodeBase/Protopia/skill-topia
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOPIA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  let target = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--target') target = path.resolve(argv[++i]);
  }
  return { target };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

const { target } = parseArgs(process.argv.slice(2));
if (!target || !existsSync(path.join(target, '.git'))) {
  console.error('Usage: node scripts/fork-drift-check.mjs --target <fork-path>');
  process.exit(1);
}

git(target, ['fetch', 'upstream-topia']);
const base = git(target, ['merge-base', 'HEAD', 'upstream-topia/main']);

const aheadTopia = git(TOPIA_ROOT, ['rev-list', '--count', `${base}..HEAD`]);
const behindTopia = git(target, ['rev-list', '--count', `${base}..upstream-topia/main`]);
const aheadFork = git(target, ['rev-list', '--count', `${base}..HEAD`]);

console.log(`Merge-base: ${base.slice(0, 7)}`);
console.log(`topia commits since base:      ${aheadTopia}`);
console.log(`topia commits fork lacks:      ${behindTopia}`);
console.log(`fork-only commits since base:  ${aheadFork}`);

if (Number(behindTopia) > 0) {
  console.error(`\nWARN: skill-topia is ${behindTopia} commit(s) behind topia. Run sync-to-skill-topia.mjs.`);
  process.exit(1);
}

console.log('\nOK: fork is up to date with topia (by commit count).');
