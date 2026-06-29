import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = join(import.meta.dirname, '../..');

describe('marketplace.json', () => {
  test('exists and lists topia at repo root', () => {
    const raw = readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8');
    const marketplace = JSON.parse(raw);
    assert.equal(marketplace.name, 'linenoize');
    assert.ok(Array.isArray(marketplace.plugins));
    const entry = marketplace.plugins.find((p) => p.name === 'topia');
    assert.ok(entry, 'topia plugin entry required (must match plugin.json name; lowercase as of v3.0.0)');
    // v3.2.1+: source is a url object pointing to the HTTPS clone URL. The
    // earlier `{ source: "github", repo: ... }` form resolves to `git@github.com:...`
    // (SSH) in Claude Code's plugin manager, which fails for users without
    // GitHub SSH keys. Using `url` + explicit `https://...git` forces HTTPS.
    assert.equal(typeof entry.source, 'object', 'source should be a url object');
    assert.equal(entry.source.source, 'url');
    assert.equal(entry.source.url, 'https://github.com/linenoize/topia.git');
  });

  test('versions align with package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
    const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.equal(marketplace.version, pkg.version);
    assert.equal(plugin.version, pkg.version);
    const entry = marketplace.plugins.find((p) => p.name === 'topia');
    assert.equal(entry.version, pkg.version);
  });
});
