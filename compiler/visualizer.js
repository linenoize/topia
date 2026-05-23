/**
 * Visualizer — Interactive Nexus Graph
 *
 * Generates a self-contained HTML file with a force-directed graph
 * of all skills, connections, and signals. No CDN dependencies.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseSkill } from './parser.js';

// ─── Data Collection ───

export async function collectGraphData(TopiaRoot) {
  const skillsDir = path.join(TopiaRoot, 'skills');
  const extDir = path.join(TopiaRoot, 'extensions');

  const nodes = [];
  const edges = [];
  const signalEdges = [];
  const signalMap = {};

  // Parse core skills
  if (existsSync(skillsDir)) {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = await readFile(skillFile, 'utf-8');
      const parsed = parseSkill(content, skillFile);

      nodes.push({
        id: parsed.name,
        layer: parsed.layer || 'L3',
        group: parsed.group || '',
        description: (parsed.description || '').slice(0, 120),
        connections: [...new Set(parsed.crossRefs.map((r) => r.skillName))],
        signals: parsed.signals || null,
      });

      // Cross-ref edges (skip self-references)
      const refs = [...new Set(parsed.crossRefs.map((r) => r.skillName))];
      for (const target of refs) {
        if (target !== parsed.name) {
          edges.push({ source: parsed.name, target, type: 'crossref' });
        }
      }

      // Signal edges
      if (parsed.signals) {
        for (const sig of parsed.signals.emit) {
          if (!signalMap[sig]) signalMap[sig] = { emitters: [], listeners: [] };
          signalMap[sig].emitters.push(parsed.name);
        }
        for (const sig of parsed.signals.listen) {
          if (!signalMap[sig]) signalMap[sig] = { emitters: [], listeners: [] };
          signalMap[sig].listeners.push(parsed.name);
        }
      }
    }
  }

  // Scan extension packs as L4 nodes
  if (existsSync(extDir)) {
    const entries = await readdir(extDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packFile = path.join(extDir, entry.name, 'PACK.md');
      if (!existsSync(packFile)) continue;

      const baseName = entry.name.replace(/^(pro|business)-/, '');
      const nodeId = `pack:${baseName}`;

      // Avoid duplicate pack nodes
      if (!nodes.find((n) => n.id === nodeId)) {
        nodes.push({
          id: nodeId,
          layer: 'L4',
          group: 'extension',
          description: `extension pack: ${baseName}`,
          connections: [],
          signals: null,
        });
      }
    }
  }

  // Build signal edges from signal map
  for (const [sigName, { emitters, listeners }] of Object.entries(signalMap)) {
    for (const emitter of emitters) {
      for (const listener of listeners) {
        signalEdges.push({ source: emitter, target: listener, signal: sigName });
      }
    }
  }

  return {
    nodes,
    edges,
    signalEdges,
    signals: Object.keys(signalMap),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      signalEdgeCount: signalEdges.length,
      signalCount: Object.keys(signalMap).length,
    },
  };
}

// ─── HTML Generation ───

export function generateNexusHTML(graphData) {
  const dataJson = JSON.stringify(graphData);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Topia Nexus Visualizer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #0a0a1a;
  color: #e2e8f0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;
  height: 100vh;
}

/* ─── Top Bar ─── */
.topbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 10;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 16px;
  background: rgba(10,10,26,0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.topbar h1 { font-size: 14px; font-weight: 600; white-space: nowrap; }
.topbar .stats { font-size: 12px; color: #64748b; margin-left: 8px; }
.search-box {
  padding: 5px 10px; border-radius: 6px; border: 1px solid #334155;
  background: #1e293b; color: #e2e8f0; font-size: 12px; width: 180px;
  outline: none;
}
.search-box:focus { border-color: #6366f1; }
.filter-group { display: flex; gap: 4px; margin-left: auto; }
.filter-btn {
  padding: 3px 10px; border-radius: 12px; border: 1px solid #334155;
  background: transparent; color: #94a3b8; font-size: 11px; cursor: pointer;
  transition: all 0.15s;
}
.filter-btn:hover { border-color: #6366f1; color: #e2e8f0; }
.filter-btn.active { background: var(--btn-color, #6366f1); border-color: var(--btn-color, #6366f1); color: #fff; }

/* ─── Canvas ─── */
#canvas {
  position: fixed; top: 44px; left: 0; right: 0; bottom: 0;
  cursor: grab;
}
#canvas:active { cursor: grabbing; }

/* ─── Detail Panel ─── */
.detail-panel {
  position: fixed; right: -320px; top: 44px; bottom: 0; width: 300px;
  background: rgba(15,23,42,0.95); backdrop-filter: blur(12px);
  border-left: 1px solid rgba(255,255,255,0.08);
  padding: 20px; overflow-y: auto;
  transition: right 0.25s ease;
  z-index: 5;
}
.detail-panel.open { right: 0; }
.detail-panel h2 { font-size: 16px; margin-bottom: 4px; }
.detail-panel .layer-badge {
  display: inline-block; padding: 2px 8px; border-radius: 8px;
  font-size: 11px; font-weight: 600; margin-bottom: 12px;
}
.detail-panel .desc { font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 16px; }
.detail-panel h3 { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin: 12px 0 6px; }
.detail-panel .conn-list { list-style: none; }
.detail-panel .conn-list li {
  font-size: 13px; padding: 3px 0; color: #cbd5e1; cursor: pointer;
}
.detail-panel .conn-list li:hover { color: #6366f1; }
.detail-panel .signal-tag {
  display: inline-block; padding: 2px 8px; border-radius: 4px;
  font-size: 11px; margin: 2px; background: rgba(99,102,241,0.15); color: #a5b4fc;
}
.detail-panel .close-btn {
  position: absolute; top: 12px; right: 12px; background: none; border: none;
  color: #64748b; font-size: 18px; cursor: pointer;
}

/* ─── Legend ─── */
.legend {
  position: fixed; bottom: 12px; left: 12px; z-index: 5;
  display: flex; gap: 12px; font-size: 11px; color: #64748b;
}
.legend-item { display: flex; align-items: center; gap: 4px; }
.legend-dot { width: 8px; height: 8px; border-radius: 50%; }
.legend-line { width: 20px; height: 2px; }
.legend-line.dashed { background: repeating-linear-gradient(90deg, #f59e0b 0 4px, transparent 4px 8px); }

@media print { body { background: #fff; color: #000; } }
</style>
</head>
<body>

<div class="topbar">
  <h1>Topia Nexus</h1>
  <span class="stats" id="stats"></span>
  <input class="search-box" id="search" placeholder="Search skills..." autocomplete="off">
  <div class="filter-group" id="filters"></div>
</div>

<canvas id="canvas"></canvas>

<div class="detail-panel" id="detail">
  <button class="close-btn" id="detail-close">&times;</button>
  <div id="detail-content"></div>
</div>

<div class="legend">
  <div class="legend-item"><div class="legend-dot" style="background:#f59e0b"></div> L0 Router</div>
  <div class="legend-item"><div class="legend-dot" style="background:#ef4444"></div> L1 Orchestrator</div>
  <div class="legend-item"><div class="legend-dot" style="background:#6366f1"></div> L2 Workflow</div>
  <div class="legend-item"><div class="legend-dot" style="background:#10b981"></div> L3 Utility</div>
  <div class="legend-item"><div class="legend-dot" style="background:#8b5cf6"></div> L4 Extension</div>
  <div class="legend-item"><div class="legend-line" style="background:#475569"></div> Cross-ref</div>
  <div class="legend-item"><div class="legend-line dashed"></div> Signal</div>
</div>

<script>
// ─── Data ───
const DATA = ${dataJson};

// ─── Config ───
const LAYER_COLORS = {
  L0: '#f59e0b', L1: '#ef4444', L2: '#6366f1', L3: '#10b981', L4: '#8b5cf6'
};
const LAYER_RADIUS = { L0: 0, L1: 110, L2: 220, L3: 320, L4: 410 };
const NODE_SIZES = { L0: 28, L1: 18, L2: 14, L3: 11, L4: 9 };

// ─── State ───
let nodes = [];
let cam = { x: 0, y: 0, zoom: 1 };
let drag = null;
let hoveredNode = null;
let selectedNode = null;
let activeFilters = new Set(['L0','L1','L2','L3','L4']);
let searchTerm = '';

// ─── Init ───
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;

function resize() {
  canvas.width = window.innerWidth * dpr;
  canvas.height = (window.innerHeight - 44) * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = (window.innerHeight - 44) + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

// ─── Layout: Concentric Rings ───
function layoutNodes() {
  const cx = window.innerWidth / 2;
  const cy = (window.innerHeight - 44) / 2;

  const byLayer = {};
  for (const n of DATA.nodes) {
    const l = n.layer || 'L3';
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(n);
  }

  nodes = [];
  for (const [layer, layerNodes] of Object.entries(byLayer)) {
    const r = LAYER_RADIUS[layer] || 350;
    const count = layerNodes.length;
    const angleStep = (2 * Math.PI) / Math.max(count, 1);
    const startAngle = -Math.PI / 2;

    layerNodes.forEach((n, i) => {
      const angle = startAngle + i * angleStep;
      nodes.push({
        ...n,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        r: NODE_SIZES[layer] || 12,
        color: LAYER_COLORS[layer] || '#6366f1',
        visible: true,
        highlighted: false,
      });
    });
  }
}

function getNode(id) { return nodes.find(n => n.id === id); }

// ─── Filtering ───
function applyFilters() {
  const term = searchTerm.toLowerCase();
  for (const n of nodes) {
    const layerMatch = activeFilters.has(n.layer);
    const searchMatch = !term || n.id.toLowerCase().includes(term) ||
      (n.description && n.description.toLowerCase().includes(term));
    n.visible = layerMatch && searchMatch;
  }
  draw();
}

// ─── Drawing ───
function screenX(x) { return (x + cam.x) * cam.zoom; }
function screenY(y) { return (y + cam.y) * cam.zoom; }

function draw() {
  const w = window.innerWidth;
  const h = window.innerHeight - 44;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.translate(cam.x * cam.zoom, cam.y * cam.zoom);
  ctx.scale(cam.zoom, cam.zoom);

  // Draw cross-ref edges
  for (const e of DATA.edges) {
    const src = getNode(e.source);
    const tgt = getNode(e.target);
    if (!src || !tgt || !src.visible || !tgt.visible) continue;

    const isHighlighted = hoveredNode &&
      (hoveredNode.id === e.source || hoveredNode.id === e.target);

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    // Quadratic bezier toward center for curvature
    const mx = (src.x + tgt.x) / 2;
    const my = (src.y + tgt.y) / 2;
    const cx2 = mx * 0.95 + w / 2 * 0.05;
    const cy2 = my * 0.95 + h / 2 * 0.05;
    ctx.quadraticCurveTo(cx2, cy2, tgt.x, tgt.y);
    ctx.strokeStyle = isHighlighted ? 'rgba(99,102,241,0.5)' : 'rgba(71,85,105,0.15)';
    ctx.lineWidth = isHighlighted ? 1.5 : 0.5;
    ctx.stroke();
  }

  // Draw signal edges (dashed)
  for (const e of DATA.signalEdges) {
    const src = getNode(e.source);
    const tgt = getNode(e.target);
    if (!src || !tgt || !src.visible || !tgt.visible) continue;

    const isHighlighted = hoveredNode &&
      (hoveredNode.id === e.source || hoveredNode.id === e.target);
    if (!isHighlighted) continue; // Only show signal edges on hover

    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = 'rgba(245,158,11,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw nodes
  for (const n of nodes) {
    if (!n.visible) continue;

    const isDimmed = hoveredNode && !n.highlighted && n.id !== hoveredNode.id;
    const alpha = isDimmed ? 0.15 : 1;
    const isSelected = selectedNode && selectedNode.id === n.id;

    // Glow for hovered/selected
    if ((n.id === hoveredNode?.id || isSelected) && !isDimmed) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 6, 0, Math.PI * 2);
      ctx.fillStyle = n.color + '22';
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.strokeStyle = isDimmed ? n.color + '33' : n.color;
    ctx.lineWidth = isSelected ? 3 : 1.5;
    ctx.stroke();
    ctx.globalAlpha = alpha;

    // Label
    ctx.fillStyle = isDimmed ? '#475569' : '#e2e8f0';
    ctx.font = (n.r >= 14 ? '10px' : '8px') + ' -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const label = n.id.replace('pack:', '');
    if (n.r >= 14) {
      ctx.fillText(label, n.x, n.y);
    } else {
      // Small nodes: label below
      ctx.fillText(label, n.x, n.y + n.r + 10);
    }

    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ─── Interaction ───
function worldPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / cam.zoom - cam.x,
    y: (e.clientY - rect.top) / cam.zoom - cam.y
  };
}

function hitTest(wx, wy) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n.visible) continue;
    const dx = wx - n.x, dy = wy - n.y;
    if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) return n;
  }
  return null;
}

function highlightConnected(node) {
  const connected = new Set();
  if (!node) { nodes.forEach(n => n.highlighted = false); return; }

  connected.add(node.id);
  for (const e of DATA.edges) {
    if (e.source === node.id) connected.add(e.target);
    if (e.target === node.id) connected.add(e.source);
  }
  for (const e of DATA.signalEdges) {
    if (e.source === node.id) connected.add(e.target);
    if (e.target === node.id) connected.add(e.source);
  }
  nodes.forEach(n => n.highlighted = connected.has(n.id));
}

canvas.addEventListener('mousemove', (e) => {
  if (drag) {
    cam.x += (e.clientX - drag.x) / cam.zoom;
    cam.y += (e.clientY - drag.y) / cam.zoom;
    drag = { x: e.clientX, y: e.clientY };
    draw();
    return;
  }

  const { x, y } = worldPos(e);
  const hit = hitTest(x, y);
  if (hit !== hoveredNode) {
    hoveredNode = hit;
    highlightConnected(hit);
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    draw();
  }
});

canvas.addEventListener('mousedown', (e) => {
  const { x, y } = worldPos(e);
  const hit = hitTest(x, y);
  if (hit) {
    selectedNode = hit;
    showDetail(hit);
    draw();
  } else {
    drag = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener('mouseup', () => { drag = null; });
canvas.addEventListener('mouseleave', () => {
  drag = null;
  hoveredNode = null;
  highlightConnected(null);
  draw();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  cam.zoom = Math.max(0.3, Math.min(3, cam.zoom * factor));
  draw();
}, { passive: false });

// ─── Detail Panel ───
const detailPanel = document.getElementById('detail');
const detailContent = document.getElementById('detail-content');

function showDetail(node) {
  const layerColor = LAYER_COLORS[node.layer] || '#6366f1';

  const connections = [];
  for (const e of DATA.edges) {
    if (e.source === node.id && getNode(e.target)) connections.push({ dir: '→', target: e.target });
    if (e.target === node.id && getNode(e.source)) connections.push({ dir: '←', target: e.source });
  }

  const signals = [];
  for (const e of DATA.signalEdges) {
    if (e.source === node.id) signals.push({ dir: 'emit', signal: e.signal, target: e.target });
    if (e.target === node.id) signals.push({ dir: 'listen', signal: e.signal, target: e.source });
  }

  let html = '<h2>' + esc(node.id.replace('pack:', '')) + '</h2>';
  html += '<span class="layer-badge" style="background:' + layerColor + '22;color:' + layerColor + '">' + node.layer + '</span>';
  if (node.description) html += '<p class="desc">' + esc(node.description) + '</p>';

  if (connections.length > 0) {
    html += '<h3>Connections (' + connections.length + ')</h3><ul class="conn-list">';
    for (const c of connections) {
      html += '<li onclick="focusNode(\\'' + esc(c.target) + '\\')">' + c.dir + ' ' + esc(c.target) + '</li>';
    }
    html += '</ul>';
  }

  if (signals.length > 0) {
    const uniqueSignals = [...new Set(signals.map(s => s.signal))];
    html += '<h3>Signals (' + uniqueSignals.length + ')</h3>';
    for (const sig of uniqueSignals) {
      html += '<span class="signal-tag">' + esc(sig) + '</span>';
    }
  }

  detailContent.innerHTML = html;
  detailPanel.classList.add('open');
}

document.getElementById('detail-close').addEventListener('click', () => {
  detailPanel.classList.remove('open');
  selectedNode = null;
  draw();
});

window.focusNode = function(id) {
  const n = getNode(id);
  if (!n) return;
  selectedNode = n;
  hoveredNode = n;
  highlightConnected(n);
  showDetail(n);
  draw();
};

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ─── Search & Filters ───
document.getElementById('search').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  applyFilters();
});

const filtersEl = document.getElementById('filters');
for (const [layer, color] of Object.entries(LAYER_COLORS)) {
  const btn = document.createElement('button');
  btn.className = 'filter-btn active';
  btn.style.setProperty('--btn-color', color);
  btn.textContent = layer;
  btn.addEventListener('click', () => {
    if (activeFilters.has(layer)) {
      activeFilters.delete(layer);
      btn.classList.remove('active');
    } else {
      activeFilters.add(layer);
      btn.classList.add('active');
    }
    applyFilters();
  });
  filtersEl.appendChild(btn);
}

// ─── Stats ───
document.getElementById('stats').textContent =
  DATA.stats.nodeCount + ' nodes · ' +
  DATA.stats.edgeCount + ' edges · ' +
  DATA.stats.signalCount + ' signals';

// ─── Boot ───
layoutNodes();
resize();
</script>
</body>
</html>`;
}

/** @deprecated Use generateNexusHTML */
export const generateMeshHTML = generateNexusHTML;
