/**
 * Skill Index Generation Tests
 *
 * Tests that buildAll generates a valid skill-index.json with:
 * - Intent patterns mapped to skills
 * - Nexus-aware chain prediction from connections
 * - Complete skill graph
 */

import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { getAdapter } from '../adapters/index.js';
import { buildAll } from '../emitter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Topia_ROOT = path.resolve(__dirname, '../..');

describe('skill-index.json generation', () => {
  test('buildAll emits skill-index.json with correct structure', async () => {
    const tmp = path.join(tmpdir(), `Topia-idx-test-${Date.now()}`);
    try {
      const adapter = getAdapter('cursor');
      await buildAll({ TopiaRoot: Topia_ROOT, outputRoot: tmp, adapter });

      const indexPath = path.join(tmp, adapter.outputDir, 'skill-index.json');
      assert.ok(existsSync(indexPath), 'skill-index.json not found in output');

      const index = JSON.parse(await readFile(indexPath, 'utf-8'));

      // Structure checks
      assert.strictEqual(index.version, 2);
      assert.ok(index.generated, 'missing generated timestamp');
      assert.ok(index.skillCount >= 50, `too few skills: ${index.skillCount}`);
      assert.ok(typeof index.skills === 'object', 'missing skills object');
      assert.ok(typeof index.graph === 'object', 'missing graph object');
      assert.ok(typeof index.signals === 'object', 'missing signals object');
      assert.ok(typeof index.intents === 'object', 'missing intents object');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('skill-index contains intent patterns with chains', async () => {
    const tmp = path.join(tmpdir(), `Topia-idx-test-${Date.now()}`);
    try {
      const adapter = getAdapter('cursor');
      await buildAll({ TopiaRoot: Topia_ROOT, outputRoot: tmp, adapter });

      const index = JSON.parse(await readFile(path.join(tmp, adapter.outputDir, 'skill-index.json'), 'utf-8'));

      // build intent should exist with keywords and chain
      assert.ok(index.intents.build, 'missing build intent');
      assert.ok(Array.isArray(index.intents.build.keywords), 'build keywords not array');
      assert.ok(index.intents.build.keywords.includes('implement'), 'build missing "implement" keyword');
      assert.ok(Array.isArray(index.intents.build.chain), 'build chain not array');
      assert.strictEqual(index.intents.build.chain[0], 'build', 'build chain should start with build');
      assert.ok(index.intents.build.chain.length > 1, 'build chain should have connected skills');

      // debug intent
      assert.ok(index.intents.debug, 'missing debug intent');
      assert.ok(index.intents.debug.keywords.includes('bug'), 'debug missing "bug" keyword');

      // sentinel intent
      assert.ok(index.intents.guardian, 'missing guardian intent');
      assert.ok(index.intents.guardian.keywords.includes('security'), 'guardian missing "security" keyword');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('skill-index graph has connections from cross-refs', async () => {
    const tmp = path.join(tmpdir(), `Topia-idx-test-${Date.now()}`);
    try {
      const adapter = getAdapter('cursor');
      await buildAll({ TopiaRoot: Topia_ROOT, outputRoot: tmp, adapter });

      const index = JSON.parse(await readFile(path.join(tmp, adapter.outputDir, 'skill-index.json'), 'utf-8'));

      // build should have outbound connections
      assert.ok(index.graph.build, 'build not in graph');
      assert.ok(index.graph.build.length > 3, `build should have many connections, got ${index.graph.build.length}`);

      // Skills entry should have layer and description
      assert.ok(index.skills.build, 'build not in skills');
      assert.strictEqual(index.skills.build.layer, 'L1');
      assert.ok(index.skills.build.description.length > 20, 'build description too short');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('skill-index contains signal graph', async () => {
    const tmp = path.join(tmpdir(), `Topia-idx-test-${Date.now()}`);
    try {
      const adapter = getAdapter('cursor');
      await buildAll({ TopiaRoot: Topia_ROOT, outputRoot: tmp, adapter });

      const index = JSON.parse(await readFile(path.join(tmp, adapter.outputDir, 'skill-index.json'), 'utf-8'));

      // Signal graph should exist
      assert.ok(typeof index.signals === 'object', 'missing signals object');
      assert.ok(Object.keys(index.signals).length >= 10, `too few signals: ${Object.keys(index.signals).length}`);

      // code.changed should be a well-connected signal
      assert.ok(index.signals['code.changed'], 'missing code.changed signal');
      assert.ok(index.signals['code.changed'].emitters.includes('fix'), 'fix should emit code.changed');
      assert.ok(index.signals['code.changed'].listeners.length >= 3, 'code.changed should have 3+ listeners');

      // Per-skill signals should be included
      assert.ok(index.skills.test.signals, 'test skill should have signals');
      assert.ok(index.skills.test.signals.emit.includes('tests.passed'), 'test should emit tests.passed');
      assert.ok(index.skills.test.signals.listen.includes('code.changed'), 'test should listen to code.changed');

      // Skills without signals should not have the field
      const noSignalSkill = Object.values(index.skills).find((s) => !s.signals);
      assert.ok(noSignalSkill, 'at least one skill should have no signals');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('skill-index signal graph with synthetic skills', async () => {
    const tmp = path.join(tmpdir(), `Topia-idx-sig-${Date.now()}`);
    const skillsDir = path.join(tmp, 'skills');
    await mkdir(path.join(skillsDir, 'emitter'), { recursive: true });
    await mkdir(path.join(skillsDir, 'listener'), { recursive: true });
    await mkdir(path.join(tmp, 'extensions'), { recursive: true });

    await writeFile(
      path.join(skillsDir, 'emitter', 'SKILL.md'),
      [
        '---',
        'name: emitter',
        'description: "Emits signals"',
        'metadata:',
        '  layer: L2',
        '  emit: data.ready',
        '---',
        '',
        '# emitter',
      ].join('\n'),
      'utf-8',
    );

    await writeFile(
      path.join(skillsDir, 'listener', 'SKILL.md'),
      [
        '---',
        'name: listener',
        'description: "Listens to signals"',
        'metadata:',
        '  layer: L3',
        '  listen: data.ready',
        '---',
        '',
        '# listener',
      ].join('\n'),
      'utf-8',
    );

    try {
      const adapter = getAdapter('generic');
      await buildAll({ TopiaRoot: tmp, outputRoot: tmp, adapter });

      const index = JSON.parse(await readFile(path.join(tmp, adapter.outputDir, 'skill-index.json'), 'utf-8'));

      assert.ok(index.signals['data.ready'], 'data.ready signal should exist');
      assert.deepStrictEqual(index.signals['data.ready'].emitters, ['emitter']);
      assert.deepStrictEqual(index.signals['data.ready'].listeners, ['listener']);
      assert.ok(index.skills.emitter.signals);
      assert.deepStrictEqual(index.skills.emitter.signals.emit, ['data.ready']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  test('skill-index works with minimal skill tree', async () => {
    const tmp = path.join(tmpdir(), `Topia-idx-min-${Date.now()}`);
    const skillsDir = path.join(tmp, 'skills', 'alpha');
    await mkdir(skillsDir, { recursive: true });
    await mkdir(path.join(tmp, 'extensions'), { recursive: true });

    await writeFile(
      path.join(skillsDir, 'SKILL.md'),
      [
        '---',
        'name: alpha',
        'description: "Test skill"',
        'metadata:',
        '  layer: L3',
        '  group: utility',
        '---',
        '',
        '# alpha',
        '',
        'Body.',
      ].join('\n'),
      'utf-8',
    );

    try {
      const adapter = getAdapter('generic');
      await buildAll({ TopiaRoot: tmp, outputRoot: tmp, adapter });

      const index = JSON.parse(await readFile(path.join(tmp, adapter.outputDir, 'skill-index.json'), 'utf-8'));
      assert.strictEqual(index.skillCount, 1);
      assert.ok(index.skills.alpha, 'alpha not in skills');
      assert.deepStrictEqual(index.graph.alpha, [], 'alpha should have no connections');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
