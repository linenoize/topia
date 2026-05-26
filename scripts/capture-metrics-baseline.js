#!/usr/bin/env node

/**
 * capture-metrics-baseline.js — Summarize .topia/metrics for context lifecycle baseline.
 *
 * Run after several Claude Code sessions with Topia hooks enabled:
 *   node scripts/capture-metrics-baseline.js
 *   node scripts/capture-metrics-baseline.js --json --days 30
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  getAllAnalytics,
  getExpensiveSessions,
  getTokenOverview,
} from '../compiler/analytics.js';
import { resolveTopiaDir } from '../compiler/lib/topia-paths.js';

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: process.cwd() },
      days: { type: 'string', default: '30' },
      json: { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
    },
  });

  const root = values.root;
  const days = Number.parseInt(values.days, 10) || 30;
  const topiaDir = resolveTopiaDir(root);

  const [analytics, tokenOverview, expensive] = await Promise.all([
    getAllAnalytics(root, days),
    getTokenOverview(root, days),
    getExpensiveSessions(root, days),
  ]);

  const baseline = {
    captured_at: new Date().toISOString(),
    days,
    topia_dir: topiaDir,
    sessions: analytics.overview.total_sessions,
    avg_tool_calls: analytics.overview.total_sessions
      ? Math.round(analytics.overview.total_tool_calls / analytics.overview.total_sessions)
      : 0,
    avg_compactions: tokenOverview.avg_compactions,
    avg_context_peak: tokenOverview.avg_context_peak,
    top_skills: analytics.skillFrequency.slice(0, 10),
    top_tools_by_tokens: analytics.toolTokenDistribution.slice(0, 10),
    expensive_sessions: expensive,
    recommendation:
      expensive.length > 0
        ? 'Investigate expensive sessions: enable context-lifecycle at phase boundaries; compact after push.'
        : 'Insufficient data or healthy sessions — run more build/team sessions with hooks.',
  };

  if (values.write) {
    const outPath = path.join(topiaDir, 'metrics', 'context-baseline.json');
    await writeFile(outPath, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(`Wrote ${outPath}\n`);
  }

  if (values.json) {
    process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Topia context baseline (${days}d)\n`);
  process.stdout.write(`  Sessions: ${baseline.sessions}\n`);
  process.stdout.write(`  Avg tool calls/session: ${baseline.avg_tool_calls}\n`);
  process.stdout.write(`  Avg compactions/session: ${baseline.avg_compactions}\n`);
  process.stdout.write(`  Avg context peak: ${baseline.avg_context_peak ?? 'n/a'}\n`);
  process.stdout.write(`  Expensive sessions: ${expensive.length}\n`);
  if (baseline.top_tools_by_tokens.length > 0) {
    process.stdout.write('  Top tools (est. tokens):\n');
    for (const t of baseline.top_tools_by_tokens.slice(0, 5)) {
      process.stdout.write(`    - ${t.tool}: ${t.estimated_tokens} (${t.invocations} calls)\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`capture-metrics-baseline: ${err.message}\n`);
  process.exit(1);
});
