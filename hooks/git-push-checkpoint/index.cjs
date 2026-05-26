// Topia Git Push Checkpoint Hook
// PreToolUse on Bash — when command is `git push`, write headless checkpoint before push runs.

const { readStdinJson, isCursorRuntime, writeHookResponse, emitHookOutput } = require('../lib/cursor-io.cjs');
const { runCheckpointFromHook } = require('../lib/checkpoint-runner.cjs');
const { appendEvent } = require('../lib/metrics-buffer.cjs');

const GIT_PUSH_RE = /\bgit\s+push\b/;

async function main() {
  const hookData = await readStdinJson();
  const toolInput = hookData.tool_input || hookData.toolInput || {};
  const command = (toolInput.command || process.env.CLAUDE_TOOL_INPUT || '').trim();

  let parsedCommand = command;
  if (!parsedCommand && process.env.CLAUDE_TOOL_INPUT) {
    try {
      parsedCommand = JSON.parse(process.env.CLAUDE_TOOL_INPUT).command || '';
    } catch {
      parsedCommand = '';
    }
  }

  if (!GIT_PUSH_RE.test(parsedCommand)) {
    if (isCursorRuntime(hookData)) writeHookResponse({ permission: 'allow' });
    process.exit(0);
  }

  const cwd = process.cwd();
  const checkpoint = runCheckpointFromHook(cwd, 'git-push');

  if (checkpoint?.ok) {
    appendEvent(cwd, {
      event: 'context_checkpoint_written',
      trigger: 'git-push',
      tool_calls: checkpoint.toolCalls,
    });
  }

  const message = checkpoint?.ok
    ? `[Topia git-push-checkpoint] Push detected — checkpoint saved to .topia/checkpoint.md (${checkpoint.toolCalls} tool calls). ` +
      'RECOMMENDED: run /compact or start a new session after push; invoke topia:context-lifecycle to resume.'
    : '[Topia git-push-checkpoint] Push detected — checkpoint write failed (non-blocking).';

  if (isCursorRuntime(hookData)) {
    writeHookResponse({
      permission: 'allow',
      agent_message: message,
    });
  } else {
    emitHookOutput({ permission: 'allow' }, { event: hookData, claudeLine: message });
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
