/**
 * Token estimation and session aggregation for Topia metrics.
 * Tiered confidence: measured (IDE context) vs estimated (chars × 0.25).
 */
const { isCursorRuntime } = require('./cursor-io.cjs');

const CHARS_PER_TOKEN = 0.25;

function estimateTokens(chars) {
  if (typeof chars !== 'number' || !Number.isFinite(chars) || chars <= 0) return 0;
  return Math.floor(chars * CHARS_PER_TOKEN);
}

function serializedLength(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

/**
 * @param {object} [event]
 * @returns {'cursor' | 'claude'}
 */
function detectPlatform(event = {}) {
  if (isCursorRuntime(event)) return 'cursor';
  return 'claude';
}

/**
 * @param {object} payload — PostToolUse / postToolUse stdin
 * @returns {{ tool: string, estimated_tokens: number, input_chars: number, output_chars: number }}
 */
function extractToolIoTokens(payload = {}) {
  const tool =
    payload.tool ||
    payload.tool_name ||
    payload.toolName ||
    'unknown';

  const toolInput = payload.tool_input ?? payload.toolInput ?? {};
  const toolOutput =
    payload.tool_output ??
    payload.tool_result ??
    payload.toolOutput ??
    payload.toolResult ??
    '';

  const inputChars = serializedLength(toolInput);
  const outputChars = serializedLength(toolOutput);

  return {
    tool,
    estimated_tokens: estimateTokens(inputChars + outputChars),
    input_chars: inputChars,
    output_chars: outputChars,
  };
}

/**
 * @param {object} payload — preCompact stdin
 * @returns {object|null}
 */
function extractCompactionTokens(payload = {}) {
  const contextTokens = payload.context_tokens ?? payload.contextTokens;
  if (contextTokens == null && payload.context_usage_percent == null) return null;

  return {
    context_tokens: typeof contextTokens === 'number' ? contextTokens : null,
    context_usage_percent:
      typeof payload.context_usage_percent === 'number'
        ? payload.context_usage_percent
        : typeof payload.contextUsagePercent === 'number'
          ? payload.contextUsagePercent
          : null,
    context_window_size:
      typeof payload.context_window_size === 'number'
        ? payload.context_window_size
        : typeof payload.contextWindowSize === 'number'
          ? payload.contextWindowSize
          : null,
    trigger: payload.trigger || 'unknown',
    message_count: payload.message_count ?? payload.messageCount ?? null,
    messages_to_compact: payload.messages_to_compact ?? payload.messagesToCompact ?? null,
  };
}

/**
 * Aggregate token metrics from buffered session events.
 * @param {object[]} events
 * @returns {object}
 */
function normalizeSessionTokens(events = []) {
  let estimatedIo = 0;
  let estimatedSkills = 0;
  let estimatedAgentResponse = 0;
  let contextPeak = null;
  let contextPeakPercent = null;
  let contextWindowSize = null;
  let compactions = 0;
  let hasMeasured = false;
  let hasEstimated = false;

  const compactionRows = [];

  for (const evt of events) {
    const type = evt.event || evt.type;
    if (type === 'tool_io') {
      estimatedIo += evt.estimated_tokens || 0;
      hasEstimated = true;
    } else if (type === 'skill_invoke' || type === 'invoke') {
      estimatedSkills += evt.estimated_tokens || 0;
      hasEstimated = true;
    } else if (type === 'agent_response') {
      estimatedAgentResponse += evt.estimated_tokens || 0;
      hasEstimated = true;
    } else if (type === 'compaction' || type === 'context_peak') {
      compactions += type === 'compaction' ? 1 : 0;
      const peak = evt.context_tokens;
      if (typeof peak === 'number' && (contextPeak == null || peak > contextPeak)) {
        contextPeak = peak;
        contextPeakPercent = evt.context_usage_percent ?? contextPeakPercent;
        contextWindowSize = evt.context_window_size ?? contextWindowSize;
        hasMeasured = true;
      }
      if (type === 'compaction') {
        compactionRows.push({
          ts: evt.ts,
          context_tokens: evt.context_tokens ?? null,
          context_usage_percent: evt.context_usage_percent ?? null,
          context_window_size: evt.context_window_size ?? null,
          trigger: evt.trigger || 'unknown',
        });
      }
    }
  }

  const totalEstimated = estimatedIo + estimatedSkills + estimatedAgentResponse;

  let confidence = 'none';
  if (hasMeasured && hasEstimated) confidence = 'mixed';
  else if (hasMeasured) confidence = 'measured';
  else if (hasEstimated) confidence = 'estimated';

  return {
    tokens: {
      context_peak: contextPeak,
      context_peak_percent: contextPeakPercent,
      context_window_size: contextWindowSize,
      estimated_io: estimatedIo,
      estimated_skills: estimatedSkills,
      estimated_agent_response: estimatedAgentResponse,
      compactions,
      total_estimated: totalEstimated,
      confidence,
    },
    compactionRows,
  };
}

/**
 * Estimate tokens for loading a skill/agent definition file.
 * @param {string} skillName
 * @param {string} pluginRoot
 * @returns {number}
 */
function estimateSkillLoadTokens(skillName, pluginRoot) {
  const fs = require('fs');
  const path = require('path');
  const candidates = [
    path.join(pluginRoot, 'agents', `${skillName}.md`),
    path.join(pluginRoot, 'skills', skillName, 'SKILL.md'),
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        return estimateTokens(fs.readFileSync(file, 'utf-8').length);
      }
    } catch {
      /* try next */
    }
  }
  return 0;
}

module.exports = {
  CHARS_PER_TOKEN,
  estimateTokens,
  serializedLength,
  detectPlatform,
  extractToolIoTokens,
  extractCompactionTokens,
  normalizeSessionTokens,
  estimateSkillLoadTokens,
};
