#!/usr/bin/env node

/**
 * checkpoint-from-hook.js — Headless checkpoint writer for Topia hooks.
 *
 * Invoked by pre-compact, git-push-checkpoint, and context-lifecycle without an LLM.
 * Writes `.topia/checkpoint.md` and optional trigger markers.
 *
 * Usage:
 *   node skills/session-bridge/scripts/checkpoint-from-hook.js --root <cwd> --trigger pre-compact|git-push
 *   node skills/session-bridge/scripts/checkpoint-from-hook.js --root <cwd> --trigger git-push --json
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { resolveTopiaDir, topiaDirForWrite } from '../../../compiler/lib/topia-paths.js';

const STATE_FILES = ['progress.md', 'decisions.md', 'conventions.md'];

function cwdHash(cwd) {
  return Buffer.from(cwd).toString('base64url').slice(0, 16);
}

function readWatchState(cwd) {
  const counterFile = path.join(os.tmpdir(), `Topia-context-watch-${cwdHash(cwd)}.json`);
  try {
    return JSON.parse(readFileSync(counterFile, 'utf-8'));
  } catch {
    return { count: 0, toolCounts: {}, sessionStart: null, sessionId: null, pressureLevel: 'green' };
  }
}

function readStatePreview(topiaDir, filename, maxLines = 30) {
  const filePath = path.join(topiaDir, filename);
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return null;
    return content.split('\n').slice(0, maxLines).join('\n');
  } catch {
    return null;
  }
}

function gitSnapshot(root) {
  const snap = {
    branch: 'unknown',
    lastCommit: 'unknown',
    uncommitted: 'unknown',
    stashed: 'no',
  };
  try {
    snap.branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf-8' }).trim();
  } catch {
    /* not a git repo */
  }
  try {
    const hash = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf-8' }).trim();
    const subject = execSync('git log -1 --pretty=%s', { cwd: root, encoding: 'utf-8' }).trim();
    snap.lastCommit = `${hash} — ${subject}`;
  } catch {
    /* skip */
  }
  try {
    const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' }).trim();
    if (!status) snap.uncommitted = 'clean';
    else {
      const files = status.split('\n').slice(0, 15);
      snap.uncommitted = files.length > 14 ? `${files.length}+ files changed` : files.join('; ');
    }
  } catch {
    /* skip */
  }
  try {
    const stash = execSync('git stash list', { cwd: root, encoding: 'utf-8' }).trim();
    snap.stashed = stash ? 'yes' : 'no';
  } catch {
    /* skip */
  }
  return snap;
}

function extractRemainingTasks(progressPreview) {
  if (!progressPreview) return ['(no progress.md — add tasks via session-bridge Save)'];
  const lines = progressPreview.split('\n');
  const tasks = [];
  for (const line of lines) {
    if (/^\s*[-*]\s+\[[ xX]\]/.test(line) || /^\s*[-*]\s+/.test(line)) {
      tasks.push(line.trim());
      if (tasks.length >= 8) break;
    }
  }
  return tasks.length > 0 ? tasks : ['(see .topia/progress.md for full task list)'];
}

function extractLoadBearingDecisions(decisionsPreview) {
  if (!decisionsPreview) return ['(none recorded — run session-bridge Save after decisions)'];
  const lines = decisionsPreview.split('\n').filter((l) => l.trim().startsWith('-'));
  return lines.length > 0 ? lines.slice(0, 8) : ['(see .topia/decisions.md)'];
}

/**
 * @param {{ root: string, trigger: string }} opts
 */
export function writeCheckpointFromHook({ root, trigger }) {
  if (!root) throw new Error('writeCheckpointFromHook: root is required');

  const topiaRead = resolveTopiaDir(root);
  const topiaWrite = topiaDirForWrite(root);
  const hadPriorCheckpoint = existsSync(path.join(topiaRead, 'checkpoint.md'));

  if (!existsSync(topiaWrite)) mkdirSync(topiaWrite, { recursive: true });

  const watch = readWatchState(root);
  const git = gitSnapshot(root);
  const progressPreview = readStatePreview(topiaRead, 'progress.md');
  const decisionsPreview = readStatePreview(topiaRead, 'decisions.md');
  const conventionsPreview = readStatePreview(topiaRead, 'conventions.md', 15);

  const now = new Date();
  const stamp = now.toISOString().replace('T', ' ').slice(0, 16);
  const triggerLabel = trigger === 'git-push' ? 'git push' : trigger === 'pre-compact' ? 'pre-compact' : trigger;

  const topTools = Object.entries(watch.toolCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');

  const remaining = extractRemainingTasks(progressPreview);
  const decisions = extractLoadBearingDecisions(decisionsPreview);

  const resumeHint =
    trigger === 'git-push'
      ? 'Work was pushed to remote. Start a fresh session or run /compact, then resume from this checkpoint.'
      : 'Compaction pending or recommended. After /compact, read this checkpoint first.';

  const checkpoint = [
    `# Checkpoint — ${stamp}`,
    '',
    `> Auto-written by Topia hook (\`${triggerLabel}\`). Invoke \`topia:context-lifecycle\` after compact to confirm resume.`,
    '',
    '## What I Was Doing',
    progressPreview
      ? progressPreview.split('\n').slice(0, 3).join(' ')
      : `[Session checkpoint at ${triggerLabel} — see progress.md]`,
    '',
    '## Current Git State',
    `- Branch: ${git.branch}`,
    `- Last commit: ${git.lastCommit}`,
    `- Uncommitted changes: ${git.uncommitted}`,
    `- Stashed: ${git.stashed}`,
    '',
    '## Session Metrics',
    `- Tool calls: ${watch.count || 0}`,
    `- Pressure level: ${watch.pressureLevel || 'unknown'}`,
    topTools ? `- Top tools: ${topTools}` : '',
    '',
    '## Decisions Made This Session (Load-Bearing)',
    ...decisions.map((d) => (d.startsWith('-') ? d : `- ${d}`)),
    '',
    "## What's Left (Ordered)",
    ...remaining.map((t, i) => (t.match(/^\d+\./) ? t : `${i + 1}. ${t}`)),
    '',
    '## Context the Next Session Needs',
    conventionsPreview
      ? `- Conventions in effect:\n${conventionsPreview
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n')}`
      : '- (no conventions.md yet)',
    `- Trigger: ${triggerLabel} at ${now.toISOString()}`,
    '',
    '## Resume Command',
    resumeHint,
    '',
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const checkpointPath = path.join(topiaWrite, 'checkpoint.md');
  writeFileSync(checkpointPath, checkpoint);

  if (trigger === 'git-push') {
    writeFileSync(
      path.join(topiaWrite, '.last-push-checkpoint'),
      JSON.stringify({ at: now.toISOString(), tool_calls: watch.count || 0 }, null, 2),
    );
  }

  return {
    ok: true,
    checkpointPath,
    hadPriorCheckpoint,
    toolCalls: watch.count || 0,
    topTools: watch.toolCounts || {},
    trigger: triggerLabel,
    pressureLevel: watch.pressureLevel || 'green',
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', default: process.cwd() },
      trigger: { type: 'string', default: 'pre-compact' },
      json: { type: 'boolean', default: false },
    },
  });

  const result = writeCheckpointFromHook({
    root: values.root,
    trigger: values.trigger || 'pre-compact',
  });

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Checkpoint written: ${result.checkpointPath} (${result.toolCalls} tool calls, trigger=${result.trigger})\n`,
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  process.argv[1]?.endsWith('checkpoint-from-hook.js');

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`checkpoint-from-hook: ${err.message}\n`);
    process.exit(1);
  });
}
