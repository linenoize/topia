// Topia Tool Collector Hook
// PostToolUse on all tools — records per-tool invocation counts for analytics.

const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { appendEvent } = require('../lib/metrics-buffer.cjs');
const { detectPlatform, extractToolIoTokens } = require('../lib/token-meter.cjs');

async function main() {
  const cwd = process.cwd();
  const hookData = await readStdinJson();
  const platform = detectPlatform(hookData);

  if (Object.keys(hookData).length > 0) {
    const io = extractToolIoTokens(hookData);
    appendEvent(cwd, {
      event: 'tool_use',
      platform,
      tool: io.tool,
      estimated_tokens: io.estimated_tokens,
      input_chars: io.input_chars,
      output_chars: io.output_chars,
    });
  }

  if (isCursorRuntime(hookData)) {
    writeHookResponse({});
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
