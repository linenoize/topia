/**
 * Integration: session-start self-healing. Spawns the real session-start hook
 * against an isolated HOME so it drives the real `topia setup` engine without
 * touching the developer's environment.
 *
 *   - auto-repair: OPT-OUT (default on) — fixes stale global hooks, preserves user hooks
 *   - auto-finalize: OPT-IN (default off) — wires a never-finalized machine only when enabled
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const RUN_HOOK = path.join(REPO, 'hooks', 'run-hook.cjs');

const cleanups = [];
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

function makeHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ss-autofix-'));
  cleanups.push(home);
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

function runSessionStart(home, extraEnv = {}) {
  return spawnSync(process.execPath, [RUN_HOOK, 'session-start'], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: home }),
    cwd: home,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: home, ...extraEnv },
  });
}

const settingsPath = (home) => path.join(home, '.claude', 'settings.json');
const backups = (home) =>
  readdirSync(path.join(home, '.claude')).filter((f) => f.startsWith('settings.json.topia-bak-'));

const STALE = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Read',
        hooks: [
          { type: 'command', command: 'echo user-owned' },
          {
            type: 'command',
            command: 'node "/nonexistent/cache/3.1.1/compiler/bin/topia.js" hook-dispatch readiness --gentle',
          },
        ],
      },
    ],
  },
};

describe('session-start auto-repair (opt-out, default on)', () => {
  test('repairs stale global hooks and preserves user hooks', () => {
    const home = makeHome();
    writeFileSync(settingsPath(home), JSON.stringify(STALE, null, 2));

    const res = runSessionStart(home);
    assert.equal(res.status, 0, res.stderr);

    const after = readFileSync(settingsPath(home), 'utf8');
    assert.ok(!after.includes('nonexistent'), 'stale path removed');
    assert.ok(after.includes('hook-dispatch.cjs'), 'launcher hooks injected');
    assert.ok(after.includes('echo user-owned'), 'user hook preserved');
    assert.equal(backups(home).length, 1, 'one backup made');
  });

  test('TOPIA_NO_AUTOREPAIR=1 leaves settings untouched (warn only)', () => {
    const home = makeHome();
    writeFileSync(settingsPath(home), JSON.stringify(STALE, null, 2));

    const res = runSessionStart(home, { TOPIA_NO_AUTOREPAIR: '1' });
    assert.equal(res.status, 0, res.stderr);

    assert.ok(readFileSync(settingsPath(home), 'utf8').includes('nonexistent'), 'NOT repaired');
    assert.equal(backups(home).length, 0, 'no backup');
  });
});

describe('session-start auto-finalize (opt-in, default off)', () => {
  test('default off: a never-wired machine is NOT auto-wired', () => {
    const home = makeHome(); // empty .claude, no settings.json
    const res = runSessionStart(home);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(existsSync(settingsPath(home)), false, 'no settings.json written by default');
  });

  test('TOPIA_AUTO_FINALIZE=1: wires hooks and marks finalized', () => {
    const home = makeHome();
    const res = runSessionStart(home, { TOPIA_AUTO_FINALIZE: '1' });
    assert.equal(res.status, 0, res.stderr);

    assert.ok(existsSync(settingsPath(home)), 'settings.json created');
    assert.ok(readFileSync(settingsPath(home), 'utf8').includes('hook-dispatch'), 'hooks wired');
    assert.ok(existsSync(path.join(home, '.topia', '.finalized')), '.finalized marker written');
  });
});
