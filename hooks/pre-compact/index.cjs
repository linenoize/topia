// Topia Pre-Compact Hook
// Headless checkpoint + snapshot BEFORE context compaction; records measured token usage.

const fs = require('fs');
const path = require('path');
const { readStdinJson, isCursorRuntime, writeHookResponse, emitHookOutput } = require('../lib/cursor-io.cjs');
const { resolveTopiaDir, topiaDirForWrite } = require('../lib/topia-paths.cjs');
const { appendEvent, watchFilePath } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, extractCompactionTokens } = require('../lib/token-meter.cjs');
const { recordTranscriptDelta, scanTranscript, resolveContextWindow } = require('../lib/transcript-meter.cjs');

const COMPACTION_TAIL_BYTES = 2 * 1024 * 1024;

/**
 * Claude Code's PreCompact payload has `trigger` and `transcript_path` but no
 * token fields (only Cursor's preCompact does), so extractCompactionTokens
 * returns null there and no compaction was ever recorded on Claude. Measure the
 * context being compacted from the transcript tail instead.
 */
function compactionFromTranscript(hookData) {
  const transcriptPath = hookData.transcript_path || hookData.transcriptPath;
  if (!transcriptPath) return null;
  const tail = scanTranscript(transcriptPath, { maxBytes: COMPACTION_TAIL_BYTES });
  const tokens = typeof tail?.contextPeak === 'number' ? tail.contextPeak : null;
  const window = tokens != null ? resolveContextWindow({ peak: tokens, model: tail.model }) : null;
  return {
    context_tokens: tokens,
    context_usage_percent: window ? Math.round((tokens / window.size) * 1000) / 10 : null,
    context_window_size: window ? window.size : null,
    trigger: hookData.trigger || 'unknown',
    message_count: null,
    messages_to_compact: null,
  };
}
const { runCheckpointFromHook } = require('../lib/checkpoint-runner.cjs');

const cwd = process.cwd();
const TopiaDirRead = resolveTopiaDir(cwd);
const TopiaDirWrite = topiaDirForWrite(cwd);
const counterFile = watchFilePath(cwd);

async function main() {
  const hookData = await readStdinJson();
  const platform = detectPlatform(hookData);
  let compaction = extractCompactionTokens(hookData);
  try {
    if (!compaction) compaction = compactionFromTranscript(hookData);
    // Bank this turn's measured context + slash-command skills before the
    // transcript is summarised; the Stop flush picks them up from the buffer.
    recordTranscriptDelta(cwd, hookData, { platform });
  } catch {
    /* best-effort */
  }

  let watchState = null;
  try {
    watchState = JSON.parse(fs.readFileSync(counterFile, 'utf-8'));
  } catch {
    /* fresh session */
  }

  const checkpoint = runCheckpointFromHook(cwd, 'pre-compact');
  if (checkpoint?.ok) {
    appendEvent(cwd, {
      event: 'context_checkpoint_written',
      trigger: 'pre-compact',
      tool_calls: checkpoint.toolCalls,
      had_prior_checkpoint: checkpoint.hadPriorCheckpoint,
    });
  }

  if (compaction) {
    appendEvent(cwd, {
      event: 'compaction',
      platform,
      ...compaction,
    });
    if (typeof compaction.context_tokens === 'number') {
      appendEvent(cwd, {
        event: 'context_peak',
        platform,
        context_tokens: compaction.context_tokens,
        context_usage_percent: compaction.context_usage_percent,
        context_window_size: compaction.context_window_size,
      });
    }
  }

  const stateFiles = ['progress.md', 'decisions.md', 'conventions.md'];
  const summaries = [];

  if (fs.existsSync(TopiaDirRead)) {
    for (const file of stateFiles) {
      const filePath = path.join(TopiaDirRead, file);
      if (!fs.existsSync(filePath)) continue;
      try {
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (content.length > 0) {
          summaries.push({ file, preview: content.split('\n').slice(0, 50).join('\n') });
        }
      } catch {
        /* skip */
      }
    }
  }

  const snapshot = ['# Pre-Compact Snapshot', `Generated: ${new Date().toISOString()}`, ''];

  if (checkpoint?.ok) {
    snapshot.push('## Checkpoint');
    snapshot.push(`- Written: .topia/checkpoint.md`);
    snapshot.push(`- Tool calls: ${checkpoint.toolCalls}`);
    snapshot.push(`- Had prior checkpoint: ${checkpoint.hadPriorCheckpoint ? 'yes' : 'no'}`);
    snapshot.push('');
  }

  if (watchState) {
    snapshot.push('## Session Metrics');
    snapshot.push(`- Tool calls: ${watchState.count || 0}`);
    snapshot.push(`- Pressure: ${watchState.pressureLevel || 'unknown'}`);
    snapshot.push(`- Session start: ${watchState.sessionStart || 'unknown'}`);
    if (watchState.toolCounts) {
      const top5 = Object.entries(watchState.toolCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      snapshot.push(`- Top tools: ${top5.map(([k, v]) => `${k}(${v})`).join(', ')}`);
    }
    snapshot.push('');
  }

  if (compaction) {
    snapshot.push('## Context Usage (measured)');
    if (compaction.context_tokens != null) snapshot.push(`- Context tokens: ${compaction.context_tokens}`);
    if (compaction.context_usage_percent != null) {
      snapshot.push(`- Context usage: ${compaction.context_usage_percent}%`);
    }
    if (compaction.context_window_size != null) {
      snapshot.push(`- Context window: ${compaction.context_window_size}`);
    }
    snapshot.push(`- Trigger: ${compaction.trigger}`);
    snapshot.push('');
  }

  if (summaries.length > 0) {
    snapshot.push('## State Files (preview)');
    for (const { file, preview } of summaries) {
      snapshot.push(`### .topia/${file}`, preview, '');
    }
  }

  if (watchState || summaries.length > 0 || compaction || checkpoint?.ok) {
    try {
      if (!fs.existsSync(TopiaDirWrite)) fs.mkdirSync(TopiaDirWrite, { recursive: true });
      fs.writeFileSync(path.join(TopiaDirWrite, 'pre-compact-snapshot.md'), snapshot.join('\n'));
    } catch {
      /* best-effort */
    }
  }

  const instruction =
    '[Topia pre-compact] State checkpointed to .topia/checkpoint.md. Run /compact now. ' +
    'After compact, PostCompact will re-inject checkpoint + progress; invoke topia:context-lifecycle if needed.';

  if (isCursorRuntime(hookData)) {
    writeHookResponse({ additional_context: instruction });
  } else {
    emitHookOutput({}, { event: hookData, claudeLine: instruction });
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
