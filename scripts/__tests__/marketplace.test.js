import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '../..');

describe('marketplace.json', () => {
  test('exists and lists skill-topia at repo root', () => {
    const raw = readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8');
    const marketplace = JSON.parse(raw);
    assert.equal(marketplace.name, 'protopia');
    assert.ok(Array.isArray(marketplace.plugins));
    const entry = marketplace.plugins.find((p) => p.name === 'skill-topia');
    assert.ok(entry, 'skill-topia plugin entry required');
    assert.equal(entry.source, './');
  });

  test('versions align with package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const marketplace = JSON.parse(
      readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'),
    );
    const plugin = JSON.parse(
      readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    assert.equal(marketplace.version, pkg.version);
    assert.equal(plugin.version, pkg.version);
    const entry = marketplace.plugins.find((p) => p.name === 'skill-topia');
    assert.equal(entry.version, pkg.version);
  });
});
