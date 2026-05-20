import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildDispatchCommand } from '../commands/hooks/presets.js';
import { resolveTopiaRoot } from '../commands/hooks/resolve-topia-root.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('resolveTopiaRoot', () => {
  test('resolves explicit clone path', () => {
    assert.equal(resolveTopiaRoot(REPO_ROOT), REPO_ROOT);
  });

  test('resolves nested plugin cache version directory', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-cache-'));
    try {
      const versionDir = path.join(tmp, '2.0.1');
      const cli = path.join(versionDir, 'compiler', 'bin', 'topia.js');
      mkdirSync(path.dirname(cli), { recursive: true });
      writeFileSync(cli, '// stub\n', 'utf8');
      assert.equal(resolveTopiaRoot(versionDir), versionDir);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('buildDispatchCommand', () => {
  test('uses node path when Topia root is known', () => {
    const cmd = buildDispatchCommand(REPO_ROOT);
    assert.match(cmd, /^node "/);
    assert.ok(cmd.includes('topia.js'));
    assert.ok(cmd.includes('hook-dispatch'));
    assert.ok(!cmd.includes('@protopia/skill-topia'));
  });

  test('falls back to npx when root is unknown and plugin cache is skipped', () => {
    const cmd = buildDispatchCommand('/nonexistent-topia-root', { skipPluginCache: true });
    assert.equal(cmd, 'npx --yes @protopia/skill-topia hook-dispatch');
  });

  test('uses plugin cache when installed (marketplace path)', () => {
    const home = os.homedir();
    const cacheBase = path.join(home, '.claude', 'plugins', 'cache', 'protopia', 'skill-topia');
    if (!existsSync(cacheBase)) return;
    const cmd = buildDispatchCommand(null);
    assert.ok(cmd.startsWith('node '), `expected node dispatch, got: ${cmd}`);
    assert.ok(cmd.includes('topia.js'));
  });
});
