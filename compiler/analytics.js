/**
 * Analytics Query Layer
 *
 * Reads .topia/metrics/ JSONL files and returns structured data
 * for the analytics dashboard. Pure JS — no external dependencies.
 *
 * Upgrade path: swap readJsonl() with DuckDB queries when data
 * volume exceeds ~1000 sessions (currently capped at 100).
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTopiaDir } from './lib/topia-paths.js';

// ─── File Readers ───

function readJsonl(content) {
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function loadMetrics(TopiaRoot) {
  const dir = path.join(resolveTopiaDir(TopiaRoot), 'metrics');
  const files = {
    sessions: path.join(dir, 'sessions.jsonl'),
    chains: path.join(dir, 'chains.jsonl'),
    skills: path.join(dir, 'skills.json'),
    tokens: path.join(dir, 'tokens.jsonl'),
    baseline: path.join(dir, 'baseline.json'),
  };

  let sessions = [];
  try {
    if (existsSync(files.sessions)) sessions = readJsonl(await readFile(files.sessions, 'utf-8'));
  } catch {
    /* file read error — use empty */
  }

  let chains = [];
  try {
    if (existsSync(files.chains)) chains = readJsonl(await readFile(files.chains, 'utf-8'));
  } catch {
    /* file read error — use empty */
  }

  let skillTotals = {};
  if (existsSync(files.skills)) {
    try {
      const raw = JSON.parse(await readFile(files.skills, 'utf-8'));
      skillTotals = raw.skills || {};
    } catch {
      /* corrupted — use empty */
    }
  }

  let toolTotals = {};
  const toolsFile = path.join(dir, 'tools.json');
  if (existsSync(toolsFile)) {
    try {
      const raw = JSON.parse(await readFile(toolsFile, 'utf-8'));
      toolTotals = raw.tools || {};
    } catch {
      /* corrupted — use empty */
    }
  }

  let tokenEvents = [];
  try {
    if (existsSync(files.tokens)) tokenEvents = readJsonl(await readFile(files.tokens, 'utf-8'));
  } catch {
    /* use empty */
  }

  let baseline = null;
  if (existsSync(files.baseline)) {
    try {
      baseline = JSON.parse(await readFile(files.baseline, 'utf-8'));
    } catch {
      /* ignore */
    }
  }

  return { sessions, chains, skillTotals, toolTotals, tokenEvents, baseline };
}

// ─── Date Filtering ───

function filterByDays(sessions, days) {
  if (!days || days <= 0) return sessions;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return sessions.filter((s) => s.date >= cutoffStr);
}

// ─── Query Functions ───

export async function getSessionOverview(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  if (filtered.length === 0) {
    return {
      total_sessions: 0,
      avg_duration_min: 0,
      total_tool_calls: 0,
      total_skill_invocations: 0,
      active_days: 0,
    };
  }

  const totalDuration = filtered.reduce((sum, s) => sum + (s.duration_min || 0), 0);
  const totalTools = filtered.reduce((sum, s) => sum + (s.tool_calls || 0), 0);
  const totalSkills = filtered.reduce((sum, s) => sum + (s.skill_invocations || 0), 0);
  const uniqueDays = new Set(filtered.map((s) => s.date)).size;

  return {
    total_sessions: filtered.length,
    avg_duration_min: Math.round(totalDuration / filtered.length),
    total_tool_calls: totalTools,
    total_skill_invocations: totalSkills,
    active_days: uniqueDays,
  };
}

