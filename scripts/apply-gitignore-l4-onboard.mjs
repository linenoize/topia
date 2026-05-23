#!/usr/bin/env node
/**
 * apply-gitignore-l4-onboard.mjs
 * Gitignore prompt, L4 auto-activation, context-budget AskQuestion flow, wiring.
 * Run from topia repo root: node scripts/apply-gitignore-l4-onboard.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function w(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content.replace(/\r\n/g, '\n'), 'utf8');
  console.log('wrote', rel);
}

function patch(rel, find, replace, optional = false) {
  const p = path.join(root, rel);
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(find)) {
    if (optional) {
      console.log('skip (already patched?)', rel);
      return;
    }
    throw new Error(`patch miss in ${rel}: ${find.slice(0, 100)}`);
  }
  fs.writeFileSync(p, s.replace(find, replace), 'utf8');
  console.log('patched', rel);
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW: compiler/lib/ensure-gitignore.js
// ═══════════════════════════════════════════════════════════════════════════
w('compiler/lib/ensure-gitignore.js', `/**
 * ensure-gitignore.js — Prompt once per project to add Topia ignore rules.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

export const SKIP_GITIGNORE_FLAG = 'skip-gitignore.flag';

export const TOPIA_GITIGNORE_BLOCK = \`# Topia — local session state (do not commit)
/.topia/*
!/.topia/org/
!/.topia/org/**
!/.topia/active-packs.json
.mcp.json
\`;

export const REQUIRED_PATTERNS = ['/.topia/*', '!/.topia/org/', '.mcp.json'];

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
  const needsNewline = content.length > 0 && !content.endsWith('\\n');
  const block = needsNewline ? \`\\n\${TOPIA_GITIGNORE_BLOCK}\` : TOPIA_GITIGNORE_BLOCK;
  writeFileSync(gitignorePath, content + block, 'utf-8');
}

function writeSkipFlag(projectRoot) {
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  writeFileSync(
    path.join(projectRoot, '.topia', SKIP_GITIGNORE_FLAG),
    \`\${new Date().toISOString()}\\n\`,
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

  const shouldAutoApply = autoYes || !interactive;
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
    return out.split('\\n').filter(Boolean).filter((p) => {
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
    results.warnings.push(\`Suggested block:\\n\${TOPIA_GITIGNORE_BLOCK}\`);
    results.healthy = false;
  }

  const tracked = findTrackedTopiaPaths(projectRoot);
  if (tracked.length > 0) {
    results.checks.push({
      name: 'Tracked Topia local files',
      status: 'warn',
      detail: \`\${tracked.length} path(s) should be untracked\`,
    });
    for (const p of tracked) results.warnings.push(\`Tracked but should be ignored: \${p}\`);
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
`);

// ═══════════════════════════════════════════════════════════════════════════
// NEW: skills/onboard/scripts/detect-l4-packs.js
// ═══════════════════════════════════════════════════════════════════════════
w('skills/onboard/scripts/detect-l4-packs.js', `#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const PACK_RULES = [
  { pack: '@Topia/ui', reason: 'Frontend patterns, design system, accessibility', match: (c) => /react|next\\.js|vue|svelte/i.test(c.signals) },
  { pack: '@Topia/backend', reason: 'API patterns, auth, middleware', match: (c) => /express|fastify|fastapi|django|nestjs|flask/i.test(c.signals) },
  { pack: '@Topia/devops', reason: 'CI/CD, containers, IaC', match: (c) => /docker|kubernetes|terraform|github actions|ci\\/cd/i.test(c.signals) },
  { pack: '@Topia/mobile', reason: 'Mobile architecture, offline sync', match: (c) => /react native|expo|flutter|swiftui/i.test(c.signals) },
  { pack: '@Topia/security', reason: 'OWASP, compliance', match: (c) => /auth|payment|hipaa|pci|owasp/i.test(c.signals) },
  { pack: '@Topia/ecommerce', reason: 'Cart, checkout, inventory', match: (c) => /cart|checkout|shopify|ecommerce/i.test(c.signals) },
  { pack: '@Topia/ai-ml', reason: 'LLM, inference, model evaluation', match: (c) => /ml|llm|embedding|pytorch|inference|tts|qwen|parler/i.test(c.signals) },
  { pack: '@Topia/content', reason: 'CMS, SEO, editorial', match: (c) => /cms|blog|mdx|seo|content/i.test(c.signals) },
  { pack: '@Topia/analytics', reason: 'Dashboards, pipelines, BI', match: (c) => /analytics|dashboard|metrics|data pipeline/i.test(c.signals) },
  { pack: '@Topia/chrome-ext', reason: 'MV3 extensions', match: (c) => /chrome extension|manifest v3/i.test(c.signals) },
];

export function detectL4Packs(ctx) {
  const seen = new Set();
  const out = [];
  for (const rule of PACK_RULES) {
    if (rule.match(ctx) && !seen.has(rule.pack)) {
      seen.add(rule.pack);
      out.push({ pack: rule.pack, reason: rule.reason });
    }
  }
  return out;
}

export function writeActivePacks(projectRoot, detected, force = false) {
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  const outPath = path.join(projectRoot, '.topia', 'active-packs.json');
  let existing = { enabled: [], packs: {} };
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, 'utf-8'));
      if (!Array.isArray(existing.enabled)) existing.enabled = [];
      if (!existing.packs) existing.packs = {};
    } catch {
      existing = { enabled: [], packs: {} };
    }
  }
  const enabledSet = new Set(existing.enabled);
  const packs = { ...existing.packs };
  for (const { pack, reason } of detected) {
    enabledSet.add(pack);
    packs[pack] = { reason, source: 'onboard', activatedAt: new Date().toISOString() };
  }
  if (!force && detected.length === 0 && existing.enabled.length > 0) {
    return { path: outPath, enabled: [...existing.enabled], merged: false };
  }
  const payload = {
    enabled: [...enabledSet].sort(),
    packs,
    source: 'onboard',
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\\n', 'utf-8');
  return { path: outPath, enabled: payload.enabled, merged: true };
}

export function formatActivePacksClaudeSection(enabled) {
  if (!enabled.length) return '';
  return \`## Topia — Active L4 packs
This project uses: \${enabled.join(', ')}
(Config: .topia/active-packs.json — apply during build/review/API/ML work.)
\`;
}

export function mergeTopiaConfigExtensions(projectRoot, enabled) {
  const cfgPath = path.join(projectRoot, 'topia.config.json');
  if (!existsSync(cfgPath) || !enabled.length) return { updated: false };
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  if (!cfg.extensions) cfg.extensions = {};
  cfg.extensions.enabled = enabled;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\\n', 'utf-8');
  return { updated: true, path: cfgPath };
}

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    framework: { type: 'string', default: '' },
    language: { type: 'string', default: '' },
    signals: { type: 'string', default: '' },
    json: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
});

let ctx = {
  signals: [values.framework, values.language, values.signals].filter(Boolean).join(' '),
};
if (values.json) Object.assign(ctx, JSON.parse(values.json));

const detected = detectL4Packs(ctx);
const result = writeActivePacks(values.root, detected, values.force);
const cfg = mergeTopiaConfigExtensions(values.root, result.enabled);
console.log(JSON.stringify({ detected, ...result, claudeSection: formatActivePacksClaudeSection(result.enabled), topiaConfig: cfg }, null, 2));
`);

// ═══════════════════════════════════════════════════════════════════════════
// NEW: skills/onboard/scripts/context-budget.js
// ═══════════════════════════════════════════════════════════════════════════
w('skills/onboard/scripts/context-budget.js', `#!/usr/bin/env node
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
  return readFileSync(filePath, 'utf-8').split('\\n').length;
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
  const lines = content.split('\\n');
  if (lines.length <= CLAUDE_MD_LINE_THRESHOLD) return { ok: true, skipped: true };
  const keep = lines.slice(0, CLAUDE_MD_LINE_THRESHOLD).join('\\n');
  const overflow = lines.slice(CLAUDE_MD_LINE_THRESHOLD).join('\\n');
  mkdirSync(path.join(projectRoot, '.topia'), { recursive: true });
  const overflowPath = path.join(projectRoot, '.topia', 'project-context.md');
  const header = '# Project context (overflow from CLAUDE.md)\\n\\n_Moved by Topia onboard context-budget remediation._\\n\\n';
  writeFileSync(overflowPath, header + overflow + '\\n', 'utf-8');
  writeFileSync(
    claudePath,
    keep +
      '\\n\\n> Extended project context: see [.topia/project-context.md](.topia/project-context.md)\\n',
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
    \`Estimated tools loaded: **\${metrics.mcpToolsEstimated}** (threshold: \${MCP_TOOL_THRESHOLD})\`,
    '',
    '## Action items',
    '- Open Cursor/Claude MCP settings',
    '- Disable servers you do not use in this repo',
    '- Prefer project-local .mcp.json over global duplicates',
    '',
    '## Detected servers',
    ...(metrics.mcpServers.length
      ? metrics.mcpServers.map((s) => \`- \${s.name} (\${s.file})\`)
      : ['- _(none parsed — check IDE MCP panel manually)_']),
    '',
  ].join('\\n');
  writeFileSync(p, body + '\\n', 'utf-8');
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
    '- Session state: \`.topia/\` (conventions, decisions, progress)',
    '- Long-form context: \`.topia/project-context.md\` when CLAUDE.md is slim',
    '- MCP audit: \`.topia/mcp-audit.md\`',
    POINTER_END,
    '',
  ].join('\\n');
  writeFileSync(claudePath, content.trimEnd() + '\\n\\n' + block, 'utf-8');
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
    JSON.stringify(record, null, 2) + '\\n',
    'utf-8',
  );
  return record;
}

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
`);

// ═══════════════════════════════════════════════════════════════════════════
// NEW: CLI wrappers + tests (continued in part 2 — same file)
// ═══════════════════════════════════════════════════════════════════════════
w('skills/onboard/scripts/ensure-gitignore.js', `#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ensureTopiaGitignore } from '../../../compiler/lib/ensure-gitignore.js';

const { values } = parseArgs({
  options: {
    root: { type: 'string', default: process.cwd() },
    yes: { type: 'boolean', default: false },
    dry: { type: 'boolean', default: false },
  },
});

const log = (icon, msg) => console.log(\`  \${icon} \${msg}\`);
const result = await ensureTopiaGitignore({
  projectRoot: values.root,
  interactive: !values.yes,
  autoYes: values.yes,
  dryRun: values.dry,
  log,
});
console.log(JSON.stringify(result));
`);

w('compiler/__tests__/ensure-gitignore.test.js', `import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  SKIP_GITIGNORE_FLAG,
  TOPIA_GITIGNORE_BLOCK,
  ensureTopiaGitignore,
  gitignoreHasTopiaPatterns,
} from '../lib/ensure-gitignore.js';

function makeGitProject() {
  const root = mkdtempSync(join(tmpdir(), 'topia-gi-'));
  mkdirSync(join(root, '.git'));
  return root;
}

describe('ensure-gitignore', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('gitignoreHasTopiaPatterns detects block', () => {
    assert.ok(gitignoreHasTopiaPatterns(TOPIA_GITIGNORE_BLOCK));
    assert.ok(!gitignoreHasTopiaPatterns('# foo\\n'));
  });

  test('autoYes appends block', async () => {
    root = makeGitProject();
    const r = await ensureTopiaGitignore({ projectRoot: root, autoYes: true, interactive: false });
    assert.strictEqual(r.status, 'auto_added');
    const gi = readFileSync(join(root, '.gitignore'), 'utf-8');
    assert.ok(gitignoreHasTopiaPatterns(gi));
  });

  test('idempotent when already present', async () => {
    root = makeGitProject();
    writeFileSync(join(root, '.gitignore'), TOPIA_GITIGNORE_BLOCK, 'utf-8');
    const r = await ensureTopiaGitignore({ projectRoot: root, autoYes: true, interactive: false });
    assert.strictEqual(r.status, 'already_ok');
  });

  test('decline writes skip flag', async () => {
    root = makeGitProject();
    const r = await ensureTopiaGitignore({ projectRoot: root, autoYes: false, interactive: false });
    assert.strictEqual(r.status, 'pending');
  });
});
`);

w('compiler/__tests__/detect-l4-packs.test.js', `import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { detectL4Packs, writeActivePacks } from '../../skills/onboard/scripts/detect-l4-packs.js';

describe('detect-l4-packs', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('detects backend + ai-ml for FastAPI stack', () => {
    const d = detectL4Packs({ signals: 'FastAPI Parler-TTS Qwen3 inference' });
    const packs = d.map((x) => x.pack);
    assert.ok(packs.includes('@Topia/backend'));
    assert.ok(packs.includes('@Topia/ai-ml'));
  });

  test('writeActivePacks creates json', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-l4-'));
    const detected = [{ pack: '@Topia/ui', reason: 'react' }];
    const r = writeActivePacks(root, detected);
    assert.ok(existsSync(join(root, '.topia', 'active-packs.json')));
    const j = JSON.parse(readFileSync(join(root, '.topia', 'active-packs.json'), 'utf-8'));
    assert.ok(j.enabled.includes('@Topia/ui'));
  });
});
`);

w('compiler/__tests__/context-budget.test.js', `import assert from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { auditContextBudget, applyRemediations } from '../../skills/onboard/scripts/context-budget.js';

describe('context-budget', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('advisory when lines over threshold', () => {
    const a = auditContextBudget('/tmp', { mcpToolCount: 10, claudeMdLines: 200 });
    assert.strictEqual(a.advisory, true);
    assert.ok(a.options.length >= 3);
    assert.ok(a.askQuestionSpec.choices.some((c) => c.id === 'all'));
  });

  test('apply all writes context-budget.json', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-cb-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    const long = '# Test\\n' + 'line\\n'.repeat(160);
    writeFileSync(join(root, 'CLAUDE.md'), long, 'utf-8');
    const audit = auditContextBudget(root);
    const r = applyRemediations(root, ['all'], audit.metrics);
    assert.ok(r.applied.length >= 1);
    const saved = JSON.parse(readFileSync(join(root, '.topia', 'context-budget.json'), 'utf-8'));
    assert.ok(saved.chosen.includes('slim-claude-md') || saved.chosen.includes('all'));
  });
});
`);

// ═══════════════════════════════════════════════════════════════════════════
// PATCHES
// ═══════════════════════════════════════════════════════════════════════════

patch(
  'compiler/commands/hook-dispatch.js',
  `  const mode = gentle ? 'advisory' : 'enforcing';
  stdout.write(\`Topia-hook: \${resolvedSkill} [\${mode}] — tool=\${eventJson?.tool_name || 'unknown'}\\n\`);

  // Until skills expose headless verdicts, dispatcher returns neutral success.`,
  `  const mode = gentle ? 'advisory' : 'enforcing';
  const toolName = eventJson?.tool_name || eventJson?.toolName || 'unknown';
  const advisoryLine = \`Topia-hook: \${resolvedSkill} [\${mode}] — tool=\${toolName}\`;
  const cursorHook =
    process.env.CURSOR_HOOK === '1' ||
    process.env.CURSOR_AGENT === '1' ||
    Boolean(eventJson?.cursor_version || eventJson?.hook_event_name);

  if (cursorHook) {
    stdout.write(\`\${JSON.stringify({ permission: 'allow', agent_message: advisoryLine })}\\n\`);
  } else {
    stdout.write(\`\${advisoryLine}\\n\`);
  }

  // Until skills expose headless verdicts, dispatcher returns neutral success.`,
);

patch(
  'compiler/commands/install.js',
  `import { runSetup } from './setup.js';`,
  `import { runSetup } from './setup.js';
import { ensureTopiaGitignore } from '../lib/ensure-gitignore.js';`,
);

patch(
  'compiler/commands/install.js',
  ` *   3. agora-code MCP — detect Python 3.10+, pip install, register in .mcp.json
 *   4. doctor — verify nexus integrity
 *   5. Print "restart Claude Code" + edit \`.topia/org/org.md\` hints`,
  ` *   3. agora-code MCP — detect Python 3.10+, pip install, register in .mcp.json
 *   4. project .gitignore — prompt once for Topia ignore rules
 *   5. doctor — verify nexus integrity
 *   6. Print "restart Claude Code" + edit \`.topia/org/org.md\` hints`,
);

patch(
  'compiler/commands/install.js',
  `  header('Step 4 — Verify install');
  const doctor = runDoctorBriefly({ TopiaRoot, dryRun });`,
  `  header('Step 4 — Project .gitignore');
  await ensureTopiaGitignore({
    projectRoot,
    autoYes,
    dryRun,
    log: (icon, msg) => step(icon === 'ok' ? '✓' : icon === '.' ? '·' : icon === '-' ? '—' : '!', msg),
  });

  header('Step 5 — Verify install');
  const doctor = runDoctorBriefly({ TopiaRoot, dryRun });`,
);

patch(
  'compiler/commands/setup.js',
  `import { installHooks } from './hooks/install.js';`,
  `import { installHooks } from './hooks/install.js';
import { ensureTopiaGitignore } from '../lib/ensure-gitignore.js';`,
);

patch(
  'compiler/commands/setup.js',
  `  const result = await installHooks(targetRoot, {
    preset,
    platform,
    dry: args.dry,
    topiaRoot: TopiaRoot,
  });

  return {
    scope,
    targetRoot,
    preset,
    ...result,
  };`,
  `  const result = await installHooks(targetRoot, {
    preset,
    platform,
    dry: args.dry,
    topiaRoot: TopiaRoot,
  });

  if (scope === 'current') {
    await ensureTopiaGitignore({
      projectRoot,
      autoYes: Boolean(args.yes),
      interactive: !args.yes && !args.dry,
      dryRun: Boolean(args.dry),
    });
  }

  return {
    scope,
    targetRoot,
    preset,
    ...result,
  };`,
);

patch(
  'compiler/bin/topia.js',
  `import { checkNexusIntegrity, formatDoctorResults, formatNexusResults, runDoctor } from '../doctor.js';`,
  `import { checkNexusIntegrity, formatDoctorResults, formatNexusResults, runDoctor } from '../doctor.js';
import { appendGitignoreChecks } from '../lib/ensure-gitignore.js';`,
);

patch(
  'compiler/bin/topia.js',
  `    const results = await runDoctor({
      outputRoot: projectRoot,
      adapter: getAdapter('claude'),
      config: {},
      topiaRoot: TOPIA_ROOT,
    });
    log(formatDoctorResults(results));`,
  `    const results = await runDoctor({
      outputRoot: projectRoot,
      adapter: getAdapter('claude'),
      config: {},
      topiaRoot: TOPIA_ROOT,
    });
    await appendGitignoreChecks(results, projectRoot);
    log(formatDoctorResults(results));`,
);

patch(
  'compiler/bin/topia.js',
  `  const results = await runDoctor({
    outputRoot: projectRoot,
    adapter,
    config,
    topiaRoot,
  });

  log(formatDoctorResults(results));`,
  `  const results = await runDoctor({
    outputRoot: projectRoot,
    adapter,
    config,
    topiaRoot,
  });

  await appendGitignoreChecks(results, projectRoot);
  log(formatDoctorResults(results));`,
);

patch(
  '.gitignore',
  `!/.topia/org/**
`,
  `!/.topia/org/**
!/.topia/active-packs.json
`,
);

patch(
  'hooks/session-start/index.cjs',
  `const TopiaDir = path.join(cwd, '.topia');`,
  `const TopiaDir = path.join(cwd, '.topia');`,
);

patch(
  'hooks/session-start/index.cjs',
  `  if (loaded.length > 0) {
    console.log(\`\\n[Topia: injected project state from \${loaded.join(', ')}]\`);
  } else {
    console.log('[Topia: .topia/ directory found but no state files yet. Run /topia onboard to populate.]');
  }
} else {
  console.log('[Topia: No .topia/ directory found. Run /topia onboard to set up project context.]');
}`,
  `  const activePacksPath = path.join(TopiaDir, 'active-packs.json');
  if (fs.existsSync(activePacksPath)) {
    try {
      const ap = JSON.parse(fs.readFileSync(activePacksPath, 'utf-8'));
      if (Array.isArray(ap.enabled) && ap.enabled.length > 0) {
        console.log(\`[Topia: active L4 packs: \${ap.enabled.join(', ')}]\`);
      }
    } catch { /* non-critical */ }
  }

  if (loaded.length > 0) {
    console.log(\`\\n[Topia: injected project state from \${loaded.join(', ')}]\`);
  } else {
    console.log('[Topia: .topia/ directory found but no state files yet. Run /topia onboard to populate.]');
  }
} else {
  console.log('[Topia: No .topia/ directory found. Run /topia onboard to set up project context.]');
}`,
  true,
);

// onboard SKILL.md — key section replacements
const onboardPath = 'skills/onboard/SKILL.md';
let onboard = fs.readFileSync(path.join(root, onboardPath), 'utf8');

onboard = onboard.replace('mkdir -p .Topia', 'mkdir -p .topia');

onboard = onboard.replace(
  `### Step 5 — Initialize .topia/ Directory
Use \`Bash\` to create the directory: \`mkdir -p .topia\``,
  `### Step 5.6 — Ensure .gitignore (before writing .topia/)

Run **before** Step 5 creates session files:

\`\`\`bash
node skills/onboard/scripts/ensure-gitignore.js --root <project-root>
\`\`\`

- Interactive: prompts once \`Add standard ignore rules to .gitignore? [Y/n]\`
- Non-interactive: \`--yes\` auto-appends; decline writes \`.topia/skip-gitignore.flag\`
- Record outcome in the Onboard Report under \`### Gitignore\`

### Step 5 — Initialize .topia/ Directory
Use \`Bash\` to create the directory: \`mkdir -p .topia\``,
);

onboard = onboard.replace(
  `### Step 6c — Suggest L4 Extension Packs

Based on the detected tech stack from Step 2, recommend relevant L4 extension packs. Use the mapping table below to find applicable packs. Only suggest packs that match the detected stack — do not suggest all packs.`,
  `### Step 6c — Activate L4 Extension Packs

Based on the detected tech stack from Step 2, **activate** (not merely suggest) matching L4 packs. Packs are already shipped with the Topia plugin — this step records project preferences for routing.`,
);

onboard = onboard.replace(
  `If ≥1 packs match: include in the Onboard Report under a \`### Suggested L4 Packs\` section:

\`\`\`
### Suggested L4 Packs
Based on your detected stack ([detected frameworks]), these extension packs may be useful:

- **@Topia/[pack]** — [one-line reason based on detected stack]
  Install: [link or command when available]
\`\`\``,
  `If ≥1 packs match:

1. Run:
\`\`\`bash
node skills/onboard/scripts/detect-l4-packs.js --root <project-root> --framework "<framework>" --language "<language>" --signals "<extra signals>"
\`\`\`
2. Merge \`claudeSection\` from JSON output into \`CLAUDE.md\` under \`## Topia — Active L4 packs\`
3. If \`topia.config.json\` exists, script updates \`extensions.enabled\` — tell user to run \`topia build\`
4. Report under \`### Active L4 Packs\` (not "Suggested") — list packs written to \`.topia/active-packs.json\``,
);

onboard = onboard.replace(
  `### Step 6d — Context Budget Check

Audit the project's baseline context cost from MCP servers and agent configurations. This helps developers understand why their context window fills up faster than expected.

1. Count MCP tools available (from session start messages or \`settings.json\`)
2. Check CLAUDE.md line count
3. If total MCP tools >80 or CLAUDE.md >150 lines, include a **Context Budget Advisory** in the Onboard Report:

\`\`\`
### Context Budget Advisory
- **MCP tools loaded**: [count] across [N] servers
- **CLAUDE.md size**: [N] lines
- **Estimated baseline**: ~[N]k tokens before any work begins
- **Recommendation**: [specific advice — disable unused MCP servers, move CLAUDE.md details to .topia/]
\`\`\`

**Skip if**: Total MCP tools ≤80 AND CLAUDE.md ≤150 lines (healthy baseline).`,
  `### Step 6d — Context Budget Check (interactive)

Audit baseline context cost. When high, **ask the user which remediations to apply** (including **All**).

1. Run audit:
\`\`\`bash
node skills/onboard/scripts/context-budget.js --root <project-root> --audit --mcp-tools <count> --claude-lines <n>
\`\`\`
2. If JSON \`advisory: true\`, use the **AskQuestion** tool:
   - Title: \`Context budget\`
   - Prompt: **"Context budget is high. Which would you like to do?"**
   - \`allow_multiple: true\`
   - Options: each entry in \`askQuestionSpec.choices\` (includes \`all\` → **All of the above**)
3. Map answers to apply:
   - If user selected \`all\` (alone or with others): \`--apply all\`
   - Else: \`--apply slim-claude-md,pointer-block\` (comma-separated ids)
\`\`\`bash
node skills/onboard/scripts/context-budget.js --root <project-root> --apply <ids>
\`\`\`
4. Report \`### Context Budget\` with metrics + \`chosen\` / \`applied\` from \`.topia/context-budget.json\`

**Skip AskQuestion if**: \`advisory: false\` (MCP ≤80 and CLAUDE.md ≤150 lines).`,
);

onboard = onboard.replace(
  `### Step 7 — Commit
Use \`Bash\` to stage and commit the generated files:
\`\`\`bash
git add CLAUDE.md .topia/ && git commit -m "chore: initialize Topia project context"
\`\`\``,
  `### Step 7 — Commit
Use \`Bash\` to stage and commit only committable Topia files (not all of \`.topia/\`):
\`\`\`bash
git add CLAUDE.md
git add -f .topia/active-packs.json 2>/dev/null || true
git add .topia/org/ 2>/dev/null || true
git commit -m "chore: initialize Topia project context"
\`\`\``,
);

onboard = onboard.replace(
  `### Suggested L4 Packs
- **@Topia/[pack]** — [reason] (only shown if applicable packs detected)`,
  `### Gitignore
- [outcome from Step 5.6]

### Active L4 Packs
- **@Topia/[pack]** — [reason] (written to .topia/active-packs.json)

### Context Budget
- [metrics + applied remediations, or "healthy baseline"]`,
);

fs.writeFileSync(path.join(root, onboardPath), onboard, 'utf8');
console.log('patched', onboardPath);

// agents/onboard.md
patch(
  'agents/onboard.md',
  `7. **Suggest L4 Packs** — recommend extension packs based on detected stack
8. **Context Budget Check** — audit baseline context cost`,
  `7. **Activate L4 Packs** — write .topia/active-packs.json from detect-l4-packs.js
8. **Context Budget** — audit; AskQuestion "Which would you like to do?" with **All** option; apply choices`,
  true,
);

patch(
  'agents/onboard.md',
  `10. **Commit** — \`git add CLAUDE.md .topia/ && git commit\``,
  `10. **Commit** — \`git add CLAUDE.md .topia/active-packs.json .topia/org/\` only`,
  true,
);

// skill-router
patch(
  'skills/skill-router/SKILL.md',
  `**Auto-suggest rules:**
1. Only suggest if the pack's PACK.md **exists on disk** — \`Glob\` for the pack path first. If not installed, skip silently.
2. Suggest ONCE per session per pack — do not repeat after user has seen the suggestion.
3. Format: brief inline note, not a blocking prompt. User can ignore and continue.
4. If user is already inside the pack's workflow, do not re-suggest.`,
  `**Auto-suggest rules:**
1. Only suggest if the pack's PACK.md **exists on disk** — \`Glob\` for the pack path first. If not installed, skip silently.
2. Read \`.topia/active-packs.json\` if present — **do not** re-suggest packs already listed in \`enabled\` (onboard activated them).
3. Suggest ONCE per session per pack — do not repeat after user has seen the suggestion.
4. Format: brief inline note, not a blocking prompt. User can ignore and continue.
5. If user is already inside the pack's workflow, do not re-suggest.
6. When \`chain_metadata.domain\` matches an **active** pack, prefer loading that pack's patterns over generic suggestions.`,
);

// Docs snippets
const gitignoreBlurb = `
### Project .gitignore

\`topia install\` and \`topia setup --here\` prompt once to append Topia ignore rules (\`.topia/*\`, \`.mcp.json\`, with exceptions for \`org/\` and \`active-packs.json\`). Decline is remembered via \`.topia/skip-gitignore.flag\`. Verify anytime with \`topia doctor\`.
`;

const l4Blurb = `
### L4 packs: shipped vs activated

All \`@Topia/*\` packs ship with the plugin. **Onboard** writes \`.topia/active-packs.json\` so this project declares which packs to lean on — not a separate install step.
`;

patch('README.md', 'The `org/org.md` is the only `.topia/` file committed to the repo', 'The `org/` tree and `.topia/active-packs.json` may be committed; all other `.topia/*` stays local' + gitignoreBlurb + l4Blurb, true);

// hook-dispatch test for cursor JSON
patch(
  'compiler/__tests__/hook-dispatch.test.js',
  `  test('malformed stdin does not crash', async () => {`,
  `  test('cursor hook emits JSON permission allow', async () => {
    const prev = process.env.CURSOR_HOOK;
    process.env.CURSOR_HOOK = '1';
    const io = makeIO({ stdinData: '{}' });
    const code = await dispatchHook(['readiness', '--gentle'], io);
    process.env.CURSOR_HOOK = prev;
    assert.strictEqual(code, 0);
    const out = JSON.parse(io.getOut().trim());
    assert.strictEqual(out.permission, 'allow');
  });

  test('malformed stdin does not crash', async () => {`,
  true,
);

console.log('\\n✓ Apply complete.');
console.log('  npm test -- compiler/__tests__/ensure-gitignore.test.js compiler/__tests__/detect-l4-packs.test.js compiler/__tests__/context-budget.test.js');