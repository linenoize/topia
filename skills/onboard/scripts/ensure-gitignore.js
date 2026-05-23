#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ensureTopiaGitignore } from '../../../compiler/lib/ensure-gitignore.js';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    yes: { type: 'boolean', default: false },
    dry: { type: 'boolean', default: false },
  },
});

const log = (icon, msg) => console.log(`  ${icon} ${msg}`);
const result = await ensureTopiaGitignore({
  projectRoot: values.root,
  interactive: !values.yes,
  autoYes: values.yes,
  dryRun: values.dry,
  log,
});
console.log(JSON.stringify(result));
