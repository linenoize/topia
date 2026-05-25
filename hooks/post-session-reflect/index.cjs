// Topia Post-Session Reflect Hook
// 1. Flushes session metrics from tmpdir to .topia/metrics/ (H3 Intelligence)
// 2. Displays structured self-review checklist at session end (Stop / sessionEnd)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isCursorRuntime, writeHookResponse, readStdinJson } = require('../lib/cursor-io.cjs');
const { topiaDirForWrite } = require('../lib/topia-paths.cjs');
const { readEvents, clearEvents } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, normalizeSessionTokens } = require('../lib/token-meter.cjs');

const hookLines = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  hookLines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
};

const cwd = process.cwd();
const hash = Buffer.from(cwd).toString('base64url').slice(0, 16);
const counterFile = path.join(os.tmpdir(), `Topia-context-watch-${hash}.json`);
const TopiaMetricsDir = path.join(topiaDirForWrite(cwd), 'metrics');

function resolveSkillModels(skillCounts) {
  const models = {};
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
  const agentsDir = path.join(pluginRoot, 'agents');

  if (!fs.existsSync(agentsDir)) return models;

  for (const [skill, count] of Object.entries(skillCounts)) {
    try {
      const agentFile = path.join(agentsDir, `${skill}.md`);
      if (!fs.existsSync(agentFile)) continue;
      const content = fs.readFileSync(agentFile, 'utf-8');
      const match = content.match(/^model:\s*(\w+)/m);
      if (match) {
        const model = match[1];
        models[model] = (models[model] || 0) + count;
      }
    } catch {
      /* best-effort */
    }
  }
  return models;
}

async function run() {
  let hookData = {};
  try {
    hookData = await readStdinJson();
  } catch {
    /* Stop may have empty stdin on Claude */
  }

  try {
    flushMetrics(hookData);
  } catch {
    /* best-effort */
  }

  console.log(`
┌─────────────────────────────────────────────────────┐
│  Topia Session End — Verification Checklist          │
├─────────────────────────────────────────────────────┤
│  Before closing this session, confirm:              │
│                                                     │
│  □ All TodoWrite tasks marked complete?             │
│  □ Tests ran and passing?                           │
│  □ No hardcoded secrets introduced?                 │
│  □ If schema changed: migration + rollback exist?   │
│  □ Verification ran (lint + types + build)?         │
│                                                     │
│  If any item is unclear → address it now.           │
└─────────────────────────────────────────────────────┘
`);

  const stopText = hookLines.join('\n').trim();
  if (isCursorRuntime(hookData)) {
    writeHookResponse(stopText ? { additional_context: stopText } : {});
  } else {
    for (const line of hookLines) origLog(line);
  }
}

