import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as antigravity from '../adapters/hooks/antigravity.js';
import { installHooks } from '../commands/hooks/install.js';
import { hookStatus } from '../commands/hooks/status.js';
import { uninstallHooks } from '../commands/hooks/uninstall.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Topia_ROOT = path.resolve(__dirname, '..', '..');
const RULES_DIR = '.antigravity/rules';

let tmpRoot;

async function seedAntigravity(root) {
  await mkdir(path.join(root, '.antigravity'), { recursive: true });
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'Topia-antigravity-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('antigravity adapter', () => {
  test('detect() true when .antigravity exists', async () => {
    await seedAntigravity(tmpRoot);
    assert.strictEqual(antigravity.detect(tmpRoot), true);
  });

  test('emit(gentle) returns 3 rule markdowns with WARN mode', async () => {
    const plan = await antigravity.emit({ preset: 'gentle', projectRoot: tmpRoot });
    assert.strictEqual(plan.files.length, 3);
    for (const file of plan.files) {
      assert.ok(file.content.includes('Topia-managed: true'));
      assert.ok(file.content.includes('mode: WARN'));
    }
  });

  test('emit(strict) renders BLOCK mode', async () => {
    const plan = await antigravity.emit({ preset: 'strict', projectRoot: tmpRoot });
    for (const file of plan.files) {
      assert.ok(file.content.includes('mode: BLOCK'));
    }
  });

  test('emit() rejects invalid preset', async () => {
    await assert.rejects(antigravity.emit({ preset: 'weird', projectRoot: tmpRoot }), /invalid preset/);
  });

  test('emit() notes call out experimental status', async () => {
    const plan = await antigravity.emit({ preset: 'gentle', projectRoot: tmpRoot });
    assert.ok(plan.notes.some((n) => n.toLowerCase().includes('experimental')));
  });

  test('install writes rule files under .antigravity/rules/', async () => {
    await seedAntigravity(tmpRoot);
    const result = await installHooks(tmpRoot, { preset: 'gentle', platform: 'antigravity' });
    assert.strictEqual(result.written, true);
    const files = await readdir(path.join(tmpRoot, RULES_DIR));
    assert.ok(files.includes('Topia-readiness.md'));
    assert.ok(files.includes('Topia-guardian.md'));
    assert.ok(files.includes('Topia-dependency-doctor.md'));
  });

  test('idempotent re-install', async () => {
    await seedAntigravity(tmpRoot);
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'antigravity' });
    const first = await readFile(path.join(tmpRoot, RULES_DIR, 'Topia-readiness.md'), 'utf-8');
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'antigravity' });
    const second = await readFile(path.join(tmpRoot, RULES_DIR, 'Topia-readiness.md'), 'utf-8');
    assert.strictEqual(first, second);
  });

  test('uninstall removes Topia rules, preserves user rules', async () => {
    await seedAntigravity(tmpRoot);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(rulesDir, 'user-rule.md'), '# User rule\n', 'utf-8');

    await installHooks(tmpRoot, { preset: 'gentle', platform: 'antigravity' });
    await uninstallHooks(tmpRoot, { platform: 'antigravity' });

    const remaining = await readdir(rulesDir);
    assert.ok(remaining.includes('user-rule.md'), 'user rule must survive');
    assert.ok(!remaining.some((f) => f.startsWith('Topia-')), 'no Topia-* files should remain');
  });

  test('uninstall leaves non-managed Topia-* files alone', async () => {
    await seedAntigravity(tmpRoot);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(rulesDir, 'Topia-fake.md'), '---\ndescription: imposter\n---\n\nnot ours\n', 'utf-8');

    await uninstallHooks(tmpRoot, { platform: 'antigravity' });
    assert.ok(existsSync(path.join(rulesDir, 'Topia-fake.md')));
  });

  test('status after install reports wired skills', async () => {
    await seedAntigravity(tmpRoot);
    await installHooks(tmpRoot, { preset: 'strict', platform: 'antigravity' });
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'antigravity' });
    const r = result.results.find((x) => x.platform === 'antigravity');
    assert.strictEqual(r.installed, true);
    assert.strictEqual(r.preset, 'strict');
    assert.ok(r.wired.includes('readiness'));
  });

  test('status reports not installed when .antigravity missing', async () => {
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'antigravity' });
    const r = result.results.find((x) => x.platform === 'antigravity');
    assert.strictEqual(r.installed, false);
  });
});
