#!/usr/bin/env node
/**
 * Context budget audit + apply remediations.
 *   node context-budget.js --root . --audit
 *   node context-budget.js --root . --apply slim-claude-md,mcp-audit-doc
 *   node context-budget.js --root . --apply all
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const MCP_TOOL_THRESHOLD = 80;
const CLAUDE_MD_LINE_THRESHOLD = 150;
const POINTER_START = '<!-- @Topia-context-pointer:start -->';
const POINTER_END = '<!-- @Topia-context-pointer:end -->';

export const REMEDIATIONS = [
  {
    id: 'slim-claude-md',
    label: 'Trim CLAUDE.md — move long sections to .topia/project-context.md',
    description: 'Keeps overview + commands in CLAUDE.md; relocates overflow content.',
  },
  {
    id: 'mcp-audit-doc',
    label: 'Write .topia/mcp-audit.md — MCP server/tool audit checklist',
    description: 'Documents which MCP servers to disable in IDE settings.',
  },
  {
    id: 'pointer-block',
    label: 'Add pointer block — details live under .topia/',
    description: 'Injects a short pointer in CLAUDE.md so agents load .topia/ for depth.',
  },
];

function countLines(filePath) {
  if (!existsSync(filePath)) return 0;
  return readFileSync(filePath, 'utf-8').split('\n').length;
}

function estimateMcpTools(projectRoot) {
  let total = 0;
  const servers = [];
  const candidates = [
    path.join(projectRoot, '.mcp.json'),
    path.join(projectRoot, '.cursor', 'mcp.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, 'utf-8'));
      const names = Object.keys(j.mcpServers || {});
      total += names.length * 10;
      servers.push(...names.map((n) => ({ file: p, name: n })));
    } catch { /* skip */ }
  }
  return { estimatedTools: total, servers };
}

export function auditContextBudget(projectRoot, { mcpToolCount, claudeMdLines } = {}) {
  const claudePath = path.join(projectRoot, 'CLAUDE.md');
  const lines = claudeMdLines ?? countLines(claudePath);
  const mcp = mcpToolCount != null ? { estimatedTools: mcpToolCount, servers: [] } : estimateMcpTools(projectRoot);
  const advisory = mcp.estimatedTools > MCP_TOOL_THRESHOLD || lines > CLAUDE_MD_LINE_THRESHOLD;
  const estimatedTokensK = Math.round((lines * 12 + mcp.estimatedTools * 80) / 1000);
  return {
    advisory,
    metrics: {
      mcpToolsEstimated: mcp.estimatedTools,
      mcpServers: mcp.servers,
      claudeMdLines: lines,
      estimatedBaselineTokensK: estimatedTokensK,
      thresholds: { mcpTools: MCP_TOOL_THRESHOLD, claudeMdLines: CLAUDE_MD_LINE_THRESHOLD },
    },
    options: advisory ? REMEDIATIONS : [],
    askQuestionSpec: advisory
      ? {
          title: 'Context budget',
          prompt: 'Context budget is high. Which would you like to do?',
          allow_multiple: true,
          choices: [
            ...REMEDIATIONS.map((r) => ({ id: r.id, label: r.label })),
            { id: 'all', label: 'All of the above' },
          ],
        }
      : null,
  };
}

function applySlimClaudeMd(projectRoot) {
  const claudePath = path.join(projectRoot, 'CLAUDE.md');
  if (!existsSync(claudePath)) return { ok: false, reason: 'no-claude-md' };
  const content = readFileSync(claudePath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length <= CLAUDE_MD_LINE_THRESHOLD) return { ok: true, skipped: true };
  const keep = lines.slice(0, CLAUDE_MD_LINE_THRESHOLD).join('\n');
  const overflow = lines.slice(CLAUDE_MD_LINE_THRESHOLD).join('\n');
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  const overflowPath = path.join(projectRoot, '.topia', 'project-context.md');
  const header = '# Project context (overflow from CLAUDE.md)\n\n_Moved by Topia onboard context-budget remediation._\n\n';
  writeFileSync(overflowPath, header + overflow + '\n', 'utf-8');
  writeFileSync(
    claudePath,
    keep +
      '\n\n> Extended project context: see [.topia/project-context.md](.topia/project-context.md)\n',
    'utf-8',
  );
  return { ok: true, overflowPath };
}

