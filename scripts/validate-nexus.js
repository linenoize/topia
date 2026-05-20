#!/usr/bin/env node

// validate-nexus.js — Validates bidirectional synapses across all SKILL.md files
// Usage: node scripts/validate-nexus.js

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, '..', 'skills');

export function parseSkillMd(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const name = filePath.split(/[/\\]/).at(-2);

  const callsMatch = content.match(/## Calls \(outbound[^)]*\)([\s\S]*?)(?=\n## )/);
  const calledByMatch = content.match(/## Called By \(inbound[^)]*\)([\s\S]*?)(?=\n## )/);

  const extractSkills = (text) => {
    if (!text) return [];
    const matches = text.matchAll(/`([a-z-]+)`\s*\(L[0-4]\)/g);
    return [...matches].map((m) => m[1]);
  };

  return {
    name,
    calls: extractSkills(callsMatch ? callsMatch[1] : ''),
    calledBy: extractSkills(calledByMatch ? calledByMatch[1] : ''),
  };
}

export function validateNexus(skillsDir) {
  const skills = {};
  const dirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of dirs) {
    const skillPath = join(skillsDir, dir, 'SKILL.md');
    if (existsSync(skillPath)) {
      skills[dir] = parseSkillMd(skillPath);
    }
  }

  const issues = [];

  for (const [name, skill] of Object.entries(skills)) {
    for (const target of skill.calls) {
      if (skills[target] && !skills[target].calledBy.includes(name)) {
        issues.push(`${name} → ${target}: ${target} missing "${name}" in Called By`);
      }
    }

    for (const caller of skill.calledBy) {
      if (caller === 'User') continue;
      if (skills[caller] && !skills[caller].calls.includes(name)) {
        issues.push(`${caller} → ${name}: ${caller} missing "${name}" in Calls`);
      }
    }
  }

  return { skillCount: Object.keys(skills).length, issues };
}

/** @deprecated Use validateNexus */
export const validateMesh = validateNexus;

// CLI entry point
const isMain =
  process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const { skillCount, issues } = validateNexus(SKILLS_DIR);
  console.log(`Scanned ${skillCount} skills`);

  if (issues.length === 0) {
    console.log('All nexus synapses are bidirectionally consistent!');
  } else {
    console.log(`\nFound ${issues.length} broken synapses:\n`);
    issues.forEach((issue) => console.log(`  - ${issue}`));
  }

  process.exit(issues.length > 0 ? 1 : 0);
}
