import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(import.meta.dirname, '../..');

describe('marketplace.json', () => {
  test('exists and lists topia at repo root', () => {
    const raw = readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8');
    const marketplace = JSON.parse(raw);
    assert.equal(marketplace.name, 'linenoize');
    assert.ok(Array.isArray(marketplace.plugins));
    const entry = marketplace.plugins.find((p) => p.name === 'topia');
    assert.ok(entry, 'topia plugin entry required (must match plugin.json name; lowercase as of v3.0.0)');
    // v3.1.2+: source is a github object so the marketplace works whether users
    // add it via GitHub shorthand (`/plugin marketplace add linenoize/topia`)
    // OR via direct URL to marketplace.json. The earlier `"./"` relative path
    // only worked when the marketplace was cloned via git.
    assert.equal(typeof entry.source, 'object', 'source should be a github object');
    assert.equal(entry.source.source, 'github');
    assert.equal(entry.source.repo, 'linenoize/topia');
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
    const entry = marketplace.plugins.find((p) => p.name === 'topia');
    assert.equal(entry.version, pkg.version);
  });
});
