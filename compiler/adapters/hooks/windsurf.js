/**
 * Windsurf hooks adapter.
 *
 * Windsurf exposes `.windsurf/workflows/*.md` — user-invoked step-by-step
 * scripts — and `.windsurf/rules/*.md` — cascade rules that inject context.
 *
 * We emit BOTH:
 *   - Workflows: `Topia-<skill>.md` so the user can manually run `/Topia-preflight`
 *   - Rules:     `Topia-<skill>-rule.md` that cascade-inject "run the workflow first"
 *     reminders on matching globs
 *
 * Fidelity vs Claude: workflows are user-triggered, not tool-triggered, so
 * true auto-fire isn't possible. Cascade rules are the closest analog to
 * PreToolUse.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const id = 'windsurf';

const WORKFLOWS_REL_DIR = '.windsurf/workflows';
const RULES_REL_DIR = '.windsurf/rules';
const Topia_PREFIX = 'Topia-';
const AUTO_SIGNATURE = '@protopia/skill-topia hook-dispatch';

export function detect(projectRoot) {
  return existsSync(path.join(projectRoot, '.windsurf'));
}

export async function emit({ preset, projectRoot }) {
  if (preset === 'off') return uninstall({ projectRoot });
  if (preset !== 'off' && preset !== 'strict' && preset !== 'gentle') {
    throw new Error(`windsurf adapter: invalid preset '${preset}'`);
  }

  const mode = preset === 'strict' ? 'BLOCK' : 'WARN';
  const skills = [
    {
      name: 'readiness',
      trigger: 'editing source files',
      globs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.py', '**/*.go', '**/*.rs'],
    },
    {
      name: 'guardian',
      trigger: 'editing infra / running shell',
      globs: ['**/*.sh', 'Dockerfile', '.github/workflows/*.yml', '.env*'],
    },
    {
      name: 'dependency-doctor',
      trigger: 'editing manifests / lockfiles',
      globs: ['package.json', '*lock*', 'Cargo.toml', 'go.mod', 'requirements.txt'],
    },
  ];

  const workflowsDir = path.join(projectRoot, WORKFLOWS_REL_DIR);
  const rulesDir = path.join(projectRoot, RULES_REL_DIR);

  const files = [];
  if (preset !== 'off') {
    for (const skill of skills) {
      files.push({
        path: path.join(workflowsDir, `${Topia_PREFIX}${skill.name}.md`),
        content: renderWorkflow(skill, mode),
      });
      files.push({
        path: path.join(rulesDir, `${Topia_PREFIX}${skill.name}-rule.md`),
        content: renderRule(skill, mode),
      });
    }
  }

  const notes =
    preset === 'off'
      ? []
      : [
          'Windsurf workflows are user-invoked. Auto-fire is emulated via cascade rules only.',
          `Preset: ${preset} (${mode}). No Stop/PostToolUse equivalent — completion-gate is manual.`,
        ];

  return { files, notes };
}

export async function uninstall({ projectRoot }) {
  const files = [];
  for (const rel of [WORKFLOWS_REL_DIR, RULES_REL_DIR]) {
    const dir = path.join(projectRoot, rel);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    const TopiaFiles = entries.filter((e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.md'));
    for (const file of TopiaFiles) {
      const abs = path.join(dir, file.name);
      const content = await readFile(abs, 'utf-8');
      if (content.includes(AUTO_SIGNATURE) || content.includes('Topia-managed: true')) {
        files.push({ path: abs, content: null });
      }
    }
  }
  return { files, notes: files.length === 0 ? ['no Topia-managed windsurf files found'] : [] };
}

export async function status(projectRoot) {
  const dir = path.join(projectRoot, WORKFLOWS_REL_DIR);
  if (!existsSync(dir)) {
    return {
      installed: false,
      preset: null,
      wired: [],
      missing: ['readiness', 'guardian', 'dependency-doctor'],
      notes: ['no .windsurf/workflows directory'],
    };
  }
  const entries = await readdir(dir, { withFileTypes: true });
  const TopiaFiles = entries.filter((e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.md'));
  const wired = TopiaFiles.map((f) => f.name.replace(Topia_PREFIX, '').replace('.md', ''));
  const expected = ['readiness', 'guardian', 'dependency-doctor'];
  const missing = expected.filter((s) => !wired.includes(s));

  let preset = null;
  for (const file of TopiaFiles) {
    const content = await readFile(path.join(dir, file.name), 'utf-8');
    if (/^mode: BLOCK$/m.test(content)) {
      preset = 'strict';
      break;
    }
    if (/^mode: WARN$/m.test(content)) preset = preset ?? 'gentle';
  }

  return { installed: TopiaFiles.length > 0, preset, wired, missing, notes: [] };
}

function renderWorkflow(skill, mode) {
  return [
    '---',
    `description: Topia ${skill.name} — run when ${skill.trigger}`,
    'Topia-managed: true',
    `Topia-skill: ${skill.name}`,
    `mode: ${mode}`,
    '---',
    '',
    `# /Topia-${skill.name}`,
    '',
    `Run before ${skill.trigger}. Mode: ${mode}.`,
    '',
    '## Steps',
    '',
    `1. Review the target files for ${skill.name} concerns.`,
    `2. Apply Topia skill guidance (see \`skills/${skill.name}/SKILL.md\`).`,
    `3. If findings emerge: ${mode} and surface to the user.`,
    '',
    `_Auto-generated by \`Topia hooks install\` (${AUTO_SIGNATURE})._`,
    '',
  ].join('\n');
}

function renderRule(skill, mode) {
  return [
    '---',
    `description: Auto-invoke /Topia-${skill.name} when ${skill.trigger}`,
    `globs: ${JSON.stringify(skill.globs)}`,
    'alwaysApply: false',
    'Topia-managed: true',
    `Topia-skill: ${skill.name}`,
    `mode: ${mode}`,
    '---',
    '',
    `# Topia ${skill.name} cascade rule`,
    '',
    `When ${skill.trigger}, invoke \`/Topia-${skill.name}\` workflow before committing the change.`,
    `Mode: ${mode}. If the workflow surfaces a finding, ${mode} and report to user.`,
    '',
    `_Auto-generated by \`Topia hooks install\` (${AUTO_SIGNATURE})._`,
    '',
  ].join('\n');
}
