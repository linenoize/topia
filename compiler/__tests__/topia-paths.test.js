import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  auditTopiaPaths,
  normalizeTopiaDir,
  planRuneFileCopies,
  resolveInvariantsFile,
  resolveTopiaDir,
  topiaDirForWrite,
} from '../lib/topia-paths.js';

describe('topia-paths', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('topiaDirForWrite always returns lowercase .topia', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    assert.strictEqual(topiaDirForWrite(root), join(root, '.topia'));
  });

  test('resolveTopiaDir prefers .topia over .Topia when both exist', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    mkdirSync(join(root, '.Topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'marker.txt'), 'canonical', 'utf-8');
    assert.strictEqual(resolveTopiaDir(root), join(root, '.topia'));
  });

  test('resolveTopiaDir falls back to legacy .Topia when only that exists', {
    skip: process.platform === 'win32',
  }, () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.Topia'), { recursive: true });
    assert.strictEqual(resolveTopiaDir(root), join(root, '.Topia'));
  });

  test('resolveInvariantsFile finds INVARIANTS.md then invariants.md', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'invariants.md'), '# legacy\n', 'utf-8');
    const resolved = resolveInvariantsFile(root);
    assert.strictEqual(resolved.found, true);
    assert.strictEqual(resolved.legacy, true);
    assert.ok(resolved.path.endsWith('invariants.md'));

    writeFileSync(join(root, '.topia', 'INVARIANTS.md'), '# canonical\n', 'utf-8');
    const canonical = resolveInvariantsFile(root);
    assert.strictEqual(canonical.found, true);
    const names = readdirSync(join(root, '.topia'));
    if (names.includes('INVARIANTS.md')) {
      assert.strictEqual(canonical.legacy, false);
      assert.ok(canonical.path.endsWith('INVARIANTS.md'));
    }
  });

  test('planRuneFileCopies collapses invariants variants', () => {
    const copies = planRuneFileCopies(['decisions.md', 'invariants.md', 'INVARIANTS.md']);
    const inv = copies.filter((c) => c.dest === 'INVARIANTS.md');
    assert.strictEqual(inv.length, 1);
    assert.strictEqual(inv[0].dest, 'INVARIANTS.md');
  });

  test('auditTopiaPaths warns on split directories and legacy invariants', {
    skip: process.platform === 'win32',
  }, () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    mkdirSync(join(root, '.Topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'invariants.md'), '# x\n', 'utf-8');
    const { warnings } = auditTopiaPaths(root);
    assert.ok(warnings.some((w) => w.includes('`.Topia/`')));
    assert.ok(warnings.some((w) => w.includes('invariants.md')));
  });

  test('normalizeTopiaDir renames legacy directory to .topia', { skip: process.platform === 'win32' }, () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.Topia'), { recursive: true });
    writeFileSync(join(root, '.Topia', 'decisions.md'), '# ok\n', 'utf-8');
    const { changed, actions } = normalizeTopiaDir(root);
    assert.strictEqual(changed, true);
    assert.ok(actions.some((a) => a.includes('.Topia')));
    assert.ok(existsSync(join(root, '.topia', 'decisions.md')));
    assert.strictEqual(readdirSync(root).includes('.Topia'), false);
  });

  test('normalizeTopiaDir renames invariants.md to INVARIANTS.md', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'invariants.md'), '# rules\n', 'utf-8');
    const { changed } = normalizeTopiaDir(root);
    assert.strictEqual(changed, true);
    assert.ok(existsSync(join(root, '.topia', 'INVARIANTS.md')));
    const names = readdirSync(join(root, '.topia'));
    if (process.platform !== 'win32') {
      assert.ok(!names.includes('invariants.md'));
    }
  });

  test('auditTopiaPaths warns on lowercase invariants only (all platforms)', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-paths-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'invariants.md'), '# x\n', 'utf-8');
    const { warnings } = auditTopiaPaths(root);
    assert.ok(warnings.some((w) => w.includes('invariants.md')));
  });
});
