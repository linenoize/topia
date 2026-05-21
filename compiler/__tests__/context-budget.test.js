import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { auditContextBudget, applyRemediations } from '../../skills/onboard/scripts/context-budget.js';

describe('context-budget', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('advisory when lines over threshold', () => {
    const a = auditContextBudget('/tmp', { mcpToolCount: 10, claudeMdLines: 200 });
    assert.strictEqual(a.advisory, true);
    assert.ok(a.options.length >= 3);
    assert.ok(a.askQuestionSpec.choices.some((c) => c.id === 'all'));
  });

  test('apply all writes context-budget.json', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-cb-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    const long = '# Test\n' + 'line\n'.repeat(160);
    writeFileSync(join(root, 'CLAUDE.md'), long, 'utf-8');
    const audit = auditContextBudget(root);
    const r = applyRemediations(root, ['all'], audit.metrics);
    assert.ok(r.applied.length >= 1);
    const saved = JSON.parse(readFileSync(join(root, '.topia', 'context-budget.json'), 'utf-8'));
    assert.ok(saved.chosen.includes('slim-claude-md') || saved.chosen.includes('all'));
  });
});
