import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  checkGitignore,
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

function makeRealRepo(gitignore) {
  const root = mkdtempSync(join(tmpdir(), 'topia-gi-real-'));
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, '.gitignore'), gitignore, 'utf-8');
  return root;
}

function isIgnored(root, file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (err) {
    if (err.status === 1) return false;
    throw err;
  }
}

const SF_PRIVATE = [
  '.topia/salesforce/activation.json',
  '.topia/salesforce/session.json',
  '.topia/salesforce/pending-enable.json',
  '.topia/salesforce/journal/corr-1.jsonl',
  '.topia/salesforce/executions/abc.json',
  '.topia/salesforce/validations/plan-1.json',
];
const SF_SHARED = ['.topia/salesforce/orgs.json', '.topia/salesforce/plans/plan-1.json'];

describe('Salesforce files under the Topia block', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('only the org registry and plans can be committed', () => {
    root = makeRealRepo(TOPIA_GITIGNORE_BLOCK);
    for (const file of SF_PRIVATE) assert.ok(isIgnored(root, file), `${file} must stay ignored`);
    for (const file of SF_SHARED) assert.ok(!isIgnored(root, file), `${file} must be committable`);
    assert.ok(!isIgnored(root, '.topia/org/org.md'));
    assert.ok(isIgnored(root, '.topia/progress.md'));
  });

  test('a project on the older block keeps every Salesforce file out of git', () => {
    root = makeRealRepo('/.topia/*\n!/.topia/org/\n!/.topia/org/**\n.remember/\n.mcp.json\n');
    assert.ok(gitignoreHasTopiaPatterns(readFileSync(join(root, '.gitignore'), 'utf-8')));
    for (const file of [...SF_PRIVATE, ...SF_SHARED]) assert.ok(isIgnored(root, file), `${file} must stay ignored`);
  });

  test('doctor accepts a tracked registry and plan, and flags a tracked lock', () => {
    root = makeRealRepo(TOPIA_GITIGNORE_BLOCK);
    mkdirSync(join(root, '.topia', 'salesforce', 'plans'), { recursive: true });
    writeFileSync(join(root, '.topia/salesforce/orgs.json'), '{}', 'utf-8');
    writeFileSync(join(root, '.topia/salesforce/plans/p.json'), '{}', 'utf-8');
    writeFileSync(join(root, '.topia/salesforce/activation.json'), '{}', 'utf-8');
    execFileSync('git', ['add', '.topia/salesforce/orgs.json', '.topia/salesforce/plans/p.json'], {
      cwd: root,
      stdio: 'ignore',
    });
    assert.ok(checkGitignore(root).healthy);
    execFileSync('git', ['add', '-f', '.topia/salesforce/activation.json'], { cwd: root, stdio: 'ignore' });
    const flagged = checkGitignore(root);
    assert.ok(!flagged.healthy);
    assert.ok(flagged.warnings.some((line) => line.includes('activation.json')));
    assert.ok(
      !flagged.warnings.some((line) => line.includes('Tracked but should be ignored: .topia/salesforce/orgs.json')),
    );
  });
});

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
