/**
 * Hook Tests — intent-router + pre-tool-guard (privacy nexus)
 *
 * Tests hook scripts via child_process to verify stdin/stdout behavior.
 */

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.resolve(__dirname, '../../hooks');

/**
 * Run a hook with given stdin input and environment
 * @returns {{ stdout: string, exitCode: number }}
 */
function runHook(hookName, stdinInput, env = {}, cwd = undefined) {
  const hookPath = path.join(HOOKS_DIR, hookName, 'index.cjs');
  try {
    const stdout = execFileSync('node', [hookPath], {
      cwd,
      input: stdinInput,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 5000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status || 1 };
  }
}

// --- Pre-Tool Guard (Privacy Nexus) ---

describe('pre-tool-guard: privacy nexus', () => {
  // Claude Code reads stdout as JSON on exit 0; plain text there never reaches the model.
  test('WARN on .env file reaches the model as additionalContext', () => {
    const { stdout, exitCode } = runHook(
      'pre-tool-guard',
      '{"hook_event_name":"PreToolUse","tool_input": {"file_path": ".env"}}',
    );
    assert.strictEqual(exitCode, 0, 'WARN should not block (exit 0)');
    const out = JSON.parse(stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(out.hookSpecificOutput.additionalContext.includes('privacy-nexus'), 'should name privacy-nexus');
    assert.ok(out.hookSpecificOutput.additionalContext.includes('Sensitive file'), 'should warn about sensitive file');
    assert.ok(out.systemMessage.includes('.env'), 'the person sees which file');
    assert.strictEqual(
      out.hookSpecificOutput.permissionDecision,
      undefined,
      'a warning does not change the permission',
    );
  });

  // On exit 2, Claude Code feeds stderr back to the model as the reason.
  test('BLOCK on private key file tells the model why, on stderr', () => {
    const { stderr, exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": "id_rsa"}}');
    assert.strictEqual(exitCode, 2, 'BLOCK should exit with code 2');
    assert.ok(stderr.includes('BLOCKED'), 'should show BLOCKED label');
    assert.ok(stderr.includes('id_rsa'), 'should name the file');
    assert.ok(stderr.includes('.topia/privacy.json'), 'should say how to allow it');
  });

  test('BLOCK on .pem file', () => {
    const { exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": "server.pem"}}');
    assert.strictEqual(exitCode, 2, '.pem should be blocked');
  });

  test('ALLOW .env.example (safe exception)', () => {
    const { stdout, exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": ".env.example"}}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '', '.env.example should produce no output');
  });

  test('ALLOW .env.test (safe exception)', () => {
    const { stdout, exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": ".env.test"}}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '', '.env.test should produce no output');
  });

  test('ALLOW normal files', () => {
    const { stdout, exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": "src/index.js"}}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '', 'normal files should produce no output');
  });

  test('elevated skill bypasses WARN', () => {
    const { stdout, exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": ".env"}}', {
      Topia_ACTIVE_SKILL: 'sentinel',
    });
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '', 'sentinel should bypass .env warning');
  });

  test('elevated skill does NOT bypass BLOCK', () => {
    const { exitCode } = runHook('pre-tool-guard', '{"tool_input": {"file_path": "id_rsa"}}', {
      Topia_ACTIVE_SKILL: 'sentinel',
    });
    assert.strictEqual(exitCode, 2, 'BLOCK cannot be bypassed by elevation');
  });

  test('graceful on empty input', () => {
    const { exitCode } = runHook('pre-tool-guard', '');
    assert.strictEqual(exitCode, 0, 'should exit cleanly on empty input');
  });

  test('graceful on missing file_path', () => {
    const { exitCode } = runHook('pre-tool-guard', '{"tool_input": {}}');
    assert.strictEqual(exitCode, 0, 'should exit cleanly on missing file_path');
  });
});

// --- Intent Router ---

describe('intent-router', () => {
  // Each run logs to <cwd>/.topia/metrics, so run it in a scratch project.
  const PROJECT = mkdtempSync(path.join(tmpdir(), 'intent-router-'));
  after(() => rmSync(PROJECT, { recursive: true, force: true }));
  const LOG = path.join(PROJECT, '.topia', 'metrics', 'routing.jsonl');
  const route = (stdin, env = {}) => runHook('intent-router', stdin, { CURSOR_HOOK: '', ...env }, PROJECT);
  const logLines = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : []);

  /** The hook answers with JSON hookSpecificOutput.additionalContext, or nothing. */
  function context(stdout) {
    if (stdout.trim() === '') return '';
    const out = JSON.parse(stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    return out.hookSpecificOutput.additionalContext;
  }

  test('suggests the skill the wording points at, from the table shipped in hooks/lib', () => {
    const { stdout, exitCode } = route('{"prompt": "add support for gzip, fix the crash and add a unit test"}', {
      CLAUDE_PLUGIN_ROOT: '/nonexistent',
    });
    assert.strictEqual(exitCode, 0);
    const text = context(stdout);
    assert.match(text, /^🧭 \[Topia intent-router\] Suggested: topia:build \(L1, sonnet\) — wording: "add support for"/);
    assert.match(text, /Also consider: test, debug/);
    // build is `context: fork`, so the hook says its report comes back later.
    assert.match(text, /Runs in the background: its report arrives later as a task notification/);
  });

  test('logs the hint to routing.jsonl: skill ids and timing, never the prompt', () => {
    rmSync(LOG, { force: true });
    route(JSON.stringify({ prompt: 'fix the crash for alice@example.com and add a unit test', session_id: 'sess-1' }));
    const lines = logLines();
    assert.strictEqual(lines.length, 1);
    const row = JSON.parse(lines[0]);
    assert.deepStrictEqual(Object.keys(row).sort(), ['bare', 'ms', 'session', 'skills', 'ts']);
    assert.strictEqual(row.session, 'sess-1');
    assert.deepStrictEqual(row.skills, ['build', 'test', 'debug']);
    assert.strictEqual(row.bare, false);
    assert.ok(Number.isInteger(row.ms) && row.ms >= 0);
    for (const word of ['crash', 'alice', 'example.com', 'unit']) assert.ok(!lines[0].includes(word), word);
  });

  test('a bare slash command gets the redirect, logged as bare', () => {
    rmSync(LOG, { force: true });
    const { stdout, exitCode } = route(JSON.stringify({ prompt: '/debug', session_id: 'sess-2' }));
    assert.strictEqual(exitCode, 0);
    assert.match(context(stdout), /Bare `\/debug` is not a Topia command/);
    const row = JSON.parse(logLines()[0]);
    assert.deepStrictEqual([row.skills, row.bare], [['debug'], true]);
  });

  test('stays silent when nothing matches or the skill is named outright', () => {
    rmSync(LOG, { force: true });
    for (const prompt of ['hello there, how are you', 'update the address field', '/topia-debug the login crash']) {
      const { stdout, exitCode } = route(JSON.stringify({ prompt }));
      assert.strictEqual(exitCode, 0);
      assert.strictEqual(stdout.trim(), '', prompt);
    }
    assert.deepStrictEqual(logLines(), [], 'no hint, no log line');
  });

  test('prints and logs nothing under Cursor, which builds its own routing', () => {
    rmSync(LOG, { force: true });
    const { stdout, exitCode } = route('{"prompt": "fix the crash"}', { CURSOR_HOOK: '1' });
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '');
    assert.deepStrictEqual(logLines(), []);
  });

  test('exits silently on empty prompt', () => {
    const { stdout, exitCode } = route('{"user_prompt": ""}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '');
  });

  test('exits silently on very short prompt', () => {
    const { stdout, exitCode } = route('{"user_prompt": "hi"}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '');
  });

  test('graceful on invalid JSON', () => {
    const { exitCode } = route('not json');
    assert.strictEqual(exitCode, 0, 'should exit cleanly on invalid JSON');
  });

  test('runs fast enough to sit in front of every prompt (cold node start)', (t) => {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const started = process.hrtime.bigint();
      const { exitCode } = route('{"prompt": "fix the crash and add a unit test"}');
      runs.push(Number(process.hrtime.bigint() - started) / 1e6);
      assert.strictEqual(exitCode, 0);
    }
    const best = Math.round(Math.min(...runs));
    t.diagnostic(`intent-router wall time, best of 3: ${best} ms (runs: ${runs.map(Math.round).join(', ')} ms)`);
    // The hooks.json timeout is 5 s; a run anywhere near it is a regression.
    assert.ok(best < 2000, `${best} ms`);
  });
});

// --- Secrets Scan ---
// Claude Code passes hook input as JSON on stdin. It never sets CLAUDE_TOOL_INPUT,
// so a scan that read only that variable never ran.

describe('secrets-scan: reads the command from stdin', () => {
  // A key shaped like an AWS access key, built here so no real-looking key sits in the repo.
  const fakeKey = `AKIA${'Q'.repeat(16)}`;

  function stagedRepo() {
    const dir = mkdtempSync(path.join(tmpdir(), 'topia-secrets-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(path.join(dir, 'config.js'), `const key = '${fakeKey}'\n`);
    git('add', 'config.js');
    return dir;
  }

  function scan(dir, command) {
    const hookPath = path.join(HOOKS_DIR, 'secrets-scan', 'index.cjs');
    const env = { ...process.env };
    delete env.CLAUDE_TOOL_INPUT;
    return spawnSync('node', [hookPath], {
      cwd: dir,
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf-8',
      env,
      timeout: 10000,
    });
  }

  test('blocks a commit of a staged key', () => {
    const dir = stagedRepo();
    try {
      const run = scan(dir, 'git commit -m "add config"');
      assert.strictEqual(run.status, 2, run.stderr);
      assert.ok(run.stderr.includes('AWS Access Key'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('catches the commit inside a chained or PowerShell-style line', () => {
    const dir = stagedRepo();
    try {
      assert.strictEqual(scan(dir, 'cd . && git commit -m x').status, 2);
      assert.strictEqual(scan(dir, 'git -C . commit -m x').status, 2);
      assert.strictEqual(scan(dir, 'Set-Location .; git commit -m x').status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lets other git commands through', () => {
    const dir = stagedRepo();
    try {
      assert.strictEqual(scan(dir, 'git status').status, 0);
      assert.strictEqual(scan(dir, 'git log --grep commit').status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- Auto-format and typecheck ---
// They read the edited file from stdin and run only the project's own Prettier
// or TypeScript, found through package.json. Fake tools stand in for the real ones.

describe('auto-format and typecheck: local tools only', () => {
  /** A project with an optional fake tool package whose bin script is `body`. */
  function project({ dep, pkg, bin, body, tsconfig = false }) {
    const dir = mkdtempSync(path.join(tmpdir(), 'topia-localtool-'));
    const manifest = { name: 'fixture', version: '1.0.0', devDependencies: dep ? { [dep]: '*' } : {} };
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    if (pkg) {
      const pkgDir = path.join(dir, 'node_modules', pkg);
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, bin: { [bin]: 'cli.cjs' } }));
      writeFileSync(path.join(pkgDir, 'cli.cjs'), body);
    }
    if (tsconfig) writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
    return dir;
  }

  function run(hook, dir, file, env = {}) {
    const hookPath = path.join(HOOKS_DIR, hook, 'index.cjs');
    return spawnSync('node', [hookPath], {
      cwd: dir,
      input: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        cwd: dir,
        tool_input: { file_path: file },
      }),
      encoding: 'utf-8',
      env: cleanEnv({ TOPIA_TYPECHECK_SETTLE_MS: '0', ...env }),
      timeout: 10000,
    });
  }

  // Fake Prettier: replaces the file named last on the command line.
  const FAKE_PRETTIER = "const f=process.argv[process.argv.length-1];require('fs').writeFileSync(f,'formatted\\n');";
  // Fake tsc: one error, exit 2, like tsc --noEmit with a type error.
  const FAKE_TSC =
    "console.log('src/a.ts(1,7): error TS2322: Type string is not assignable to type number.');process.exit(2);";

  test('auto-format runs the project Prettier on the edited file', () => {
    const dir = project({ dep: 'prettier', pkg: 'prettier', bin: 'prettier', body: FAKE_PRETTIER });
    try {
      const file = path.join(dir, 'a.js');
      writeFileSync(file, 'let  x\n');
      const res = run('auto-format', dir, 'a.js');
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(readFileSync(file, 'utf-8'), 'formatted\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('auto-format leaves the file alone when package.json does not list prettier', () => {
    const dir = project({ pkg: 'prettier', bin: 'prettier', body: FAKE_PRETTIER });
    try {
      const file = path.join(dir, 'a.js');
      writeFileSync(file, 'let  x\n');
      assert.strictEqual(run('auto-format', dir, 'a.js').status, 0);
      assert.strictEqual(readFileSync(file, 'utf-8'), 'let  x\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('auto-format reads Cursor afterFileEdit input (file_path at the top level)', () => {
    const dir = project({ dep: 'prettier', pkg: 'prettier', bin: 'prettier', body: FAKE_PRETTIER });
    try {
      const file = path.join(dir, 'a.css');
      writeFileSync(file, 'a{}\n');
      const res = spawnSync('node', [path.join(HOOKS_DIR, 'auto-format', 'index.cjs')], {
        cwd: dir,
        input: JSON.stringify({
          hook_event_name: 'afterFileEdit',
          cursor_version: '3.0.0',
          file_path: file,
          edits: [],
        }),
        encoding: 'utf-8',
        env: cleanEnv(),
        timeout: 10000,
      });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(readFileSync(file, 'utf-8'), 'formatted\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('typecheck tells Claude about errors through additionalContext', () => {
    const dir = project({ dep: 'typescript', pkg: 'typescript', bin: 'tsc', body: FAKE_TSC, tsconfig: true });
    try {
      mkdirSync(path.join(dir, 'src'));
      writeFileSync(path.join(dir, 'src', 'a.ts'), 'const n: number = "x"\n');
      const res = run('typecheck', dir, 'src/a.ts');
      assert.strictEqual(res.status, 0, res.stderr);
      const out = JSON.parse(res.stdout);
      assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
      assert.match(out.hookSpecificOutput.additionalContext, /TS2322/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('typecheck stays silent without typescript in package.json or without tsconfig.json', () => {
    const noDep = project({ pkg: 'typescript', bin: 'tsc', body: FAKE_TSC, tsconfig: true });
    const noConfig = project({ dep: 'typescript', pkg: 'typescript', bin: 'tsc', body: FAKE_TSC });
    try {
      for (const dir of [noDep, noConfig]) {
        writeFileSync(path.join(dir, 'a.ts'), 'x\n');
        const res = run('typecheck', dir, 'a.ts');
        assert.strictEqual(res.status, 0);
        assert.strictEqual(res.stdout.trim(), '');
      }
    } finally {
      rmSync(noDep, { recursive: true, force: true });
      rmSync(noConfig, { recursive: true, force: true });
    }
  });
});

// --- Cursor tool-level hooks ---
// Input and output shapes: https://cursor.com/docs/hooks
// Cursor permission hooks block on invalid or empty JSON, so every exit path prints JSON.

const REPO_ROOT = path.resolve(HOOKS_DIR, '..');

/** process.env without anything that marks a Cursor (or old Claude) hook run. */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CURSOR_') || key === 'CLAUDE_TOOL_INPUT') delete env[key];
  }
  return { ...env, ...extra };
}

function runCursorHook(hookName, event, { cwd, env = {} } = {}) {
  const hookPath = path.join(HOOKS_DIR, hookName, 'index.cjs');
  return spawnSync('node', [hookPath], {
    cwd: cwd || tmpdir(),
    input: JSON.stringify({ cursor_version: '3.0.0', ...event }),
    encoding: 'utf-8',
    env: cleanEnv(env),
    timeout: 10000,
  });
}

function onlyJson(stdout) {
  const lines = stdout.split('\n').filter((l) => l.trim());
  assert.strictEqual(lines.length, 1, `expected one JSON line, got: ${stdout}`);
  return JSON.parse(lines[0]);
}

describe('cursor-io: isCursorRuntime', () => {
  const io = path.join(HOOKS_DIR, 'lib', 'cursor-io.cjs');
  function detect(event) {
    const code = `process.stdout.write(String(require(${JSON.stringify(io)}).isCursorRuntime(${JSON.stringify(event)})))`;
    return execFileSync('node', ['-e', code], { encoding: 'utf-8', env: cleanEnv() });
  }

  test('a Claude Code event (PascalCase name) is not Cursor', () => {
    assert.strictEqual(detect({ hook_event_name: 'PreToolUse' }), 'false');
  });

  test('a Cursor event (camelCase name or cursor_version) is Cursor', () => {
    assert.strictEqual(detect({ hook_event_name: 'beforeReadFile' }), 'true');
    assert.strictEqual(detect({ cursor_version: '3.0.0' }), 'true');
  });
});

describe('pre-tool-guard under Cursor beforeReadFile', () => {
  const read = (file) => ({ hook_event_name: 'beforeReadFile', file_path: file, content: '' });

  test('allows a normal file with an explicit JSON allow', () => {
    const run = runCursorHook('pre-tool-guard', read('/proj/src/index.js'));
    assert.strictEqual(run.status, 0, run.stderr);
    assert.deepStrictEqual(onlyJson(run.stdout), { permission: 'allow' });
  });

  test('allows a safe exception with an explicit JSON allow', () => {
    const run = runCursorHook('pre-tool-guard', read('/proj/.env.example'));
    assert.deepStrictEqual(onlyJson(run.stdout), { permission: 'allow' });
  });

  test('denies a private key with only beforeReadFile output fields', () => {
    const run = runCursorHook('pre-tool-guard', read('/proj/id_rsa'));
    assert.strictEqual(run.status, 0, 'the JSON deny blocks; exit 0 so Cursor reads it');
    const out = onlyJson(run.stdout);
    assert.strictEqual(out.permission, 'deny');
    assert.ok(out.user_message.includes('id_rsa'));
    assert.deepStrictEqual(Object.keys(out).sort(), ['permission', 'user_message']);
  });

  test('a sensitive-file warning stays in Cursor format, never Claude format', () => {
    const run = runCursorHook('pre-tool-guard', {
      ...read('/proj/.env'),
      content: `KEY=AKIA${'Q'.repeat(16)}\n`,
    });
    assert.strictEqual(run.status, 0);
    const out = onlyJson(run.stdout);
    assert.strictEqual(out.permission, 'allow');
    assert.strictEqual(out.hookSpecificOutput, undefined);
    assert.strictEqual(out.systemMessage, undefined);
    assert.deepStrictEqual(Object.keys(out).sort(), ['permission', 'user_message']);
    assert.ok(out.user_message.includes('.env'));
    assert.ok(out.user_message.includes('AWS access key'), 'scans the content Cursor sends');
  });

  test('preToolUse (Claude hooks loaded by Cursor) gets the warning as agent_message', () => {
    const run = runCursorHook('pre-tool-guard', {
      hook_event_name: 'preToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/proj/.env' },
    });
    const out = onlyJson(run.stdout);
    assert.strictEqual(out.permission, 'allow');
    assert.ok(out.agent_message.includes('Sensitive file'));
  });

  test('allows on unreadable input instead of printing nothing', () => {
    const hookPath = path.join(HOOKS_DIR, 'pre-tool-guard', 'index.cjs');
    const run = spawnSync('node', [hookPath], {
      input: 'not json',
      encoding: 'utf-8',
      env: cleanEnv({ CURSOR_VERSION: '3.0.0' }),
      timeout: 10000,
    });
    assert.strictEqual(run.status, 0);
    assert.deepStrictEqual(onlyJson(run.stdout), { permission: 'allow' });
  });

  test('a Claude Code block still explains itself on stderr', () => {
    const hookPath = path.join(HOOKS_DIR, 'pre-tool-guard', 'index.cjs');
    const run = spawnSync('node', [hookPath], {
      input: '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"id_rsa"}}',
      encoding: 'utf-8',
      env: cleanEnv(),
      timeout: 10000,
    });
    assert.strictEqual(run.status, 2);
    assert.ok(run.stderr.includes('BLOCKED'));
  });
});

describe('secrets-scan under Cursor beforeShellExecution', () => {
  const fakeKey = `AKIA${'Q'.repeat(16)}`;

  function stagedRepo() {
    const dir = mkdtempSync(path.join(tmpdir(), 'topia-secrets-cursor-'));
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    writeFileSync(path.join(dir, 'config.js'), `const key = '${fakeKey}'\n`);
    git('add', 'config.js');
    return dir;
  }

  // Cursor sends the command and cwd at the top level, and plugin hooks run
  // from the plugin folder, so the scan must use the event's cwd.
  const shell = (command, cwd) => ({ hook_event_name: 'beforeShellExecution', command, cwd, sandbox: false });

  test('denies a commit of a staged key with Cursor JSON', () => {
    const dir = stagedRepo();
    try {
      const run = runCursorHook('secrets-scan', shell('git commit -m x', dir), { cwd: tmpdir() });
      assert.strictEqual(run.status, 0, run.stderr);
      const out = onlyJson(run.stdout);
      assert.strictEqual(out.permission, 'deny');
      assert.ok(out.agent_message.includes('AWS Access Key'));
      assert.ok(out.user_message.includes('secret'));
      assert.ok(!out.agent_message.includes(fakeKey), 'never echoes the secret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('allows other commands with an explicit JSON allow', () => {
    const dir = stagedRepo();
    try {
      const run = runCursorHook('secrets-scan', shell('git status', dir));
      assert.strictEqual(run.status, 0);
      assert.deepStrictEqual(onlyJson(run.stdout), { permission: 'allow' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('git-push-checkpoint under Cursor beforeShellExecution', () => {
  test('reads the top-level command and tells the agent about the checkpoint', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'topia-push-cursor-'));
    try {
      const run = runCursorHook(
        'git-push-checkpoint',
        { hook_event_name: 'beforeShellExecution', command: 'git push origin main', cwd: dir },
        { cwd: dir },
      );
      assert.strictEqual(run.status, 0, run.stderr);
      const out = onlyJson(run.stdout);
      assert.strictEqual(out.permission, 'allow');
      assert.match(out.agent_message, /git-push-checkpoint\] Push detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run-hook.cjs launcher for Cursor plugin hooks', () => {
  // The plugin command: node -e "require(...CURSOR_PLUGIN_ROOT...run-hook.cjs)" <hook>
  const launcher = "require(require('path').resolve(process.env.CURSOR_PLUGIN_ROOT||'.','hooks','run-hook.cjs'))";

  test('takes the hook name after node -e and runs in the project folder', () => {
    const project = mkdtempSync(path.join(tmpdir(), 'topia-cursor-proj-'));
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'topia-cursor-cwd-'));
    try {
      // A project privacy rule only takes effect if the hook runs in the project.
      mkdirSync(path.join(project, '.topia'));
      writeFileSync(path.join(project, '.topia', 'privacy.json'), JSON.stringify({ block: ['^notes\\.txt$'] }));
      const run = spawnSync('node', ['-e', launcher, 'pre-tool-guard'], {
        cwd: elsewhere,
        input: JSON.stringify({
          hook_event_name: 'beforeReadFile',
          cursor_version: '3.0.0',
          file_path: path.join(project, 'notes.txt'),
          content: '',
        }),
        encoding: 'utf-8',
        env: cleanEnv({ CURSOR_PLUGIN_ROOT: REPO_ROOT, CURSOR_PROJECT_DIR: project }),
        timeout: 10000,
      });
      assert.strictEqual(run.status, 0, run.stderr);
      assert.strictEqual(onlyJson(run.stdout).permission, 'deny');
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
