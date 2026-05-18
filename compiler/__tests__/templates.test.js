import assert from 'node:assert';
import { describe, test } from 'node:test';
import { parseSkill, parseTemplate } from '../parser.js';

describe('parseTemplate', () => {
  test('parses template frontmatter correctly', () => {
    const content = [
      '---',
      'name: test-workflow',
      'pack: "@Topia/product"',
      'version: "1.0.0"',
      'description: A test workflow template',
      'domain: product',
      'chain: full',
      'signals:',
      '  emit: product.test.complete',
      '  listen: codebase.scanned',
      'connections:',
      '  - idea',
      '  - plan',
      '  - brainstorm',
      '---',
      '',
      '# Template: Test Workflow',
      '',
      '## Phases',
      '',
      '### Phase 1: Setup',
      '**Skills**: `Topia:idea`',
    ].join('\n');

    const parsed = parseTemplate(content);

    assert.strictEqual(parsed.name, 'test-workflow');
    assert.strictEqual(parsed.pack, '@Topia/product');
    assert.strictEqual(parsed.version, '1.0.0');
    assert.strictEqual(parsed.domain, 'product');
    assert.strictEqual(parsed.chain, 'full');
    assert.deepStrictEqual(parsed.signals.emit, ['product.test.complete']);
    assert.deepStrictEqual(parsed.signals.listen, ['codebase.scanned']);
    assert.deepStrictEqual(parsed.connections, ['idea', 'plan', 'brainstorm']);
    assert.ok(parsed.sections.has('Phases'));
  });

  test('handles multiple emit signals', () => {
    const content = [
      '---',
      'name: multi-emit',
      'signals:',
      '  emit: signal.one, signal.two, signal.three',
      '  listen: signal.input',
      '---',
      '',
      '# Multi-emit template',
    ].join('\n');

    const parsed = parseTemplate(content);
    assert.deepStrictEqual(parsed.signals.emit, ['signal.one', 'signal.two', 'signal.three']);
    assert.deepStrictEqual(parsed.signals.listen, ['signal.input']);
  });

  test('handles no signals gracefully', () => {
    const content = ['---', 'name: no-signals', 'domain: test', '---', '', '# Template without signals'].join('\n');

    const parsed = parseTemplate(content);
    assert.deepStrictEqual(parsed.signals.emit, []);
    assert.deepStrictEqual(parsed.signals.listen, []);
  });

  test('handles no connections gracefully', () => {
    const content = ['---', 'name: no-connections', '---', '', '# Template without connections'].join('\n');

    const parsed = parseTemplate(content);
    assert.deepStrictEqual(parsed.connections, []);
  });

  test('defaults chain to standard', () => {
    const content = ['---', 'name: default-chain', '---', '', '# Template'].join('\n');

    const parsed = parseTemplate(content);
    assert.strictEqual(parsed.chain, 'standard');
  });

  test('extracts cross-references from body', () => {
    const content = [
      '---',
      'name: with-refs',
      '---',
      '',
      '# Template',
      '',
      'Uses `Topia:idea` and `Topia:plan` for setup.',
    ].join('\n');

    const parsed = parseTemplate(content);
    assert.strictEqual(parsed.crossRefs.length, 2);
    assert.strictEqual(parsed.crossRefs[0].skillName, 'idea');
    assert.strictEqual(parsed.crossRefs[1].skillName, 'plan');
  });
});

describe('YAML list parsing in frontmatter', () => {
  // This tests the parser's ability to handle YAML list items (- item)
  // which was added for template connections support
  test('parses YAML list items under nested key', () => {
    const content = [
      '---',
      'name: yaml-list-test',
      'connections:',
      '  - alpha',
      '  - beta',
      '  - gamma-delta',
      '---',
      '',
      '# Test',
    ].join('\n');

    const parsed = parseTemplate(content);
    assert.deepStrictEqual(parsed.connections, ['alpha', 'beta', 'gamma-delta']);
  });

  test('YAML list does not break existing key-value nested blocks', () => {
    // Ensure the parser still handles metadata: { key: value } correctly
    const content = [
      '---',
      'name: skill-test',
      'description: Test',
      'metadata:',
      '  layer: L2',
      '  model: sonnet',
      '  emit: code.changed',
      '---',
      '',
      '# skill-test',
    ].join('\n');

    const parsed = parseSkill(content);
    assert.strictEqual(parsed.name, 'skill-test');
    assert.strictEqual(parsed.layer, 'L2');
    assert.strictEqual(parsed.model, 'sonnet');
    assert.deepStrictEqual(parsed.signals.emit, ['code.changed']);
  });
});
