/**
 * CLI integration: `topia init --platform cursor` from a temp project dir.
 * Locks the topiaRoot contract between bin/topia.js and buildAll().
 */

import assert from 'node:assert';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(REPO_ROOT, 'compiler', 'bin', 'topia.js');

describe('topia init CLI', () => {
  test('init --platform cursor writes .cursor/rules/ and topia.config.json', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'topia-init-'));
    try {
      const result = spawnSync(process.execPath, [CLI, 'init', '--platform', 'cursor'], {
        cwd: tmp,
        encoding: 'utf-8',
        env: { ...process.env, CI: '1' },
      });

      assert.strictEqual(
        result.status,
        0,
        `init failed (exit ${result.status}): ${result.stderr || result.stdout}`,
      );
      assert.ok(existsSync(path.join(tmp, 'topia.config.json')), 'topia.config.json missing');
      const rulesDir = path.join(tmp, '.cursor', 'rules');
      assert.ok(existsSync(rulesDir), '.cursor/rules/ missing');
      const entries = readdirSync(rulesDir);
      assert.ok(entries.some((f) => f.startsWith('Topia-') && f.endsWith('.mdc')), 'no compiled .mdc rules');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
