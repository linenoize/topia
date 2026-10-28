// Topia Metrics Collector Hook
// PostToolUse on Skill | Agent | Task — captures skill invocations for H3 nexus analytics:
//   Skill tool calls (tool_input.skill) and topia:* subagents (tool_input.subagent_type).
// Slash-command invocations never reach a tool hook; post-session-reflect reads
// them from the transcript (hooks/lib/transcript-meter.cjs).
// Append-only JSONL to tmpdir. Flushed to .topia/metrics/ at session end.

const fs = require('fs');
const path = require('path');
const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { appendEvent, readEvents, watchFilePath, skillCacheFilePath } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, estimateSkillLoadTokens } = require('../lib/token-meter.cjs');
const { extractToolSkillInvocation } = require('../lib/skill-telemetry.cjs');

const cwd = process.cwd();
const watchFile = watchFilePath(cwd);
const skillCacheFile = skillCacheFilePath(cwd);

function loadSkillCache() {
  try {
    return JSON.parse(fs.readFileSync(skillCacheFile, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSkillCache(cache) {
  try {
    fs.writeFileSync(skillCacheFile, JSON.stringify(cache));
  } catch {
    /* best-effort */
  }
}

async function main() {
  const hookData = await readStdinJson();
  const platform = detectPlatform(hookData);
  const invocation = extractToolSkillInvocation(hookData);

  if (invocation) {
    const { skill: skillName, via } = invocation;
    const now = Date.now();

    let sessionId = hookData.session_id || null;
    if (!sessionId) {
      try {
        sessionId = JSON.parse(fs.readFileSync(watchFile, 'utf-8')).sessionId || null;
      } catch {
        /* no watch state */
      }
    }

    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
    const skillCache = loadSkillCache();
    if (skillCache[skillName] == null) {
      skillCache[skillName] = estimateSkillLoadTokens(skillName, pluginRoot);
      saveSkillCache(skillCache);
    }
    const estimatedTokens = skillCache[skillName] || 0;

    let durationMs = null;
    try {
      const lines = readEvents(cwd).filter((e) => e.event === 'invoke' || e.event === 'skill_invoke');
      if (lines.length > 0) {
        durationMs = now - new Date(lines[lines.length - 1].ts).getTime();
        if (!(durationMs >= 0) || durationMs > 600000) durationMs = null;
      }
    } catch {
      /* first event */
    }

    appendEvent(cwd, {
      skill: skillName,
      event: 'invoke',
      via,
      session_id: sessionId,
      duration_ms: durationMs,
      platform,
      estimated_tokens: estimatedTokens,
    });
  }

  if (isCursorRuntime(hookData)) {
    writeHookResponse({});
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
