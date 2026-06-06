import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  activateL4PacksForProject,
  collectProjectSignals,
  detectL4Packs,
  packIdToDirName,
  writeActivePacks,
} from '../../skills/onboard/scripts/detect-l4-packs.js';

describe('detect-l4-packs', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('detects backend + ai-ml for FastAPI stack', () => {
    const d = detectL4Packs({ signals: 'FastAPI Parler-TTS Qwen3 inference' });
    const packs = d.map((x) => x.pack);
    assert.ok(packs.includes('@Topia/backend'));
    assert.ok(packs.includes('@Topia/ai-ml'));
  });

  test('writeActivePacks creates json', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-l4-'));
    const detected = [{ pack: '@Topia/ui', reason: 'react' }];
    const r = writeActivePacks(root, detected);
    assert.ok(existsSync(join(root, '.topia', 'active-packs.json')));
    const j = JSON.parse(readFileSync(join(root, '.topia', 'active-packs.json'), 'utf-8'));
    assert.ok(j.enabled.includes('@Topia/ui'));
  });

  test('packIdToDirName strips @Topia prefix', () => {
    assert.strictEqual(packIdToDirName('@Topia/ui'), 'ui');
    assert.strictEqual(packIdToDirName('ui'), 'ui');
  });

  test('collectProjectSignals reads package.json react + express', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-l4-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18', express: '^4' },
        devDependencies: { typescript: '^5' },
      }),
      'utf-8',
    );
    const collected = collectProjectSignals(root);
    assert.match(collected.signals, /react/i);
    assert.match(collected.signals, /express/i);
    assert.strictEqual(collected.framework, 'react');
  });

  test('activateL4PacksForProject writes ui and backend packs', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-l4-'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18', express: '^4' },
      }),
      'utf-8',
    );
    const result = activateL4PacksForProject(root, { source: 'install' });
    assert.ok(result.enabled.includes('@Topia/ui'));
    assert.ok(result.enabled.includes('@Topia/backend'));
    const j = JSON.parse(readFileSync(join(root, '.topia', 'active-packs.json'), 'utf-8'));
    assert.strictEqual(j.packs['@Topia/ui'].source, 'install');
  });

  test('activateL4PacksForProject dry-run does not write', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-l4-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }), 'utf-8');
    activateL4PacksForProject(root, { dryRun: true });
    assert.ok(!existsSync(join(root, '.topia', 'active-packs.json')));
  });
});
