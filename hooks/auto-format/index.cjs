// Topia Auto-Format Hook
// PostToolUse on Edit|Write: formats the edited file with the project's own Prettier.
//
// Runs only when the project lists prettier in package.json and has it
// installed. Otherwise it exits at once and does nothing. It runs before
// Claude's next step (not in the background), so the next edit sees the
// formatted file.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findLocalTool, readEvent, editedFile } = require('../lib/local-tool.cjs');

const FORMATS = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts|json|css|scss|less|md|html|vue|yaml|yml|graphql)$/i;

const file = editedFile(readEvent());
if (!file || !FORMATS.test(file) || !fs.existsSync(file)) process.exit(0);
if (/[\\/]node_modules[\\/]/.test(file)) process.exit(0);

const tool = findLocalTool(path.dirname(file), 'prettier');
if (!tool) process.exit(0);

// --ignore-unknown: skip files Prettier has no parser for. .prettierignore is honoured.
const run = spawnSync(process.execPath, [tool.script, '--write', '--ignore-unknown', file], {
  cwd: tool.root,
  encoding: 'utf-8',
  stdio: 'pipe',
  timeout: 15000,
});

if (run.status !== 0 && !run.error) {
  // A syntax error the formatter could not parse is worth telling Claude about.
  const first = `${run.stderr || run.stdout || ''}`.trim().split('\n').slice(0, 3).join('\n');
  if (first) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `[Topia auto-format] Prettier could not format ${path.basename(file)}:\n${first}`,
        },
      }),
    );
  }
}
process.exit(0);
