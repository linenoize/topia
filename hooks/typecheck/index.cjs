// Topia TypeScript Check Hook
// PostToolUse on Edit|Write, in the background: runs the project's own
// `tsc --noEmit` after a .ts/.tsx edit and tells Claude about errors on its
// next turn.
//
// Runs only when the project lists typescript in package.json, has it
// installed, and has a tsconfig.json. When Claude edits several files in a row,
// only the last edit's check runs (each check waits a few seconds and steps
// aside if a newer edit came in), so tsc does not pile up.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findLocalTool, readEvent, editedFile } = require('../lib/local-tool.cjs');

const SETTLE_MS = Number(process.env.TOPIA_TYPECHECK_SETTLE_MS || 4000);

function findTsconfigDir(start, stop) {
  let dir = start;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, 'tsconfig.json'))) return dir;
    if (dir === stop) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function main() {
  const file = editedFile(readEvent());
  if (!file || !/\.(ts|tsx|mts|cts)$/i.test(file) || /\.d\.ts$/i.test(file)) return;
  if (/[\\/]node_modules[\\/]/.test(file)) return;

  const tool = findLocalTool(path.dirname(file), 'typescript', 'tsc');
  if (!tool) return;
  const projectDir = findTsconfigDir(path.dirname(file), tool.root);
  if (!projectDir) return;

  // Trailing debounce: the last edit in a burst runs the check.
  const stamp = path.join(os.tmpdir(), `topia-typecheck-${crypto.createHash('sha1').update(projectDir.toLowerCase()).digest('hex').slice(0, 12)}`);
  const token = `${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(stamp, token);
  } catch {
    // No temp dir: just run.
  }
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  try {
    if (fs.readFileSync(stamp, 'utf8') !== token) return;
  } catch {
    // Stamp gone: run anyway.
  }

  const run = spawnSync(process.execPath, [tool.script, '--noEmit', '--pretty', 'false'], {
    cwd: projectDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 120000,
  });
  if (run.status === 0 || run.error) return;

  const errors = `${run.stdout || ''}`.split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.trim());
  if (errors.length === 0) return;
  // Errors in the edited file first.
  const name = path.basename(file);
  errors.sort((a, b) => Number(!a.includes(name)) - Number(!b.includes(name)));
  const shown = errors.slice(0, 5);
  const more = errors.length > 5 ? `\n...and ${errors.length - 5} more. Run tsc --noEmit for the full list.` : '';
  const text = `[Topia typecheck] ${errors.length} TypeScript error(s) after editing ${name}:\n${shown.join('\n')}${more}`;
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Topia typecheck: ${errors.length} TypeScript error(s)`,
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text },
    }),
  );
}

main().finally(() => process.exit(0));
