/**
 * migrate-v1.js — Rewrite v1 skill IDs in .topia/ project state for Topia v2.0.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

const MIGRATED_FLAG = 'migrated-from-v1.flag';

export const V1_SKILL_MAP = {
  sentinel: 'guardian',
  'sentinel-env': 'guardian-env',
  preflight: 'readiness',
  graft: 'integrate',
  scout: 'recon',
};

/** v1 pulse wire IDs → v2 (applied before skill word-boundary rewrites). */
export const V1_PULSE_MAP = {
  'preflight.passed': 'readiness.passed',
  'preflight.blocked': 'readiness.blocked',
  'graft.complete': 'integrate.complete',
};

const STATE_FILES = [
  'decisions.md',
  'conventions.md',
  'progress.md',
  'session-log.md',
  'instincts.md',
  'checkpoint.md',
  'cumulative-notes.md',
  'learnings.jsonl',
  'task-notes.md',
  'invariants.md',
  'INVARIANTS.md',
];

const STATE_DIRS = ['adr', 'features', 'metrics'];

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function rewriteContent(text) {
  let out = text;
  const pulseOrdered = Object.entries(V1_PULSE_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of pulseOrdered) {
    out = out.replaceAll(from, to);
  }
  const ordered = Object.entries(V1_SKILL_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of ordered) {
    // v1 used `topia:`; v3+ uses lowercase `topia:`. Translate both forms to canonical lowercase.
    out = out.replaceAll(`topia:${from}`, `topia:${to}`);
    out = out.replaceAll(`topia:${from}`, `topia:${to}`);
    out = out.replaceAll(`\`${from}\``, `\`${to}\``);
    out = out.replaceAll(`skills/${from}`, `skills/${to}`);
    out = out.replaceAll(`/${from}/`, `/${to}/`);
    out = out.replace(new RegExp(`\\b${from.replace(/-/g, '\\-')}\\b`, 'g'), to);
  }
  out = out.replaceAll('mesh integrity', 'nexus integrity');
  out = out.replaceAll('Skill Mesh', 'Topia Nexus');
  out = out.replaceAll('203 connections', '203 synapses');
  out = out.replaceAll('44 signals', '44 pulses');
  return out;
}

function collectFiles(topiaDir) {
  const files = [];
  for (const name of STATE_FILES) {
    const p = path.join(topiaDir, name);
    if (existsSync(p) && statSync(p).isFile()) files.push(p);
  }
  for (const dir of STATE_DIRS) {
    const dirPath = path.join(topiaDir, dir);
    if (!existsSync(dirPath)) continue;
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      if (entry.isFile()) files.push(path.join(dirPath, entry.name));
    }
  }
  return files;
}

export async function migrateFromV1({ cwd, dryRun = false, force = false, autoYes = false }) {
  const topiaDir = path.join(cwd, '.topia');
  const flagPath = path.join(topiaDir, MIGRATED_FLAG);

  if (!existsSync(topiaDir)) {
    console.log('  ℹ No .topia/ directory — nothing to migrate.');
    return;
  }

  if (existsSync(flagPath) && !force) {
    console.log('  ℹ Already migrated (`.topia/migrated-from-v1.flag`). Use --force to re-run.');
    return;
  }

  const files = collectFiles(topiaDir);
  if (files.length === 0) {
    console.log('  ℹ .topia/ exists but no known state files found.');
    return;
  }

  const plan = [];
  for (const file of files) {
    const before = readFileSync(file, 'utf-8');
    const after = rewriteContent(before);
    if (before !== after) plan.push({ file, after });
  }

  console.log('');
  console.log('  Topia v1 → v2 migration');
  console.log(`  Files to update: ${plan.length} of ${files.length} scanned`);
  console.log('');

  if (plan.length === 0) {
    console.log('  ✓ No v1 references found in .topia/ state.');
    if (!dryRun) writeFileSync(flagPath, `migrated-at: ${new Date().toISOString()}\n`, 'utf-8');
    return;
  }

  for (const { file } of plan) {
    console.log(`    · ${path.relative(cwd, file)}`);
  }
  console.log('');

  if (dryRun) {
    console.log('  ◎ Dry-run — no files written.');
    return;
  }

  if (!autoYes && !force) {
    const answer = await prompt('  Proceed? [y/N] ');
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Cancelled.');
      return;
    }
  }

  for (const { file, after } of plan) {
    writeFileSync(file, after, 'utf-8');
  }

  writeFileSync(flagPath, `migrated-at: ${new Date().toISOString()}\nfiles-updated: ${plan.length}\n`, 'utf-8');

  console.log(`  ✓ Updated ${plan.length} file(s). Rebuild: topia build`);
  console.log('');
}