function flushMetrics(hookData) {
  const allEvents = readEvents(cwd);
  const skillEvents = allEvents.filter((e) => e.event === 'invoke' || (e.skill && !e.event));

  let watchState = { count: 0, sessionStart: null, sessionId: null, toolCounts: {} };
  if (fs.existsSync(counterFile)) {
    try {
      watchState = JSON.parse(fs.readFileSync(counterFile, 'utf-8'));
    } catch {
      /* defaults */
    }
  }

  if (skillEvents.length === 0 && watchState.count === 0 && allEvents.length === 0) return;

  fs.mkdirSync(TopiaMetricsDir, { recursive: true });

  const now = new Date().toISOString();
  const sessionStart = watchState.sessionStart || now;
  const durationMin = Math.round((new Date(now) - new Date(sessionStart)) / 60000);

  const skillCounts = {};
  const skillDurations = {};
  const skillTokenTotals = {};
  const skillChain = [];

  for (const evt of skillEvents) {
    if (!evt.skill) continue;
    skillCounts[evt.skill] = (skillCounts[evt.skill] || 0) + 1;
    skillChain.push(evt.skill);
    if (evt.duration_ms != null) {
      skillDurations[evt.skill] = (skillDurations[evt.skill] || 0) + evt.duration_ms;
    }
    if (evt.estimated_tokens) {
      skillTokenTotals[evt.skill] = (skillTokenTotals[evt.skill] || 0) + evt.estimated_tokens;
    }
  }

  const primarySkill =
    Object.entries(skillCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none';
  const modelsUsed = resolveSkillModels(skillCounts);

  const sessionId =
    watchState.sessionId ||
    hookData.session_id ||
    `s-${now.slice(0, 10).replace(/-/g, '')}-${now.slice(11, 19).replace(/:/g, '')}`;

  const platform =
    allEvents.find((e) => e.platform)?.platform || detectPlatform(hookData);

  const { tokens, compactionRows } = normalizeSessionTokens(allEvents);

  const sessionEntry = {
    id: sessionId,
    date: now.slice(0, 10),
    platform,
    duration_min: durationMin,
    tool_calls: watchState.count,
    tool_distribution: watchState.toolCounts,
    skill_invocations: skillEvents.length,
    skills_used: Object.keys(skillCounts),
    primary_skill: primarySkill,
    models_used: modelsUsed,
    skill_durations: Object.keys(skillDurations).length > 0 ? skillDurations : undefined,
    tokens,
  };

  const sessionsFile = path.join(TopiaMetricsDir, 'sessions.jsonl');
  fs.appendFileSync(sessionsFile, `${JSON.stringify(sessionEntry)}\n`);

  try {
    const allLines = fs.readFileSync(sessionsFile, 'utf-8').trim().split('\n').filter(Boolean);
    if (allLines.length > 100) {
      fs.writeFileSync(sessionsFile, `${allLines.slice(-100).join('\n')}\n`);
    }
  } catch {
    /* cap is best-effort */
  }

  if (compactionRows.length > 0) {
    const tokensFile = path.join(TopiaMetricsDir, 'tokens.jsonl');
    for (const row of compactionRows) {
      fs.appendFileSync(
        tokensFile,
        `${JSON.stringify({ session: sessionId, platform, ...row })}\n`,
      );
    }
  }

  const skillsFile = path.join(TopiaMetricsDir, 'skills.json');
  let skillsData = { version: 2, updated: now, skills: {} };
  if (fs.existsSync(skillsFile)) {
    try {
      skillsData = JSON.parse(fs.readFileSync(skillsFile, 'utf-8'));
      if (!skillsData.skills) skillsData.skills = {};
    } catch {
      /* start fresh */
    }
  }

  for (const [skill, count] of Object.entries(skillCounts)) {
    if (!skillsData.skills[skill]) {
      skillsData.skills[skill] = { total_invocations: 0, last_used: now.slice(0, 10) };
    }
    skillsData.skills[skill].total_invocations += count;
    skillsData.skills[skill].last_used = now.slice(0, 10);
    if (skillTokenTotals[skill]) {
      skillsData.skills[skill].estimated_tokens_total =
        (skillsData.skills[skill].estimated_tokens_total || 0) + skillTokenTotals[skill];
      const total = skillsData.skills[skill].total_invocations;
      skillsData.skills[skill].avg_tokens_per_invocation = Math.round(
        skillsData.skills[skill].estimated_tokens_total / total,
      );
    }
  }
  skillsData.updated = now;
  skillsData.version = 2;

  fs.writeFileSync(skillsFile, `${JSON.stringify(skillsData, null, 2)}\n`);

  if (skillChain.length > 0) {
    const chainsFile = path.join(TopiaMetricsDir, 'chains.jsonl');
    fs.appendFileSync(
      chainsFile,
      `${JSON.stringify({ session: sessionId, chain: skillChain, depth: skillChain.length })}\n`,
    );
  }

  clearEvents(cwd);

  const skillList = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `${s}(${c})`)
    .join(', ');

  const tokenSummary =
    tokens.confidence !== 'none'
      ? `, ~${tokens.total_estimated} est. tokens (peak ctx: ${tokens.context_peak ?? 'n/a'})`
      : '';

  console.log(
    `\n📊 [Topia metrics] Session ${sessionId} — ${durationMin}min, ${watchState.count} tool calls, ${skillEvents.length} skill invocations${tokenSummary}`,
  );
  if (skillList) console.log(`   Skills: ${skillList}`);
  console.log(`   Saved to .topia/metrics/\n`);
}

run().catch(() => process.exit(0));
