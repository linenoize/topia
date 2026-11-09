import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareSources, exitCodeFor, sha256, validatePin } from '../check-sf-skills-drift.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHA = 'a'.repeat(40);

function pinFor(...files) {
  return {
    repo: 'forcedotcom/sf-skills',
    sources: files.map(([sourcePath, text]) => ({ sha: SHA, sourcePath, sha256: sha256(Buffer.from(text)) })),
  };
}

describe('check-sf-skills-drift', () => {
  test('the committed pin is well formed and uses one commit', () => {
    const pin = validatePin(JSON.parse(readFileSync(join(ROOT, 'salesforce', 'upstream', 'sf-skills.json'), 'utf-8')));
    assert.deepStrictEqual(
      [...new Set(pin.sources.map((source) => source.sha))],
      ['219a84a028387366f9d73fd2551ce7ed47bb1103'],
    );
  });

  test('same bytes report no drift', () => {
    const results = compareSources(pinFor(['a.md', 'one']), () => Buffer.from('one'), 'main');
    assert.strictEqual(results[0].status, 'same');
    assert.strictEqual(exitCodeFor(results), 0);
  });

  test('changed and deleted files are drift', () => {
    const results = compareSources(
      pinFor(['a.md', 'one'], ['b.md', 'two']),
      (file) => (file === 'a.md' ? Buffer.from('new') : null),
      'main',
    );
    assert.deepStrictEqual(
      results.map((result) => result.status),
      ['changed', 'missing'],
    );
    assert.strictEqual(exitCodeFor(results), 1);
  });

  test('a fetch failure is not reported as no drift', () => {
    const results = compareSources(
      pinFor(['a.md', 'one']),
      () => {
        throw new Error('network down');
      },
      'main',
    );
    assert.strictEqual(results[0].status, 'error');
    assert.strictEqual(exitCodeFor(results), 2);
  });

  test('without a ref each file is read at its pinned commit', () => {
    const seen = [];
    compareSources(pinFor(['a.md', 'one']), (_file, ref) => {
      seen.push(ref);
      return Buffer.from('one');
    });
    assert.deepStrictEqual(seen, [SHA]);
  });

  test('a pin that could steer the fetch is rejected', () => {
    for (const sourcePath of ['../secrets', '/etc/passwd', 'a b.md', 'x?ref=evil']) {
      assert.throws(() => validatePin({ repo: 'r', sources: [{ sha: SHA, sha256: 'b'.repeat(64), sourcePath }] }));
    }
    assert.throws(() => validatePin({ repo: 'r', sources: [] }));
  });
});
