import assert from 'node:assert';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { formatSetupResult, runSetup } from '../commands/setup.js';

let tmpRoot;

async function seedClaude(root) {
  await mkdir(path.join(root, '.claude'), { recursive: true });
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'Topia-setup-'));
  await mkdir(path.join(tmpRoot, 'project'), { recursive: true });
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('runSetup (non-interactive)', () => {
  test('--here installs to current project', async () => {
    const projectRoot = path.join(tmpRoot, 'project');
    await seedClaude(projectRoot);
    const result = await runSetup({
      projectRoot,
      topiaRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
      args: { here: true, preset: 'gentle' },
    });
    assert.strictEqual(result.scope, 'current');
    assert.strictEqual(result.preset, 'gentle');
    assert.strictEqual(result.targetRoot, projectRoot);
  });

  test('--dry does not write files', async () => {
    const projectRoot = path.join(tmpRoot, 'project');
    await seedClaude(projectRoot);
    const result = await runSetup({
      projectRoot,
      topiaRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'),
      args: { here: true, preset: 'gentle', dry: true },
    });
    assert.strictEqual(result.written, false);
  });
});

describe('formatSetupResult', () => {
  test('renders summary with scope', () => {
    const out = formatSetupResult({
      scope: 'current',
      targetRoot: '/path/to/project',
      preset: 'gentle',
      platforms: ['claude'],
      written: true,
      notes: [],
    });
    assert.match(out, /Setup Complete/);
    assert.match(out, /current project/);
    assert.match(out, /topia doctor --hooks/);
  });

  test('renders global scope label when scope=global', () => {
    const out = formatSetupResult({
      scope: 'global',
      targetRoot: '/home/user',
      preset: 'gentle',
      platforms: ['claude'],
      written: true,
      notes: [],
    });
    assert.match(out, /GLOBAL/);
  });
});
