import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { gatherMemories } from '../../skills/recall/scripts/gather-memories.js';

describe('gather-memories', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'topia-recall-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('collects .topia state files when present', () => {
    writeFileSync(join(root, '.topia', 'progress.md'), '# Progress\n- Task A done\n', 'utf-8');
    writeFileSync(join(root, '.topia', 'checkpoint.md'), 'Resume Phase 4\n', 'utf-8');

    const result = gatherMemories(root);
    assert.ok(result.sources.some((s) => s.name === 'progress.md'));
    assert.ok(result.sources.some((s) => s.name === 'checkpoint.md'));
    assert.strictEqual(result.missing.length, 0);
  });

  test('collects .remember files when present', () => {
    mkdirSync(join(root, '.remember'), { recursive: true });
    writeFileSync(join(root, '.remember', 'now.md'), 'Working on recall skill\n', 'utf-8');

    const result = gatherMemories(root);
    assert.ok(result.sources.some((s) => s.source === '.remember' && s.name === 'now.md'));
  });

  test('returns empty sources gracefully', () => {
    const result = gatherMemories(root);
    assert.strictEqual(result.sources.length, 0);
    assert.ok(result.missing.length > 0);
    assert.ok(result.mcpHint.neuralMemory);
  });
});