function applyMcpAuditDoc(projectRoot, metrics) {
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  const p = path.join(projectRoot, '.topia', 'mcp-audit.md');
  const body = [
    '# MCP audit checklist',
    '',
    `Estimated tools loaded: **${metrics.mcpToolsEstimated}** (threshold: ${MCP_TOOL_THRESHOLD})`,
    '',
    '## Action items',
    '- Open Cursor/Claude MCP settings',
    '- Disable servers you do not use in this repo',
    '- Prefer project-local .mcp.json over global duplicates',
    '',
    '## Detected servers',
    ...(metrics.mcpServers.length
      ? metrics.mcpServers.map((s) => `- ${s.name} (${s.file})`)
      : ['- _(none parsed — check IDE MCP panel manually)_']),
    '',
  ].join('\n');
  writeFileSync(p, body + '\n', 'utf-8');
  return { ok: true, path: p };
}

function applyPointerBlock(projectRoot) {
  const claudePath = path.join(projectRoot, 'CLAUDE.md');
  if (!existsSync(claudePath)) return { ok: false, reason: 'no-claude-md' };
  let content = readFileSync(claudePath, 'utf-8');
  if (content.includes(POINTER_START)) return { ok: true, skipped: true };
  const block = [
    POINTER_START,
    '## Topia — Context pointers',
    '- Session state: `.topia/` (conventions, decisions, progress)',
    '- Long-form context: `.topia/project-context.md` when CLAUDE.md is slim',
    '- MCP audit: `.topia/mcp-audit.md`',
    POINTER_END,
    '',
  ].join('\n');
  writeFileSync(claudePath, content.trimEnd() + '\n\n' + block, 'utf-8');
  return { ok: true };
}

export function applyRemediations(projectRoot, ids, metrics) {
  const set = new Set(ids.includes('all') ? REMEDIATIONS.map((r) => r.id) : ids);
  const applied = [];
  const results = {};
  if (set.has('slim-claude-md')) {
    results['slim-claude-md'] = applySlimClaudeMd(projectRoot);
    applied.push('slim-claude-md');
  }
  if (set.has('mcp-audit-doc')) {
    results['mcp-audit-doc'] = applyMcpAuditDoc(projectRoot, metrics);
    applied.push('mcp-audit-doc');
  }
  if (set.has('pointer-block')) {
    results['pointer-block'] = applyPointerBlock(projectRoot);
    applied.push('pointer-block');
  }
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  const record = {
    chosen: [...set],
    applied,
    results,
    metrics,
    appliedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(projectRoot, '.topia', 'context-budget.json'),
    JSON.stringify(record, null, 2) + '\n',
    'utf-8',
  );
  return record;
}

const isMain = (() => {
  try {
    return (
      import.meta.url === `file://${process.argv[1]}` ||
      import.meta.url.endsWith(path.basename(process.argv[1]))
    );
  } catch {
    return false;
  }
})();

if (isMain) {
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string', default: process.cwd() },
    audit: { type: 'boolean', default: false },
    apply: { type: 'string' },
    'mcp-tools': { type: 'string' },
    'claude-lines': { type: 'string' },
  },
});

const root = values.root;
const mcpTools = values['mcp-tools'] ? Number(values['mcp-tools']) : undefined;
const claudeLines = values['claude-lines'] ? Number(values['claude-lines']) : undefined;

if (values.audit) {
  console.log(JSON.stringify(auditContextBudget(root, { mcpToolCount: mcpTools, claudeMdLines: claudeLines }), null, 2));
  process.exit(0);
}

const applyArg = values.apply || positionals[0];
if (applyArg) {
  const audit = auditContextBudget(root, { mcpToolCount: mcpTools, claudeMdLines: claudeLines });
  const ids = applyArg.split(',').map((s) => s.trim()).filter(Boolean);
  console.log(JSON.stringify(applyRemediations(root, ids, audit.metrics), null, 2));
  process.exit(0);
}

console.error('Usage: --audit | --apply <id,id,...|all>');
process.exit(1);
}
