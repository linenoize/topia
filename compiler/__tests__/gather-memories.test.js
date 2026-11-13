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
  });

  test('names no MCP memory server (those are optional and found by tool list)', () => {
    const result = gatherMemories(root);
    assert.doesNotMatch(JSON.stringify(result), /nmem|neural|agora|recall_learnings/i);
  });

  test('keeps the newest entries of a long progress log', () => {
    const entries = [];
    for (let i = 1; i <= 200; i++) entries.push(`## [2026-01-01] Session ${i}\n- step ${i} done\n`);
    writeFileSync(join(root, '.topia', 'progress.md'), entries.join('\n'), 'utf-8');
    const progress = gatherMemories(root).sources.find((s) => s.name === 'progress.md');
    assert.ok(progress.truncated);
    assert.match(progress.content, /step 200 done/);
    assert.doesNotMatch(progress.content, /step 1 done/);
  });
});
