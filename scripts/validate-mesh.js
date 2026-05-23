#!/usr/bin/env node
/** @deprecated Use validate-nexus.js — re-export for one release cycle */
export { parseSkillMd, validateMesh, validateNexus } from './validate-nexus.js';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateNexus } from './validate-nexus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', 'skills');

console.warn('validate-mesh.js is deprecated — use validate-nexus.js');
const { skillCount, issues } = validateNexus(SKILLS_DIR);
console.log(`Scanned ${skillCount} skills`);
process.exit(issues.length > 0 ? 1 : 0);
