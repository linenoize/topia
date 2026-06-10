/**
 * Resolve the Topia source root for hook dispatch commands.
 *
 * The anchor is the plugin manifest (`.claude-plugin/plugin.json`), NOT a cache
 * directory name. Cache names change on plugin update and across namespace
 * migrations (linenoize → protopia, topia → skill-topia), so resolving by
 * manifest keeps this stable without per-release code changes.
 *
 * Resolution order:
 *   1. explicit path argument (clone dir passed by a caller)
 *   2. TOPIA_ROOT / CLAUDE_PLUGIN_ROOT env (valid CLI on disk)
 *   3. manifest walk up from this module's own location
 *   4. newest installed Topia plugin by manifest version (cache / skills dirs)
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_REL = path.join('compiler', 'bin', 'topia.js');
const MANIFEST_REL = path.join('.claude-plugin', 'plugin.json');
const PLUGIN_NAMES = new Set(['topia', 'skill-topia']);
const here = path.dirname(fileURLToPath(import.meta.url));

function hasCli(root) {
  return Boolean(root && existsSync(path.join(root, CLI_REL)));
}

/** Manifest version if `root` is a Topia plugin root, else null. */
function pluginVersion(root) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, MANIFEST_REL), 'utf8'));
    if (manifest && typeof manifest.name === 'string' && PLUGIN_NAMES.has(manifest.name)) {
      return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    }
  } catch {
    /* not a manifest we recognize */
  }
  return null;
}

/** Compare semver-ish strings; >0 when `a` is newer. Non-numeric parts → 0. */
function cmpVersion(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < 3; i++) {
    const x = Number.parseInt(pa[i], 10);
    const y = Number.parseInt(pb[i], 10);
    const xi = Number.isFinite(x) ? x : 0;
    const yi = Number.isFinite(y) ? y : 0;
    if (xi !== yi) return xi - yi;
  }
  return 0;
}

/**
 * Walk up from `startDir` to the plugin root, identified by the manifest anchor.
 * Robust against cache namespace/version since it never inspects directory names.
 *
 * @param {string} startDir
 * @returns {string|null} absolute plugin root, or null
 */
export function findPluginRootFromFile(startDir) {
  let dir = startDir;
  while (dir) {
    if (hasCli(dir) && pluginVersion(dir) !== null) return path.resolve(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Newest Topia plugin root under `base` (bounded scan, manifest-matched).
 * @returns {{root: string, version: string}|null}
 */
function newestPluginUnder(base) {
  if (!existsSync(base)) return null;
  const skip = new Set(['node_modules', '.git']);
  const stack = [{ dir: base, depth: 0 }];
  let best = null;
  let budget = 3000;

  while (stack.length > 0 && budget-- > 0) {
    const { dir, depth } = stack.pop();
    const version = hasCli(dir) ? pluginVersion(dir) : null;
    if (version !== null) {
      if (!best || cmpVersion(version, best.version) > 0) best = { root: path.resolve(dir), version };
      continue; // do not descend into a resolved plugin root
    }
    if (depth >= 4) continue;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) continue;
      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return best;
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

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (hasCli(pluginRoot)) return path.resolve(pluginRoot);

  // skipPluginCache disables all auto-discovery (manifest walk + cache scan),
  // leaving only explicit/env above. Tests and non-plugin contexts use it to
  // force the npx fallback.
  if (opts.skipPluginCache) return null;

  // Manifest-anchored: this module lives inside the plugin, so walking up from
  // its own location finds the plugin root regardless of cache namespace/version.
  const fromSelf = findPluginRootFromFile(here);
  if (fromSelf) return fromSelf;

  // Last resort: newest installed Topia plugin across known roots. Generalized
  // over any owner namespace so namespace migrations resolve with no code change.
  const home = os.homedir();
  const bases = [
    path.join(home, '.claude', 'plugins', 'cache'),
    path.join(home, '.claude', 'plugins'),
    path.join(home, '.claude', 'skills'),
  ];
  let best = null;
  for (const base of bases) {
    const found = newestPluginUnder(base);
    if (found && (!best || cmpVersion(found.version, best.version) > 0)) best = found;
  }
  return best ? best.root : null;
}
