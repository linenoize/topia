import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { detectL4Packs, writeActivePacks } from '../../skills/onboard/scripts/detect-l4-packs.js';

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
});
