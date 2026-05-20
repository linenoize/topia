#!/usr/bin/env node
/**
 * Second-pass sweep: user-facing "mesh" → "nexus" (v2.0 cleanup).
 * Skips deprecated API names, migration history, and design-style "Aurora/Mesh".
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'mcp-servers', 'references/ui-pro-max-data']);

const SKIP_FILES = new Set([
  'mesh-to-nexus-sweep.js',
  'v2-rename-replacements.js',
  'SAMENESS.md',
  'CHANGELOG.md',
  'NEXUS-GLOSSARY.md',
  'docs/migration/v1-to-v2.md',
  'validate-mesh.js',
]);

/** Line-level skip if it contains these (deprecated / historical / design) */
const LINE_SKIP = [
  /checkMeshIntegrity/,
  /formatMeshResults/,
  /getSkillMesh/,
  /generateMeshHTML/,
  /validate-nexus\.js/,
  /Aurora\/Mesh/,
  /Animated mesh gradients/,
  /args\.mesh/,
  /--mesh/,
  /mesh→nexus/,
  /was `mesh/,
  /was mesh/,
  /Collection\/Mesh/,
  /deprecated.*mesh/i,
];

const REPLACEMENTS = [
  ['## Nexus Gates', '## Nexus Gates'],
  ['Nexus Gates (', 'Nexus Gates ('],
  ['| Nexus Gates |', '| Nexus Gates |'],
  ['Nexus Analytics', 'Nexus Analytics'],
  ['Nexus Impact', 'Nexus Impact'],
  ['Nexus impact', 'Nexus impact'],
  ['nexus impact', 'nexus impact'],
  ['Nexus Protocol', 'Nexus Protocol'],
  ['Nexus discipline', 'Nexus discipline'],
  ['nexus discipline', 'nexus discipline'],
  ['Core Nexus Integration', 'Core Nexus Integration'],
  ['core nexus integration', 'core nexus integration'],
  ['Internal Nexus Tools', 'Internal Nexus Tools'],
  ['Cross-Hub Nexus', 'Cross-Hub Nexus'],
  ['Cross-Hub nexus', 'Cross-Hub nexus'],
  ['Privacy Nexus', 'Privacy Nexus'],
  ['privacy-nexus', 'privacy-nexus'],
  ['Topia Nexus Visualizer', 'Topia Nexus Visualizer'],
  ['Topia Nexus</h1>', 'Topia Nexus</h1>'],
  ['Interactive Nexus Graph', 'Interactive Nexus Graph'],
  ['interactive nexus graph', 'interactive nexus graph'],
  ['interactive nexus', 'interactive nexus'],
  ['compiled intent graph', 'compiled intent graph'],
  ['intent graph for', 'intent graph for'],
  ['# Nexus Rules (see NEXUS-RULES.md)', '# Nexus Rules (see NEXUS-RULES.md)'],
  ['nexus routing change', 'nexus routing change'],
  ['nexus routing', 'nexus routing'],
  ['nexus valid', 'nexus valid'],
  ['nexus architecture', 'nexus architecture'],
  ['nexus-architecture', 'nexus-architecture'],
  ['nexus-embed', 'nexus-embed'],
  ['nexus-canvas', 'nexus-canvas'],
  ['nexus-overlay', 'nexus-overlay'],
  ['nexus-panel', 'nexus-panel'],
  ['nexus-hint', 'nexus-hint'],
  ['nexus-tooltip', 'nexus-tooltip'],
  ['skill-nexus-canvas', 'skill-nexus-canvas'],
  ['nexus-diagram', 'nexus-diagram'],
  ['nexus-tier', 'nexus-tier'],
  ['nexus-layer', 'nexus-layer'],
  ['nexus-node', 'nexus-node'],
  ['nexus-flow', 'nexus-flow'],
  ['nexus-arrow', 'nexus-arrow'],
  ['nexus-pack', 'nexus-pack'],
  ['nexus-point', 'nexus-point'],
  ['nexus-badge', 'nexus-badge'],
  ['Topia nexus', 'Topia nexus'],
  ['debug↔fix chain', 'debug↔fix chain'],
  ['integrate into the nexus', 'integrate into the nexus'],
  ['wire into the nexus', 'wire into the nexus'],
  ['enters the nexus', 'enters the nexus'],
  ['into the nexus', 'into the nexus'],
  ['the nexus means', 'the nexus means'],
  ["Topia's nexus means", "Topia's nexus means"],
  ['the nexus routes', 'the nexus routes'],
  ['in the nexus', 'in the nexus'],
  ['the nexus (', 'the nexus ('],
  ['the nexus.', 'the nexus.'],
  ['the nexus,', 'the nexus,'],
  ['the nexus grows', 'the nexus grows'],
  ['the nexus.', 'the nexus.'],
  ['breaks the nexus', 'breaks the nexus'],
  ['broken nexus', 'broken nexus'],
  ['core nexus', 'core nexus'],
  ['core nexus.', 'core nexus.'],
  ['5-layer nexus', '5-layer nexus'],
  ['fits a layer in the nexus', 'fits a layer in the nexus'],
  ['nexus synapses', 'nexus synapses'],
  ['nexus synapse', 'nexus synapse'],
  ['Nexus synapses', 'Nexus synapses'],
  ['nexus paths', 'nexus paths'],
  ['nexus path', 'nexus path'],
  ['nexus density', 'nexus density'],
  ['nexus check', 'nexus check'],
  ['nexus stats', 'nexus stats'],
  ['nexus only', 'nexus only'],
  ['for nexus only', 'for nexus only'],
  ['runs nexus check', 'runs nexus check'],
  ['Also run nexus check', 'Also run nexus check'],
  ['+ nexus check', '+ nexus check'],
  ['Nexus-aware', 'Nexus-aware'],
  ['nexus has 200', 'nexus has 200'],
  ['shows nexus synapses', 'shows nexus synapses'],
  ['includes nexus stats', 'includes nexus stats'],
  ['unified nexus has', 'unified nexus has'],
  ['.test-nexus-skills', '.test-nexus-skills'],
  ['Topia-nexus-', 'Topia-nexus-'],
  ['validate-nexus', 'validate-nexus'],
  ["describe('validate-nexus", "describe('validate-nexus"],
  ['is a **nexus**', 'is a **nexus**'],
  ['outside the nexus', 'outside the nexus'],
  ['dead node', 'dead node'], // no-op anchor
  ['nexus:', 'nexus:'],
  ['Fairness through nexus', 'Fairness through nexus'],
  ['Nexus Examples', 'Nexus Examples'],
  ['Nexus Examples', 'Nexus Examples'],
  ['Wire the skill into the nexus:', 'Wire the skill into the nexus:'],
  ['cheapest skill in the nexus', 'cheapest skill in the nexus'],
  ['Fairness through nexus', 'Fairness through nexus'],
  ['Fairness through nexus', 'Fairness through nexus'],
  ['8. **Nexus Analytics**', '8. **Nexus Analytics**'],
  ['delegate to guardian', 'delegate to guardian'],
  ['Phase 2 to guardian', 'Phase 2 to guardian'],
  ['build → plan → recon', 'build → plan → recon'],
];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(md|js|cjs|mjs|json|html|css|yml|yaml|svg|mdc)$/.test(name)) files.push(full);
  }
  return files;
}

function shouldSkipLine(line) {
  return LINE_SKIP.some((re) => re.test(line));
}

let changed = 0;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (SKIP_FILES.has(rel) || rel.endsWith('nexus-diagram.html')) continue;

  let text = readFileSync(file, 'utf-8');
  const orig = text;

  if (rel === 'docs/MESH-RULES.md') {
    text =
      '# Deprecated — use [NEXUS-RULES.md](NEXUS-RULES.md)\n\nThis file is kept only as a redirect stub. All rules live in **NEXUS-RULES.md**.\n';
    writeFileSync(file, text, 'utf-8');
    changed++;
    continue;
  }

  const lines = text.split('\n');
  const out = lines.map((line) => {
    if (shouldSkipLine(line)) return line;
    let l = line;
    for (const [from, to] of REPLACEMENTS) {
      if (from === to) continue;
      l = l.split(from).join(to);
    }
    return l;
  });
  text = out.join('\n');

  if (text !== orig) {
    writeFileSync(file, text, 'utf-8');
    changed++;
  }
}

console.log(`mesh-to-nexus-sweep: updated ${changed} files`);
