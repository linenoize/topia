import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  estimateTokens,
  extractToolIoTokens,
  extractCompactionTokens,
  normalizeSessionTokens,
} = require('../../hooks/lib/token-meter.cjs');

describe('token-meter', () => {
  test('estimateTokens uses chars × 0.25', () => {
    assert.strictEqual(estimateTokens(1000), 250);
    assert.strictEqual(estimateTokens(0), 0);
    assert.strictEqual(estimateTokens(-5), 0);
  });

  test('extractToolIoTokens sums input and output', () => {
    const result = extractToolIoTokens({
      tool: 'Read',
      tool_input: { path: '/foo.ts' },
      tool_output: 'x'.repeat(400),
    });
    assert.strictEqual(result.tool, 'Read');
    assert.ok(result.estimated_tokens > 0);
    assert.ok(result.output_chars >= 400);
  });

  test('extractCompactionTokens reads Cursor preCompact fields', () => {
    const result = extractCompactionTokens({
      trigger: 'auto',
      context_tokens: 120000,
      context_usage_percent: 85,
      context_window_size: 128000,
    });
    assert.strictEqual(result.context_tokens, 120000);
    assert.strictEqual(result.context_usage_percent, 85);
    assert.strictEqual(result.trigger, 'auto');
  });

  test('extractCompactionTokens returns null when no token fields', () => {
    assert.strictEqual(extractCompactionTokens({ trigger: 'manual' }), null);
  });

  test('normalizeSessionTokens aggregates mixed events', () => {
    const { tokens, compactionRows } = normalizeSessionTokens([
      { event: 'tool_io', estimated_tokens: 1000 },
      { event: 'skill_invoke', estimated_tokens: 500 },
      {
        event: 'compaction',
        ts: '2026-05-23T10:00:00.000Z',
        context_tokens: 90000,
        context_usage_percent: 70,
        context_window_size: 128000,
        trigger: 'auto',
      },
      {
        event: 'context_peak',
        context_tokens: 120000,
        context_usage_percent: 94,
        context_window_size: 128000,
      },
    ]);

    assert.strictEqual(tokens.context_peak, 120000);
    assert.strictEqual(tokens.estimated_io, 1000);
    assert.strictEqual(tokens.estimated_skills, 500);
    assert.strictEqual(tokens.compactions, 1);
    assert.strictEqual(tokens.confidence, 'mixed');
    assert.strictEqual(compactionRows.length, 1);
  });

  test('normalizeSessionTokens confidence estimated only', () => {
    const { tokens } = normalizeSessionTokens([{ event: 'tool_io', estimated_tokens: 100 }]);
    assert.strictEqual(tokens.confidence, 'estimated');
    assert.strictEqual(tokens.context_peak, null);
  });
});
