/**
 * Cursor hooks adapter.
 *
 * Emits:
 *   - `.cursor/rules/Topia-*.mdc` — discipline rule injection (readiness, guardian, dependency-doctor)
 *   - `.cursor/hooks.json` — native hooks: lifecycle + metrics, plus tool-level guards
 *     (beforeReadFile → pre-tool-guard, beforeShellExecution → secrets-scan / git-push-checkpoint)
 *
 * The same plan also produces the plugin's `hooks/hooks-cursor.json` (see buildPluginHooksJson).
 * Event names, input and output: https://cursor.com/docs/hooks
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveTopiaRoot } from '../../commands/hooks/resolve-topia-root.js';

export const id = 'cursor';

const RULES_REL_DIR = '.cursor/rules';
const HOOKS_REL_PATH = '.cursor/hooks.json';
const Topia_PREFIX = 'Topia-';
const AUTO_SIGNATURE = '@linenoize/topia hook-dispatch';
const RUN_HOOK_SIGNATURE = 'run-hook.cjs';

export function detect(projectRoot) {
  return existsSync(path.join(projectRoot, '.cursor'));
}

/**
 * Which Topia hook runs on which Cursor event. One plan for both the project
 * file and the plugin file, so they cannot drift.
 *
 * - beforeShellExecution matchers are tested against the full command string.
 * - postToolUse matchers are tested against the tool name. Cursor calls its
 *   subagent tool `Task`; `Skill` is kept for parity with Claude Code.
 * - auto-format and typecheck are deliberately absent (inert pending a decision).
 * - No `stop` follow-up message: it would start a new agent turn every time.
 */
export const CURSOR_HOOK_PLAN = Object.freeze([
  { event: 'sessionStart', hook: 'session-start' },
  { event: 'beforeReadFile', hook: 'pre-tool-guard' },
  { event: 'beforeShellExecution', hook: 'secrets-scan', matcher: 'commit' },
  { event: 'beforeShellExecution', hook: 'git-push-checkpoint', matcher: 'push' },
  { event: 'postToolUse', hook: 'token-meter', matcher: '.*' },
  { event: 'postToolUse', hook: 'metrics-collector', matcher: 'Skill|Task' },
  { event: 'preCompact', hook: 'pre-compact' },
  { event: 'sessionEnd', hook: 'post-session-reflect' },
  { event: 'stop', hook: 'post-session-reflect' },
]);

const PLAN_HOOKS = [...new Set(CURSOR_HOOK_PLAN.map((p) => p.hook))];

function buildHooks(commandFor) {
  const hooks = {};
  for (const { event, hook, matcher } of CURSOR_HOOK_PLAN) {
    const entry = { command: commandFor(hook) };
    if (matcher) entry.matcher = matcher;
    (hooks[event] ??= []).push(entry);
  }
  return hooks;
}

/**
 * Project hooks run from the project root with an absolute path to Topia.
 * Cursor runs hook commands through PowerShell on Windows and sh elsewhere.
 * Forward slashes work for Node on every OS, and single quotes are literal in
 * both shells (double quotes would let PowerShell expand a `$` in the path).
 */
function projectHookCommand(topiaRoot, hookName) {
  const runHook = path.join(topiaRoot, 'hooks', 'run-hook.cjs').split(path.sep).join('/');
  const quoted = runHook.includes("'") ? JSON.stringify(runHook) : `'${runHook}'`;
  return `node ${quoted} ${hookName}`;
}

/**
 * Plugin hooks cannot name the plugin folder in shell syntax: PowerShell reads
 * `${CURSOR_PLUGIN_ROOT}` as an empty PowerShell variable, and `stop` hooks run
 * from the workspace root rather than the plugin folder. So Node reads the
 * CURSOR_PLUGIN_ROOT environment variable itself. The fallback `.` covers a
 * Cursor build that runs plugin hooks from the plugin folder without the variable.
 * The script has no spaces, `$`, or double quotes, so PowerShell and sh pass it as is.
 */
export function pluginHookCommand(hookName) {
  return `node -e "require(require('path').resolve(process.env.CURSOR_PLUGIN_ROOT||'.','hooks','run-hook.cjs'))" ${hookName}`;
}

/** Contents of the plugin's hooks/hooks-cursor.json. */
export function buildPluginHooksJson() {
  return { version: 1, hooks: buildHooks(pluginHookCommand) };
}

function buildHooksJson(topiaRoot) {
  return {
    version: 1,
    'Topia-managed': true,
    hooks: buildHooks((name) => projectHookCommand(topiaRoot, name)),
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
    'Native `.cursor/hooks.json` installed: metrics + token tracking (sessionStart, postToolUse, preCompact, sessionEnd, stop), sensitive-file reads (beforeReadFile), and commit secrets + push checkpoint (beforeShellExecution).',
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
    const TopiaFiles = entries.filter((e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.mdc'));

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
  const expectedMetricsHooks = PLAN_HOOKS;

  let wired = [];
  let missing = [...expectedRules];
  let preset = null;
  let hooksInstalled = false;

  if (existsSync(rulesDir)) {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const TopiaFiles = entries.filter((e) => e.isFile() && e.name.startsWith(Topia_PREFIX) && e.name.endsWith('.mdc'));
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
