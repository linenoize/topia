import assert from 'node:assert';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectGraphData, generateNexusHTML } from '../visualizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Topia_ROOT = path.resolve(__dirname, '../..');

// ─── collectGraphData ───

describe('collectGraphData', () => {
  test('collects nodes for all core skills', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const coreNodes = data.nodes.filter((n) => n.layer !== 'L4');
    assert.ok(coreNodes.length >= 60, `Expected >= 60 core nodes, got ${coreNodes.length}`);
  });

  test('collects L4 pack nodes', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const packNodes = data.nodes.filter((n) => n.layer === 'L4');
    assert.ok(packNodes.length >= 10, `Expected >= 10 pack nodes, got ${packNodes.length}`);
  });

  test('nodes have required fields', async () => {
    const data = await collectGraphData(Topia_ROOT);
    for (const n of data.nodes) {
      assert.ok(n.id, 'Node must have id');
      assert.ok(n.layer, 'Node must have layer');
    }
  });

  test('nodes have correct layer values', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const validLayers = new Set(['L0', 'L1', 'L2', 'L3', 'L4']);
    for (const n of data.nodes) {
      assert.ok(validLayers.has(n.layer), `Invalid layer ${n.layer} for ${n.id}`);
    }
  });

  test('collects cross-ref edges', async () => {
    const data = await collectGraphData(Topia_ROOT);
    assert.ok(data.edges.length > 100, `Expected > 100 edges, got ${data.edges.length}`);
  });

  test('edges reference valid nodes', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const nodeIds = new Set(data.nodes.map((n) => n.id));
    for (const e of data.edges) {
      assert.ok(nodeIds.has(e.source), `Edge source ${e.source} not in nodes`);
    }
  });

  test('edges have type field', async () => {
    const data = await collectGraphData(Topia_ROOT);
    for (const e of data.edges) {
      assert.strictEqual(e.type, 'crossref');
    }
  });

  test('collects signal edges', async () => {
    const data = await collectGraphData(Topia_ROOT);
    assert.ok(data.signalEdges.length > 0, 'Should have signal edges');
  });

  test('signal edges have signal name', async () => {
    const data = await collectGraphData(Topia_ROOT);
    for (const e of data.signalEdges) {
      assert.ok(e.signal, 'Signal edge must have signal name');
      assert.ok(e.source, 'Signal edge must have source');
      assert.ok(e.target, 'Signal edge must have target');
    }
  });

  test('counts unique signals', async () => {
    const data = await collectGraphData(Topia_ROOT);
    assert.ok(data.signals.length >= 10, `Expected >= 10 signals, got ${data.signals.length}`);
  });

  test('stats are accurate', async () => {
    const data = await collectGraphData(Topia_ROOT);
    assert.strictEqual(data.stats.nodeCount, data.nodes.length);
    assert.strictEqual(data.stats.edgeCount, data.edges.length);
    assert.strictEqual(data.stats.signalEdgeCount, data.signalEdges.length);
    assert.strictEqual(data.stats.signalCount, data.signals.length);
  });

  test('no duplicate node IDs', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const ids = data.nodes.map((n) => n.id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, 'Duplicate node IDs found');
  });

  test('L0 has exactly 1 node (skill-router)', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const l0 = data.nodes.filter((n) => n.layer === 'L0');
    assert.strictEqual(l0.length, 1);
    assert.strictEqual(l0[0].id, 'skill-router');
  });

  test('L1 has orchestrator nodes', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const l1 = data.nodes.filter((n) => n.layer === 'L1');
    assert.ok(l1.length >= 4);
    const names = l1.map((n) => n.id);
    assert.ok(names.includes('build'));
    assert.ok(names.includes('team'));
  });
});

// ─── generateNexusHTML ───

