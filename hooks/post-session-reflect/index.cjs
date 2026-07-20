// Topia Post-Session Reflect Hook
// 1. Flushes session metrics from tmpdir to .topia/metrics/ (H3 Intelligence)
// 2. Displays expandable Topia activity report at session end (Stop / sessionEnd)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isCursorRuntime, writeHookResponse, readStdinJson } = require('../lib/cursor-io.cjs');
const { topiaDirForWrite } = require('../lib/topia-paths.cjs');
const { readEvents, clearEvents } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, normalizeSessionTokens } = require('../lib/token-meter.cjs');
const { resolveSkillModel } = require('../lib/skill-catalog.cjs');
const { formatSessionReport } = require('../lib/session-report.cjs');

const hookLines = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  hookLines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
};

const cwd = process.cwd();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
const hash = Buffer.from(cwd).toString('base64url').slice(0, 16);
const counterFile = path.join(os.tmpdir(), `Topia-context-watch-${hash}.json`);
const TopiaMetricsDir = path.join(topiaDirForWrite(cwd), 'metrics');

function resolveSkillModels(skillCounts) {
  const models = {};
  for (const [skill, count] of Object.entries(skillCounts)) {
    const model = resolveSkillModel(skill, pluginRoot);
    if (model) {
      models[model] = (models[model] || 0) + count;
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

  let reportText = null;
  try {
    reportText = flushMetrics(hookData);
  } catch {
    /* best-effort */
  }

  if (reportText) {
    console.log(`\n${reportText}\n`);
  }

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

  if (skillEvents.length === 0 && watchState.count === 0 && allEvents.length === 0) return null;

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
    pressure_level: watchState.pressureLevel || 'green',
    skill_invocations: skillEvents.length,
    skills_used: Object.keys(skillCounts),
    primary_skill: primarySkill,
    models_used: modelsUsed,
    skill_durations: Object.keys(skillDurations).length > 0 ? skillDurations : undefined,
    tokens,
    expensive_session:
      (tokens.compactions || 0) >= 2 ||
      (typeof tokens.context_peak === 'number' && tokens.context_peak >= 90000),
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

  const { toolIoByTool } = normalizeSessionTokens(allEvents);
  if (toolIoByTool && Object.keys(toolIoByTool).length > 0) {
    const toolsFile = path.join(TopiaMetricsDir, 'tools.json');
    let toolsData = { version: 1, updated: now, tools: {} };
    if (fs.existsSync(toolsFile)) {
      try {
        toolsData = JSON.parse(fs.readFileSync(toolsFile, 'utf-8'));
        if (!toolsData.tools) toolsData.tools = {};
      } catch {
        /* fresh */
      }
    }
    for (const [tool, stats] of Object.entries(toolIoByTool)) {
      if (!toolsData.tools[tool]) {
        toolsData.tools[tool] = { total_invocations: 0, estimated_tokens_total: 0, sessions: 0 };
      }
      toolsData.tools[tool].total_invocations += stats.invocations;
      toolsData.tools[tool].estimated_tokens_total += stats.estimated_tokens;
      toolsData.tools[tool].sessions += 1;
      toolsData.tools[tool].last_used = now.slice(0, 10);
    }
    toolsData.updated = now;
    fs.writeFileSync(toolsFile, `${JSON.stringify(toolsData, null, 2)}\n`);
  }

  clearEvents(cwd);

  return formatSessionReport(
    {
      skillCounts,
      skillChain,
      skillDurations,
      toolCounts: watchState.toolCounts,
      toolCalls: watchState.count,
      durationMin,
      primarySkill,
      skillInvocations: skillEvents.length,
      tokens,
    },
    pluginRoot,
  );
}

run().catch(() => process.exit(0));
