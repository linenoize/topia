/**
 * Spawn headless checkpoint-from-hook.js from CJS hooks.
 */
const { spawnSync } = require('child_process');
const path = require('path');

function resolveCheckpointScript() {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
  return path.join(pluginRoot, 'skills', 'session-bridge', 'scripts', 'checkpoint-from-hook.js');
}

/**
 * @param {string} cwd
 * @param {'pre-compact' | 'git-push'} trigger
 * @returns {object|null}
 */
function runCheckpointFromHook(cwd, trigger) {
  const script = resolveCheckpointScript();
  const result = spawnSync(
    process.execPath,
    [script, '--root', cwd, '--trigger', trigger, '--json'],
    { encoding: 'utf-8', timeout: 15000, cwd },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }
}

module.exports = { runCheckpointFromHook, resolveCheckpointScript };
