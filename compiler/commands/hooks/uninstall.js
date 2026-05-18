/**
 * `Topia hooks uninstall [--platform <name>|all]`
 *
 * Removes all Topia-managed hook/rule/workflow entries for one or more platforms,
 * leaving user entries intact. If no platform artifacts exist, no-op.
 */

import { existsSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { ADAPTERS, detectPlatforms, getAdapter, PLATFORM_KEYS } from '../../adapters/hooks/index.js';

/**
 * @param {string} projectRoot
 * @param {{dry?: boolean, platform?: string|string[]}} args
 */
export async function uninstallHooks(projectRoot, args = {}) {
  const platforms = resolvePlatforms(projectRoot, args.platform);
  if (platforms.length === 0) {
    return {
      platforms: [],
      results: [],
      written: false,
      notes: ['no target platform detected'],
    };
  }

  const results = [];
  let totalWrites = 0;
  for (const id of platforms) {
    const adapter = getAdapter(id);
    const plan = await adapter.uninstall({ projectRoot });
    let platformWrites = 0;
    if (!args.dry) {
      for (const file of plan.files) {
        if (file.content === null) {
          if (existsSync(file.path)) {
            await unlink(file.path);
            platformWrites += 1;
          }
        } else {
          await writeFile(file.path, file.content, 'utf-8');
          platformWrites += 1;
        }
      }
    }
    totalWrites += platformWrites;
    results.push({
      platform: id,
      files: plan.files.map((f) => ({ path: f.path, deleted: f.content === null })),
      notes: plan.notes,
      writes: platformWrites,
    });
  }

  return {
    platforms,
    results,
    written: !args.dry && totalWrites > 0,
    notes: totalWrites === 0 && !args.dry ? ['no Topia-managed entries found'] : [],
  };
}

function resolvePlatforms(projectRoot, requested) {
  if (!requested) return detectPlatforms(projectRoot);
  const list = Array.isArray(requested) ? requested : [requested];
  const expanded = [];
  for (const item of list) {
    if (item === 'all') {
      // Uninstall `all` walks detected platforms only. Named platforms still work
      // even with no directory — adapter uninstall() returns empty for missing dirs.
      expanded.push(...detectPlatforms(projectRoot));
    } else if (ADAPTERS[item]) {
      expanded.push(item);
    } else {
      throw new Error(`Unknown platform: ${item}. Choose from: ${PLATFORM_KEYS.join(', ')}, all`);
    }
  }
  return Array.from(new Set(expanded));
}
