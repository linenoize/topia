import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  ensureTopiaGitignore,
  gitignoreHasTopiaPatterns,
  SKIP_GITIGNORE_FLAG,
  TOPIA_GITIGNORE_BLOCK,
} from '../lib/ensure-gitignore.js';

function makeGitProject() {
  const root = mkdtempSync(join(tmpdir(), 'topia-gi-'));
  mkdirSync(join(root, '.git'));
  return root;
}

describe('ensure-gitignore', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('gitignoreHasTopiaPatterns detects block', () => {
    assert.ok(gitignoreHasTopiaPatterns(TOPIA_GITIGNORE_BLOCK));
    assert.ok(!gitignoreHasTopiaPatterns('# foo\n'));
  });

  test('autoYes appends block', async () => {
    root = makeGitProject();
    const r = await ensureTopiaGitignore({ projectRoot: root, autoYes: true, interactive: false });
    assert.strictEqual(r.status, 'auto_added');
    const gi = readFileSync(join(root, '.gitignore'), 'utf-8');
    assert.ok(gitignoreHasTopiaPatterns(gi));
  });

  test('idempotent when already present', async () => {
    root = makeGitProject();
    writeFileSync(join(root, '.gitignore'), TOPIA_GITIGNORE_BLOCK, 'utf-8');
    const r = await ensureTopiaGitignore({ projectRoot: root, autoYes: true, interactive: false });
    assert.strictEqual(r.status, 'already_ok');
  });

  test('decline writes skip flag', async () => {
    root = makeGitProject();
    const r = await ensureTopiaGitignore({ projectRoot: root, autoYes: false, interactive: false });
    assert.strictEqual(r.status, 'pending');
    assert.ok(existsSync(join(root, '.topia', SKIP_GITIGNORE_FLAG)));
  });
});
