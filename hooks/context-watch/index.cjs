// Topia Context Watch Hook
// Counts all PreToolUse calls — detects context pressure aligned with context-engine thresholds.
// H3 Intelligence: tool distribution + pressure level for metrics at session end.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readStdinJson, isCursorRuntime, writeHookResponse, emitHookOutput } = require('../lib/cursor-io.cjs');
const { readEvents, appendEvent } = require('../lib/metrics-buffer.cjs');

const cwd = process.cwd();
const hash = Buffer.from(cwd).toString('base64url').slice(0, 16);
const counterFile = path.join(os.tmpdir(), `Topia-context-watch-${hash}.json`);

// Aligned with skills/context-engine/SKILL.md
const THRESHOLDS = {
  green: 50,
  yellow: 80,
  orange: 120,
};

const REPEAT_INTERVAL = 20;

function classifyPressure(count) {
  if (count >= THRESHOLDS.orange) return 'red';
  if (count >= THRESHOLDS.yellow) return 'orange';
  if (count >= THRESHOLDS.green) return 'yellow';
  return 'green';
}

function sumEstimatedIo(cwd) {
  try {
    return readEvents(cwd)
      .filter((e) => e.event === 'tool_io')
      .reduce((sum, e) => sum + (e.estimated_tokens || 0), 0);
  } catch {
    return 0;
  }
}

function buildWarning(count, level, estimatedIo) {
  const ioHint = estimatedIo > 50000 ? ` ~${Math.round(estimatedIo / 1000)}k est. tool I/O tokens.` : '';
  if (level === 'red') {
    return (
      `[Topia context-watch] ${count} tool calls — context RED. ` +
      `Invoke topia:context-lifecycle (or context-engine) for Save + /compact.${ioHint}`
    );
  }
  if (level === 'orange') {
    return (
      `[Topia context-watch] ${count} tool calls — context ORANGE. ` +
      `Recommend /compact at next phase boundary; caveman mode may apply.${ioHint}`
    );
  }
  if (level === 'yellow') {
    return (
      `[Topia context-watch] ${count} tool calls — context YELLOW. ` +
      `Load only essential files; prefer Grep over full Read.${ioHint}`
    );
  }
  return null;
}

async function main() {
  const hookData = await readStdinJson();
  const toolName = hookData.tool || hookData.tool_name || process.env.CLAUDE_TOOL_NAME || 'unknown';

  let state = {
    count: 0,
    lastWarning: 0,
    lastPressureEmit: 'green',
    sessionStart: null,
    sessionId: null,
    toolCounts: {},
    estimatedIo: 0,
    pressureLevel: 'green',
  };
  try {
    const raw = fs.readFileSync(counterFile, 'utf-8');
    state = { ...state, ...JSON.parse(raw) };
    if (!state.toolCounts) state.toolCounts = {};
  } catch {
    const now = new Date().toISOString();
    state.sessionStart = now;
    state.sessionId = `s-${now.slice(0, 10).replace(/-/g, '')}-${now.slice(11, 19).replace(/:/g, '')}`;
  }

  state.count += 1;
  state.toolCounts[toolName] = (state.toolCounts[toolName] || 0) + 1;
  state.estimatedIo = sumEstimatedIo(cwd);

  const count = state.count;
  const level = classifyPressure(count);
  state.pressureLevel = level;

  if (
    (level === 'orange' || level === 'red') &&
    state.lastPressureEmit !== level &&
    (level === 'red' || state.lastPressureEmit !== 'red')
  ) {
    appendEvent(cwd, {
      event: 'context_pressure',
      level,
      tool_calls: count,
      estimated_io: state.estimatedIo,
    });
    state.lastPressureEmit = level;
  }

  const sinceLast = count - state.lastWarning;
  let warning = null;

  if (level === 'red' && sinceLast >= REPEAT_INTERVAL) {
    warning = buildWarning(count, level, state.estimatedIo);
    state.lastWarning = count;
  } else if (level === 'orange' && sinceLast >= REPEAT_INTERVAL) {
    warning = buildWarning(count, level, state.estimatedIo);
    state.lastWarning = count;
  } else if (level === 'yellow' && sinceLast >= REPEAT_INTERVAL && state.lastWarning < THRESHOLDS.green) {
    warning = buildWarning(count, level, state.estimatedIo);
    state.lastWarning = count;
  }

  try {
    fs.writeFileSync(counterFile, JSON.stringify(state));
  } catch {
    /* non-critical */
  }

  if (isCursorRuntime(hookData)) {
    writeHookResponse(warning ? { permission: 'allow', agent_message: warning } : { permission: 'allow' });
  } else if (warning) {
    emitHookOutput({ permission: 'allow' }, { event: hookData, claudeLine: warning });
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
