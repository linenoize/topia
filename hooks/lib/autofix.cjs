/**
 * Self-healing helpers for session-start: decide WHEN to auto-repair stale hooks
 * or auto-finalize a never-wired machine, then drive the existing (well-tested)
 * `topia setup --global` engine to do the actual settings.json write. The write
 * path itself (backup + idempotency + user-hook preservation) lives in the ESM
 * installer — this module only triggers it. CJS, node builtins only.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function pluginRoot() {
  return process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
}

function cliPath() {
  return path.join(pluginRoot(), 'compiler', 'bin', 'topia.js');
}

function anyFlagExists(dirs, flag) {
  for (const d of dirs) {
    try {
      if (fs.existsSync(path.join(d, flag))) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Auto-repair is OPT-OUT (default on): fixing already-broken hooks is low
 * surprise. Disable with TOPIA_NO_AUTOREPAIR=1 or a `.no-autorepair` flag.
 */
function repairOptedOut(dirs) {
  if (process.env.TOPIA_NO_AUTOREPAIR === '1') return true;
  return anyFlagExists(dirs, '.no-autorepair');
}

/**
 * Auto-finalize is OPT-IN (default off): silently ADDING hooks to a never-wired
 * settings.json is high surprise and would also fire in tests/CI. Enable with
 * TOPIA_AUTO_FINALIZE=1 or a `.auto-finalize` flag. The first-run nudge remains
 * the default path otherwise.
 */
function autoFinalizeEnabled(dirs) {
  if (process.env.TOPIA_AUTO_FINALIZE === '1') return true;
  return anyFlagExists(dirs, '.auto-finalize');
}

/** Parse a settings.json; null on absent/empty/invalid (never throws). */
function readSettings(settingsPath) {
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Walk settings.hooks applying `fn(command)` to every hook command string. */
function forEachHookCommand(settings, fn) {
  if (!settings || typeof settings.hooks !== 'object') return;
  for (const groups of Object.values(settings.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) continue;
      for (const entry of group.hooks) {
        if (entry && typeof entry.command === 'string') fn(entry.command);
      }
    }
  }
}

/** Concrete (non-${var}) hook-dispatch targets that no longer exist on disk. */
function staleTargetsIn(settingsPath) {
  const out = [];
  forEachHookCommand(readSettings(settingsPath), (cmd) => {
    if (!/hook-dispatch/.test(cmd)) return;
    const m = cmd.match(/node\s+"([^"]+\.(?:cjs|js))"/) || cmd.match(/node\s+(\S+\.(?:cjs|js))/);
    if (!m) return;
    const target = m[1];
    if (target.includes('${')) return; // Claude Code resolves variable paths
    try {
      if (!fs.existsSync(target)) out.push(target);
    } catch {
      /* ignore */
    }
  });
  return out;
}

/** True if settings carries any Topia-managed (hook-dispatch) entry. */
function hasManagedHooks(settings) {
  let found = false;
  forEachHookCommand(settings, (cmd) => {
    if (/hook-dispatch/.test(cmd)) found = true;
  });
  return found;
}

/** Infer the active preset from managed commands; null if none. */
function detectPreset(settings) {
  let gentle = false;
  let strict = false;
  forEachHookCommand(settings, (cmd) => {
    if (!/hook-dispatch/.test(cmd)) return;
    if (/--gentle/.test(cmd)) gentle = true;
    else strict = true;
  });
  return gentle ? 'gentle' : strict ? 'strict' : null;
}

const LAUNCHER_MARKER = 'Topia hook-dispatch launcher';

/** `LAUNCHER_REVISION` of a launcher source; 0 for copies that predate it. */
function launcherRevision(source) {
  const m = /const LAUNCHER_REVISION = (\d+);/.exec(source);
  return m ? Number(m[1]) : 0;
}

/**
 * This plugin's bundled launcher source when the Topia launcher at
 * `launcherPath` has an older revision, else null (absent, current or newer,
 * or not a Topia launcher). Never throws.
 */
function outdatedLauncher(launcherPath) {
  try {
    const installed = fs.readFileSync(launcherPath, 'utf8');
    if (!installed.includes(LAUNCHER_MARKER)) return null;
    const bundled = fs.readFileSync(
      path.join(pluginRoot(), 'compiler', 'assets', 'hook-dispatch-launcher.cjs'),
      'utf8',
    );
    return launcherRevision(bundled) > launcherRevision(installed) ? bundled : null;
  } catch {
    return null;
  }
}

/**
 * Replace an installed launcher with this plugin's bundled one when the bundled
 * revision is newer. The launcher is copied once at setup and never refreshed by
 * plugin updates, so resolver fixes would otherwise never reach it. Never
 * downgrades (an older plugin can't clobber a newer launcher) and never touches
 * a file that isn't a Topia launcher. Returns true when it wrote the file.
 */
function refreshLauncher(launcherPath) {
  const bundled = outdatedLauncher(launcherPath);
  if (!bundled) return false;
  // Write-then-rename: hooks running in parallel with session-start execute
  // this file, and must never read it half-written.
  const tmp = `${launcherPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, bundled, 'utf8');
    fs.renameSync(tmp, launcherPath);
    return true;
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * Run `topia setup --global --preset <preset> --yes` quietly. The installer
 * backs up + writes settings.json. Returns { ok, reason? }.
 */
function runGlobalSetup(preset = 'gentle') {
  const cli = cliPath();
  if (!fs.existsSync(cli)) return { ok: false, reason: 'no-cli' };
  try {
    execFileSync(process.execPath, [cli, 'setup', '--global', '--preset', preset, '--yes'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 60000,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'setup-failed', error: err };
  }
}

module.exports = {
  pluginRoot,
  cliPath,
  repairOptedOut,
  autoFinalizeEnabled,
  readSettings,
  staleTargetsIn,
  hasManagedHooks,
  detectPreset,
  launcherRevision,
  outdatedLauncher,
  refreshLauncher,
  runGlobalSetup,
};
