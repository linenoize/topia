import assert from 'node:assert';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { writeCheckpointFromHook } from '../../skills/session-bridge/scripts/checkpoint-from-hook.js';

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'topia-checkpoint-'));
  await mkdir(path.join(tmpRoot, '.topia'), { recursive: true });
  writeFileSync(
    path.join(tmpRoot, '.topia', 'progress.md'),
    '- [ ] Implement retry logic in src/api/client.ts\n- [x] Happy path done\n',
  );
  writeFileSync(
    path.join(tmpRoot, '.topia', 'decisions.md'),
    '- Use Redis for cache: fewer moving parts than Memcached\n',
  );
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('writeCheckpointFromHook', () => {
  test('writes checkpoint.md with progress and decisions', () => {
    const result = writeCheckpointFromHook({ root: tmpRoot, trigger: 'pre-compact' });
    assert.strictEqual(result.ok, true);
    const checkpointPath = path.join(tmpRoot, '.topia', 'checkpoint.md');
    assert.ok(existsSync(checkpointPath));
    const content = readFileSync(checkpointPath, 'utf-8');
    assert.match(content, /Checkpoint/);
    assert.match(content, /retry logic/);
    assert.match(content, /Redis/);
    assert.match(content, /pre-compact/);
  });

  test('writes .last-push-checkpoint on git-push trigger', () => {
    writeCheckpointFromHook({ root: tmpRoot, trigger: 'git-push' });
    const marker = path.join(tmpRoot, '.topia', '.last-push-checkpoint');
    assert.ok(existsSync(marker));
    const parsed = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.ok(parsed.at);
  });
});
