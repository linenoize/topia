/**
 * Measured context + slash-command extraction from the Claude Code transcript.
 *
 * Claude Code hook payloads carry `transcript_path` but no token counts, so
 * before this module `tokens.context_peak` was only ever set from Cursor's
 * preCompact fields and stayed null on Claude. Every assistant record in the
 * transcript has `message.usage`; input + cache_read + cache_creation is the
 * context the model saw on that request.
 *
 * Scans are incremental: the caller passes the byte offset reached last time
 * (kept per transcript in a tmpdir cursor file), so each Stop reads only the
 * turn it closes.
 */
'use strict';

const fs = require('fs');
const { slashInvocationsFromRecords } = require('./skill-telemetry.cjs');

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
const STANDARD_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

/** Context tokens one request used, from an Anthropic `usage` object. */
function contextTokensFromUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const parts = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens];
  if (!parts.some((n) => typeof n === 'number')) return null;
  return parts.reduce((sum, n) => sum + (typeof n === 'number' && n > 0 ? n : 0), 0);
}

/**
 * @param {object[]} records — parsed transcript records
 * @returns {{ contextPeak: number|null, model: string|null, slashInvocations: object[] }}
 */
function measureRecords(records = []) {
  let contextPeak = null;
  let model = null;
  for (const rec of records) {
    if (!rec || rec.type !== 'assistant' || rec.isSidechain === true) continue;
    const tokens = contextTokensFromUsage(rec.message?.usage);
    if (tokens == null) continue;
    if (contextPeak == null || tokens > contextPeak) contextPeak = tokens;
    model = rec.requestedModel || rec.message?.model || model;
  }
  return { contextPeak, model, slashInvocations: slashInvocationsFromRecords(records) };
}

function parseLines(text) {
  const records = [];
  for (const line of text.split('\n')) {
    // Cheap prefilter: only assistant usage and user records matter.
    if (!line || (!line.includes('"usage"') && !line.includes('"user"'))) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* torn or foreign line */
    }
  }
  return records;
}

/**
 * Read a transcript from `fromOffset` to its last complete line.
 * @param {string} file
 * @param {{ fromOffset?: number, maxBytes?: number }} [opts]
 * @returns {{ offset: number, contextPeak: number|null, model: string|null,
 *             slashInvocations: object[] } | null} null when unreadable
 */
