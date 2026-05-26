// Topia Post-Compact Hook
// Re-injects checkpoint + progress after context compaction (Claude Code PostCompact).

const fs = require('fs');
const path = require('path');
const { readStdinJson, isCursorRuntime, writeHookResponse, emitHookOutput } = require('../lib/cursor-io.cjs');
const { resolveTopiaDir } = require('../lib/topia-paths.cjs');
const { appendEvent } = require('../lib/metrics-buffer.cjs');
const { detectPlatform } = require('../lib/token-meter.cjs');

const cwd = process.cwd();
const TopiaDir = resolveTopiaDir(cwd);
const MAX_PREVIEW_LINES = 40;

function readPreview(filename, maxLines = MAX_PREVIEW_LINES) {
  const filePath = path.join(TopiaDir, filename);
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch {
    return null;
  }
}

async function main() {
  const hookData = await readStdinJson();
  const platform = detectPlatform(hookData);

  appendEvent(cwd, { event: 'context_compacted', platform });

  const blocks = [
    '## Topia — Post-Compact Resume',
    '',
    'Context was compacted. Continue from these files (do not re-scan the whole repo unless needed):',
    '',
  ];

  const checkpoint = readPreview('checkpoint.md', 50);
  if (checkpoint) {
    blocks.push('### .topia/checkpoint.md', checkpoint, '');
  }

  const progress = readPreview('progress.md', 25);
  if (progress) {
    blocks.push('### .topia/progress.md', progress, '');
  }

  const activePath = path.join(TopiaDir, 'active-context.md');
  let modePreview = null;
  if (fs.existsSync(activePath)) {
    try {
      modePreview = fs.readFileSync(activePath, 'utf-8').trim().split('\n').slice(0, 20).join('\n');
    } catch {
      /* skip */
    }
  }
  if (modePreview) {
    blocks.push('### Active behavioral mode', modePreview, '');
  }

  if (!checkpoint && !progress) {
    blocks.push(
      '_No checkpoint yet — invoke `topia:session-bridge` Save or wait for the next pre-compact hook._',
      '',
    );
  }

  blocks.push(
    '**Next steps:** Read `.topia/checkpoint.md` first. Invoke `topia:context-lifecycle` (Resume Mode) if unsure where to continue.',
    '',
  );

  const message = blocks.join('\n');

  if (isCursorRuntime(hookData)) {
    writeHookResponse({ additional_context: message });
  } else {
    emitHookOutput({ additional_context: message }, { event: hookData, claudeLine: message });
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
