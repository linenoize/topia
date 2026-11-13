/**
 * Hook Tests — intent-router + pre-tool-guard (privacy nexus)
 *
 * Tests hook scripts via child_process to verify stdin/stdout behavior.
 */

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOKS_DIR = path.resolve(__dirname, '../../hooks');

/**
 * Run a hook with given stdin input and environment
 * @returns {{ stdout: string, exitCode: number }}
 */
function runHook(hookName, stdinInput, env = {}) {
  const hookPath = path.join(HOOKS_DIR, hookName, 'index.cjs');
  try {
    const stdout = execFileSync('node', [hookPath], {
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
  test('suggests the skill the wording points at, from the table shipped in hooks/lib', () => {
    const { stdout, exitCode } = runHook('intent-router', '{"prompt": "fix the crash and add a unit test"}', {
      CLAUDE_PLUGIN_ROOT: '/nonexistent',
      CURSOR_HOOK: '',
    });
    assert.strictEqual(exitCode, 0);
    assert.match(stdout, /\[Topia intent-router\] Suggested: topia:build \(L1, sonnet\) — wording: "fix", "add"/);
    assert.match(stdout, /Also consider: test, debug/);
  });

  test('stays silent when nothing matches or the skill is named outright', () => {
    for (const prompt of ['hello there, how are you', 'update the address field', '/topia-debug the login crash']) {
      const { stdout, exitCode } = runHook('intent-router', JSON.stringify({ prompt }), { CURSOR_HOOK: '' });
      assert.strictEqual(exitCode, 0);
      assert.strictEqual(stdout.trim(), '', prompt);
    }
  });

  test('prints nothing under Cursor, which wants JSON on stdout', () => {
    const { stdout, exitCode } = runHook('intent-router', '{"prompt": "fix the crash"}', { CURSOR_HOOK: '1' });
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '');
  });

  test('exits silently on empty prompt', () => {
    const { stdout, exitCode } = runHook('intent-router', '{"user_prompt": ""}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '');
  });

  test('exits silently on very short prompt', () => {
    const { stdout, exitCode } = runHook('intent-router', '{"user_prompt": "hi"}');
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.trim(), '');
  });

  test('graceful on invalid JSON', () => {
    const { exitCode } = runHook('intent-router', 'not json');
    assert.strictEqual(exitCode, 0, 'should exit cleanly on invalid JSON');
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
