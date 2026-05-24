#!/usr/bin/env node

/**
 * inject-claude-md.js — Idempotent editor for CLAUDE.md pointer blocks.
 *
 * Blocks:
 *   <!-- @Topia-invariants-pointer:start|end -->
 *   <!-- @Topia-context-pointer:start|end -->
 *
 * Usage as module:
 *   import { injectInvariantsPointer, injectContextPointer } from './inject-claude-md.js';
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { INVARIANTS_REL_PATH } from '../../../compiler/lib/topia-paths.js';

export const MARKER_START = '<!-- @Topia-invariants-pointer:start -->';
export const MARKER_END = '<!-- @Topia-invariants-pointer:end -->';
export const SKIP_DIRECTIVE = '<!-- @Topia-invariants-pointer:skip -->';

export const CONTEXT_MARKER_START = '<!-- @Topia-context-pointer:start -->';
export const CONTEXT_MARKER_END = '<!-- @Topia-context-pointer:end -->';
export const CONTEXT_SKIP_DIRECTIVE = '<!-- @Topia-context-pointer:skip -->';

const DEFAULT_INVARIANTS_PATH = INVARIANTS_REL_PATH;
const MAX_GLOBS_IN_POINTER = 8;

export function buildPointerBlock({ globs = [], invariantsPath = DEFAULT_INVARIANTS_PATH } = {}) {
  const unique = Array.from(new Set(globs.filter((g) => typeof g === 'string' && g.trim())));
  const shown = unique.slice(0, MAX_GLOBS_IN_POINTER);
  const overflow = unique.length - shown.length;

  const lines = [
    MARKER_START,
    '## Invariants (auto-detected)',
    '',
    `Before editing these paths, read [\`${invariantsPath}\`](${invariantsPath}) —`,
    'it lists danger zones and cross-file invariants this project enforces.',
    '',
  ];

  if (shown.length === 0) {
    lines.push('_No danger zones detected yet. Re-run `Topia onboard` after the codebase grows._');
  } else {
    for (const glob of shown) {
      lines.push(`- \`${glob}\``);
    }
    if (overflow > 0) {
      lines.push(`- _…and ${overflow} more — see \`${invariantsPath}\`_`);
    }
  }

  lines.push('', MARKER_END);
  return lines.join('\n');
}

export function buildContextPointerBlock() {
  const lines = [
    CONTEXT_MARKER_START,
    '## Topia — Context pointers',
    '',
    'Persisted session state lives under `.topia/` (mostly gitignored). Read or Glob these before large edits:',
    '',
    '- **Core session**: `decisions.md`, `conventions.md`, `progress.md`, `session-log.md`, `instincts.md`, `contract.md`, `cumulative-notes.md`, `task-notes.md`, `checkpoint.md`',
    '- **Plans**: `plan-*.md`',
    '- **ADRs**: `adr/`',
    '- **Discipline**: `INVARIANTS.md`, `logic-manifest.json`',
    '- **Org (committable)**: `org/org.md`',
    '- **Overflow**: `project-context.md` when CLAUDE.md was trimmed',
    '- **MCP audit**: `mcp-audit.md` when generated',
    '',
    'Session-start hooks may inject summaries of key files; do not assume CLAUDE.md alone holds full project memory.',
    '',
    CONTEXT_MARKER_END,
  ];
  return lines.join('\n');
}

function injectMarkedBlock({ claudeMd = '', block, markerStart, markerEnd, skipDirective } = {}) {
  if (claudeMd.includes(skipDirective)) {
    return { action: 'skipped', reason: 'skip-directive', content: claudeMd };
  }

  const startIdx = claudeMd.indexOf(markerStart);
  const endIdx = claudeMd.indexOf(markerEnd);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = claudeMd.slice(0, startIdx);
    const after = claudeMd.slice(endIdx + markerEnd.length);
    const next = `${before}${block}${after}`;
    if (next === claudeMd) {
      return { action: 'unchanged', content: claudeMd };
    }
    return { action: 'updated', content: next };
  }

  if (startIdx !== -1 || endIdx !== -1) {
    return {
      action: 'error',
      reason: 'marker-mismatch',
      content: claudeMd,
    };
  }

  const separator = claudeMd.length === 0 || claudeMd.endsWith('\n\n') ? '' : claudeMd.endsWith('\n') ? '\n' : '\n\n';
  const next = `${claudeMd}${separator}${block}\n`;
  return { action: 'created', content: next };
}

export function injectInvariantsPointer({ claudeMd = '', globs = [], invariantsPath = DEFAULT_INVARIANTS_PATH } = {}) {
  const block = buildPointerBlock({ globs, invariantsPath });
  return injectMarkedBlock({
    claudeMd,
    block,
    markerStart: MARKER_START,
    markerEnd: MARKER_END,
    skipDirective: SKIP_DIRECTIVE,
  });
}

export function injectContextPointer({ claudeMd = '' } = {}) {
  const block = buildContextPointerBlock();
  return injectMarkedBlock({
    claudeMd,
    block,
    markerStart: CONTEXT_MARKER_START,
    markerEnd: CONTEXT_MARKER_END,
    skipDirective: CONTEXT_SKIP_DIRECTIVE,
  });
}

export async function applyInvariantsPointer({
  claudeMdPath,
  globs = [],
  invariantsPath = DEFAULT_INVARIANTS_PATH,
  dryRun = false,
} = {}) {
  if (!claudeMdPath) {
    throw new Error('claudeMdPath is required');
  }

  const existing = existsSync(claudeMdPath) ? await readFile(claudeMdPath, 'utf8') : '';
  const result = injectInvariantsPointer({ claudeMd: existing, globs, invariantsPath });

  if (!dryRun && (result.action === 'created' || result.action === 'updated')) {
    await writeFile(claudeMdPath, result.content, 'utf8');
  }

  return { ...result, path: claudeMdPath, existed: existing.length > 0 };
}

export async function applyContextPointer({ claudeMdPath, dryRun = false } = {}) {
  if (!claudeMdPath) {
    throw new Error('claudeMdPath is required');
  }

  const existing = existsSync(claudeMdPath) ? await readFile(claudeMdPath, 'utf8') : '';
  const result = injectContextPointer({ claudeMd: existing });

  if (!dryRun && (result.action === 'created' || result.action === 'updated')) {
    await writeFile(claudeMdPath, result.content, 'utf8');
  }

  return { ...result, path: claudeMdPath, existed: existing.length > 0 };
}

async function main() {
  const { values } = parseArgs({
    options: {
      'claude-md': { type: 'string' },
      invariants: { type: 'string', default: DEFAULT_INVARIANTS_PATH },
      globs: { type: 'string', multiple: true, default: [] },
      dry: { type: 'boolean', default: false },
      context: { type: 'boolean', default: false },
    },
  });

  const claudeMdPath = values['claude-md'];
  if (!claudeMdPath) {
    console.error(
      'Usage: inject-claude-md.js --claude-md <path> [--invariants <path>] [--globs glob ...] [--context] [--dry]',
    );
    process.exit(2);
  }

  const inv = await applyInvariantsPointer({
    claudeMdPath,
    globs: values.globs,
    invariantsPath: values.invariants,
    dryRun: values.dry,
  });

  let ctx = null;
  if (values.context) {
    const content =
      inv.action === 'created' || inv.action === 'updated'
        ? inv.content
        : existsSync(claudeMdPath)
          ? await readFile(claudeMdPath, 'utf8')
          : '';
    const ctxResult = injectContextPointer({ claudeMd: content });
    if (!values.dry && (ctxResult.action === 'created' || ctxResult.action === 'updated')) {
      await writeFile(claudeMdPath, ctxResult.content, 'utf8');
    }
    ctx = { action: ctxResult.action, reason: ctxResult.reason ?? null };
  }

  console.log(
    JSON.stringify({
      path: inv.path,
      invariants: { action: inv.action, reason: inv.reason ?? null },
      context: ctx,
    }),
  );
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('inject-claude-md.js')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
