/**
 * Stable hook-dispatch launcher — install + reference helpers.
 *
 * Claude Code does not expand `${CLAUDE_PLUGIN_ROOT}` in user/project
 * `.claude/settings.json` hooks, and the plugin lives in a versioned cache dir
 * that upgrades delete. So settings.json must point at a stable, version-
 * independent path that we own: `<scope>/.claude/topia/hook-dispatch.cjs`.
 * That launcher resolves the active plugin install at runtime (anchored on the
 * plugin manifest) and delegates to `compiler/bin/topia.js hook-dispatch`.
 *
 * See `compiler/assets/hook-dispatch-launcher.cjs` for the runtime shim.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Launcher location relative to a scope root (project dir or home dir). */
export const LAUNCHER_REL = path.join('.claude', 'topia', 'hook-dispatch.cjs');

/**
 * settings.json command reference for project scope. `${CLAUDE_PROJECT_DIR}`
 * IS expanded in settings.json hooks, so this stays portable across machines
 * and deterministic for drift comparison.
 */
// NOTE: the ${CLAUDE_PROJECT_DIR} below is a Claude Code settings.json variable,
// expanded by Claude Code at runtime — NOT a JS template literal.
export const PROJECT_LAUNCHER_REF = '${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs';

/** Absolute on-disk path of the launcher for a given scope root. */
export function launcherPathFor(scopeRoot) {
  return path.join(scopeRoot, LAUNCHER_REL);
}

/**
 * The string written into a settings.json hook command to reference the
 * launcher. Project scope uses `${CLAUDE_PROJECT_DIR}` (expands in settings.json,
 * portable); global scope uses the absolute home path (stable across plugin
 * upgrades because it lives outside the versioned plugin cache).
 *
 * @param {string} scopeRoot — project root, or home dir for global installs
 * @param {{ global?: boolean }} [opts]
 */
export function launcherRefFor(scopeRoot, { global = false } = {}) {
  return global ? launcherPathFor(scopeRoot) : PROJECT_LAUNCHER_REF;
}

/** Source of the launcher shim, read from the bundled asset. */
export function launcherSource() {
  return readFileSync(path.join(here, '..', '..', 'assets', 'hook-dispatch-launcher.cjs'), 'utf8');
}
