import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectStats, renderStatus, renderStatusJson } from '../status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Topia_ROOT = path.resolve(__dirname, '../..');

// ─── collectStats ───

describe('collectStats', () => {
  test('collects core skill count', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.ok(stats.skillCount >= 60, `Expected >= 60 skills, got ${stats.skillCount}`);
  });

  test('counts skills by layer', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.strictEqual(stats.layers.L0, 1);
    assert.ok(stats.layers.L1 >= 4);
    assert.ok(stats.layers.L2 >= 25);
    assert.ok(stats.layers.L3 >= 20);
  });

  test('counts signals', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.ok(stats.signalCount >= 10, `Expected >= 10 signals, got ${stats.signalCount}`);
  });

  test('builds signal map with emitters and listeners', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.ok(Object.keys(stats.signalMap.emitters).length > 0);
    assert.ok(Object.keys(stats.signalMap.listeners).length > 0);
  });

  test('counts connections', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.ok(stats.totalConnections > 100);
    assert.ok(parseFloat(stats.avgConnections) > 1);
  });

  test('discovers extension packs', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.ok(stats.packs.length >= 10);
    for (const pack of stats.packs) {
      assert.ok(pack.name, 'Pack should have a name');
      assert.ok(pack.lines > 0, `Pack ${pack.name} should have lines`);
    }
  });

  test('returns parsedSkills array', async () => {
    const stats = await collectStats(Topia_ROOT);
    assert.strictEqual(stats.parsedSkills.length, stats.skillCount);
    for (const skill of stats.parsedSkills) {
      assert.ok(skill.name);
    }
  });
});

// ─── renderStatus ───

describe('renderStatus', () => {
  test('renders box with Unicode borders', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.ok(output.includes('╭'));
    assert.ok(output.includes('╰'));
    assert.ok(output.includes('│'));
  });

  test('shows project title', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.ok(output.includes('🔮 Topia'));
  });

  test('shows skill count with layer breakdown', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.match(output, /Skills\s+\d+ core/);
    assert.ok(output.includes('L0:'));
    assert.ok(output.includes('L1:'));
    assert.ok(output.includes('L2:'));
    assert.ok(output.includes('L3:'));
  });

  test('shows pack count', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.match(output, /Packs\s+\d+ installed/);
  });

  test('shows signal count', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.match(output, /Signals\s+\d+ defined/);
  });

  test('shows mesh connections', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.match(output, /Mesh\s+\d+\+ connections/);
  });

  test('shows health progress bar', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.ok(output.includes('▓'));
    assert.ok(output.includes('mesh health'));
  });

  test('shows active signals section', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.ok(output.includes('Active Signals'));
    assert.ok(output.includes('→'));
  });

  test('shows project info when provided', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats, {
      version: '2.6.0',
      platform: 'cursor',
      projectName: 'my-app',
    });
    assert.ok(output.includes('my-app'));
    assert.ok(output.includes('cursor'));
    assert.ok(output.includes('2.6.0'));
  });

  test('shows Extension Packs section', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    assert.ok(output.includes('Extension Packs'));
    assert.ok(output.includes('@Topia/'));
  });
});

// ─── renderStatusJson ───

describe('renderStatusJson', () => {
  test('returns valid JSON', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(parsed);
  });

  test('includes skills with layers', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(parsed.skills.total >= 60);
    assert.strictEqual(parsed.skills.layers.L0, 1);
  });

  test('includes packs array with name and lines', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(Array.isArray(parsed.packs));
    assert.ok(parsed.packs.length >= 10);
    for (const pack of parsed.packs) {
      assert.ok(pack.name);
      assert.ok(pack.lines > 0);
    }
  });

  test('includes signal data with top signals', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(parsed.signals.count >= 10);
    assert.ok(parsed.signals.top.length > 0);
    for (const sig of parsed.signals.top) {
      assert.ok(sig.name);
      assert.ok(Array.isArray(sig.emitters));
      assert.ok(Array.isArray(sig.listeners));
    }
  });

  test('includes mesh stats', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(parsed.mesh.connections > 100);
    assert.ok(parsed.mesh.avgPerSkill > 1);
  });

  test('includes health score 0-100', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(parsed.health >= 0);
    assert.ok(parsed.health <= 100);
  });

  test('includes project info when provided', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats, { version: '2.6.0', platform: 'cursor', projectName: 'test' }));
    assert.strictEqual(parsed.project, 'test');
    assert.strictEqual(parsed.platform, 'cursor');
    assert.strictEqual(parsed.version, '2.6.0');
  });
});

// ─── Health Score ───

describe('health score', () => {
  test('unified mesh has reasonable health', async () => {
    const stats = await collectStats(Topia_ROOT);
    const parsed = JSON.parse(renderStatusJson(stats));
    assert.ok(parsed.health >= 70, `Health ${parsed.health} should be >= 70`);
  });
});

// ─── Box Rendering ───

describe('box rendering', () => {
  test('all box lines end with correct border char', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    const lines = output.split('\n');
    const boxLines = lines.filter((l) => l.startsWith('│') || l.startsWith('╭') || l.startsWith('╰'));

    for (const line of boxLines) {
      const lastChar = line.trimEnd().slice(-1);
      assert.ok(
        ['│', '╮', '╯'].includes(lastChar),
        `Line should end with border char, got: "${lastChar}" in "${line}"`,
      );
    }
  });

  test('box has exactly one top and one bottom border', async () => {
    const stats = await collectStats(Topia_ROOT);
    const output = renderStatus(stats);
    const lines = output.split('\n');
    assert.strictEqual(lines.filter((l) => l.startsWith('╭')).length, 1);
    assert.strictEqual(lines.filter((l) => l.startsWith('╰')).length, 1);
  });
});
