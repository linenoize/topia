#!/usr/bin/env node
/**
 * One-shot v2.0 string replacements for nexus terminology + skill renames.
 * Run: node scripts/v2-rename-replacements.js
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.git', 'mcp-servers', 'references/ui-pro-max-data']);

const REPLACEMENTS = [
  // Skill IDs (order: longest / most specific first)
  ['guardian-env', 'guardian-env'],
  ['Topia:guardian-env', 'Topia:guardian-env'],
  ['Topia:guardian', 'Topia:guardian'],
  ['Topia:readiness', 'Topia:readiness'],
  ['Topia:integrate', 'Topia:integrate'],
  ['Topia:recon', 'Topia:recon'],
  ['`guardian`', '`guardian`'],
  ['`readiness`', '`readiness`'],
  ['`integrate`', '`integrate`'],
  ['- guardian', '- guardian'],
  ['- readiness', '- readiness'],
  ['- integrate', '- integrate'],
  ['- recon (', '- recon ('],
  ['- `recon`', '- `recon`'],
  ['guardian/', 'guardian/'],
  ['readiness/', 'readiness/'],
  ['integrate/', 'integrate/'],
  ['recon/', 'recon/'],
  ['skills/guardian', 'skills/guardian'],
  ['skills/readiness', 'skills/readiness'],
  ['skills/integrate', 'skills/integrate'],
  ['skills/recon', 'skills/recon'],
  ['agents/guardian', 'agents/guardian'],
  ['agents/readiness', 'agents/readiness'],
  ['agents/recon', 'agents/recon'],
  ["WIRED_SKILLS = ['preflight', 'sentinel'", "WIRED_SKILLS = ['readiness', 'guardian'"],
  ["dispatchHook('readiness", "dispatchHook('readiness"],
  ["dispatchHook('guardian", "dispatchHook('guardian"],
  ['${DISPATCH_CMD} readiness', '${DISPATCH_CMD} readiness'],
  ['${DISPATCH_CMD} guardian', '${DISPATCH_CMD} guardian'],
  // Nexus terminology (user-facing)
  ['Topia Nexus', 'Topia Nexus'],
  ['Topia Nexus', 'Topia Nexus'],
  ['nexus integrity', 'nexus integrity'],
  ['Nexus integrity', 'Nexus integrity'],
  ['Nexus Integrity', 'Nexus Integrity'],
  ['nexus health', 'nexus health'],
  ['Nexus is healthy', 'Nexus is healthy'],
  ['Nexus has', 'Nexus has'],
  ['nexus.html', 'nexus.html'],
  ['nexus-diagram.html', 'nexus-diagram.html'],
  ['NEXUS-RULES.md', 'NEXUS-RULES.md'],
  ['validate-nexus.js', 'validate-nexus.js'],
  ['checkNexusIntegrity', 'checkNexusIntegrity'],
  ['formatNexusResults', 'formatNexusResults'],
  ['generateNexusHTML', 'generateNexusHTML'],
  ['--nexus', '--nexus'],
  ['203 synapses + 44 pulses', '203 synapses + 44 pulses'],
  ['203 synapses', '203 synapses'],
  ['44 pulses', '44 pulses'],
  ['Synapses:', 'Synapses:'],
  ['Pulses:', 'Pulses:'],
  ['Active Pulses', 'Active Pulses'],
  ['nexus analytics', 'nexus analytics'],
  ['Topia Nexus', 'Topia Nexus'],
  ['Topia Nexus', 'Topia Nexus'],
  ['Topia Nexus', 'Topia Nexus'],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(md|js|cjs|mjs|json|html|css|yml|yaml|svg)$/.test(name)) files.push(full);
  }
  return files;
}

let changed = 0;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (rel === 'scripts/v2-rename-replacements.js') continue;
  if (rel === 'SAMENESS.md') continue;

  let text = readFileSync(file, 'utf-8');
  const orig = text;
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (text !== orig) {
    writeFileSync(file, text, 'utf-8');
    changed++;
  }
}

console.log(`Updated ${changed} files`);
