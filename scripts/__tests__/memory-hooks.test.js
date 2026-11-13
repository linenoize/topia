/**
 * Memory hooks — session-start memory block + commit-memory capture.
 *
 * Spawns the real hooks with stdin JSON against temp dirs and an isolated HOME,
 * so nothing touches the developer's own settings or repos.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN_HOOK = path.resolve(__dirname, '../../hooks/run-hook.cjs');

const cleanups = [];
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

/** A project dir plus a separate fake HOME (so ~/.claude and ~/.cursor are empty). */
function makeProject() {
  const root = tempDir('topia-mem-');
  const home = tempDir('topia-home-');
  mkdirSync(path.join(home, '.claude'), { recursive: true });
  return { root, home };
}

function runHook(hook, { root, home }, payload, extraEnv = {}) {
  const res = spawnSync(process.execPath, [RUN_HOOK, hook], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PROJECT_DIR: root,
      TOPIA_NO_AUTOREPAIR: '1',
      TOPIA_AGORA_COMMIT_LEARN: '',
      CURSOR_HOOK: '',
      CURSOR_AGENT: '',
      CURSOR_VERSION: '',
      CURSOR_PROJECT_DIR: '',
      ...extraEnv,
    },
  });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
}

function writeTopia(root, name, content) {
  mkdirSync(path.join(root, '.topia'), { recursive: true });
  writeFileSync(path.join(root, '.topia', name), content);
}

function runSession(project, extraEnv) {
  return runHook(
    'session-start',
    project,
    { hook_event_name: 'SessionStart', source: 'startup', cwd: project.root },
    extraEnv,
  );
}

const MCP_WORDS = /neural-memory|nmem_|agora|recall_learnings/i;