function scanTranscript(file, { fromOffset = 0, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof file !== 'string' || !file) return null;
  let fd = null;
  try {
    const { size } = fs.statSync(file);
    let start = Number.isInteger(fromOffset) && fromOffset >= 0 && fromOffset <= size ? fromOffset : 0;
    let skipPartial = false;
    if (size - start > maxBytes) {
      start = size - maxBytes;
      skipPartial = true;
    }
    const length = size - start;
    if (length <= 0) return { offset: start, ...measureRecords([]) };

    const buf = Buffer.alloc(length);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, length, start);

    let from = 0;
    if (skipPartial) {
      const nl = buf.indexOf(0x0a);
      from = nl === -1 ? length : nl + 1;
    }
    const lastNl = buf.lastIndexOf(0x0a);
    const end = lastNl >= from ? lastNl + 1 : from;
    const records = parseLines(buf.subarray(from, end).toString('utf8'));
    return { offset: start + end, ...measureRecords(records) };
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function readCursor(cursorFile) {
  try {
    const data = JSON.parse(fs.readFileSync(cursorFile, 'utf-8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * Scan what the transcript gained since the last call for the same file, and
 * advance the cursor. Safe to call from several hooks: each byte is read once.
 * @returns {ReturnType<typeof scanTranscript>}
 */
function scanTranscriptSinceLast(transcriptPath, cursorFile, opts = {}) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  const cursor = readCursor(cursorFile);
  const result = scanTranscript(transcriptPath, { ...opts, fromOffset: cursor[transcriptPath] || 0 });
  if (!result) return null;
  // Keep only the newest few transcripts so the file cannot grow without bound.
  const next = Object.fromEntries(
    Object.entries(cursor)
      .filter(([k]) => k !== transcriptPath)
      .slice(-7),
  );
  next[transcriptPath] = result.offset;
  try {
    fs.writeFileSync(cursorFile, JSON.stringify(next));
  } catch {
    /* best-effort; worst case the next scan re-reads */
  }
  return result;
}

/**
 * Scan the transcript delta and append what it found to the session metrics
 * buffer: one `context_peak` event (measured) and one `invoke` per slash-command
 * skill. Shared by pre-compact and post-session-reflect: whichever runs first
 * advances the cursor, and the events wait in the buffer for the Stop flush.
 * @returns {{ contextPeak: number|null, slashCount: number } | null}
 */
function recordTranscriptDelta(cwd, hookData = {}, { platform = 'claude', pluginRoot } = {}) {
  const { appendEvent, transcriptCursorFilePath } = require('./metrics-buffer.cjs');
  const transcriptPath = hookData.transcript_path || hookData.transcriptPath;
  const scan = scanTranscriptSinceLast(transcriptPath, transcriptCursorFilePath(cwd));
  if (!scan) return null;

  if (typeof scan.contextPeak === 'number') {
    const window = resolveContextWindow({ peak: scan.contextPeak, model: scan.model });
    appendEvent(cwd, {
      event: 'context_peak',
      platform,
      source: 'transcript',
      context_tokens: scan.contextPeak,
      context_window_size: window ? window.size : null,
      context_window_source: window ? window.source : null,
      context_usage_percent: window ? Math.round((scan.contextPeak / window.size) * 1000) / 10 : null,
      model: scan.model,
    });
  }

  let estimateSkillLoadTokens = null;
  try {
    ({ estimateSkillLoadTokens } = require('./token-meter.cjs'));
  } catch {
    /* estimates are optional */
  }
  const root = pluginRoot || require('path').join(__dirname, '..', '..');
  for (const inv of scan.slashInvocations) {
    appendEvent(cwd, {
      ...(inv.ts ? { ts: inv.ts } : {}),
      skill: inv.skill,
      event: 'invoke',
      via: 'slash',
      session_id: hookData.session_id || null,
      platform,
      estimated_tokens: estimateSkillLoadTokens ? estimateSkillLoadTokens(inv.skill, root) : 0,
    });
  }
  return { contextPeak: scan.contextPeak, slashCount: scan.slashInvocations.length };
}

/**
 * Context window size, only when it can be known. Claude windows are 200k or
 * 1M and the transcript does not say which, so a peak at or under 200k on an
 * unmarked model returns null rather than guess (a guess of 200k would paint a
 * 150k session on a 1M window as nearly full).
 * @param {{ peak?: number|null, model?: string|null, explicit?: number|null, env?: object }} p
 * @returns {{ size: number, source: 'payload'|'env'|'model'|'inferred' } | null}
 */
function resolveContextWindow({ peak = null, model = null, explicit = null, env = process.env } = {}) {
  if (typeof explicit === 'number' && explicit > 0) return { size: explicit, source: 'payload' };
  const fromEnv = Number(env?.TOPIA_CONTEXT_WINDOW);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return { size: fromEnv, source: 'env' };
  if (typeof model === 'string' && /\[1m\]/i.test(model)) return { size: LARGE_WINDOW, source: 'model' };
  if (typeof peak === 'number' && peak > STANDARD_WINDOW) return { size: LARGE_WINDOW, source: 'inferred' };
  return null;
}

/**
 * Pressure from measured context use. Mirrors context-engine Step 6b:
 * >35% left is safe, 25–35% left is a warning, <25% left is critical.
 */
function pressureFromPercent(percentUsed) {
  if (typeof percentUsed !== 'number' || !Number.isFinite(percentUsed)) return null;
  if (percentUsed >= 75) return 'red';
  if (percentUsed >= 65) return 'orange';
  if (percentUsed >= 50) return 'yellow';
  return 'green';
}

module.exports = {
  STANDARD_WINDOW,
  LARGE_WINDOW,
  contextTokensFromUsage,
  measureRecords,
  scanTranscript,
  scanTranscriptSinceLast,
  recordTranscriptDelta,
  resolveContextWindow,
  pressureFromPercent,
};
