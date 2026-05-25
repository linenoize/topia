import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cursor from '../adapters/hooks/cursor.js';
import { installHooks } from '../commands/hooks/install.js';
import { hookStatus } from '../commands/hooks/status.js';
import { uninstallHooks } from '../commands/hooks/uninstall.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Topia_ROOT = path.resolve(__dirname, '..', '..');
const RULES_DIR = '.cursor/rules';

let tmpRoot;

async function seedCursor(root) {
  await mkdir(path.join(root, '.cursor'), { recursive: true });
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'Topia-cursor-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('cursor adapter', () => {
  test('detect() true when .cursor exists', async () => {
    await seedCursor(tmpRoot);
    assert.strictEqual(cursor.detect(tmpRoot), true);
  });

  test('detect() false when .cursor missing', () => {
    assert.strictEqual(cursor.detect(tmpRoot), false);
  });

  test('emit(gentle) returns 3 .mdc rule files and hooks.json', async () => {
    const plan = await cursor.emit({ preset: 'gentle', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    assert.strictEqual(plan.files.length, 4);
    const names = plan.files.map((f) => path.basename(f.path)).sort();
    assert.deepStrictEqual(names, [
      'Topia-dependency-doctor.mdc',
      'Topia-guardian.mdc',
      'Topia-readiness.mdc',
      'hooks.json',
    ]);
    for (const file of plan.files) {
      if (file.path.endsWith('.mdc')) {
        assert.ok(file.content.includes('Topia-managed: true'));
        assert.ok(file.content.includes('@linenoize/topia hook-dispatch'));
      }
    }
    const hooksJson = plan.files.find((f) => f.path.endsWith('hooks.json'));
    assert.ok(hooksJson.content.includes('"Topia-managed": true'));
    assert.ok(hooksJson.content.includes('token-meter'));
    assert.ok(hooksJson.content.includes('run-hook.cjs'));
  });

  test('emit(strict) renders WARN → BLOCK guidance', async () => {
    const gentle = await cursor.emit({ preset: 'gentle', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    const strict = await cursor.emit({ preset: 'strict', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    const gentlePreflight = gentle.files.find((f) => f.path.endsWith('Topia-readiness.mdc')).content;
    const strictPreflight = strict.files.find((f) => f.path.endsWith('Topia-readiness.mdc')).content;
    assert.ok(gentlePreflight.includes('WARN'));
    assert.ok(strictPreflight.includes('BLOCK'));
  });

  test('emit(off) delegates to uninstall', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const plan = await cursor.emit({ preset: 'off', projectRoot: tmpRoot });
    assert.ok(plan.files.every((f) => f.content === null));
    assert.ok(plan.files.length >= 1);
  });

  test('emit() rejects invalid preset', async () => {
    await assert.rejects(cursor.emit({ preset: 'loose', projectRoot: tmpRoot }), /invalid preset/);
  });

  test('install writes .mdc files and hooks.json to .cursor/', async () => {
    await seedCursor(tmpRoot);
    const result = await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    assert.strictEqual(result.written, true);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    const files = await readdir(rulesDir);
    assert.ok(files.includes('Topia-readiness.mdc'));
    assert.ok(files.includes('Topia-guardian.mdc'));
    assert.ok(files.includes('Topia-dependency-doctor.mdc'));
    assert.ok(existsSync(path.join(tmpRoot, '.cursor', 'hooks.json')));
  });

  test('idempotent re-install produces identical content', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    const first = await readFile(path.join(rulesDir, 'Topia-readiness.mdc'), 'utf-8');
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const second = await readFile(path.join(rulesDir, 'Topia-readiness.mdc'), 'utf-8');
    assert.strictEqual(first, second);
  });

  test('uninstall removes only Topia-managed .mdc files', async () => {
    await seedCursor(tmpRoot);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(rulesDir, 'user-custom.mdc'), '---\ndescription: user\n---\n\n# User rule\n', 'utf-8');

    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    await uninstallHooks(tmpRoot, { platform: 'cursor' });

    const remaining = await readdir(rulesDir);
    assert.ok(remaining.includes('user-custom.mdc'), 'user rule must survive');
    assert.ok(!remaining.some((f) => f.startsWith('Topia-')), 'no Topia-* files should remain');
    assert.ok(!existsSync(path.join(tmpRoot, '.cursor', 'hooks.json')), 'Topia hooks.json should be removed');
  });

  test('uninstall skips files without Topia-managed signature', async () => {
    await seedCursor(tmpRoot);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    await mkdir(rulesDir, { recursive: true });
    // A file that happens to start with "Topia-" but is NOT managed by Topia
    await writeFile(
      path.join(rulesDir, 'Topia-fake.mdc'),
      '---\ndescription: user imposter\n---\n\nnot ours\n',
      'utf-8',
    );

    await uninstallHooks(tmpRoot, { platform: 'cursor' });
    assert.ok(existsSync(path.join(rulesDir, 'Topia-fake.mdc')), 'non-managed Topia-* file must survive');
  });

  test('status reports installed preset after install', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'strict', platform: 'cursor', topiaRoot: Topia_ROOT });
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'cursor' });
    const r = result.results.find((x) => x.platform === 'cursor');
    assert.strictEqual(r.installed, true);
    assert.strictEqual(r.preset, 'strict');
    assert.ok(r.wired.includes('readiness'));
    assert.ok(r.wired.includes('guardian'));
    assert.ok(r.wired.includes('dependency-doctor'));
  });

  test('status reports not installed when .cursor missing', async () => {
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'cursor' });
    const r = result.results.find((x) => x.platform === 'cursor');
    assert.strictEqual(r.installed, false);
    assert.ok(r.missing.includes('readiness'));
  });
});
