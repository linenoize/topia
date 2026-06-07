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

import { resolveTopiaRoot } from './resolve-topia-root.js';
import path from 'node:path';

export const Topia_MANAGED_SIGNATURE = 'Topia hook-dispatch';

/** Shared relative path to avoid per-file duplication. */
export const SETTINGS_REL_PATH = '.claude/settings.json';

const NPX_DISPATCH_CMD = 'npx --yes @linenoize/topia hook-dispatch';

/**
 * Version-stable dispatch prefix for `.claude/settings.json`.
 * Claude Code expands `${CLAUDE_PLUGIN_ROOT}` at hook runtime to the active
 * plugin install — avoids stale absolute paths after plugin upgrades.
 * Matches the pattern used in plugin `hooks/hooks.json`.
 */
export const PLUGIN_DISPATCH_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/compiler/bin/topia.js" hook-dispatch';

/**
 * Regex that matches dispatch invocations Topia writes (plugin env, npx, or local node).
 */
const Topia_DISPATCH_RE =
  /(^|\s)(npx(\s+--yes)?\s+@(?:linenoize\/topia|protopia\/skill-topia)\s+hook-dispatch|node\s+("\$\{CLAUDE_PLUGIN_ROOT\}\/[^"]*topia\.js"|"\$\{TOPIA_ROOT\}\/[^"]*topia\.js"|"[^"]*topia\.js"|'[^']*topia\.js'|[^\s]*topia\.js)\s+hook-dispatch)\b/;

/**
 * Build the shell command prefix for hook-dispatch.
 *
 * Default (Claude Code settings.json): `${CLAUDE_PLUGIN_ROOT}` — survives plugin
 * upgrades without re-running setup. Use `preferAbsolute: true` for tests or
 * non-plugin contexts; `useNpx: true` when npm is the only option.
 *
 * @param {string|null|undefined} topiaRoot
 * @param {{ skipPluginCache?: boolean, preferAbsolute?: boolean, useNpx?: boolean }} [opts]
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

  return PLUGIN_DISPATCH_CMD;
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
 * @param {{ topiaRoot?: string|null }} [opts]
 * @returns {Object} — { hooks: { PreToolUse: [...], PostToolUse: [...], Stop: [...] } }
 */
export function buildPreset(preset, opts = {}) {
  if (preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`Unknown preset: ${preset}. Use 'strict' or 'gentle'.`);
  }

  const flag = preset === 'gentle' ? ' --gentle' : '';
  const dispatchCmd = buildDispatchCommand(opts.topiaRoot);

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
