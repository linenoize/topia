import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import flightrec from '../../hooks/lib/flightrec.cjs';
import {
  LAUNCHER_REL,
  launcherPathFor,
  launcherRefFor,
  launcherSource,
  PROJECT_LAUNCHER_REF,
} from '../commands/hooks/launcher.js';

const ASSET = path.resolve(import.meta.dirname, '../assets/hook-dispatch-launcher.cjs');
const FLIGHTREC_SRC = path.resolve(import.meta.dirname, '../../hooks/lib/flightrec.cjs');

/** Build a fake plugin tree with a stub CLI; optionally include flightrec.cjs. */
function makeFakePlugin(root, { withFlightrec = false } = {}) {
  const cli = path.join(root, 'compiler', 'bin', 'topia.js');
  mkdirSync(path.dirname(cli), { recursive: true });
  mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'topia', version: '9.9.9' }));
  writeFileSync(cli, 'process.exit(0);\n');
  if (withFlightrec) {
    const libDir = path.join(root, 'hooks', 'lib');
    mkdirSync(libDir, { recursive: true });
    copyFileSync(FLIGHTREC_SRC, path.join(libDir, 'flightrec.cjs'));
  }
  return cli;
}

describe('launcher reference helpers', () => {
  test('project scope ref uses ${CLAUDE_PROJECT_DIR} (expands in settings.json)', () => {
    assert.equal(launcherRefFor('/some/project'), PROJECT_LAUNCHER_REF);
    assert.equal(PROJECT_LAUNCHER_REF, '${CLAUDE_PROJECT_DIR}/.claude/topia/hook-dispatch.cjs');
  });

  test('global scope ref uses the absolute launcher path (stable across upgrades)', () => {
    const home = '/home/u';
    assert.equal(launcherRefFor(home, { global: true }), launcherPathFor(home));
  });

  test('launcherPathFor places the shim under <scope>/.claude/topia/', () => {
    assert.equal(launcherPathFor('/x'), path.join('/x', LAUNCHER_REL));
  });

  test('launcherSource returns the runnable shim', () => {
    const src = launcherSource();
    assert.ok(src.includes('hook-dispatch'));
    assert.ok(src.includes('.claude-plugin'));
  });
});

describe('launcher runtime delegation', () => {
  // Build a fake plugin whose compiler/bin/topia.js records the args it received,
  // then run the launcher against it and assert it delegated `hook-dispatch …`.
  test('resolves the plugin via CLAUDE_PLUGIN_ROOT and forwards args verbatim', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-launcher-'));
    try {
      const plugin = path.join(tmp, 'plugin');
      const cli = path.join(plugin, 'compiler', 'bin', 'topia.js');
      mkdirSync(path.dirname(cli), { recursive: true });
      mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
      writeFileSync(
        path.join(plugin, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'topia', version: '9.9.9' }),
      );
      const out = path.join(tmp, 'received.txt');
      // Stub CLI writes its argv (minus node + script) to a file.
      writeFileSync(
        cli,
        `require('node:fs').writeFileSync(${JSON.stringify(out)}, process.argv.slice(2).join(' '));\n`,
      );

      const res = spawnSync(process.execPath, [ASSET, 'hook-dispatch', 'completion-gate', '--gentle'], {
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, TOPIA_ROOT: '' },
        encoding: 'utf8',
      });

      assert.equal(res.status, 0, res.stderr);
      assert.equal(readFileSync(out, 'utf8'), 'hook-dispatch completion-gate --gentle');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('scans for the newest install when no env is set (manifest-anchored)', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-scan-'));
    try {
      // Two cached versions under a namespaced cache; launcher must pick the newest.
      const cacheBase = path.join(tmp, '.claude', 'plugins', 'cache', 'protopia', 'topia');
      const out = path.join(tmp, 'received.txt');
      for (const v of ['3.1.1', '3.4.0']) {
        const root = path.join(cacheBase, v);
        const cli = path.join(root, 'compiler', 'bin', 'topia.js');
        mkdirSync(path.dirname(cli), { recursive: true });
        mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
        writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'topia', version: v }));
        writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(v)});\n`);
      }

      // Run a COPY of the launcher placed outside any plugin tree, with HOME=tmp.
      const launcher = path.join(tmp, 'hook-dispatch.cjs');
      copyFileSync(ASSET, launcher);
      const env = { ...process.env, CLAUDE_PLUGIN_ROOT: '', TOPIA_ROOT: '', HOME: tmp, USERPROFILE: tmp };
      const res = spawnSync(process.execPath, [launcher, 'hook-dispatch', 'readiness'], { env, encoding: 'utf8' });

      assert.equal(res.status, 0, res.stderr);
      assert.equal(readFileSync(out, 'utf8'), '3.4.0'); // newest version wins
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('fail-open: exits 0 with a notice when no plugin can be located', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-empty-home-'));
    try {
      // Copy the launcher OUT of the repo so its manifest-walk cannot find the
      // real plugin; with an empty HOME the scan finds nothing → fail-open.
      const launcher = path.join(tmp, 'hook-dispatch.cjs');
      copyFileSync(ASSET, launcher);
      const env = { ...process.env, CLAUDE_PLUGIN_ROOT: '', TOPIA_ROOT: '', HOME: tmp, USERPROFILE: tmp };
      const res = spawnSync(process.execPath, [launcher, 'hook-dispatch', 'guardian'], { env, encoding: 'utf8' });
      assert.equal(res.status, 0);
      assert.match(res.stderr, /could not locate the Topia plugin/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('launcher flight recorder', () => {
  test('records one valid dispatch to <CLAUDE_PROJECT_DIR>/.topia/hook-flightrec.jsonl', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-fr-'));
    try {
      const plugin = path.join(tmp, 'plugin');
      const cli = makeFakePlugin(plugin, { withFlightrec: true });
      const projectDir = path.join(tmp, 'project');
      mkdirSync(projectDir, { recursive: true });

      const res = spawnSync(process.execPath, [ASSET, 'hook-dispatch', 'readiness', '--gentle'], {
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, TOPIA_ROOT: '', CLAUDE_PROJECT_DIR: projectDir },
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, res.stderr);

      const recPath = path.join(projectDir, '.topia', flightrec.FILE_NAME);
      const recs = flightrec.parseRecords(readFileSync(recPath, 'utf8'));
      assert.equal(recs.length, 1);
      assert.equal(flightrec.validateRecord(recs[0]).valid, true);
      assert.equal(recs[0].hook, 'readiness');
      assert.equal(recs[0].target, cli);
      assert.equal(recs[0].exit, 0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('fail-open: plugin without flightrec.cjs still exits 0 and writes nothing', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'topia-fr-none-'));
    try {
      const plugin = path.join(tmp, 'plugin');
      makeFakePlugin(plugin, { withFlightrec: false });
      const projectDir = path.join(tmp, 'project');
      mkdirSync(projectDir, { recursive: true });

      const res = spawnSync(process.execPath, [ASSET, 'hook-dispatch', 'guardian'], {
        env: { ...process.env, CLAUDE_PLUGIN_ROOT: plugin, TOPIA_ROOT: '', CLAUDE_PROJECT_DIR: projectDir },
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, res.stderr);
      assert.equal(existsSync(path.join(projectDir, '.topia', flightrec.FILE_NAME)), false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
