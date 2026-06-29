/**
 * Status — Project Neofetch
 *
 * Shows a rich boxed dashboard of the current Topia project.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkNexusIntegrity } from './doctor.js';
import { LAYER_EMOJI, NEXUS_STATS } from './nexus-constants.js';
import { parseSkill } from './parser.js';

// ─── Box Drawing ───

function box(lines, { title = '', width = 52 } = {}) {
  const inner = width - 2;
  const output = [];

  const titleStr = title ? ` ${title} ` : '';
  const topFill = inner - titleStr.length - 1;
  output.push(`╭─${titleStr}${'─'.repeat(Math.max(topFill, 0))}╮`);

  for (const line of lines) {
    const dw = displayWidth(line);
    const pad = inner - dw;
    output.push(`│ ${line}${' '.repeat(Math.max(pad, 0))}│`);
  }

  output.push(`╰${'─'.repeat(inner + 1)}╯`);
  return output.join('\n');
}

function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (
      code > 0x1f600 ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x2700 && code <= 0x27bf) ||
      code === 0x2713 ||
      code === 0x2717 ||
      code === 0x2192 ||
      code === 0x2593 ||
      code === 0x2591
    ) {
      w += 1;
    } else if (code > 0xffff) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

// ─── Memory health (agora-code MCP) ───

function readMcpConfigs(projectRoot) {
  const paths = [
    path.join(projectRoot, '.cursor', 'mcp.json'),
    path.join(projectRoot, '.mcp.json'),
    path.join(os.homedir(), '.cursor', 'mcp.json'),
  ];
  const texts = [];
  for (const configPath of paths) {
    if (!existsSync(configPath)) continue;
    try { texts.push(readFileSync(configPath, 'utf-8')); } catch { }
  }
  return texts.join('\n');
}

export function detectMemoryHealth(projectRoot) {
  const raw = readMcpConfigs(projectRoot);
  const hasAgora = /agora[-_]?code|"agora-memory"/i.test(raw);
  const hasNmem = /neural-memory/i.test(raw);
  if (hasAgora && hasNmem) return { status: 'active', detail: 'agora-memory + neural-memory registered' };
  if (hasAgora) return { status: 'active', detail: 'agora-memory registered' };
  if (hasNmem) return { status: 'active', detail: 'neural-memory registered' };
  return { status: 'inactive', detail: 'file-based .topia/ only (no memory MCP)' };
}

// ─── Data Collection ───

export async function collectStats(TopiaRoot) {
  const skillsDir = path.join(TopiaRoot, 'skills');
  const extDir = path.join(TopiaRoot, 'extensions');

  const layers = { L0: 0, L1: 0, L2: 0, L3: 0 };
  const skillNames = [];
  let pulseCount = 0;
  const pulseMap = { emitters: {}, listeners: {} };
  const parsedSkills = [];

  if (existsSync(skillsDir)) {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const content = await readFile(skillFile, 'utf-8');
      const parsed = parseSkill(content, skillFile);
      parsedSkills.push(parsed);
      skillNames.push(parsed.name);

      const layer = parsed.layer || 'L3';
      if (layers[layer] !== undefined) layers[layer]++;

      if (parsed.signals?.emit && parsed.signals?.listen) {
        for (const sig of parsed.signals.emit) {
          if (!pulseMap.emitters[sig]) pulseMap.emitters[sig] = [];
          pulseMap.emitters[sig].push(parsed.name);
        }
        for (const sig of parsed.signals.listen) {
          if (!pulseMap.listeners[sig]) pulseMap.listeners[sig] = [];
          pulseMap.listeners[sig].push(parsed.name);
        }
      }
    }
    const allPulses = new Set([...Object.keys(pulseMap.emitters), ...Object.keys(pulseMap.listeners)]);
    pulseCount = allPulses.size;
  }

  // Synapse count comes from the SAME computation as `topia doctor`
  // (sum of `## Calls` edges) so status and doctor never report different numbers.
  // Fall back to the local unique-crossref count only if the nexus check fails.
  let totalSynapses;
  try {
    const nexus = await checkNexusIntegrity(TopiaRoot);
    totalSynapses = nexus.stats.synapses;
  } catch {
    totalSynapses = 0;
    for (const skill of parsedSkills) {
      totalSynapses += new Set((skill.crossRefs ?? []).map((r) => r.skillName)).size;
    }
  }
  const avgSynapses = parsedSkills.length > 0 ? (totalSynapses / parsedSkills.length).toFixed(1) : '0';
  const nexusDensity = parsedSkills.length > 0 ? (totalSynapses / parsedSkills.length).toFixed(2) : '0';

  const packs = [];
  if (existsSync(extDir)) {
    const entries = await readdir(extDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packFile = path.join(extDir, entry.name, 'PACK.md');
      if (!existsSync(packFile)) continue;

      const packDir = path.join(extDir, entry.name);
      let lines = 0;
      const subEntries = await readdir(packDir, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isFile() && sub.name.endsWith('.md')) {
          const content = await readFile(path.join(packDir, sub.name), 'utf-8');
          lines += content.split('\n').length;
        }
      }
      packs.push({ name: entry.name, lines });
    }
  }

  return {
    skillCount: parsedSkills.length,
    layers,
    pulseCount,
    pulseMap,
    totalSynapses,
    avgSynapses,
    nexusDensity,
    packs,
    parsedSkills,
    // deprecated v1 aliases
    signalCount: pulseCount,
    signalMap: pulseMap,
    totalConnections: totalSynapses,
    avgConnections: avgSynapses,
  };
}

// ─── Rendering ───

function fmtNum(n) {
  return n.toLocaleString('en-US');
}

export function renderStatus(stats, { version = '', platform = '', projectName = '', memoryHealth = null } = {}) {
  const lines = [];

  lines.push('');

  if (projectName) lines.push(`Project     ${projectName}`);
  if (platform) lines.push(`Platform    ${platform}`);
  if (version) lines.push(`Version     ${version}`);
  if (projectName || platform || version) lines.push('');

  const layerStr = Object.entries(stats.layers)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${LAYER_EMOJI[k] || ''} ${k}:${v}`.trim())
    .join('  ');
  lines.push(`Skills      ${stats.skillCount} core`);
  if (layerStr) lines.push(`  ${layerStr}`);
  lines.push('');

  lines.push(`Packs       ${stats.packs.length} installed`);
  lines.push(`Pulses      ${stats.pulseCount} defined`);
  lines.push(
    `Nexus       ${stats.totalSynapses}+ synapses (${stats.avgSynapses} avg/skill, density ${stats.nexusDensity})`,
  );
  lines.push(`            target: ${NEXUS_STATS.synapses} synapses · ${NEXUS_STATS.pulses} pulses`);
  lines.push('');

  if (memoryHealth) {
    const memIcon = memoryHealth.status === 'active' ? '✓' : '–';
    lines.push(`Memory      [${memIcon}] ${memoryHealth.detail}`);
    lines.push('');
  }

  const healthScore = computeHealth(stats);
  lines.push(`${progressBar(healthScore)} ${healthScore}% nexus health`);
  lines.push('');

  if (stats.packs.length > 0) {
    lines.push('Extension Packs');
    for (const pack of stats.packs) {
      lines.push(`  ✓ ${formatPackName(pack.name)}  ${fmtNum(pack.lines)} lines`);
    }
    lines.push('');
  }

  const topPulses = getTopPulses(stats.pulseMap, 3);
  if (topPulses.length > 0) {
    lines.push('Active Pulses');
    for (const sig of topPulses) {
      const emitters = sig.emitters.slice(0, 2).join(', ');
      const listeners = sig.listeners.slice(0, 3).join(', ');
      let sigLine = `  → ${sig.name} (${emitters} → ${listeners})`;
      if (sigLine.length > 64) sigLine = `${sigLine.slice(0, 61)}...`;
      lines.push(sigLine);
    }
    lines.push('');
  }

  const title = `🔮 Topia`;
  const maxLineLen = lines.reduce((max, l) => Math.max(max, displayWidth(l)), 48);
  const boxWidth = Math.min(Math.max(maxLineLen + 4, 52), 72);

  return box(lines, { title, width: boxWidth });
}

export function renderStatusJson(stats, { version = '', platform = '', projectName = '', memoryHealth = null } = {}) {
  return JSON.stringify(
    {
      project: projectName || undefined,
      platform: platform || undefined,
      version: version || undefined,
      skills: {
        total: stats.skillCount,
        layers: stats.layers,
      },
      packs: stats.packs.map((p) => ({ name: p.name, lines: p.lines })),
      pulses: {
        count: stats.pulseCount,
        top: getTopPulses(stats.pulseMap, 5).map((s) => ({
          name: s.name,
          emitters: s.emitters,
          listeners: s.listeners,
        })),
      },
      nexus: {
        synapses: stats.totalSynapses,
        avgPerSkill: parseFloat(stats.avgSynapses),
        density: parseFloat(stats.nexusDensity),
      },
      memory: memoryHealth || undefined,
      health: computeHealth(stats),
      // deprecated v1 keys (one release)
      signals: {
        count: stats.pulseCount,
        top: getTopPulses(stats.pulseMap, 5).map((s) => ({
          name: s.name,
          emitters: s.emitters,
          listeners: s.listeners,
        })),
      },
      mesh: {
        connections: stats.totalSynapses,
        avgPerSkill: parseFloat(stats.avgSynapses),
      },
    },
    null,
    2,
  );
}

function formatPackName(dirName) {
  return `@Topia/${dirName}`.padEnd(26);
}

function getTopPulses(pulseMap, limit) {
  const pulses = new Set([...Object.keys(pulseMap.emitters), ...Object.keys(pulseMap.listeners)]);

  const scored = [...pulses].map((name) => ({
    name,
    emitters: pulseMap.emitters[name] || [],
    listeners: pulseMap.listeners[name] || [],
    score: (pulseMap.emitters[name]?.length || 0) + (pulseMap.listeners[name]?.length || 0),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function computeHealth(stats) {
  let score = 0;

  score += Math.min(stats.skillCount / 60, 1) * 25;
  score += Math.min(stats.pulseCount / 15, 1) * 25;

  const avgSyn = parseFloat(stats.avgSynapses);
  score += Math.min(avgSyn / 3.5, 1) * 25;

  const totalPacks = stats.packs.length;
  score += Math.min(totalPacks / 14, 1) * 25;

  return Math.round(score);
}
