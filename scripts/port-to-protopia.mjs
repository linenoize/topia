#!/usr/bin/env node
/**
 * port-to-protopia.mjs — re-stamp linenoize/topia identifiers → protopia/skill-topia.
 *
 * Run inside the skill-topia fork after merging upstream topia (or copying content).
 * Normal release direction: topia → merge → this script → test → commit.
 *
 * USAGE
 *   node scripts/port-to-protopia.mjs [--root <path>] [--dry-run]
 *
 *   --root  repo root (default: cwd). sync-to-skill-topia passes the fork path.
 *
 * SAFE TO RE-RUN. Idempotent on an already-rebranded fork tree.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toProtopia } from './lib/rebrand-pairs.js';
import { runRebrand } from './lib/rebrand-runner.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const rootIdx = args.indexOf('--root');
const ROOT =
  rootIdx >= 0 && args[rootIdx + 1]
    ? path.resolve(args[rootIdx + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { changed, touched } = runRebrand({
  root: ROOT,
  replacements: toProtopia.replacements,
  scoped: toProtopia.scoped,
  dryRun: DRY_RUN,
});

const verb = DRY_RUN ? 'Would update' : 'Updated';
console.log(`${verb} ${changed} file${changed === 1 ? '' : 's'} in ${ROOT}:`);
for (const t of touched) console.log(`  ${t}`);
if (DRY_RUN) console.log('\n(dry run — no files written)');
