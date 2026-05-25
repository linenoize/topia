/**
 * Cursor hooks adapter.
 *
 * Emits:
 *   - `.cursor/rules/Topia-*.mdc` — discipline rule injection (readiness, guardian, dependency-doctor)
 *   - `.cursor/hooks.json` — native lifecycle hooks for metrics + token tracking
 */

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveTopiaRoot } from '../../commands/hooks/resolve-topia-root.js';

export const id = 'cursor';

const RULES_REL_DIR = '.cursor/rules';
const HOOKS_REL_PATH = '.cursor/hooks.json';
const Topia_PREFIX = 'Topia-';
const AUTO_SIGNATURE = '@protopia/skill-topia hook-dispatch';
const RUN_HOOK_SIGNATURE = 'run-hook.cjs';

export function detect(projectRoot) {
  return existsSync(path.join(projectRoot, '.cursor'));
}

function hookCommand(topiaRoot, hookName) {
  const runHook = path.join(topiaRoot, 'hooks', 'run-hook.cjs');
  return `node ${JSON.stringify(runHook)} ${hookName}`;
}

function buildHooksJson(topiaRoot) {
  const cmd = (name) => ({ command: hookCommand(topiaRoot, name) });
  return {
    version: 1,
    'Topia-managed': true,
    hooks: {
      sessionStart: [cmd('session-start')],
      postToolUse: [
        { ...cmd('token-meter'), matcher: '.*' },
        { ...cmd('metrics-collector'), matcher: 'Skill' },
      ],
      preCompact: [cmd('pre-compact')],
      sessionEnd: [cmd('post-session-reflect')],
      stop: [cmd('post-session-reflect')],
    },
  };
}

export async function emit({ preset, projectRoot, topiaRoot }) {
  if (preset === 'off') return uninstall({ projectRoot });
  if (preset !== 'off' && preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`cursor adapter: invalid preset '${preset}'`);
  }

  const resolvedRoot = resolveTopiaRoot(topiaRoot);
  if (!resolvedRoot) {
    throw new Error(
      'cursor adapter: cannot resolve Topia root for hooks.json — set TOPIA_ROOT or run from a Topia clone',
    );
  }

  const rulesDir = path.join(projectRoot, RULES_REL_DIR);
  const mode = preset === 'strict' ? 'BLOCK' : 'WARN';

  const rules = [
    {
      name: 'Topia-readiness',
      globs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.go', '**/*.rs'],
      alwaysApply: true,
      skill: 'readiness',
      description: 'Run Topia readiness check before editing source files.',
      detail: `Before editing any source file, mentally run through Topia's readiness checklist: logic preserved, error handling present, no regressions introduced. ${mode} if any concern surfaces.`,
    },
    {
      name: 'Topia-guardian',
      globs: ['**/*.sh', '**/*.Dockerfile', 'Dockerfile', '.github/workflows/*.yml', '.env*'],
      alwaysApply: false,
      skill: 'guardian',
      description: 'Security review before shell / infra / secret edits.',
      detail: `Before running any Bash or editing infrastructure/env files, audit for secrets, destructive commands, and command injection. ${mode} on any finding.`,
    },
    {
      name: 'Topia-dependency-doctor',
      globs: [
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'yarn.lock',
        'requirements.txt',
        'Cargo.toml',
        'go.mod',
      ],
      alwaysApply: false,
      skill: 'dependency-doctor',
      description: 'Dependency health audit after lockfile edits.',
      detail:
        'After modifying any lockfile or manifest, run Topia dependency-doctor to check for outdated packages, CVEs, and breaking change risk.',
    },
  ];

  const mdcFiles = rules.map((r) => ({
    path: path.join(rulesDir, `${r.name}.mdc`),
    content: renderMdc({ ...r, mode }),
  }));

  const hooksFile = {
    path: path.join(projectRoot, HOOKS_REL_PATH),
    content: `${JSON.stringify(buildHooksJson(resolvedRoot), null, 2)}\n`,
  };

  const notes = [
    'Native `.cursor/hooks.json` installed for metrics + token tracking (sessionStart, postToolUse, preCompact, sessionEnd).',
    'Invoke `/topia completion-gate` manually before wrapping up — no native completion-gate on Cursor.',
    `Auto-attach mode: ${preset}. Rules emit ${mode} guidance to the agent.`,
  ];

  return { files: [...mdcFiles, hooksFile], notes };
}

function isTopiaHooksJson(content) {
  if (!content.includes(RUN_HOOK_SIGNATURE)) return false;
  try {
    const parsed = JSON.parse(content);
    return parsed['Topia-managed'] === true;
  } catch {
    return content.includes(RUN_HOOK_SIGNATURE);
  }
}

export async function uninstall({ projectRoot }) {
  const files = [];
  const rulesDir = path.join(projectRoot, RULES_REL_DIR);

  if (existsSync(rulesDir)) {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const TopiaFiles = entries.filter(
      (e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.mdc'),
    );

    for (const file of TopiaFiles) {
      const abs = path.join(rulesDir, file.name);
      const content = await readFile(abs, 'utf-8');
      if (content.includes(AUTO_SIGNATURE) || content.includes('Topia-managed: true')) {
        files.push({ path: abs, content: null });
      }
    }
  }

  const hooksPath = path.join(projectRoot, HOOKS_REL_PATH);
  if (existsSync(hooksPath)) {
    try {
      const content = await readFile(hooksPath, 'utf-8');
      if (isTopiaHooksJson(content)) {
        files.push({ path: hooksPath, content: null });
      }
    } catch {
      /* skip */
    }
  }

  return {
    files,
    notes: files.length === 0 ? ['no Topia-managed cursor artifacts found'] : [],
  };
}

