/**
 * One row per session in .topia/metrics/sessions.jsonl and chains.jsonl.
 *
 * The flush runs on Claude Code's Stop hook, which fires at the end of every
 * TURN, not once per session. Appending a row per Stop turned one session into
 * dozens of rows that each repeated the cumulative tool count and duration, and
 * scattered its skills across rows. These helpers upsert by session id instead,
 * merging the per-turn skill counts and token estimates into the session's row.
 */
'use strict';

const fs = require('fs');
const { pressureFromPercent } = require('./transcript-meter.cjs');

const SEVERITY = ['green', 'yellow', 'orange', 'red'];

function worstPressure(a, b) {
  return SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a || b;
}

function sumCounts(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = (out[k] || 0) + (v || 0);
  return out;
}

/**
 * Session pressure. Measured context wins whenever its window is known; the
 * tool-call count is a proxy (context-engine: "directional, not precise") and
 * is reported with `pressure_source: 'tool_count'` so readers can tell.
 */
function sessionPressure(tokens = {}, toolCountLevel = 'green') {
  const measured = pressureFromPercent(tokens.context_peak_percent);
  if (measured) return { pressure_level: measured, pressure_source: 'context' };
  return { pressure_level: toolCountLevel || 'green', pressure_source: 'tool_count' };
}

function mergeToolIo(a, b) {
  if (!a && !b) return undefined;
  const out = {};
  for (const src of [a || {}, b || {}]) {
    for (const [tool, s] of Object.entries(src)) {
      if (!out[tool]) out[tool] = { invocations: 0, estimated_tokens: 0 };
      out[tool].invocations += s.invocations || 0;
      out[tool].estimated_tokens += s.estimated_tokens || 0;
    }
  }
  return out;
}

function mergeConfidence(a, b) {
  const set = new Set([a, b].filter((c) => c && c !== 'none'));
  if (set.has('mixed') || (set.has('measured') && set.has('estimated'))) return 'mixed';
  return set.values().next().value || 'none';
}

function mergeTokens(prev = {}, next = {}) {
  const sum = (k) => (prev[k] || 0) + (next[k] || 0);
  const prevPeak = typeof prev.context_peak === 'number' ? prev.context_peak : null;
  const nextPeak = typeof next.context_peak === 'number' ? next.context_peak : null;
  const peakFrom = nextPeak != null && (prevPeak == null || nextPeak >= prevPeak) ? next : prev;
  return {
    context_peak: peakFrom.context_peak ?? null,
    context_peak_percent: peakFrom.context_peak_percent ?? null,
    context_window_size: peakFrom.context_window_size ?? next.context_window_size ?? prev.context_window_size ?? null,
    estimated_io: sum('estimated_io'),
    estimated_skills: sum('estimated_skills'),
    estimated_agent_response: sum('estimated_agent_response'),
    compactions: sum('compactions'),
    checkpoints_written: sum('checkpoints_written'),
    tool_io_by_tool: mergeToolIo(prev.tool_io_by_tool, next.tool_io_by_tool),
    total_estimated: sum('total_estimated'),
    confidence: mergeConfidence(prev.confidence, next.confidence),
  };
}

/**
 * Fold a turn's row into the session's existing row.
 * Tool calls and duration come from a counter that SessionStart resets after
 * /compact, so they take the larger value (a lower bound, never inflated).
 */
function mergeSessionEntry(prev, next) {
  const skillCounts = sumCounts(prev.skill_counts, next.skill_counts);
  const viaCounts = sumCounts(prev.skill_via, next.skill_via);
  const tokens = mergeTokens(prev.tokens, next.tokens);
  const primary = Object.entries(skillCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';
  const toolCountLevel = worstPressure(prev.tool_count_pressure, next.tool_count_pressure);
  const usePrevTools = (prev.tool_calls || 0) > (next.tool_calls || 0);
  return {
    ...prev,
    ...next,
    date: prev.date || next.date,
    started: prev.started || next.started,
    turns: (prev.turns || 1) + (next.turns || 1),
    duration_min: Math.max(prev.duration_min || 0, next.duration_min || 0),
    tool_calls: Math.max(prev.tool_calls || 0, next.tool_calls || 0),
    tool_distribution: usePrevTools ? prev.tool_distribution : next.tool_distribution,
    tool_count_pressure: toolCountLevel,
    ...sessionPressure(tokens, toolCountLevel),
    skill_invocations: (prev.skill_invocations || 0) + (next.skill_invocations || 0),
    skill_counts: skillCounts,
    skill_via: viaCounts,
    skills_used: Object.keys(skillCounts),
    primary_skill: primary,
    models_used: sumCounts(prev.models_used, next.models_used),
    skill_durations:
      prev.skill_durations || next.skill_durations
        ? sumCounts(prev.skill_durations, next.skill_durations)
        : undefined,
    tokens,
    expensive_session:
      (tokens.compactions || 0) >= 2 || (typeof tokens.context_peak === 'number' && tokens.context_peak >= 90000),
  };
}

function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Replace the row whose `key` matches entry's (merged via `merge`), or append.
 * Keeps at most `cap` rows. The updated row moves to the end (most recent).
 * @returns {object} the row written
 */
function upsertJsonl(file, entry, { key = 'id', merge, cap = 100 } = {}) {
  const rows = readJsonl(file);
  let written = entry;
  let idx = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i] && rows[i][key] === entry[key]) {
      idx = i;
      break;
    }
  }
  if (idx !== -1) {
    written = merge ? merge(rows[idx], entry) : entry;
    rows.splice(idx, 1);
  }
  rows.push(written);
  const kept = cap > 0 ? rows.slice(-cap) : rows;
  fs.writeFileSync(file, `${kept.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return written;
}

function mergeChain(prev, next) {
  const chain = [...(prev.chain || []), ...(next.chain || [])];
  return { ...prev, ...next, chain, depth: chain.length };
}

module.exports = {
  sessionPressure,
  mergeTokens,
  mergeSessionEntry,
  mergeChain,
  upsertJsonl,
  readJsonl,
};
