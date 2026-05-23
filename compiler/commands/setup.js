/**
 * `Topia setup` — Interactive Setup Wizard
 *
 * One-shot configuration: asks the operator two
 * questions (scope / preset), and wires hooks to the chosen
 * destination.
 *
 * Non-interactive mode: pass `--here` / `--global` + `--preset`
 * flags to skip prompts. Useful for CI / scripted setups.
 *
 * Scopes:
 *   - current  — `<cwd>/.claude/settings.json` (per-project, default)
 *   - global   — `~/.claude/settings.json` (every Claude Code session)
 */

import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { installHooks } from './hooks/install.js';
import { ensureTopiaGitignore } from '../lib/ensure-gitignore.js';

/**
 * @param {{ projectRoot: string, TopiaRoot: string, args: object }} opts
 * @returns {Promise<{ scope: string, preset: string, written: boolean, files: string[], notes: string[] }>}
 */
export async function runSetup({ projectRoot, TopiaRoot, args = {} }) {
  // Scope resolution
  let scope;
  if (args.global) scope = 'global';
  else if (args.here) scope = 'current';
  else scope = await promptScope(projectRoot);

  // Preset resolution
  const preset = args.preset || (await promptPreset());

  // Determine target root
  const targetRoot = scope === 'global' ? os.homedir() : projectRoot;

  // For global scope, claude is the only meaningful platform (cursor/windsurf
  // configs typically live per-project). Force claude.
  const platform = scope === 'global' ? 'claude' : args.platform;

  // Run installer
  const result = await installHooks(targetRoot, {
    preset,
    platform,
    dry: args.dry,
    topiaRoot: TopiaRoot,
  });

  if (scope === 'current') {
    await ensureTopiaGitignore({
      projectRoot,
      autoYes: Boolean(args.yes),
      interactive: !args.yes && !args.dry,
      dryRun: Boolean(args.dry),
    });
  }

  return {
    scope,
    targetRoot,
    preset,
    ...result,
  };
}

async function promptScope(projectRoot) {
  console.log('');
  console.log('  Where to install hooks?');
  console.log(`    [c] Current project — ${projectRoot}/.claude/settings.json`);
  console.log(`    [g] Global          — ${path.join(os.homedir(), '.claude', 'settings.json')}`);
  console.log('         (every Claude Code session, regardless of project)');
  console.log('');
  const answer = (await prompt('  Scope [c/g] (default c): ')).toLowerCase();
  return answer.startsWith('g') ? 'global' : 'current';
}

async function promptPreset() {
  console.log('');
  console.log('  Preset:');
  console.log('    [g] gentle — advisory mode, hooks warn but never block (recommended)');
  console.log('    [s] strict — hooks BLOCK on violations (CI/AFK use)');
  console.log('');
  const answer = (await prompt('  Preset [g/s] (default g): ')).toLowerCase();
  return answer.startsWith('s') ? 'strict' : 'gentle';
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Format setup result for console output.
 */
export function formatSetupResult(result) {
  const lines = [];
  lines.push('');
  lines.push('  Topia Setup Complete');
  lines.push('  ──────────────────');
  lines.push(
    `  Scope:     ${result.scope === 'global' ? 'GLOBAL (~/.claude/settings.json)' : `current project (${result.targetRoot})`}`,
  );
  lines.push(`  Preset:    ${result.preset}`);
  lines.push(`  Platforms: ${(result.platforms || []).join(', ') || '—'}`);
  if (result.notes?.length) {
    lines.push('');
    lines.push('  Notes:');
    for (const note of result.notes) lines.push(`    • ${note}`);
  }
  lines.push('');
  lines.push('  Verify:');
  lines.push('    topia doctor --hooks   # check drift');
  lines.push('    topia hooks status     # show wired skills');
  lines.push('');
  return lines.join('\n');
}
