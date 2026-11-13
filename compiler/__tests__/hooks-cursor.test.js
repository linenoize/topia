import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cursor from '../adapters/hooks/cursor.js';
import { CAPABILITIES } from '../adapters/hooks/index.js';
import { installHooks } from '../commands/hooks/install.js';
import { hookStatus } from '../commands/hooks/status.js';
import { uninstallHooks } from '../commands/hooks/uninstall.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Topia_ROOT = path.resolve(__dirname, '..', '..');
const RULES_DIR = '.cursor/rules';

let tmpRoot;

async function seedCursor(root) {
  await mkdir(path.join(root, '.cursor'), { recursive: true });
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'Topia-cursor-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('cursor adapter', () => {
  test('detect() true when .cursor exists', async () => {
    await seedCursor(tmpRoot);
    assert.strictEqual(cursor.detect(tmpRoot), true);
  });

  test('detect() false when .cursor missing', () => {
    assert.strictEqual(cursor.detect(tmpRoot), false);
  });

  test('emit(gentle) returns 3 .mdc rule files and hooks.json', async () => {
    const plan = await cursor.emit({ preset: 'gentle', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    assert.strictEqual(plan.files.length, 4);
    const names = plan.files.map((f) => path.basename(f.path)).sort();
    assert.deepStrictEqual(names, [
      'Topia-dependency-doctor.mdc',
      'Topia-guardian.mdc',
      'Topia-readiness.mdc',
      'hooks.json',
    ]);
    for (const file of plan.files) {
      if (file.path.endsWith('.mdc')) {
        assert.ok(file.content.includes('Topia-managed: true'));
        assert.ok(file.content.includes('@linenoize/topia hook-dispatch'));
      }
    }
    const hooksJson = plan.files.find((f) => f.path.endsWith('hooks.json'));
    assert.ok(hooksJson.content.includes('"Topia-managed": true'));
    assert.ok(hooksJson.content.includes('token-meter'));
    assert.ok(hooksJson.content.includes('run-hook.cjs'));
  });

  test('emit(strict) renders WARN → BLOCK guidance', async () => {
    const gentle = await cursor.emit({ preset: 'gentle', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    const strict = await cursor.emit({ preset: 'strict', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    const gentlePreflight = gentle.files.find((f) => f.path.endsWith('Topia-readiness.mdc')).content;
    const strictPreflight = strict.files.find((f) => f.path.endsWith('Topia-readiness.mdc')).content;
    assert.ok(gentlePreflight.includes('WARN'));
    assert.ok(strictPreflight.includes('BLOCK'));
  });

  test('emit(off) delegates to uninstall', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const plan = await cursor.emit({ preset: 'off', projectRoot: tmpRoot });
    assert.ok(plan.files.every((f) => f.content === null));
    assert.ok(plan.files.length >= 1);
  });

  test('emit() rejects invalid preset', async () => {
    await assert.rejects(cursor.emit({ preset: 'loose', projectRoot: tmpRoot }), /invalid preset/);
  });

  test('install writes .mdc files and hooks.json to .cursor/', async () => {
    await seedCursor(tmpRoot);
    const result = await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    assert.strictEqual(result.written, true);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    const files = await readdir(rulesDir);
    assert.ok(files.includes('Topia-readiness.mdc'));
    assert.ok(files.includes('Topia-guardian.mdc'));
    assert.ok(files.includes('Topia-dependency-doctor.mdc'));
    assert.ok(existsSync(path.join(tmpRoot, '.cursor', 'hooks.json')));
  });

  test('idempotent re-install produces identical content', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    const first = await readFile(path.join(rulesDir, 'Topia-readiness.mdc'), 'utf-8');
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const second = await readFile(path.join(rulesDir, 'Topia-readiness.mdc'), 'utf-8');
    assert.strictEqual(first, second);
  });

  test('uninstall removes only Topia-managed .mdc files', async () => {
    await seedCursor(tmpRoot);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    await mkdir(rulesDir, { recursive: true });
    await writeFile(path.join(rulesDir, 'user-custom.mdc'), '---\ndescription: user\n---\n\n# User rule\n', 'utf-8');

    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    await uninstallHooks(tmpRoot, { platform: 'cursor' });

    const remaining = await readdir(rulesDir);
    assert.ok(remaining.includes('user-custom.mdc'), 'user rule must survive');
    assert.ok(!remaining.some((f) => f.startsWith('Topia-')), 'no Topia-* files should remain');
    assert.ok(!existsSync(path.join(tmpRoot, '.cursor', 'hooks.json')), 'Topia hooks.json should be removed');
  });

  test('uninstall skips files without Topia-managed signature', async () => {
    await seedCursor(tmpRoot);
    const rulesDir = path.join(tmpRoot, RULES_DIR);
    await mkdir(rulesDir, { recursive: true });
    // A file that happens to start with "Topia-" but is NOT managed by Topia
    await writeFile(
      path.join(rulesDir, 'Topia-fake.mdc'),
      '---\ndescription: user imposter\n---\n\nnot ours\n',
      'utf-8',
    );

    await uninstallHooks(tmpRoot, { platform: 'cursor' });
    assert.ok(existsSync(path.join(rulesDir, 'Topia-fake.mdc')), 'non-managed Topia-* file must survive');
  });

  test('status reports installed preset after install', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'strict', platform: 'cursor', topiaRoot: Topia_ROOT });
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'cursor' });
    const r = result.results.find((x) => x.platform === 'cursor');
    assert.strictEqual(r.installed, true);
    assert.strictEqual(r.preset, 'strict');
    assert.ok(r.wired.includes('readiness'));
    assert.ok(r.wired.includes('guardian'));
    assert.ok(r.wired.includes('dependency-doctor'));
  });

  test('status reports not installed when .cursor missing', async () => {
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'cursor' });
    const r = result.results.find((x) => x.platform === 'cursor');
    assert.strictEqual(r.installed, false);
    assert.ok(r.missing.includes('readiness'));
  });

  test('status lists the tool-level guards once hooks.json is installed', async () => {
    await seedCursor(tmpRoot);
    await installHooks(tmpRoot, { preset: 'gentle', platform: 'cursor', topiaRoot: Topia_ROOT });
    const result = await hookStatus(tmpRoot, Topia_ROOT, { platform: 'cursor' });
    const r = result.results.find((x) => x.platform === 'cursor');
    for (const hook of ['pre-tool-guard', 'secrets-scan', 'git-push-checkpoint']) {
      assert.ok(r.wired.includes(hook), `${hook} should be reported as wired`);
    }
    assert.ok(!r.notes.some((n) => /no tool-level/i.test(n)));
  });
});