export async function getSkillFrequency(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  const counts = {};
  for (const session of filtered) {
    if (!session.skills_used) continue;
    for (const skill of session.skills_used) {
      counts[skill] = (counts[skill] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([skill, sessions_count]) => ({ skill, sessions_count }))
    .sort((a, b) => b.sessions_count - a.sessions_count);
}

export async function getModelDistribution(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  const models = {};
  for (const session of filtered) {
    if (!session.models_used) continue;
    for (const [model, count] of Object.entries(session.models_used)) {
      models[model] = (models[model] || 0) + count;
    }
  }

  return Object.entries(models)
    .map(([model, skill_count]) => ({ model, skill_count }))
    .sort((a, b) => b.skill_count - a.skill_count);
}

export async function getSessionTrend(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  const byDate = {};
  for (const session of filtered) {
    const date = session.date;
    if (!byDate[date]) {
      byDate[date] = { date, sessions: 0, duration_min: 0, skill_invocations: 0, tool_calls: 0 };
    }
    byDate[date].sessions += 1;
    byDate[date].duration_min += session.duration_min || 0;
    byDate[date].skill_invocations += session.skill_invocations || 0;
    byDate[date].tool_calls += session.tool_calls || 0;
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getSkillChains(TopiaRoot, days = 30) {
  const { chains, sessions } = await loadMetrics(TopiaRoot);

  // Filter chains by matching session dates
  const sessionDates = new Map();
  for (const s of sessions) {
    sessionDates.set(s.id, s.date);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 9999));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filtered = chains.filter((c) => {
    if (!c.session || !Array.isArray(c.chain)) return false;
    const date = sessionDates.get(c.session);
    // Drop orphaned chains (session rotated out) — only include known sessions in range
    return date !== undefined && date >= cutoffStr;
  });

  // Count unique chain patterns (normalize to string key)
  const patterns = {};
  for (const chain of filtered) {
    const key = chain.chain.join(' → ');
    patterns[key] = (patterns[key] || 0) + 1;
  }

  return Object.entries(patterns)
    .map(([chain, count]) => ({ chain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export async function getToolTokenDistribution(TopiaRoot, days = 30) {
  const { toolTotals } = await loadMetrics(TopiaRoot);

  return Object.entries(toolTotals)
    .map(([tool, stats]) => ({
      tool,
      invocations: stats.total_invocations || 0,
      estimated_tokens: stats.estimated_tokens_total || 0,
      sessions: stats.sessions || 0,
      last_used: stats.last_used || null,
    }))
    .sort((a, b) => b.estimated_tokens - a.estimated_tokens);
}

export async function getExpensiveSessions(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  const peaks = filtered.map((s) => s.tokens?.context_peak).filter((p) => typeof p === 'number');
  const p90 =
    peaks.length > 0 ? (peaks.sort((a, b) => a - b)[Math.floor(peaks.length * 0.9)] ?? peaks[peaks.length - 1]) : 90000;

  return filtered
    .filter(
      (s) =>
        s.expensive_session === true ||
        (s.tokens?.compactions || 0) >= 2 ||
        (typeof s.tokens?.context_peak === 'number' && s.tokens.context_peak >= p90),
    )
    .map((s) => ({
      id: s.id,
      date: s.date,
      platform: s.platform,
      tool_calls: s.tool_calls,
      compactions: s.tokens?.compactions || 0,
      context_peak: s.tokens?.context_peak ?? null,
      pressure_level: s.pressure_level || 'unknown',
      primary_skill: s.primary_skill,
    }))
    .sort((a, b) => (b.context_peak || 0) - (a.context_peak || 0))
    .slice(0, 20);
}

export async function getToolDistribution(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  const tools = {};
  for (const session of filtered) {
    if (!session.tool_distribution) continue;
    for (const [tool, count] of Object.entries(session.tool_distribution)) {
      tools[tool] = (tools[tool] || 0) + count;
    }
  }

  return Object.entries(tools)
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── Skill Heatmap (per-day per-skill matrix) ───

export async function getSkillHeatmap(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  // Build matrix: { date → { skill → count } }
  const matrix = {};
  const allSkills = new Set();

  for (const session of filtered) {
    const date = session.date;
    if (!session.skills_used) continue;
    if (!matrix[date]) matrix[date] = {};
    for (const skill of session.skills_used) {
      matrix[date][skill] = (matrix[date][skill] || 0) + 1;
      allSkills.add(skill);
    }
  }

  // Sort dates, get top skills by total frequency
  const dates = Object.keys(matrix).sort();
  const skillTotals = {};
  for (const date of dates) {
    for (const [skill, count] of Object.entries(matrix[date])) {
      skillTotals[skill] = (skillTotals[skill] || 0) + count;
    }
  }

  const topSkills = Object.entries(skillTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([skill]) => skill);

  // Build heatmap grid: [ { skill, days: [ { date, count } ] } ]
  const heatmap = topSkills.map((skill) => ({
    skill,
    total: skillTotals[skill],
    days: dates.map((date) => ({
      date,
      count: matrix[date][skill] || 0,
    })),
  }));

  return { heatmap, dates, maxCount: Math.max(1, ...heatmap.flatMap((h) => h.days.map((d) => d.count))) };
}

// ─── Session Timeline (skill sequence for last N sessions) ───

export async function getSessionTimeline(TopiaRoot, days = 30, limit = 5) {
  const { sessions, chains } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.duration_min || 0) - (a.duration_min || 0))
    .slice(0, limit);

  // Map session IDs to their chains
  const sessionChains = {};
  for (const chain of chains) {
    if (!chain.session || !Array.isArray(chain.chain)) continue;
    if (!sessionChains[chain.session]) sessionChains[chain.session] = [];
    sessionChains[chain.session].push(chain.chain);
  }

  return filtered.map((session) => ({
    id: session.id,
    date: session.date,
    duration_min: session.duration_min || 0,
    tool_calls: session.tool_calls || 0,
    skills_used: session.skills_used || [],
    primary_skill: session.primary_skill || (session.skills_used || [])[0] || 'unknown',
    chains: (sessionChains[session.id] || []).slice(0, 5),
  }));
}

// ─── Topia Nexus (connections from skill frequency) ───

export async function getSkillNexus(TopiaRoot, days = 30) {
  const { sessions, chains } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  // Node sizes from frequency
  const freq = {};
  for (const session of filtered) {
    if (!session.skills_used) continue;
    for (const skill of session.skills_used) {
      freq[skill] = (freq[skill] || 0) + 1;
    }
  }

  const nodes = Object.entries(freq)
    .map(([skill, count]) => ({ id: skill, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const nodeSet = new Set(nodes.map((n) => n.id));

  // Edges from co-occurrence in sessions
  const edgeMap = {};
  for (const session of filtered) {
    if (!session.skills_used || session.skills_used.length < 2) continue;
    const skills = session.skills_used.filter((s) => nodeSet.has(s));
    for (let i = 0; i < skills.length; i++) {
      for (let j = i + 1; j < skills.length; j++) {
        const key = [skills[i], skills[j]].sort().join('::');
        edgeMap[key] = (edgeMap[key] || 0) + 1;
      }
    }
  }

  // Also add chain-based edges (sequential connection = stronger signal)
  const sessionDates = new Map(sessions.map((s) => [s.id, s.date]));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 9999));
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const chain of chains) {
    if (!chain.session || !Array.isArray(chain.chain)) continue;
    const date = sessionDates.get(chain.session);
    if (date === undefined || date < cutoffStr) continue;
    const skills = chain.chain.filter((s) => nodeSet.has(s));
    for (let i = 0; i < skills.length - 1; i++) {
      const key = [skills[i], skills[i + 1]].sort().join('::');
      edgeMap[key] = (edgeMap[key] || 0) + 2; // Chain edges weighted 2x
    }
  }

  const edges = Object.entries(edgeMap)
    .map(([key, weight]) => {
      const [source, target] = key.split('::');
      return { source, target, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 40);

  return { nodes, edges, maxCount: Math.max(1, ...nodes.map((n) => n.count)) };
}

/** @deprecated Use getSkillNexus */
export const getSkillMesh = getSkillNexus;

// ─── Token Analytics ───

function sessionsWithTokens(sessions) {
  return sessions.filter((s) => s.tokens && s.tokens.confidence !== 'none');
}

export async function getTokenOverview(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);
  const withTokens = sessionsWithTokens(filtered);

  if (withTokens.length === 0) {
    return {
      sessions_with_token_data: 0,
      avg_context_peak: null,
      avg_estimated_tokens: 0,
      avg_compactions: 0,
      total_estimated_tokens: 0,
      platform_split: {},
    };
  }

  let peakSum = 0;
  let peakCount = 0;
  let estimatedSum = 0;
  let compactionSum = 0;
  const platformSplit = {};

  for (const s of withTokens) {
    const t = s.tokens;
    if (typeof t.context_peak === 'number') {
      peakSum += t.context_peak;
      peakCount += 1;
    }
    estimatedSum += t.total_estimated || 0;
    compactionSum += t.compactions || 0;

    const plat = s.platform || 'unknown';
    if (!platformSplit[plat]) {
      platformSplit[plat] = { sessions: 0, estimated_tokens: 0, context_peak_sum: 0, context_peak_count: 0 };
    }
    platformSplit[plat].sessions += 1;
    platformSplit[plat].estimated_tokens += t.total_estimated || 0;
    if (typeof t.context_peak === 'number') {
      platformSplit[plat].context_peak_sum += t.context_peak;
      platformSplit[plat].context_peak_count += 1;
    }
  }

  return {
    sessions_with_token_data: withTokens.length,
    avg_context_peak: peakCount > 0 ? Math.round(peakSum / peakCount) : null,
    avg_estimated_tokens: Math.round(estimatedSum / withTokens.length),
    avg_compactions: Math.round((compactionSum / withTokens.length) * 10) / 10,
    total_estimated_tokens: estimatedSum,
    platform_split: platformSplit,
  };
}

export async function getTokenTrend(TopiaRoot, days = 30) {
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);
  const byDate = {};

  for (const s of filtered) {
    if (!s.tokens || s.tokens.confidence === 'none') continue;
    const date = s.date;
    if (!byDate[date]) {
      byDate[date] = {
        date,
        sessions: 0,
        context_peak_sum: 0,
        context_peak_count: 0,
        estimated_tokens: 0,
      };
    }
    byDate[date].sessions += 1;
    byDate[date].estimated_tokens += s.tokens.total_estimated || 0;
    if (typeof s.tokens.context_peak === 'number') {
      byDate[date].context_peak_sum += s.tokens.context_peak;
      byDate[date].context_peak_count += 1;
    }
  }

  return Object.values(byDate)
    .map((d) => ({
      date: d.date,
      sessions: d.sessions,
      avg_context_peak: d.context_peak_count > 0 ? Math.round(d.context_peak_sum / d.context_peak_count) : null,
      estimated_tokens: d.estimated_tokens,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getPlatformComparison(TopiaRoot, days = 30) {
  const overview = await getTokenOverview(TopiaRoot, days);
  const { sessions } = await loadMetrics(TopiaRoot);
  const filtered = filterByDays(sessions, days);

  const counts = { cursor: 0, claude: 0, unknown: 0 };
  for (const s of filtered) {
    const p = s.platform === 'cursor' ? 'cursor' : s.platform === 'claude' ? 'claude' : 'unknown';
    counts[p] += 1;
  }

  return {
    session_counts: counts,
    token_stats: overview.platform_split,
  };
}

export async function getSavingsVsBaseline(TopiaRoot) {
  const { baseline, sessions } = await loadMetrics(TopiaRoot);
  if (!baseline || baseline.without_topia_avg_tokens == null) {
    return { has_baseline: false };
  }

  const recent = sessions.filter((s) => s.tokens?.total_estimated).slice(-10);
  if (recent.length === 0) {
    return { has_baseline: true, baseline, recent_avg: null, delta_percent: null };
  }

  const recentAvg = Math.round(recent.reduce((sum, s) => sum + (s.tokens.total_estimated || 0), 0) / recent.length);
  const baselineVal = baseline.without_topia_avg_tokens;
  const deltaPercent = baselineVal > 0 ? Math.round(((baselineVal - recentAvg) / baselineVal) * 1000) / 10 : null;

  return {
    has_baseline: true,
    baseline,
    recent_avg: recentAvg,
    delta_percent: deltaPercent,
    saving: deltaPercent != null ? deltaPercent > 0 : null,
  };
}

// ─── All Queries ───

export async function getAllAnalytics(TopiaRoot, days = 30) {
  const [
    overview,
    skillFrequency,
    modelDistribution,
    sessionTrend,
    skillChains,
    toolDistribution,
    toolTokenDistribution,
    expensiveSessions,
    skillHeatmap,
    sessionTimeline,
    skillNexus,
    tokenOverview,
    tokenTrend,
    platformComparison,
    savingsVsBaseline,
  ] = await Promise.all([
    getSessionOverview(TopiaRoot, days),
    getSkillFrequency(TopiaRoot, days),
    getModelDistribution(TopiaRoot, days),
    getSessionTrend(TopiaRoot, days),
    getSkillChains(TopiaRoot, days),
    getToolDistribution(TopiaRoot, days),
    getToolTokenDistribution(TopiaRoot, days),
    getExpensiveSessions(TopiaRoot, days),
    getSkillHeatmap(TopiaRoot, days),
    getSessionTimeline(TopiaRoot, days, 5),
    getSkillNexus(TopiaRoot, days),
    getTokenOverview(TopiaRoot, days),
    getTokenTrend(TopiaRoot, days),
    getPlatformComparison(TopiaRoot, days),
    getSavingsVsBaseline(TopiaRoot),
  ]);

  return {
    overview,
    skillFrequency,
    modelDistribution,
    sessionTrend,
    skillChains,
    toolDistribution,
    toolTokenDistribution,
    expensiveSessions,
    skillHeatmap,
    sessionTimeline,
    skillNexus,
    skillMesh: skillNexus, // deprecated v1 alias
    tokenOverview,
    tokenTrend,
    platformComparison,
    savingsVsBaseline,
    generated: new Date().toISOString(),
    days,
  };
}
