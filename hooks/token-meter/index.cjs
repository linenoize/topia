// Topia Token Meter Hook
// PostToolUse — estimates token cost from tool input/output sizes.
// Append-only to tmpdir metrics buffer; flushed at session end.

const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { appendEvent } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, extractToolIoTokens } = require('../lib/token-meter.cjs');

async function main() {
  const cwd = process.cwd();
  const hookData = await readStdinJson();
  const platform = detectPlatform(hookData);

  if (Object.keys(hookData).length > 0) {
    const io = extractToolIoTokens(hookData);
    if (io.estimated_tokens > 0) {
      appendEvent(cwd, {
        event: 'tool_io',
        platform,
        tool: io.tool,
        estimated_tokens: io.estimated_tokens,
        input_chars: io.input_chars,
        output_chars: io.output_chars,
      });
    }
  }

  if (isCursorRuntime(hookData)) {
    writeHookResponse({});
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