// Cursor tool-level hooks: https://cursor.com/docs/hooks (beforeReadFile, beforeShellExecution).
describe('cursor tool-level hooks', () => {
  async function emittedHooks() {
    const plan = await cursor.emit({ preset: 'gentle', projectRoot: tmpRoot, topiaRoot: Topia_ROOT });
    return JSON.parse(plan.files.find((f) => f.path.endsWith('hooks.json')).content).hooks;
  }

  const hookNames = (entries = []) => entries.map((e) => e.command.trim().split(/\s+/).pop());

  test('beforeReadFile runs pre-tool-guard', async () => {
    const hooks = await emittedHooks();
    assert.deepStrictEqual(hookNames(hooks.beforeReadFile), ['pre-tool-guard']);
  });

  test('beforeShellExecution runs secrets-scan on commits and git-push-checkpoint on pushes', async () => {
    const hooks = await emittedHooks();
    assert.deepStrictEqual(hookNames(hooks.beforeShellExecution), ['secrets-scan', 'git-push-checkpoint']);
    const [scan, push] = hooks.beforeShellExecution;
    // The matcher is tested against the full command string.
    assert.ok(new RegExp(scan.matcher).test('cd app && git commit -m x'));
    assert.ok(new RegExp(scan.matcher).test('git -C app commit -m x'));
    assert.ok(new RegExp(push.matcher).test('git push origin main'));
    assert.ok(!new RegExp(push.matcher).test('npm test'));
  });

  test('metrics-collector matches the Cursor subagent tool name', async () => {
    const hooks = await emittedHooks();
    const entry = hooks.postToolUse.find((e) => e.command.endsWith('metrics-collector'));
    const re = new RegExp(`^(?:${entry.matcher})$`);
    assert.ok(re.test('Task'), 'Cursor names the subagent tool Task');
    assert.ok(re.test('Skill'));
  });

  test('auto-format and typecheck stay unwired', async () => {
    const hooks = await emittedHooks();
    const all = Object.values(hooks).flatMap(hookNames);
    assert.ok(!all.includes('auto-format'));
    assert.ok(!all.includes('typecheck'));
  });

  test('no completion follow-up on stop', async () => {
    const hooks = await emittedHooks();
    assert.deepStrictEqual(hookNames(hooks.stop), ['post-session-reflect']);
  });

  test('project commands use forward slashes and quote the path for PowerShell and sh', async () => {
    const hooks = await emittedHooks();
    for (const entry of Object.values(hooks).flat()) {
      assert.ok(!entry.command.includes('\\'), `no backslashes: ${entry.command}`);
      assert.ok(!entry.command.includes('${'), `no shell variables: ${entry.command}`);
      assert.match(entry.command, /^node '[^']+\/hooks\/run-hook\.cjs' [a-z-]+$/);
    }
  });

  test('capability matrix no longer says Cursor has no tool-level hooks', () => {
    const cap = CAPABILITIES.cursor;
    assert.ok(!/no tool-level hooks/i.test(cap.notes));
    assert.strictEqual(cap.preToolBash, true);
    assert.strictEqual(cap.preToolRead, true);
    assert.strictEqual(cap.postToolEdit, false, 'afterFileEdit is not wired');
  });
});

