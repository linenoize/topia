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
  test('defaults to the stable launcher path (version-stable, survives upgrades)', () => {
    const cmd = buildDispatchCommand(REPO_ROOT);
    // ${CLAUDE_PROJECT_DIR} IS expanded in settings.json; ${CLAUDE_PLUGIN_ROOT} is NOT.
    assert.equal(cmd, 'node "${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs" hook-dispatch');
    assert.ok(!cmd.includes('${CLAUDE_PLUGIN_ROOT}'));
    assert.ok(!cmd.includes('@linenoize/topia'));
  });

  test('honors an explicit launcherRef (e.g. absolute home path for --global)', () => {
    const cmd = buildDispatchCommand(REPO_ROOT, { launcherRef: '/home/u/.claude/topia/hook-dispatch.cjs' });
    assert.equal(cmd, 'node "/home/u/.claude/topia/hook-dispatch.cjs" hook-dispatch');
  });

  test('preferAbsolute uses node path when Topia root is known', () => {
    const cmd = buildDispatchCommand(REPO_ROOT, { preferAbsolute: true });
    assert.match(cmd, /^node "/);
    assert.ok(cmd.includes('topia.js'));
    assert.ok(cmd.includes('hook-dispatch'));
    assert.ok(!cmd.includes('@linenoize/topia'));
  });

  test('falls back to npx when root is unknown and plugin cache is skipped', () => {
    const cmd = buildDispatchCommand('/nonexistent-topia-root', {
      preferAbsolute: true,
      skipPluginCache: true,
    });
    assert.equal(cmd, 'npx --yes @linenoize/topia hook-dispatch');
  });

  test('useNpx forces npx regardless of root', () => {
    const cmd = buildDispatchCommand(REPO_ROOT, { useNpx: true });
    assert.equal(cmd, 'npx --yes @linenoize/topia hook-dispatch');
  });
});

describe('resolveTopiaRoot env', () => {
  test('prefers CLAUDE_PLUGIN_ROOT when set', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-plugin-root-'));
    try {
      const cli = path.join(tmp, 'compiler', 'bin', 'topia.js');
      mkdirSync(path.dirname(cli), { recursive: true });
      writeFileSync(cli, '// stub\n', 'utf8');
      const prev = process.env.CLAUDE_PLUGIN_ROOT;
      process.env.CLAUDE_PLUGIN_ROOT = tmp;
      try {
        assert.equal(resolveTopiaRoot(null, { skipPluginCache: true }), tmp);
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
        else process.env.CLAUDE_PLUGIN_ROOT = prev;
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