export async function status(projectRoot) {
  const rulesDir = path.join(projectRoot, RULES_REL_DIR);
  const hooksPath = path.join(projectRoot, HOOKS_REL_PATH);
  const expectedRules = ['readiness', 'guardian', 'dependency-doctor'];
  const expectedMetricsHooks = [
    'session-start',
    'token-meter',
    'metrics-collector',
    'pre-compact',
    'post-session-reflect',
  ];

  let wired = [];
  let missing = [...expectedRules];
  let preset = null;
  let hooksInstalled = false;

  if (existsSync(rulesDir)) {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const TopiaFiles = entries.filter(
      (e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.mdc'),
    );
    const ruleWired = TopiaFiles.map((f) => f.name.replace(Topia_PREFIX, '').replace('.mdc', ''));
    wired = [...wired, ...ruleWired];
    missing = expectedRules.filter((s) => !ruleWired.includes(s));

    for (const file of TopiaFiles) {
      const content = await readFile(path.join(rulesDir, file.name), 'utf-8');
      if (/^mode: BLOCK$/m.test(content)) {
        preset = 'strict';
        break;
      }
      if (/^mode: WARN$/m.test(content)) preset = preset ?? 'gentle';
    }
  } else {
    missing = [...expectedRules];
  }

  if (existsSync(hooksPath)) {
    try {
      const content = await readFile(hooksPath, 'utf-8');
      if (isTopiaHooksJson(content)) {
        hooksInstalled = true;
        wired = [...wired, ...expectedMetricsHooks];
      }
    } catch {
      /* skip */
    }
  }

  const notes = [];
  if (!hooksInstalled) {
    notes.push('metrics hooks.json not installed — run `topia hooks install --platform cursor`');
  }
  notes.push('completion-gate not available on Cursor — invoke manually via `/topia completion-gate`');

  return {
    installed: wired.length > 0,
    preset,
    wired,
    missing,
    hooksInstalled,
    notes,
  };
}

function renderMdc(rule) {
  const frontmatter = [
    '---',
    `description: ${rule.description}`,
    `globs: ${JSON.stringify(rule.globs)}`,
    `alwaysApply: ${rule.alwaysApply}`,
    'Topia-managed: true',
    `Topia-skill: ${rule.skill}`,
    `mode: ${rule.mode}`,
    '---',
  ].join('\n');
  const body = [
    `# Topia ${rule.skill}`,
    '',
    rule.detail,
    '',
    `_Auto-generated by \`Topia hooks install\` (${AUTO_SIGNATURE})._`,
    '_Do not hand-edit — changes will be overwritten. Delete the file to opt out._',
  ].join('\n');
  return `${frontmatter}\n\n${body}\n`;
}
