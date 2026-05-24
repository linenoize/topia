/**
 * ensure-gitignore.js — Prompt once per project to add Topia ignore rules.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

export const SKIP_GITIGNORE_FLAG = 'skip-gitignore.flag';

export const TOPIA_GITIGNORE_BLOCK = `# Topia — local session state (do not commit)
/.topia/*
!/.topia/org/
!/.topia/org/**
!/.topia/active-packs.json
.remember/
.mcp.json
`;

export const REQUIRED_PATTERNS = ['/.topia/*', '!/.topia/org/', '.remember/', '.mcp.json'];

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export function gitignoreHasTopiaPatterns(content) {
  if (!content) return false;
  return REQUIRED_PATTERNS.every((p) => content.includes(p));
}

export function isGitRepo(projectRoot) {
  return existsSync(path.join(projectRoot, '.git'));
}

function readGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) return '';
  return readFileSync(gitignorePath, 'utf-8');
}

function writeGitignore(projectRoot, content) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const needsNewline = content.length > 0 && !content.endsWith('\n');
  const block = needsNewline ? `\n${TOPIA_GITIGNORE_BLOCK}` : TOPIA_GITIGNORE_BLOCK;
  writeFileSync(gitignorePath, content + block, 'utf-8');
}

function writeSkipFlag(projectRoot) {
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, '.topia', SKIP_GITIGNORE_FLAG),
    `${new Date().toISOString()}\n`,
    'utf-8',
  );
}

function hasSkipFlag(projectRoot) {
  return existsSync(path.join(projectRoot, '.topia', SKIP_GITIGNORE_FLAG));
}

export async function ensureTopiaGitignore({
  projectRoot = process.cwd(),
  interactive = true,
  autoYes = false,
  dryRun = false,
  log = () => {},
} = {}) {
  if (!isGitRepo(projectRoot)) {
    log('i', 'Not a git repository — skip .gitignore setup.');
    return { status: 'not_git' };
  }

  const existing = readGitignore(projectRoot);
  if (gitignoreHasTopiaPatterns(existing)) {
    log('ok', '.gitignore already includes Topia entries');
    return { status: 'already_ok', added: false };
  }

  if (hasSkipFlag(projectRoot)) {
    log('-', 'Topia .gitignore setup skipped previously');
    return { status: 'skipped_flag', added: false };
  }

  if (!interactive && !autoYes) {
    if (!dryRun) writeSkipFlag(projectRoot);
    log('-', 'Gitignore setup deferred (non-interactive, no --yes).');
    return { status: 'pending', added: false };
  }

  const shouldAutoApply = autoYes;
  let accept = shouldAutoApply;

  if (!shouldAutoApply) {
    console.log('');
    console.log('  Topia writes .topia/ session state and may create .mcp.json.');
    console.log('  Add standard ignore rules to .gitignore? [Y/n]');
    const answer = await prompt('  > ');
    accept = answer === '' || answer === 'y' || answer === 'yes';
  }

  if (!accept) {
    if (!dryRun) writeSkipFlag(projectRoot);
    log('-', 'Declined — run topia doctor to verify .gitignore later.');
    return { status: 'prompted_declined', added: false };
  }

  if (dryRun) {
    log('.', '[dry-run] would append Topia block to .gitignore');
    return { status: 'dry_run_would_add', added: false };
  }

  writeGitignore(projectRoot, existing);
  const status = shouldAutoApply ? 'auto_added' : 'prompted_added';
  log('ok', 'Added Topia entries to .gitignore');
  return { status, added: true };
}

function findTrackedTopiaPaths(projectRoot) {
  try {
    const out = execFileSync('git', ['ls-files', '.topia', '.mcp.json'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (!out) return [];
    return out.split('\n').filter(Boolean).filter((p) => {
      if (p === '.mcp.json') return true;
      if (p === '.topia/active-packs.json') return false;
      if (p.startsWith('.topia/org/')) return false;
      if (p.startsWith('.topia/')) return true;
      return false;
    });
  } catch {
    return [];
  }
}

export function checkGitignore(projectRoot) {
  const results = { checks: [], warnings: [], errors: [], healthy: true };

  if (!isGitRepo(projectRoot)) {
    results.checks.push({ name: 'Gitignore (Topia)', status: 'skip', detail: 'Not a git repository' });
    return results;
  }

  if (hasSkipFlag(projectRoot)) {
    results.checks.push({ name: 'Gitignore (Topia)', status: 'warn', detail: 'User declined auto-setup' });
    results.warnings.push('Topia .gitignore setup was declined — add block manually or re-run install.');
  } else if (gitignoreHasTopiaPatterns(readGitignore(projectRoot))) {
    results.checks.push({ name: 'Gitignore (Topia)', status: 'pass' });
  } else {
    results.checks.push({ name: 'Gitignore (Topia)', status: 'warn', detail: 'Missing Topia ignore patterns' });
    results.warnings.push('Add Topia block to .gitignore (run topia install in project).');
    results.warnings.push(`Suggested block:\n${TOPIA_GITIGNORE_BLOCK}`);
    results.healthy = false;
  }

  const tracked = findTrackedTopiaPaths(projectRoot);
  if (tracked.length > 0) {
    results.checks.push({
      name: 'Tracked Topia local files',
      status: 'warn',
      detail: `${tracked.length} path(s) should be untracked`,
    });
    for (const p of tracked) results.warnings.push(`Tracked but should be ignored: ${p}`);
    results.healthy = false;
  } else {
    results.checks.push({ name: 'Tracked Topia local files', status: 'pass' });
  }

  return results;
}

export function appendGitignoreChecks(results, projectRoot) {
  const gi = checkGitignore(projectRoot);
  results.checks.push(...gi.checks);
  results.warnings.push(...gi.warnings);
  results.errors.push(...gi.errors);
  if (!gi.healthy) results.healthy = false;
  return results;
}
