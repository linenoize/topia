import assert from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getExpensiveSessions,
  getToolTokenDistribution,
} from '../analytics.js';

let tmpRoot;

// Dates must stay inside the analytics rolling window (filterByDays uses
// today - days). Hard-coded dates age out and cause time-bomb failures, so
// derive fixture dates relative to "now".
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'topia-analytics-'));
  const metricsDir = path.join(tmpRoot, '.topia', 'metrics');
  await mkdir(metricsDir, { recursive: true });

  await writeFile(
    path.join(metricsDir, 'sessions.jsonl'),
    [
      JSON.stringify({
        id: 's-1',
        date: daysAgo(2),
        platform: 'claude',
        tool_calls: 130,
        pressure_level: 'red',
        expensive_session: true,
        tokens: { compactions: 2, context_peak: 95000, confidence: 'mixed' },
      }),
      JSON.stringify({
        id: 's-2',
        date: daysAgo(3),
        platform: 'claude',
        tool_calls: 40,
        pressure_level: 'green',
        tokens: { compactions: 0, context_peak: 40000, confidence: 'measured' },
      }),
    ].join('\n') + '\n',
  );

  await writeFile(
    path.join(metricsDir, 'tools.json'),
    JSON.stringify({
      version: 1,
      tools: {
        Read: { total_invocations: 50, estimated_tokens_total: 12000, sessions: 2 },
        Skill: { total_invocations: 10, estimated_tokens_total: 8000, sessions: 1 },
      },
    }),
  );
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('context analytics', () => {
  test('getExpensiveSessions flags high compaction sessions', async () => {
    const expensive = await getExpensiveSessions(tmpRoot, 30);
    assert.ok(expensive.length >= 1);
    assert.strictEqual(expensive[0].id, 's-1');
    assert.strictEqual(expensive[0].compactions, 2);
  });

  test('getToolTokenDistribution reads tools.json', async () => {
    const tools = await getToolTokenDistribution(tmpRoot, 30);
    assert.ok(tools.length >= 2);
    assert.strictEqual(tools[0].tool, 'Read');
    assert.strictEqual(tools[0].estimated_tokens, 12000);
  });
});