describe('generateNexusHTML', () => {
  test('generates valid HTML document', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<html'));
    assert.ok(html.includes('</html>'));
  });

  test('is self-contained (no CDN links)', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(!html.includes('cdn.'), 'Should not reference CDN');
    assert.ok(!html.includes('unpkg.com'), 'Should not reference unpkg');
    assert.ok(!html.includes('cdnjs.'), 'Should not reference cdnjs');
  });

  test('embeds graph data as JSON', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('const DATA ='));
    assert.ok(html.includes('"nodeCount"'));
  });

  test('includes inline CSS', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('<style>'));
    assert.ok(html.includes('</style>'));
  });

  test('includes inline JavaScript', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('<script>'));
    assert.ok(html.includes('</script>'));
  });

  test('includes search input', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('id="search"'));
    assert.ok(html.includes('Search skills'));
  });

  test('includes layer filter buttons', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('id="filters"'));
    assert.ok(html.includes('filter-btn'));
  });

  test('includes detail panel', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('detail-panel'));
    assert.ok(html.includes('detail-content'));
  });

  test('includes legend', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('L0 Router'));
    assert.ok(html.includes('L1 Orchestrator'));
    assert.ok(html.includes('L2 Workflow'));
    assert.ok(html.includes('L3 Utility'));
    assert.ok(html.includes('L4 Extension'));
    assert.ok(html.includes('Cross-ref'));
    assert.ok(html.includes('Signal'));
  });

  test('includes canvas element', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('<canvas id="canvas"'));
  });

  test('includes layer colors config', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('#f59e0b')); // L0
    assert.ok(html.includes('#ef4444')); // L1
    assert.ok(html.includes('#6366f1')); // L2
    assert.ok(html.includes('#10b981')); // L3
    assert.ok(html.includes('#8b5cf6')); // L4
  });

  test('handles interaction code', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('mousemove'));
    assert.ok(html.includes('mousedown'));
    assert.ok(html.includes('wheel'));
    assert.ok(html.includes('hitTest'));
  });

  test('has zoom/pan support', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('cam.zoom'));
    assert.ok(html.includes('cam.x'));
  });

  test('HTML escapes data to prevent XSS', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const html = generateNexusHTML(data);
    assert.ok(html.includes('function esc('));
    assert.ok(html.includes('&amp;'));
    assert.ok(html.includes('&lt;'));
  });
});

// ─── Graph Properties ───

describe('graph properties', () => {
  test('graph is connected (most nodes reachable from build)', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const adj = {};
    for (const n of data.nodes) adj[n.id] = [];
    for (const e of data.edges) {
      if (adj[e.source]) adj[e.source].push(e.target);
      if (adj[e.target]) adj[e.target].push(e.source);
    }

    // BFS from build
    const visited = new Set();
    const queue = ['build'];
    visited.add('build');
    while (queue.length > 0) {
      const current = queue.shift();
      for (const neighbor of adj[current] || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // Most core skills should be reachable
    const coreNodes = data.nodes.filter((n) => n.layer !== 'L4');
    const reachable = coreNodes.filter((n) => visited.has(n.id));
    const ratio = reachable.length / coreNodes.length;
    assert.ok(ratio > 0.5, `Only ${(ratio * 100).toFixed(0)}% of core skills reachable from build`);
  });

  test('no self-referencing edges', async () => {
    const data = await collectGraphData(Topia_ROOT);
    for (const e of data.edges) {
      assert.notStrictEqual(e.source, e.target, `Self-edge found: ${e.source}`);
    }
  });

  test('signal edges connect different nodes', async () => {
    const data = await collectGraphData(Topia_ROOT);
    for (const e of data.signalEdges) {
      assert.notStrictEqual(e.source, e.target, `Signal self-edge: ${e.source} via ${e.signal}`);
    }
  });

  test('all layers represented', async () => {
    const data = await collectGraphData(Topia_ROOT);
    const layers = new Set(data.nodes.map((n) => n.layer));
    assert.ok(layers.has('L0'));
    assert.ok(layers.has('L1'));
    assert.ok(layers.has('L2'));
    assert.ok(layers.has('L3'));
    assert.ok(layers.has('L4'));
  });
});