describe('cursor plugin hooks file', () => {
  const PLUGIN_HOOKS = path.join(Topia_ROOT, 'hooks', 'hooks-cursor.json');

  test('hooks/hooks-cursor.json matches the adapter plan', async () => {
    const onDisk = JSON.parse(await readFile(PLUGIN_HOOKS, 'utf-8'));
    assert.deepStrictEqual(onDisk, cursor.buildPluginHooksJson());
  });

  test('plugin commands find the plugin through the environment, not a shell variable', () => {
    const json = cursor.buildPluginHooksJson();
    for (const entry of Object.values(json.hooks).flat()) {
      // PowerShell reads ${CURSOR_PLUGIN_ROOT} as an empty PowerShell variable.
      assert.ok(!entry.command.includes('$'), entry.command);
      assert.ok(entry.command.includes('process.env.CURSOR_PLUGIN_ROOT'), entry.command);
    }
  });

  // Runs the real command string through the shell Cursor uses: PowerShell on
  // Windows, sh elsewhere. The cwd is a different folder, as for stop hooks.
  test('plugin command runs from any folder through the platform shell', () => {
    const json = cursor.buildPluginHooksJson();
    const command = json.hooks.beforeReadFile[0].command;
    const win = process.platform === 'win32';
    const shell = win ? 'powershell.exe' : 'sh';
    const shellArgs = (cmd) => (win ? ['-NoProfile', '-NonInteractive', '-Command', cmd] : ['-c', cmd]);
    const args = shellArgs(command);
    if (spawnSync(shell, shellArgs('exit 0')).error) return; // shell not installed on this runner
    const env = { ...process.env, CURSOR_PLUGIN_ROOT: Topia_ROOT, CURSOR_PROJECT_DIR: tmpRoot };
    const res = spawnSync(shell, args, {
      cwd: tmpdir(),
      env,
      input: JSON.stringify({
        hook_event_name: 'beforeReadFile',
        cursor_version: '3.0.0',
        file_path: path.join(tmpRoot, 'src', 'index.js'),
        content: 'export {};\n',
      }),
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(JSON.parse(res.stdout.trim()), { permission: 'allow' });
  });
});
