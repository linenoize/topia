// Topia Metrics Collector Hook
// PostToolUse on Skill — captures skill invocations for H3 nexus analytics
// Append-only JSONL to tmpdir. Flushed to .topia/metrics/ at session end.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { appendEvent } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, estimateSkillLoadTokens } = require('../lib/token-meter.cjs');

const cwd = process.cwd();
const hash = Buffer.from(cwd).toString('base64url').slice(0, 16);
const watchFile = path.join(os.tmpdir(), `Topia-context-watch-${hash}.json`);
const skillCacheFile = path.join(os.tmpdir(), `Topia-skill-cache-${hash}.json`);

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
  let skillName = 'unknown';

  try {
    const toolInput = hookData.tool_input || hookData.toolInput || {};
    const raw = toolInput.skill || toolInput.name || '';
    // Case-insensitive: accepts both v3+ `topia:` and legacy `topia:` prefixes.
    skillName = raw.replace(/^[Tt]opia:/, '') || 'unknown';
  } catch {
    const toolInput = process.env.CLAUDE_TOOL_INPUT || '';
    try {
      const parsed = JSON.parse(toolInput);
      skillName = (parsed.skill || parsed.name || '').replace(/^[Tt]opia:/, '');
    } catch {
      const match = toolInput.match(/(?:[Tt]opia:)?([a-z][\w-]*)/);
      if (match) skillName = match[1];
    }
  }

  if (skillName && skillName !== 'unknown') {
    const now = Date.now();
    const ts = new Date(now).toISOString();

    let sessionId = null;
    try {
      sessionId = JSON.parse(fs.readFileSync(watchFile, 'utf-8')).sessionId || null;
    } catch {
      /* no watch state */
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
      const { readEvents } = require('../lib/metrics-buffer.cjs');
      const lines = readEvents(cwd).filter((e) => e.event === 'invoke' || e.event === 'skill_invoke');
      if (lines.length > 0) {
        durationMs = now - new Date(lines[lines.length - 1].ts).getTime();
        if (durationMs > 600000) durationMs = null;
      }
    } catch {
      /* first event */
    }

    appendEvent(cwd, {
      skill: skillName,
      event: 'invoke',
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
