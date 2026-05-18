/**
 * `Topia hooks install [--preset strict|gentle|off] [--platform claude|cursor|windsurf|antigravity|all]`
 *
 * Writes Topia-managed hook/rule/workflow entries for one or more platforms.
 * Idempotent: re-running replaces existing Topia entries, preserves user entries.
 */

import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADAPTERS, detectPlatforms, getAdapter, PLATFORM_KEYS } from '../../adapters/hooks/index.js';

/**
 * @param {string} projectRoot
 * @param {{preset?: string, dry?: boolean, platform?: string|string[]}} args
 */
export async function installHooks(projectRoot, args = {}) {
  const preset = args.preset || 'gentle';
  if (preset !== 'strict' && preset !== 'gentle' && preset !== 'off') {
    throw new Error(`Invalid preset: ${preset}. Choose from: strict | gentle | off`);
  }

  const platforms = resolvePlatforms(projectRoot, args.platform);
  if (platforms.length === 0) {
    return {
      preset,
      platforms: [],
      results: [],
      written: false,
      notes: [
        'No target platform detected. Create `.claude/`, `.cursor/`, `.windsurf/`, or `.antigravity/` first, or pass `--platform <name>`.',
      ],
    };
  }

  const results = [];
  let totalWrites = 0;
  for (const id of platforms) {
    const adapter = getAdapter(id);
    const plan = await adapter.emit({ preset, projectRoot });
    let platformWrites = 0;
    if (!args.dry) {
      for (const file of plan.files) {
        if (file.content === null) {
          if (existsSync(file.path)) {
            await unlink(file.path);
            platformWrites += 1;
          }
        } else {
          await mkdir(path.dirname(file.path), { recursive: true });
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
    preset,
    platforms,
    results,
    written: !args.dry && totalWrites > 0,
    notes: [...(totalWrites === 0 && !args.dry ? ['no changes to apply (already clean)'] : [])],
  };
}

function resolvePlatforms(projectRoot, requested) {
  if (!requested) return detectPlatforms(projectRoot);
  const list = Array.isArray(requested) ? requested : [requested];
  const expanded = [];
  for (const item of list) {
    if (item === 'all') {
      // `all` = every *detected* platform, never force-creates unrelated platform dirs.
      // To install into a platform with no existing directory, pass `--platform <name>` explicitly.
      expanded.push(...detectPlatforms(projectRoot));
    } else if (ADAPTERS[item]) {
      expanded.push(item);
    } else {
      throw new Error(`Unknown platform: ${item}. Choose from: ${PLATFORM_KEYS.join(', ')}, all`);
    }
  }
  return Array.from(new Set(expanded));
}

