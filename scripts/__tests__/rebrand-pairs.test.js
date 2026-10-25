import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { toLinenoize, toProtopia } from '../lib/rebrand-pairs.js';
import { runRebrand } from '../lib/rebrand-runner.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const FILES = ['.claude-plugin/marketplace.json', 'scripts/__tests__/marketplace.test.js'];
const cleanups = [];
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

/** Copy topia's marketplace manifest and its test into a throwaway tree. */
function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rebrand-fix-'));
  cleanups.push(dir);
  for (const rel of FILES) {
    mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    copyFileSync(path.join(REPO, rel), path.join(dir, rel));
  }
  return dir;
}

const sourceOf = (dir) =>
  JSON.parse(readFileSync(path.join(dir, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins.find(
    (p) => p.name === 'topia',
  ).source;

describe('rebrand pairs keep the marketplace source on HTTPS', () => {
  // The `github` source form clones over SSH and fails for users without
  // GitHub SSH keys, so neither direction may produce it.
  test('to protopia: url form pointing at skill-topia', () => {
    const dir = makeFixture();
    runRebrand({ root: dir, ...toProtopia });
    assert.deepEqual(sourceOf(dir), { source: 'url', url: 'https://github.com/protopia/skill-topia.git' });
    const testSrc = readFileSync(path.join(dir, 'scripts', '__tests__', 'marketplace.test.js'), 'utf8');
    assert.match(testSrc, /assert\.equal\(marketplace\.name, 'protopia'\);/);
    assert.match(testSrc, /assert\.equal\(entry\.source\.url, 'https:\/\/github\.com\/protopia\/skill-topia\.git'\);/);
  });

  test('round trip back to linenoize restores the original url', () => {
    const dir = makeFixture();
    runRebrand({ root: dir, ...toProtopia });
    runRebrand({ root: dir, ...toLinenoize });
    assert.deepEqual(sourceOf(dir), { source: 'url', url: 'https://github.com/linenoize/topia.git' });
  });
});
