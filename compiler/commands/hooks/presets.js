/**
 * Hook preset definitions for `Topia hooks install`.
 *
 * Presets:
 *   - strict  — dispatcher blocks on BLOCK verdict (returns non-zero exit)
 *   - gentle  — dispatcher warns only (always exits 0), adds --gentle flag
 *   - off     — no hooks installed (uninstall semantics)
 *
 * Each hook command is `Topia hook-dispatch <skill>` so the dispatcher owns
 * skill→command mapping. Commands carry the Topia_MANAGED signature so we can
 * detect and cleanly replace them without comment markers (settings.json is JSON).
 */

import path from 'node:path';
import { PROJECT_LAUNCHER_REF } from './launcher.js';
import { resolveTopiaRoot } from './resolve-topia-root.js';

export const Topia_MANAGED_SIGNATURE = 'Topia hook-dispatch';

/** Shared relative path to avoid per-file duplication. */
export const SETTINGS_REL_PATH = '.claude/settings.json';

const NPX_DISPATCH_CMD = 'npx --yes @linenoize/topia hook-dispatch';

/**
 * Default dispatch prefix for `.claude/settings.json`.
 *
 * Points at the stable launcher shim (`<scope>/.claude/topia/hook-dispatch.cjs`)
 * rather than the plugin install directly. This is deliberate: `${CLAUDE_PLUGIN_ROOT}`
 * is NOT expanded in settings.json hooks (only in plugin-bundled `hooks/hooks.json`),
 * and absolute plugin-cache paths rot on upgrade. `${CLAUDE_PROJECT_DIR}` IS
 * expanded in settings.json, and the launcher re-resolves the active plugin at
 * runtime — so hooks survive upgrades without re-running setup. See
 * `compiler/commands/hooks/launcher.js`.
 */
export const LAUNCHER_DISPATCH_CMD = `node "${PROJECT_LAUNCHER_REF}" hook-dispatch`;

/**
 * Regex that matches dispatch invocations Topia writes. Recognizes:
 *   - the stable launcher (`…/hook-dispatch.cjs hook-dispatch …`)
 *   - legacy direct `topia.js` forms (absolute, `${CLAUDE_PLUGIN_ROOT}`,
 *     `${TOPIA_ROOT}`) — kept so upgrade/uninstall still strips them
 *   - npx forms
 * Broad enough to catch stale entries from older Topia versions for clean migration.
 */
const Topia_DISPATCH_RE =
  /(^|\s)(npx(\s+--yes)?\s+@(?:linenoize\/topia|protopia\/skill-topia)\s+hook-dispatch|node\s+("[^"]*(?:topia\.js|hook-dispatch\.cjs)"|'[^']*(?:topia\.js|hook-dispatch\.cjs)'|[^\s]*(?:topia\.js|hook-dispatch\.cjs))\s+hook-dispatch)\b/;

/**
 * Build the shell command prefix for hook-dispatch.
 *
 * Default (Claude Code settings.json): the stable launcher reference — survives
 * plugin upgrades without re-running setup. Pass `launcherRef` to override the
 * launcher path (e.g. an absolute home path for `--global` installs).
 * Use `preferAbsolute: true` for tests / non-plugin contexts; `useNpx: true`
 * when npm is the only option.
 *
 * @param {string|null|undefined} topiaRoot
 * @param {{ skipPluginCache?: boolean, preferAbsolute?: boolean, useNpx?: boolean, launcherRef?: string }} [opts]
 * @returns {string}
 */
export function buildDispatchCommand(topiaRoot, opts = {}) {
  if (opts.useNpx) return NPX_DISPATCH_CMD;

  if (opts.preferAbsolute) {
    const root = resolveTopiaRoot(topiaRoot, opts);
    if (root) {
      const cli = path.join(root, 'compiler', 'bin', 'topia.js');
      return `node ${JSON.stringify(cli)} hook-dispatch`;
    }
    return NPX_DISPATCH_CMD;
  }

  const ref = opts.launcherRef || PROJECT_LAUNCHER_REF;
  return `node "${ref}" hook-dispatch`;
}

/**
 * Historical regex — matches legacy `${TOPIA_*_ROOT}` hook path placeholders.
 * Kept so pre-1.0 settings.json entries are still recognised as Topia-managed
 * and cleaned up by uninstall.
 */
const Topia_TIER_RE = /\$\{TOPIA_[A-Z][A-Z0-9_]*_ROOT\}/;

/**
 * Build a preset hooks block for merging into `.claude/settings.json`.
 *
 * @param {'strict'|'gentle'} preset
 * @param {{ topiaRoot?: string|null, launcherRef?: string }} [opts]
 * @returns {Object} — { hooks: { PreToolUse: [...], PostToolUse: [...], Stop: [...] } }
 */
export function buildPreset(preset, opts = {}) {
  if (preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`Unknown preset: ${preset}. Use 'strict' or 'gentle'.`);
  }

  const flag = preset === 'gentle' ? ' --gentle' : '';
  const dispatchCmd = buildDispatchCommand(opts.topiaRoot, opts);

  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [
            {
              type: 'command',
              command: `${dispatchCmd} readiness${flag}`,
              async: preset === 'gentle',
            },
          ],
        },
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `${dispatchCmd} guardian${flag}`,
              async: false,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [
            {
              type: 'command',
              command: `${dispatchCmd} dependency-doctor${flag}`,
              async: true,
            },
          ],
        },
        {
          matcher: 'mcp__.*|WebFetch|Read',
          hooks: [
            {
              type: 'command',
              command: `${dispatchCmd} quarantine${flag}`,
              async: true,
            },
          ],
        },
      ],
      Stop: [
        {
          matcher: '.*',
          hooks: [
            {
              type: 'command',
              command: `${dispatchCmd} completion-gate${flag}`,
              async: false,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Skills wired by presets — used by `Topia hooks status` to verify skill existence.
 */
export const WIRED_SKILLS = ['readiness', 'guardian', 'dependency-doctor', 'completion-gate', 'quarantine'];

/**
 * Detect if a hook command entry is Topia-managed.
 * Matches npx or local `node …/topia.js hook-dispatch` invocations written by Topia.
 *
 * @param {Object} entry — single hook entry { type, command, ... }
 */
export function isTopiaManaged(entry) {
  if (!entry || typeof entry.command !== 'string') return false;
  return Topia_DISPATCH_RE.test(entry.command) || Topia_TIER_RE.test(entry.command);
}
