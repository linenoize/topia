// Topia Context Watch Hook
// Lightweight tool call counter — detects context pressure and suggests Topia:context-engine
// Runs as PreToolUse hook on Edit/Write (high-cost operations)
//
// H3 Intelligence: also tracks tool type distribution and session start timestamp
// for metrics aggregation at session end.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');

const cwd = process.cwd();
const hash = Buffer.from(cwd).toString('base64url').slice(0, 16);
const counterFile = path.join(os.tmpdir(), `Topia-context-watch-${hash}.json`);

const FIRST_WARNING = 40;
const REPEAT_INTERVAL = 20;
const CRITICAL_THRESHOLD = 80;

function buildWarning(count) {
  if (count >= CRITICAL_THRESHOLD) {
    return (
      `[Topia context-watch] ${count} tool calls — context likely RED (>85%). ` +
      'RECOMMENDED: Invoke Topia:context-engine for state save + /compact.'
    );
  }
  if (count >= FIRST_WARNING) {
    return (
      `[Topia context-watch] ${count} tool calls — context filling up. ` +
      'Consider Topia:context-engine or /compact at the next boundary.'
    );
  }
  return null;
}

async function main() {
  const hookData = await readStdinJson();
  const toolName = hookData.tool || hookData.tool_name || process.env.CLAUDE_TOOL_NAME || 'unknown';

  let state = { count: 0, lastWarning: 0, sessionStart: null, sessionId: null, toolCounts: {} };
  try {
    const raw = fs.readFileSync(counterFile, 'utf-8');
    state = JSON.parse(raw);
    if (!state.toolCounts) state.toolCounts = {};
    if (!state.sessionStart) state.sessionStart = new Date().toISOString();
    if (!state.sessionId) {
      const s = state.sessionStart;
      state.sessionId = `s-${s.slice(0, 10).replace(/-/g, '')}-${s.slice(11, 19).replace(/:/g, '')}`;
    }
  } catch {
    const now = new Date().toISOString();
    state.sessionStart = now;
    state.sessionId = `s-${now.slice(0, 10).replace(/-/g, '')}-${now.slice(11, 19).replace(/:/g, '')}`;
  }

  state.count += 1;
  state.toolCounts[toolName] = (state.toolCounts[toolName] || 0) + 1;

  const count = state.count;
  const sinceLast = count - state.lastWarning;
  let warning = null;

  if (count >= CRITICAL_THRESHOLD && sinceLast >= REPEAT_INTERVAL) {
    warning = buildWarning(count);
    state.lastWarning = count;
  } else if (count >= FIRST_WARNING && sinceLast >= REPEAT_INTERVAL) {
    warning = buildWarning(count);
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
    process.stdout.write(`${warning}\n`);
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
