// PostToolUse on Bash|PowerShell — after a successful `git commit`, append
// {ts, subject, files} to .topia/learnings.jsonl. Node only, no LLM, no setup.
// The file stays bounded (see hooks/lib/memory-sources.cjs). Every failure is
// silent and the hook always exits 0.
//
// Optional: when agora-code is opted in (.topia/agora-commit-learn.flag or
// TOPIA_AGORA_COMMIT_LEARN=1), registered, and on PATH, it also runs
// `agora-code learn-from-commit`.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readStdinJson, isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const memory = require('../lib/memory-sources.cjs');
const { resolveTopiaDir } = require('../lib/topia-paths.cjs');

// `git commit` as its own command (start of line or after ; & | && ||, or
// inside a PowerShell/sub-shell group), allowing `git -c k=v commit`.
const GIT_COMMIT_RE = /(?:^|[;&|({\n]\s*)git(?:\s+-[cC]\s+\S+)*\s+commit\b/;
const FAILED_RE = /nothing to commit|nothing added to commit|no changes added to commit|Aborting commit|^(?:error|fatal):/im;
// `[main 1a2b3c4] subject` — git's one-line commit summary.
const SUMMARY_RE = /^\[[^\]\n]*?\s([0-9a-f]{7,40})\]/m;
const RECENT_SECONDS = 600;

function done(hookData) {
  if (isCursorRuntime(hookData)) writeHookResponse({});
  process.exit(0);
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
    windowsHide: true,
  });
}

function pickCwd(hookData) {
  const candidates = [hookData.cwd, process.env.CLAUDE_PROJECT_DIR, process.cwd()];
  for (const dir of candidates) {
    if (typeof dir !== 'string' || !dir) continue;
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* try next */
    }
  }
  return process.cwd();
}

function responseText(hookData) {
  const r = hookData.tool_response ?? hookData.toolResponse ?? hookData.tool_result ?? hookData.toolResult ?? {};
  if (typeof r === 'string') return r;
  return [r.stdout, r.stderr, r.output, r.error].filter((v) => typeof v === 'string').join('\n');
}

/** Read HEAD; null when it is not a fresh commit. */
function readHead(root, output) {
  const head = git(root, ['log', '-1', '--format=%H%x1f%ct%x1f%s']).trim();
  const [sha, ct, ...rest] = head.split('\x1f');
  if (!/^[0-9a-f]{40}$/.test(sha || '')) return null;
  const age = Date.now() / 1000 - Number(ct);
  if (!(age < RECENT_SECONDS)) return null;
  const summary = SUMMARY_RE.exec(output);
  if (summary && !sha.startsWith(summary[1])) return null;
  const files = git(root, ['show', '--name-only', '--format=', '--no-renames', 'HEAD'])
    .split('\n')
    .map((f) => f.trim())
    .filter(Boolean);
  return { sha, subject: rest.join('\x1f'), files };
}

/** Create .topia/ with a .gitignore so the log never dirties the repo. */
function ensureTopiaDir(root) {
  const resolved = resolveTopiaDir(root);
  if (fs.existsSync(resolved)) return resolved;
  fs.mkdirSync(resolved, { recursive: true });
  const ignore = '# Topia local memory (written by the commit-memory hook)\nlearnings.jsonl\n.gitignore\n';
  fs.writeFileSync(path.join(resolved, '.gitignore'), ignore);
  return resolved;
}

function recordCommit(hookData) {
  const command = String((hookData.tool_input || hookData.toolInput || {}).command || '');
  if (!GIT_COMMIT_RE.test(command)) return;
  const output = responseText(hookData);
  if (!SUMMARY_RE.test(output) && FAILED_RE.test(output)) return;

  const root = git(pickCwd(hookData), ['rev-parse', '--show-toplevel']).trim();
  if (!root) return;
  const head = readHead(root, output);
  if (!head) return;

  const files = head.files.slice(0, memory.MAX_FILES_PER_COMMIT);
  const row = {
    ts: new Date().toISOString(),
    type: 'commit',
    sha: head.sha,
    subject: head.subject.slice(0, memory.MAX_SUBJECT_CHARS),
    files,
  };
  if (head.files.length > files.length) row.more_files = head.files.length - files.length;
  const topiaDir = ensureTopiaDir(root);
  memory.appendCommitRow(path.join(topiaDir, 'learnings.jsonl'), row);
  return root;
}

function agoraLearn(root) {
  const { isAgoraMemoryRegistered, isAgoraCommitLearnEnabled, agoraCodeOnPath } = require('../lib/agora-detect.cjs');
  if (!isAgoraCommitLearnEnabled(root) || !isAgoraMemoryRegistered(root) || !agoraCodeOnPath()) return;
  execFileSync('agora-code', ['learn-from-commit', '--quiet'], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: 30000,
    windowsHide: true,
  });
}

async function main() {
  const hookData = await readStdinJson();
  let root;
  try {
    root = recordCommit(hookData || {});
  } catch {
    /* silent */
  }
  if (root) {
    try {
      agoraLearn(root);
    } catch {
      /* optional backend — silent */
    }
  }
  done(hookData || {});
}

main().catch(() => process.exit(0));