describe('session-start: memory block', () => {
  test('never mentions an MCP memory backend that is not installed', () => {
    const project = makeProject();
    writeTopia(project.root, 'progress.md', '# Progress\n\n## [2026-01-01 10:00] Session Summary\n- did a thing\n');
    const { stdout, status } = runSession(project);
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, MCP_WORDS);
    assert.doesNotMatch(stdout, /Memory checklist/);
  });

  test('lists only the sources found on disk and points to recall and journal', () => {
    const project = makeProject();
    writeTopia(project.root, 'decisions.md', '# Decisions\n\n## [2026-01-01] Decision: use sqlite\n');
    writeTopia(
      project.root,
      'learnings.jsonl',
      '{"ts":"2026-01-01T00:00:00Z","type":"insight","key":"k","insight":"x"}\n',
    );
    const { stdout, status } = runSession(project);
    assert.equal(status, 0);
    assert.match(stdout, /topia:recall/);
    assert.match(stdout, /topia:journal/);
    assert.match(stdout, /\.topia\/ \(.*decisions\.md.*learnings\.jsonl.*\)/);
    assert.doesNotMatch(stdout, /\.remember\//);

    mkdirSync(path.join(project.root, '.remember'), { recursive: true });
    writeFileSync(path.join(project.root, '.remember', 'now.md'), 'working on parser\n');
    const again = runSession(project);
    assert.match(again.stdout, /\.remember\//);
  });

  test('prints no memory block when no memory source exists', () => {
    const project = makeProject();
    const { stdout, status } = runSession(project);
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /\[topia: memory\]/);
    assert.doesNotMatch(stdout, MCP_WORDS);
  });

  test('mentions neural-memory or agora only when registered in an MCP config', () => {
    const project = makeProject();
    writeTopia(project.root, 'progress.md', '## [2026-01-01] Session Summary\n- a\n');
    writeFileSync(
      path.join(project.root, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'neural-memory': { command: 'nmem-mcp' } } }),
    );
    const nmem = runSession(project);
    assert.equal(nmem.status, 0);
    assert.match(nmem.stdout, /neural-memory MCP/);
    assert.doesNotMatch(nmem.stdout, /agora/i);

    writeFileSync(
      path.join(project.root, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'agora-memory': { command: 'agora-code', args: ['memory-server'] } } }),
    );
    const agora = runSession(project);
    assert.equal(agora.status, 0);
    assert.match(agora.stdout, /agora-memory MCP/);
    assert.doesNotMatch(agora.stdout, /neural-memory/);
  });

  test('injects only the newest entries of progress.md and points to recall for the rest', () => {
    const project = makeProject();
    const entries = [];
    for (let i = 1; i <= 12; i++)
      entries.push(`## [2026-01-${String(i).padStart(2, '0')}] Session Summary\n- entry ${i}\n`);
    writeTopia(project.root, 'progress.md', `# Progress\n\n${entries.join('\n')}`);
    const { stdout, status } = runSession(project);
    assert.equal(status, 0);
    assert.match(stdout, /- entry 12\b/);
    assert.doesNotMatch(stdout, /- entry 1\n/);
    assert.doesNotMatch(stdout, /- entry 6\b/);
    assert.match(stdout, /older entries.*topia:recall/);
  });

  test('caps bytes injected per file and in total', () => {
    const project = makeProject();
    const huge = `## [2026-01-01] Session Summary\n${'x'.repeat(200)}\n`.repeat(400);
    for (const f of ['progress.md', 'decisions.md', 'conventions.md', 'DEVELOPER-GUIDE.md', 'RESCUE-STATE.md']) {
      writeTopia(project.root, f, huge);
    }
    const { stdout, status } = runSession(project);
    assert.equal(status, 0);
    assert.ok(Buffer.byteLength(stdout) < 20000, `session-start output too big: ${Buffer.byteLength(stdout)} bytes`);
  });

  test('shows a short tail of learnings.jsonl', () => {
    const project = makeProject();
    const lines = [];
    for (let i = 1; i <= 30; i++) {
      lines.push(
        JSON.stringify({
          ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
          type: 'commit',
          insight: `subject ${i}`,
        }),
      );
    }
    writeTopia(project.root, 'learnings.jsonl', `${lines.join('\n')}\n`);
    const { stdout, status } = runSession(project);
    assert.equal(status, 0);
    assert.match(stdout, /subject 30\b/);
    assert.doesNotMatch(stdout, /subject 2\b/);
  });

  test('stays silent and exits 0 when a state file cannot be read', () => {
    const project = makeProject();
    mkdirSync(path.join(project.root, '.topia', 'progress.md'), { recursive: true });
    writeTopia(project.root, 'learnings.jsonl', 'not json\n{"broken":\n');
    const { status, stderr } = runSession(project);
    assert.equal(status, 0);
    assert.doesNotMatch(stderr, /Error|at .*index\.cjs/);
  });

  test('emits a single JSON object under Cursor', () => {
    const project = makeProject();
    writeTopia(project.root, 'progress.md', '## [2026-01-01] Session Summary\n- a\n');
    const { stdout, status } = runSession(project, { CURSOR_HOOK: '1' });
    assert.equal(status, 0);
    const lines = stdout.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.match(parsed.additional_context, /topia:recall/);
  });
});

// --- commit-memory ---

