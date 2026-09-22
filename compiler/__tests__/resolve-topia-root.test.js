import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { buildDispatchCommand } from '../commands/hooks/presets.js';
import { resolveTopiaRoot } from '../commands/hooks/resolve-topia-root.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Non-empty skills/ so hasCli accepts the fake root. */
function ensureSkills(root) {
  const skillsDir = path.join(root, 'skills', 'readiness');
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(path.join(skillsDir, '.keep'), '');
}

/**
 * @param {string} root
 * @param {{ version?: string, withSkills?: boolean }} [opts]
 */
function makeFakePlugin(root, { version = '9.9.9', withSkills = true } = {}) {
  const cli = path.join(root, 'compiler', 'bin', 'topia.js');
  mkdirSync(path.dirname(cli), { recursive: true });
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'topia', version }));
  writeFileSync(cli, '// stub\n', 'utf8');
  if (withSkills) ensureSkills(root);
}

/** Isolate os.homedir()-based cache scan from the real user home. */
function withIsolatedHome(tmp, fn) {
  const prev = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    TOPIA_ROOT: process.env.TOPIA_ROOT,
    CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT,
  };
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  delete process.env.TOPIA_ROOT;
  delete process.env.CLAUDE_PLUGIN_ROOT;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('resolveTopiaRoot', () => {
  test('resolves explicit clone path', () => {
    assert.equal(resolveTopiaRoot(REPO_ROOT), REPO_ROOT);
  });

  test('resolves nested plugin cache version directory', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-cache-'));
    try {
      const versionDir = path.join(tmp, '2.0.1');
      makeFakePlugin(versionDir, { version: '2.0.1' });
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
      makeFakePlugin(tmp);
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

describe('resolveTopiaRoot cache scan', () => {
  test('skips a candidate root that is missing skills/', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-rt-incomplete-'));
    try {
      const cache = path.join(tmp, '.claude', 'plugins', 'cache');
      const incomplete = path.join(cache, 'linenoize', 'topia', '3.7.0');
      const complete = path.join(cache, 'linenoize', 'topia', '3.6.0');
      makeFakePlugin(incomplete, { version: '3.7.0', withSkills: false });
      makeFakePlugin(complete, { version: '3.6.0' });

      withIsolatedHome(tmp, () => {
        assert.equal(resolveTopiaRoot(null, { skipManifestWalk: true }), complete);
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('equal version prefers canonical install over temp_git staging', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-rt-staging-'));
    try {
      const cache = path.join(tmp, '.claude', 'plugins', 'cache');
      const version = '3.7.0';
      const staging = path.join(cache, 'temp_git_9999999999_test');
      const canonical = path.join(cache, 'linenoize', 'topia', version);
      makeFakePlugin(staging, { version });
      makeFakePlugin(canonical, { version });

      withIsolatedHome(tmp, () => {
        assert.equal(resolveTopiaRoot(null, { skipManifestWalk: true }), canonical);
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('resolves when the only candidate is a canonical install', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-rt-canonical-'));
    try {
      const canonical = path.join(tmp, '.claude', 'plugins', 'cache', 'linenoize', 'topia', '3.7.0');
      makeFakePlugin(canonical, { version: '3.7.0' });

      withIsolatedHome(tmp, () => {
        assert.equal(resolveTopiaRoot(null, { skipManifestWalk: true }), canonical);
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
