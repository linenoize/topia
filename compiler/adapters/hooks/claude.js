/**
 * Claude Code hooks adapter.
 *
 * Target: `.claude/settings.json` — native hook primitive (PreToolUse /
 * PostToolUse / Stop). This is the stable reference adapter; other adapters
 * degrade gracefully against Claude's capabilities.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  appendHookBlock,
  detectPreset,
  stripTopiaHooks,
  summarizeTopiaHooks,
} from '../../commands/hooks/merge.js';
import { buildPreset, SETTINGS_REL_PATH, WIRED_SKILLS } from '../../commands/hooks/presets.js';

export const id = 'claude';

export function detect(projectRoot) {
  return existsSync(path.join(projectRoot, '.claude'));
}

export async function emit({ preset, projectRoot }) {
  if (preset === 'off') return uninstall({ projectRoot });
  if (preset !== 'off' && preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`claude adapter: invalid preset '${preset}'`);
  }

  const settingsPath = path.join(projectRoot, SETTINGS_REL_PATH);
  const existing = await readJson(settingsPath);

  // Strip ONCE up-front — preset layers then merge additively.
  let merged = stripTopiaHooks(existing);
  // Clear any existing Topia-managed statusLine so re-install is idempotent.
  if (merged.statusLine?.command && isTopiaStatusLine(merged.statusLine.command)) {
    const { statusLine: _unused, ...rest } = merged;
    merged = rest;
  }
  const notes = [];

  if (preset !== 'off') {
    merged = appendHookBlock(merged, buildPreset(preset));
  }

  return {
    files: [
      {
        path: settingsPath,
        content: `${JSON.stringify(merged, null, 2)}\n`,
      },
    ],
    notes,
  };
}

export async function uninstall({ projectRoot }) {
  const settingsPath = path.join(projectRoot, SETTINGS_REL_PATH);
  if (!existsSync(settingsPath)) {
    return { files: [], notes: ['no .claude/settings.json — nothing to uninstall'] };
  }
  const existing = await readJson(settingsPath);
  const stripped = stripTopiaHooks(existing);
  // statusLine with Topia hook-dispatch is Topia-owned — strip it.
  if (stripped.statusLine?.command && isTopiaStatusLine(stripped.statusLine.command)) {
    delete stripped.statusLine;
  }
  return {
    files: [
      {
        path: settingsPath,
        content: `${JSON.stringify(stripped, null, 2)}\n`,
      },
    ],
    notes: [],
  };
}

function isTopiaStatusLine(command) {
  if (typeof command !== 'string') return false;
  // Match the installer's own output shapes only — not any command that happens
  // to contain the substring "Topia-pulse" (a user alias could legitimately contain it).
  // Accepts: (1) npx @protopia/skill-topia ...
  return /(^|\s)npx(\s+--yes)?\s+@protopia\/skill-topia\b/.test(command);
}

export async function status(projectRoot) {
  const settingsPath = path.join(projectRoot, SETTINGS_REL_PATH);
  if (!existsSync(settingsPath)) {
    return {
      installed: false,
      preset: null,
      wired: [],
      missing: [...WIRED_SKILLS],
      notes: ['no .claude/settings.json'],
    };
  }
  const settings = await readJson(settingsPath);
  const summary = summarizeTopiaHooks(settings);
  const preset = detectPreset(settings);
  const wired = Array.from(new Set(Object.values(summary.events).flat()));
  const missing = WIRED_SKILLS.filter((s) => !wired.includes(s));
  return {
    installed: summary.total > 0,
    preset: preset === 'none' ? null : preset,
    wired,
    missing,
    events: summary.events,
    notes: [],
  };
}

async function readJson(settingsPath) {
  if (!existsSync(settingsPath)) return {};
  const raw = await readFile(settingsPath, 'utf-8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${settingsPath} is not valid JSON — fix it manually or delete the file and re-run \`Topia hooks install\`. (${err.message})`,
    );
  }
}
