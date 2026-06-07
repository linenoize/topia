#!/usr/bin/env node
/**
 * port-rebrand.mjs — re-stamp protopia/skill-topia identifiers → linenoize/topia.
 *
 * Source of truth is linenoize/topia. Normal release flow is topia → skill-topia via
 * `scripts/sync-to-skill-topia.mjs` and `scripts/port-to-protopia.mjs` in the fork.
 *
 * Use THIS script only when pulling an old skill-topia snapshot into topia (reverse
 * port) or recovering from a bad merge. Every URL, plugin slug, marketplace id, and
 * cache path must flip protopia → linenoize before committing here.
 *
 * USAGE
 *   node scripts/port-rebrand.mjs            # apply replacements in place
 *   node scripts/port-rebrand.mjs --dry-run  # print what would change, don't write
 *
 * SAFE TO RE-RUN. Idempotent on an already-rebranded tree.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLinenoize } from './lib/rebrand-pairs.js';
import { runRebrand } from './lib/rebrand-runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = process.argv.includes('--dry-run');

const { changed, touched } = runRebrand({
  root: ROOT,
  replacements: toLinenoize.replacements,
  scoped: toLinenoize.scoped,
  dryRun: DRY_RUN,
});

const verb = DRY_RUN ? 'Would update' : 'Updated';
console.log(`${verb} ${changed} file${changed === 1 ? '' : 's'}:`);
for (const t of touched) console.log(`  ${t}`);
if (DRY_RUN) console.log('\n(dry run — no files written)');
