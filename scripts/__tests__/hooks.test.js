/**
 * Hook Tests — intent-router + pre-tool-guard (privacy nexus)
 *
 * Tests hook scripts via child_process to verify stdin/stdout behavior.
 */

import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
