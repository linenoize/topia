#!/usr/bin/env node

/**
 * gather-memories.js — Read file-based memory sources for topia:recall.
 *
 * Usage:
 *   node skills/recall/scripts/gather-memories.js --root <project> [--json] [--topic <text>]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveTopiaDir } from '../../../compiler/lib/topia-paths.js';

const TOPIA_FILES = [
  'progress.md',
  'decisions.md',
  'checkpoint.md',
  'session-log.md',
  'conventions.md',
  'cumulative-notes.md',
  'instincts.md',
];

const REMEMBER_FILES = ['now.md', 'recent.md', 'remember.md'];

/**
 * @param {string} dir
 * @returns {string | null}
 */
function latestTodayFile(dir) {
  if (!existsSync(dir)) return null;
  const todayFiles = readdirSync(dir)
    .filter((name) => /^today-.*\.md$/i.test(name))
    .map((name) => path.join(dir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return todayFiles[0] ?? null;
}

/**
 * @param {string} filePath
 * @param {number} maxChars
 * @returns {{ path: string, content: string, truncated: boolean } | null}
 */
function readSnippet(filePath, maxChars = 4000) {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) return null;
  const truncated = raw.length > maxChars;
  return {
    path: filePath,
    content: truncated ? `${raw.slice(0, maxChars)}\n\n…[truncated]` : raw,
    truncated,
  };
}

/**
 * @param {string} filePath
 * @param {number} maxLines
 * @returns {{ path: string, content: string, truncated: boolean } | null}
 */
function readJsonlTail(filePath, maxLines = 20) {
  if (!existsSync(filePath)) return null;
  const lines = readFileSync(filePath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const tail = lines.slice(-maxLines);
  return {
    path: filePath,
    content: tail.join('\n'),
    truncated: lines.length > maxLines,
  };
}

/**
 * @param {string} root
 * @param {{ topic?: string, maxChars?: number }} [opts]
 */
export function gatherMemories(root, opts = {}) {
  const maxChars = opts.maxChars ?? 4000;
  const sources = [];
  const missing = [];

  const topiaDir = resolveTopiaDir(root);
  for (const file of TOPIA_FILES) {
    const snippet = readSnippet(path.join(topiaDir, file), maxChars);
    if (snippet) {
      sources.push({ source: '.topia', kind: 'state', name: file, ...snippet });
    }
  }

  const learnings = readJsonlTail(path.join(topiaDir, 'learnings.jsonl'));
  if (learnings) {
    sources.push({ source: '.topia', kind: 'learnings', name: 'learnings.jsonl', ...learnings });
  }

  const rememberDir = path.join(root, '.remember');
  for (const file of REMEMBER_FILES) {
    const snippet = readSnippet(path.join(rememberDir, file), maxChars);
    if (snippet) {
      sources.push({ source: '.remember', kind: 'session', name: file, ...snippet });
    }
  }

  const todayPath = latestTodayFile(rememberDir);
  if (todayPath) {
    const snippet = readSnippet(todayPath, maxChars);
    if (snippet) {
      sources.push({
        source: '.remember',
        kind: 'session',
        name: path.basename(todayPath),
        ...snippet,
      });
    }
  }

  const identityPath = path.join(root, '.claude', 'remember', 'identity.md');
  const identity = readSnippet(identityPath, maxChars);
  if (identity) {
    sources.push({ source: '.claude/remember', kind: 'identity', name: 'identity.md', ...identity });
  }

  if (sources.length === 0) {
    missing.push('.topia/', '.remember/', '.claude/remember/identity.md');
  }

  return {
    root,
    topic: opts.topic ?? null,
    gatheredAt: new Date().toISOString(),
    sources,
    missing,
    mcpHint: {
      neuralMemory: 'nmem_recall (if neural-memory MCP registered)',
      agoraMemory: 'recall_learnings (if agora-memory MCP registered)',
    },
  };
}

function parseArgs(argv) {
  const out = { root: process.cwd(), json: false, topic: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--root') out.root = argv[++i];
    else if (arg === '--topic') out.topic = argv[++i];
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const result = gatherMemories(args.root, { topic: args.topic });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.sources.length === 0) {
    process.stdout.write('No file-based memories found.\n');
    process.stdout.write('Optional MCP: nmem_recall / recall_learnings when registered.\n');
  } else {
    for (const item of result.sources) {
      process.stdout.write(`\n=== ${item.source}/${item.name} ===\n${item.content}\n`);
    }
  }
}
