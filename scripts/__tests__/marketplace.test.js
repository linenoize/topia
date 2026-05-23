import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '../..');

describe('marketplace.json', () => {
  test('exists and lists Topia at repo root', () => {
    const raw = readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8');
    const marketplace = JSON.parse(raw);
    assert.equal(marketplace.name, 'linenoize');
    assert.ok(Array.isArray(marketplace.plugins));
    const entry = marketplace.plugins.find((p) => p.name === 'Topia');
    assert.ok(entry, 'Topia plugin entry required (must match plugin.json name)');
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
    const entry = marketplace.plugins.find((p) => p.name === 'Topia');
    assert.equal(entry.version, pkg.version);
  });
});
