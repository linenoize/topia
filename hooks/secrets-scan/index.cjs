// Topia Secrets Scan Hook
// Claude Code: PreToolUse on Bash. Cursor: beforeShellExecution.
// Intercepts git commit commands and scans staged files for hardcoded secrets.
//
// Patterns based on gitleaks + common AI-generated secret leaks.
// Zero false-positive tolerance on BLOCK patterns.

const { spawnSync } = require('child_process');
const fs = require('fs');
const { isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');

// Claude Code and Cursor pass the hook input as JSON on stdin. CLAUDE_TOOL_INPUT
// is kept only as a fallback for older wiring; Claude Code never sets it.
function readEvent() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) return JSON.parse(raw);
  } catch {
    // No stdin or not JSON: fall back below.
  }
  return {};
}

function readCommand(event) {
  // Claude Code: tool_input.command. Cursor beforeShellExecution: command at the top level.
  const toolInput = event.tool_input || event.toolInput || {};
  if (typeof toolInput.command === 'string') return toolInput.command;
  if (typeof event.command === 'string') return event.command;
  try {
    return JSON.parse(process.env.CLAUDE_TOOL_INPUT || '{}').command || '';
  } catch {
    return '';
  }
}

// The folder the command runs in. Cursor runs plugin hooks from the plugin
// folder, so the event's cwd is the only reliable pointer to the repo.
function commandCwd(event) {
  const cwd = typeof event.cwd === 'string' ? event.cwd : '';
  try {
    if (cwd && fs.statSync(cwd).isDirectory()) return cwd;
  } catch {
    // Missing folder: use our own cwd.
  }
  return process.cwd();
}

const event = readEvent();
const cursor = isCursorRuntime(event);

// Cursor permission hooks block on empty or invalid JSON, so always answer.
// https://cursor.com/docs/hooks
function allowAndExit() {
  if (cursor) writeHookResponse({ permission: 'allow' });
  process.exit(0);
}

const command = readCommand(event).trim();

// A git commit anywhere in the line: chained (`cd x && git commit`), after a
// PowerShell `;`, or with `git -C <dir>` / `git -c k=v` options first.
const GIT_COMMIT_RE = /(?:^|[\s;&|(])git(?:\s+-[Cc]\s+\S+)*\s+commit\b/;

if (!GIT_COMMIT_RE.test(command)) {
  // Not a commit — pass through
  allowAndExit();
}

const cwd = commandCwd(event);

// Get staged files
let stagedFiles;
try {
  const result = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error();
  stagedFiles = result.stdout
    .trim()
    .split('\n')
    .filter(f => f.length > 0);
} catch {
  // Not in a git repo or no staged files — pass through
  allowAndExit();
}

if (stagedFiles.length === 0) {
  allowAndExit();
}

// Secret patterns (high-confidence, low false-positive)
const BLOCK_PATTERNS = [
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', regex: /gh[ps]_[A-Za-z0-9_]{36,}/ },
  { name: 'Slack Token', regex: /xox[bpors]-[0-9a-zA-Z-]{10,}/ },
  { name: 'Stripe Key', regex: /[sr]k_(live|test)_[0-9a-zA-Z]{24,}/ },
  { name: 'SendGrid Key', regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/ },
  { name: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/ },
  { name: 'Firebase Key', regex: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Private Key', regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'OpenAI Key', regex: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic Key', regex: /sk-ant-[A-Za-z0-9_-]{32,}/ },
];

// Files to always skip (test fixtures, examples)
const SKIP_PATHS = /\/(test|tests|__tests__|fixtures|__mocks__|examples?|\.test\.|\.spec\.)/i;

// Scan staged content (not files on disk — staged content via git show)
const findings = [];

for (const file of stagedFiles) {
  // Skip test/fixture files
  if (SKIP_PATHS.test(file)) continue;

  // Skip binary files and lockfiles
  if (/\.(png|jpg|gif|ico|woff|ttf|lock|lockb)$/i.test(file)) continue;

  let content;
  try {
    const result = spawnSync('git', ['show', `:${file}`], { cwd, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    if (result.status !== 0) continue;
    content = result.stdout;
  } catch {
    continue; // File deleted or binary
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          file,
          line: i + 1,
          pattern: pattern.name,
          snippet: line.substring(0, 80).trim(),
        });
      }
    }
  }
}

if (findings.length > 0) {
  if (cursor) {
    // A JSON deny with exit 0: Cursor uses the JSON, so both messages arrive.
    // No snippets here, so the secret is not copied into the chat.
    const where = findings.map((f) => `${f.file}:${f.line} (${f.pattern})`).join(', ');
    writeHookResponse({
      permission: 'deny',
      user_message: `Topia blocked this commit: staged files contain secrets (${where}).`,
      agent_message:
        `[Topia secrets-scan] BLOCKED — hardcoded secrets in staged files: ${where}. ` +
        'Remove them, load them from environment variables, and stage the files again.',
    });
    process.exit(0);
  }

  console.error('\n\u{1F6A8} [Topia secrets-scan] BLOCKED — hardcoded secrets detected in staged files:\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.pattern}`);
    console.error(`    ${f.snippet}...`);
  }
  console.error('\n  Fix: Remove secrets, use environment variables instead.');
  console.error('  Override: git commit --no-verify (NOT recommended)\n');

  // BLOCK the commit
  process.exit(2);
}

// No secrets found — allow commit
allowAndExit();