const GIT_ID = ['-c', 'user.name=Topia Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];

function git(root, args) {
  return execFileSync('git', [...GIT_ID, ...args], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function makeRepo() {
  const project = makeProject();
  git(project.root, ['init', '-q']);
  return project;
}

function commitFile(project, name, subject) {
  writeFileSync(path.join(project.root, name), `${subject}\n`);
  git(project.root, ['add', name]);
  return git(project.root, ['commit', '-q', '-m', subject]);
}

function commitPayload(
  project,
  command = 'git commit -m "x"',
  toolResponse = { stdout: '', stderr: '' },
  tool = 'Bash',
) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: tool,
    tool_input: { command },
    tool_response: toolResponse,
    cwd: project.root,
    session_id: 's-test',
  };
}

function learnings(project) {
  const file = path.join(project.root, '.topia', 'learnings.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('commit-memory: automatic capture after git commit', () => {
  test('appends time, subject and files after a successful commit', () => {
    const project = makeRepo();
    commitFile(project, 'parser.js', 'Add parser for config files');
    const { status } = runHook('commit-memory', project, commitPayload(project));
    assert.equal(status, 0);
    const rows = learnings(project);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 'commit');
    assert.equal(rows[0].subject, 'Add parser for config files');
    assert.deepEqual(rows[0].files, ['parser.js']);
    assert.match(rows[0].ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(rows[0].sha, /^[0-9a-f]{40}$/);
  });

  test('does not record the same commit twice', () => {
    const project = makeRepo();
    commitFile(project, 'a.txt', 'First change');
    runHook('commit-memory', project, commitPayload(project));
    runHook('commit-memory', project, commitPayload(project));
    assert.equal(learnings(project).length, 1);
  });

  test('works for the PowerShell tool and chained commands', () => {
    const project = makeRepo();
    commitFile(project, 'b.txt', 'Second change');
    runHook('commit-memory', project, commitPayload(project, 'git add -A; git commit -m "y"', {}, 'PowerShell'));
    assert.equal(learnings(project).length, 1);
  });

  test('ignores commands that are not git commit', () => {
    const project = makeRepo();
    commitFile(project, 'c.txt', 'Third change');
    runHook('commit-memory', project, commitPayload(project, 'git status'));
    runHook('commit-memory', project, commitPayload(project, 'echo "git commit later"; ls'));
    assert.equal(learnings(project).length, 0);
  });

  test('ignores a commit command that failed', () => {
    const project = makeRepo();
    commitFile(project, 'd.txt', 'Fourth change');
    runHook(
      'commit-memory',
      project,
      commitPayload(project, 'git commit -m z', { stdout: 'On branch main\nnothing to commit, working tree clean\n' }),
    );
    assert.equal(learnings(project).length, 0);
  });

  test('keeps the repo clean: the new .topia/ is ignored by git', () => {
    const project = makeRepo();
    commitFile(project, 'e.txt', 'Fifth change');
    runHook('commit-memory', project, commitPayload(project));
    assert.equal(learnings(project).length, 1);
    assert.equal(git(project.root, ['status', '--porcelain']).trim(), '');
  });

  test('bounds the file: old commit rows are dropped, other rows are kept', () => {
    const project = makeRepo();
    const seed = [JSON.stringify({ ts: '2025-01-01T00:00:00Z', type: 'decision', key: 'keep-me', insight: 'kept' })];
    for (let i = 0; i < 600; i++) {
      seed.push(
        JSON.stringify({
          ts: '2025-01-02T00:00:00Z',
          type: 'commit',
          sha: `${i}`.padStart(40, '0'),
          subject: `old ${i}`,
        }),
      );
    }
    writeTopia(project.root, 'learnings.jsonl', `${seed.join('\n')}\n`);
    commitFile(project, 'f.txt', 'Newest change');
    runHook('commit-memory', project, commitPayload(project));
    const rows = learnings(project);
    const commits = rows.filter((r) => r.type === 'commit');
    assert.ok(commits.length <= 300, `too many commit rows: ${commits.length}`);
    assert.equal(commits.at(-1).subject, 'Newest change');
    assert.ok(
      rows.some((r) => r.key === 'keep-me'),
      'non-commit row kept',
    );
    const size = readFileSync(path.join(project.root, '.topia', 'learnings.jsonl')).length;
    assert.ok(size <= 512 * 1024);
  });

  test('exits 0 silently outside a git repo and on bad input', () => {
    const project = makeProject();
    for (const input of [commitPayload(project), 'not json', '']) {
      const { status, stdout } = runHook('commit-memory', project, input);
      assert.equal(status, 0);
      // `{}` is the empty hook response (payloads carry hook_event_name).
      assert.ok(['', '{}'].includes(stdout.trim()), stdout);
    }
    assert.equal(existsSync(path.join(project.root, '.topia')), false);
  });
});
