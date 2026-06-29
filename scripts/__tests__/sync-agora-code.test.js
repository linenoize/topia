import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { applyPatches } from '../sync-agora-code.js';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const cleanups = [];
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

/**
 * Build a throwaway git repo whose working tree is the PATCHED state, with a
 * committed BASE and patches/0001.patch = (base → patched). `git apply
 * --reverse --check` against this tree must therefore succeed.
 */
function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-fix-'));
  cleanups.push(dir);
  const file = path.join(dir, 'pkg', 'mod.py');
  mkdirSync(path.dirname(file), { recursive: true });
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  writeFileSync(file, 'a\nb\nc\n'); // BASE
  g('init', '-q');
  g('config', 'core.autocrlf', 'false');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  g('add', '-A');
  g('commit', '-qm', 'base');
  writeFileSync(file, 'a\nB\nc\n'); // PATCHED (uncommitted working change)
  const patch = execFileSync('git', ['--no-pager', 'diff'], { cwd: dir, encoding: 'utf8' });
  mkdirSync(path.join(dir, 'patches'));
  writeFileSync(path.join(dir, 'patches', '0001.patch'), patch);
  return { dir, file };
}

describe('agora-code patch queue', () => {
  test('--check passes when tree == base + patch', () => {
    const { dir } = makeFixture();
    const { applied } = applyPatches({ dir, check: true });
    assert.deepEqual(applied, ['0001.patch']);
  });

  test('FAILS LOUDLY when a patch no longer applies (no silent skip)', () => {
    const { dir, file } = makeFixture();
    writeFileSync(file, 'unrelated\ncontent\n'); // tree drifts away from patched
    assert.throws(() => applyPatches({ dir, check: true }), /patch reverse-check failed/);
  });

  test('no patches dir → empty result, no throw', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'agora-empty-'));
    cleanups.push(dir);
    assert.deepEqual(applyPatches({ dir, check: true }), { applied: [] });
  });

  test('the real windows-asyncio patch exists and is non-empty', () => {
    const p = path.join(REPO, 'mcp-servers', 'agora-code', 'patches', '0001-windows-asyncio-stdin.patch');
    assert.ok(statSync(p).size > 0);
  });

  test('the real patch reverse-checks clean against the vendored tree', () => {
    const dir = path.join(REPO, 'mcp-servers', 'agora-code');
    const { applied } = applyPatches({ dir, check: true });
    assert.ok(applied.includes('0001-windows-asyncio-stdin.patch'));
  });
});
