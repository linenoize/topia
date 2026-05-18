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

export const Topia_MANAGED_SIGNATURE = 'Topia hook-dispatch';

/** Shared relative path to avoid per-file duplication. */
export const SETTINGS_REL_PATH = '.claude/settings.json';

const DISPATCH_CMD = 'npx --yes @linenoize/topia hook-dispatch';

/**
 * Regex that matches the exact dispatch invocation Topia writes.
 * Matches: `npx [--yes] @linenoize/topia hook-dispatch` or
 *          `node ... @linenoize/topia hook-dispatch` as word boundary.
 * Does NOT match arbitrary strings that merely contain those words.
 */
const Topia_DISPATCH_RE = /(^|\s)npx(\s+--yes)?\s+@linenoize\/topia\s+hook-dispatch\b/;

/**
 * Regex that matches tier-emitted commands — they substitute a tier env var
 * (e.g. `${TOPIA_PRO_ROOT}`, `${TOPIA_BUSINESS_ROOT}`). These are Topia-managed
 * because only `Topia hooks install --tier <name>` writes them.
 */
const Topia_TIER_RE = /\$\{TOPIA_[A-Z][A-Z0-9_]*_ROOT\}/;

/**
 * Build a preset hooks block for merging into `.claude/settings.json`.
 *
 * @param {'strict'|'gentle'} preset
 * @returns {Object} — { hooks: { PreToolUse: [...], PostToolUse: [...], Stop: [...] } }
 */
export function buildPreset(preset) {
  if (preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`Unknown preset: ${preset}. Use 'strict' or 'gentle'.`);
  }

  const flag = preset === 'gentle' ? ' --gentle' : '';

  return {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [
            {
              type: 'command',
              command: `${DISPATCH_CMD} preflight${flag}`,
              async: preset === 'gentle',
            },
          ],
        },
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `${DISPATCH_CMD} sentinel${flag}`,
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
              command: `${DISPATCH_CMD} dependency-doctor${flag}`,
              async: true,
            },
          ],
        },
        {
          matcher: 'mcp__.*|WebFetch|Read',
          hooks: [
            {
              type: 'command',
              command: `${DISPATCH_CMD} quarantine${flag}`,
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
              command: `${DISPATCH_CMD} completion-gate${flag}`,
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
export const WIRED_SKILLS = ['preflight', 'sentinel', 'dependency-doctor', 'completion-gate', 'quarantine'];

/**
 * Detect if a hook command entry is Topia-managed.
 * Matches only the exact `npx [--yes] @linenoize/topia hook-dispatch` invocation
 * to avoid false-positives on user commands that merely contain those words.
 *
 * @param {Object} entry — single hook entry { type, command, ... }
 */
export function isTopiaManaged(entry) {
  if (!entry || typeof entry.command !== 'string') return false;
  return Topia_DISPATCH_RE.test(entry.command) || Topia_TIER_RE.test(entry.command);
}
