// PostToolUse on Bash — after successful `git commit`, store learnings via agora-code CLI.
// Opt-in: .topia/agora-commit-learn.flag or TOPIA_AGORA_COMMIT_LEARN=1

const { execFileSync } = require('child_process');
const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const {
  isAgoraMemoryRegistered,
  isAgoraCommitLearnEnabled,
  agoraCodeOnPath,
} = require('../lib/agora-detect.cjs');

const GIT_COMMIT_RE = /\bgit\s+commit\b/;

async function main() {
  const hookData = await readStdinJson();
  const cwd = process.cwd();

  if (!isAgoraCommitLearnEnabled(cwd) || !isAgoraMemoryRegistered(cwd) || !agoraCodeOnPath()) {
    if (isCursorRuntime(hookData)) writeHookResponse({});
    process.exit(0);
  }

  const toolInput = hookData.tool_input || hookData.toolInput || {};
  const command = (toolInput.command || '').trim();
  if (!GIT_COMMIT_RE.test(command)) {
    if (isCursorRuntime(hookData)) writeHookResponse({});
    process.exit(0);
  }

  const toolResult = hookData.tool_result || hookData.toolResult || {};
  const stderr = String(toolResult.stderr || '');
  const stdout = String(toolResult.stdout || '');
  const combined = `${stdout}\n${stderr}`;
  if (/error:|fatal:|failed/i.test(combined) && !/\[main|files? changed/i.test(combined)) {
    if (isCursorRuntime(hookData)) writeHookResponse({});
    process.exit(0);
  }

  try {
    execFileSync('agora-code', ['learn-from-commit', '--quiet'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch {
    // non-fatal
  }

  if (isCursorRuntime(hookData)) writeHookResponse({});
  process.exit(0);
}

main().catch(() => process.exit(0));
