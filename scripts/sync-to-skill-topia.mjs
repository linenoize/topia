#!/usr/bin/env node
/**
 * sync-to-skill-topia.mjs — merge topia into skill-topia and rebrand for protopia.
 *
 * Run from the topia repo (source of truth):
 *   node scripts/sync-to-skill-topia.mjs --target C:/CodeBase/Protopia/skill-topia
 *
 * Flags:
 *   --target <path>   skill-topia clone (required)
 *   --dry-run         preview merge + rebrand only; no git merge or file writes
 *   --no-merge        rebrand-only on current fork tree (skip git merge)
 *   --ff-only         pass --ff-only to git merge
 *   --skip-verify     skip npm test + topia doctor in the fork
 *   --upstream <name> remote in fork pointing at topia (default: upstream-topia)
 *   --branch <name>   branch to merge (default: main)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRebrand } from './lib/rebrand-runner.mjs';
import { toProtopia } from './lib/rebrand-pairs.js';

const TOPIA_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_SCRIPT = path.join(TOPIA_ROOT, 'scripts', 'port-to-protopia.mjs');

function parseArgs(argv) {
  const out = {
    target: null,
    dryRun: false,
    noMerge: false,
    ffOnly: false,
    skipVerify: false,
    upstream: 'upstream-topia',
    branch: 'main',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-merge') out.noMerge = true;
    else if (a === '--ff-only') out.ffOnly = true;
    else if (a === '--skip-verify') out.skipVerify = true;
    else if (a === '--target') out.target = path.resolve(argv[++i]);
    else if (a === '--upstream') out.upstream = argv[++i];
    else if (a === '--branch') out.branch = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/sync-to-skill-topia.mjs --target <fork-path> [flags]
  --dry-run       preview only
  --no-merge      rebrand current fork tree without merging topia
  --ff-only       fast-forward merge only
  --skip-verify   skip npm test and topia doctor
  --upstream <n>  fork remote for topia (default: upstream-topia)
  --branch <n>    branch to merge (default: main)`);
      process.exit(0);
    }
  }
  return out;
}

function git(cwd, args, { dryRun = false } = {}) {
  const cmd = `git ${args.join(' ')}`;
  if (dryRun) {
    console.log(`[dry-run] (in ${cwd}) ${cmd}`);
    return '';
  }
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function verifyFork(target) {
  if (!existsSync(path.join(target, '.git'))) {
    throw new Error(`Not a git repo: ${target}`);
  }
  const origin = git(target, ['remote', 'get-url', 'origin']);
  if (!/protopia\/skill-topia/i.test(origin)) {
    throw new Error(`Expected origin → protopia/skill-topia, got: ${origin}`);
  }
}

function readVersion(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
  } catch {
    return '?';
  }
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.target) {
  console.error('Error: --target <fork-path> is required.');
  process.exit(1);
}

verifyFork(opts.target);

const topiaVersion = readVersion(TOPIA_ROOT);
console.log(`Topia source: ${TOPIA_ROOT} (v${topiaVersion})`);
console.log(`Fork target:  ${opts.target}`);

if (!opts.noMerge) {
  git(opts.target, ['fetch', opts.upstream], { dryRun: opts.dryRun });
  const mergeArgs = ['merge', `${opts.upstream}/${opts.branch}`, '--no-edit'];
  if (opts.ffOnly) mergeArgs.splice(1, 0, '--ff-only');
  try {
    git(opts.target, mergeArgs, { dryRun: opts.dryRun });
    if (!opts.dryRun) console.log(`Merged ${opts.upstream}/${opts.branch} into fork.`);
  } catch (err) {
    console.error(`Merge failed: ${err.stderr || err.message}`);
    console.error('Resolve conflicts in the fork, then re-run with --no-merge to rebrand only.');
    process.exit(1);
  }
}

const { changed, touched } = runRebrand({
  root: opts.target,
  replacements: toProtopia.replacements,
  scoped: toProtopia.scoped,
  dryRun: opts.dryRun,
});

console.log(`${opts.dryRun ? 'Would rebrand' : 'Rebranded'} ${changed} file(s).`);
if (touched.length > 0 && touched.length <= 30) {
  for (const t of touched) console.log(`  ${t}`);
} else if (touched.length > 30) {
  for (const t of touched.slice(0, 20)) console.log(`  ${t}`);
  console.log(`  ... and ${touched.length - 20} more`);
}

if (!opts.skipVerify && !opts.dryRun) {
  console.log('\nRunning fork verification...');
  const test = spawnSync(process.execPath, ['--test', 'compiler/__tests__/*.test.js', 'scripts/__tests__/*.test.js'], {
    cwd: opts.target,
    shell: true,
    stdio: 'inherit',
  });
  if (test.status !== 0) {
    console.error('npm test equivalent failed in fork.');
    process.exit(test.status ?? 1);
  }
  const doctor = spawnSync(process.execPath, [path.join(opts.target, 'compiler/bin/topia.js'), 'doctor'], {
    cwd: opts.target,
    stdio: 'inherit',
  });
  if (doctor.status !== 0) {
    console.error('topia doctor failed in fork.');
    process.exit(doctor.status ?? 1);
  }
}

console.log('\n--- Next steps ---');
console.log(`1. In fork: node scripts/bump-version.js ${topiaVersion}   # if version drift remains`);
console.log(`2. Review: git -C "${opts.target}" status`);
console.log(`3. Commit: feat: parity port from linenoize/topia v${topiaVersion}`);
console.log('4. Push fork to origin when ready');
