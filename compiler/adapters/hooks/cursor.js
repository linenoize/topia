/**
 * Cursor hooks adapter.
 *
 * Cursor has no PreToolUse/PostToolUse primitives. The closest analog is the
 * `.cursor/rules/*.mdc` auto-attach system: rules with `alwaysApply: true` or
 * glob-scoped rules inject guidance into the agent's prompt when editing
 * matching files. This adapter emits Topia skill invocation reminders as rules.
 *
 * Fidelity vs Claude:
 *   - readiness → rule (alwaysApply, agent sees it before every Edit)
 *   - guardian  → rule scoped to commit-related files
 *   - dependency-doctor → rule scoped to package.json / lockfiles
 *   - completion-gate → no analog (Cursor has no Stop hook) — documented in notes
 *
 * All Topia rule files are prefixed `Topia-` for unambiguous detection.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const id = 'cursor';

const RULES_REL_DIR = '.cursor/rules';
const Topia_PREFIX = 'Topia-';
const AUTO_SIGNATURE = '@protopia/skill-topia hook-dispatch';

export function detect(projectRoot) {
  return existsSync(path.join(projectRoot, '.cursor'));
}

export async function emit({ preset, projectRoot }) {
  if (preset === 'off') return uninstall({ projectRoot });
  if (preset !== 'off' && preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`cursor adapter: invalid preset '${preset}'`);
  }

  const rulesDir = path.join(projectRoot, RULES_REL_DIR);
  const mode = preset === 'strict' ? 'BLOCK' : 'WARN';
  const ruleBase = { mode };

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

  const files =
    preset === 'off'
      ? []
      : rules.map((r) => ({
          path: path.join(rulesDir, `${r.name}.mdc`),
          content: renderMdc({ ...r, ...ruleBase }),
        }));

  const notes =
    preset === 'off'
      ? []
      : [
          'Cursor has no Stop hook equivalent — `completion-gate` must be invoked manually via `/topia completion-gate`.',
          `Auto-attach mode: ${preset}. Rules emit ${mode} guidance to the agent.`,
        ];

  return { files, notes };
}

export async function uninstall({ projectRoot }) {
  const rulesDir = path.join(projectRoot, RULES_REL_DIR);
  if (!existsSync(rulesDir)) return { files: [], notes: [] };

  const entries = await readdir(rulesDir, { withFileTypes: true });
  const TopiaFiles = entries.filter((e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.mdc'));

  const files = [];
  for (const file of TopiaFiles) {
    const abs = path.join(rulesDir, file.name);
    const content = await readFile(abs, 'utf-8');
    if (content.includes(AUTO_SIGNATURE) || content.includes('Topia-managed: true')) {
      files.push({ path: abs, content: null });
    }
  }

  return { files, notes: files.length === 0 ? ['no Topia-managed rules found'] : [] };
}

export async function status(projectRoot) {
  const rulesDir = path.join(projectRoot, RULES_REL_DIR);
  if (!existsSync(rulesDir)) {
    return {
      installed: false,
      preset: null,
      wired: [],
      missing: ['readiness', 'guardian', 'dependency-doctor'],
      notes: ['no .cursor/rules directory'],
    };
  }
  const entries = await readdir(rulesDir, { withFileTypes: true });
  const TopiaFiles = entries.filter((e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.mdc'));
  const wired = TopiaFiles.map((f) => f.name.replace(Topia_PREFIX, '').replace('.mdc', ''));
  const expected = ['readiness', 'guardian', 'dependency-doctor'];
  const missing = expected.filter((s) => !wired.includes(s));

  let preset = null;
  for (const file of TopiaFiles) {
    const content = await readFile(path.join(rulesDir, file.name), 'utf-8');
    if (/^mode: BLOCK$/m.test(content)) {
      preset = 'strict';
      break;
    }
    if (/^mode: WARN$/m.test(content)) preset = preset ?? 'gentle';
  }

  return {
    installed: TopiaFiles.length > 0,
    preset,
    wired,
    missing,
    notes: ['completion-gate not available on Cursor'],
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
