/**
 * `Topia hooks status [--platform <name>|all]`
 *
 * For each detected (or requested) platform, reports:
 *   - installed (boolean)
 *   - preset (gentle | strict | mixed | null)
 *   - wired skills
 *   - missing skills (present-in-project-but-not-wired)
 *   - per-platform notes
 *
 * Claude Code adapter additionally returns `events` for hook-level detail.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { ADAPTERS, CAPABILITIES, detectPlatforms, getAdapter, PLATFORM_KEYS } from '../../adapters/hooks/index.js';
import { WIRED_SKILLS } from './presets.js';

/**
 * @param {string} projectRoot
 * @param {string} TopiaRoot
 * @param {{platform?: string|string[]}} args
 */
export async function hookStatus(projectRoot, TopiaRoot, args = {}) {
  const platforms = resolvePlatforms(projectRoot, args.platform);
  const missingInRepo = findMissingSkills(TopiaRoot, WIRED_SKILLS);

  if (platforms.length === 0) {
    return {
      platforms: [],
      results: [],
      missingInRepo,
      notes: [
        'No target platform detected. Create `.claude/`, `.cursor/`, `.windsurf/`, or `.antigravity/` first, or pass `--platform <name>`.',
      ],
    };
  }

  const results = [];
  for (const id of platforms) {
    const adapter = getAdapter(id);
    const info = await adapter.status(projectRoot);
    results.push({
      platform: id,
      capability: CAPABILITIES[id] ?? null,
      ...info,
    });
  }

  return { platforms, results, missingInRepo, notes: [] };
}

function resolvePlatforms(projectRoot, requested) {
  if (!requested) return detectPlatforms(projectRoot);
  const list = Array.isArray(requested) ? requested : [requested];
  const expanded = [];
  for (const item of list) {
    if (item === 'all') {
      expanded.push(...PLATFORM_KEYS);
    } else if (ADAPTERS[item]) {
      expanded.push(item);
    } else {
      throw new Error(`Unknown platform: ${item}. Choose from: ${PLATFORM_KEYS.join(', ')}, all`);
    }
  }
  return Array.from(new Set(expanded));
}

function findMissingSkills(TopiaRoot, skills) {
  const skillsDir = path.join(TopiaRoot, 'skills');
  return skills.filter((skill) => !existsSync(path.join(skillsDir, skill, 'SKILL.md')));
}
