import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { installHooks } from '../commands/hooks/install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOPIA_ROOT = path.resolve(__dirname, '..', '..');

let tmpRoot;
beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'topia-install-safe-'));
  await mkdir(path.join(tmpRoot, '.claude'), { recursive: true });
});
afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

const settingsPath = () => path.join(tmpRoot, '.claude', 'settings.json');
function backups() {
  const dir = path.join(tmpRoot, '.claude');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('settings.json.topia-bak-')) : [];
}
const install = (preset = 'gentle') => installHooks(tmpRoot, { preset, platform: 'claude', topiaRoot: TOPIA_ROOT });

describe('install hardening — backup + idempotency', () => {
  test('backs up an existing settings.json and preserves user hooks', async () => {
    const userHook = {
      hooks: {
        PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo user-owned' }] }],
      },
    };
    await writeFile(settingsPath(), JSON.stringify(userHook, null, 2));

    await install('gentle');

    assert.equal(backups().length, 1, 'one timestamped backup made');
    const after = await readFile(settingsPath(), 'utf-8');
    assert.ok(after.includes('echo user-owned'), 'user hook preserved');
    assert.ok(after.includes('hook-dispatch'), 'topia hooks injected');
  });

  test('idempotent re-install: no write, no new backup', async () => {
    await install('gentle'); // first install (no prior file → no backup)
    const afterFirst = await readFile(settingsPath(), 'utf-8');
    const baseline = backups().length;

    const result = await install('gentle');

    assert.equal(result.written, false, 'identical re-install does not write');
    assert.equal(backups().length, baseline, 'no backup on no-op');
    assert.equal(await readFile(settingsPath(), 'utf-8'), afterFirst, 'content unchanged');
  });

  test('backups are pruned to the newest 5', async () => {
    for (let i = 0; i < 8; i++) {
      // overwrite with a non-topia settings each round so the next install backs up
      await writeFile(settingsPath(), JSON.stringify({ marker: i, hooks: {} }, null, 2));
      await install(i % 2 === 0 ? 'gentle' : 'strict');
    }
    const n = backups().length;
    assert.ok(n >= 1 && n <= 5, `expected 1..5 backups, got ${n}`);
  });
});
