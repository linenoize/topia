/**
 * Resolve the Topia source root for hook dispatch commands.
 *
 * `npx @protopia/skill-topia` only works when the package is published to npm.
 * Internal / private installs use `node <path>/compiler/bin/topia.js` instead.
 */

import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI_REL = path.join('compiler', 'bin', 'topia.js');

function hasCli(root) {
  return Boolean(root && existsSync(path.join(root, CLI_REL)));
}

/**
 * Newest version directory under a plugin cache folder (semver or commit SHA).
 * @param {string} base
 * @returns {string|null}
 */
function newestCachedPluginRoot(base) {
  if (!existsSync(base)) return null;
  if (hasCli(base)) return path.resolve(base);

  let entries = [];
  try {
    entries = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }

  for (const name of entries) {
    const candidate = path.join(base, name);
    if (hasCli(candidate)) return path.resolve(candidate);
  }
  return null;
}

/**
 * @param {string|null|undefined} explicit — path passed from caller (clone dir or TOPIA_ROOT)
 * @param {{ skipPluginCache?: boolean }} [opts]
 * @returns {string|null} absolute path to Topia root, or null to fall back to npx
 */
export function resolveTopiaRoot(explicit, opts = {}) {
  if (hasCli(explicit)) return path.resolve(explicit);

  const envRoot = process.env.TOPIA_ROOT;
  if (hasCli(envRoot)) return path.resolve(envRoot);

  if (opts.skipPluginCache) return null;

  const home = os.homedir();
  const cacheCandidates = [
    path.join(home, '.claude', 'plugins', 'cache', 'protopia', 'skill-topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'skill-topia'),
    path.join(home, '.claude', 'plugins', 'cache', 'Topia'),
  ];

  for (const base of cacheCandidates) {
    const found = newestCachedPluginRoot(base);
    if (found) return found;
  }

  return null;
}
