/**
 * stack skill — server.sh / server.ps1 templates.
 *
 * Syntax: `bash -n` and the PowerShell parser. Behaviour: each template runs in
 * dry-run mode inside a temp project, so docker is never called. Tests skip
 * when the shell is not installed. On Windows only Git Bash is used, since the
 * `bash` on PATH may be WSL, which cannot see Windows temp paths.
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const TEMPLATES = resolve(fileURLToPath(import.meta.url), '../../../skills/stack/scripts/templates');
const SH = join(TEMPLATES, 'server.sh');
const PS1 = join(TEMPLATES, 'server.ps1');
const SECRET = 'SENTINEL_VALUE_MUST_NOT_PRINT';

function works(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 });
  return !r.error && r.status === 0;
}

function findBash() {
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      join(process.env.ProgramW6432 ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    ];
    return candidates.find((p) => existsSync(p)) ?? null;
  }
  return works('bash', ['-c', 'true']) ? 'bash' : null;
}

function findPwsh() {
  for (const cmd of ['pwsh', process.platform === 'win32' ? 'powershell' : null]) {
    if (cmd && works(cmd, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'])) return cmd;
  }
  return null;
}

const BASH = findBash();
const PWSH = findPwsh();

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'topia-server-'));
  writeFileSync(join(root, 'compose.yaml'), 'services:\n  api:\n    image: example.com/api:1\n');
  writeFileSync(join(root, '.env.example'), 'FAKE_A=\nFAKE_B=example\n');
  writeFileSync(join(root, '.env'), `FAKE_A=${SECRET}\n`);
  copyFileSync(SH, join(root, 'server.sh'));
  copyFileSync(PS1, join(root, 'server.ps1'));
  return root;
}

describe('template files', () => {
  test('server.sh uses LF line endings', () => {
    assert.ok(!readFileSync(SH, 'utf8').includes('\r'), 'CRLF in server.sh breaks bash');
  });

  test('server.ps1 is ASCII so Windows PowerShell 5.1 reads it right', () => {
    const text = readFileSync(PS1, 'utf8');
    assert.ok([...text].every((ch) => ch.charCodeAt(0) < 128));
  });

  test('both templates offer the same commands', () => {
    const sh = readFileSync(SH, 'utf8');
    const ps = readFileSync(PS1, 'utf8');
    for (const cmd of ['start', 'build', 'restart', 'stop', 'logs', 'status', 'prune', 'env']) {
      assert.match(sh, new RegExp(`\\./server\\.sh ${cmd}\\b`));
      assert.match(ps, new RegExp(`\\.\\\\server\\.ps1 ${cmd}\\b`));
    }
  });

  test('neither template removes volumes outside the confirmed prune path', () => {
    for (const file of [SH, PS1]) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/volume prune|volume rm|system prune/.test(text), `${file} has a global volume/system prune`);
      assert.strictEqual(text.match(/down['",\s]+-?-?volumes|down --volumes/g)?.length ?? 0, 1);
    }
  });
});

describe('server.sh', { skip: BASH ? false : 'bash not found' }, () => {
  let root;
  before(() => {
    root = makeProject();
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const sh = (args, env = {}) =>
    spawnSync(BASH, ['server.sh', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STACK_DOCKER: 'docker', STACK_CONFIRM: '', ...env },
      input: '',
      timeout: 30000,
    });

  test('bash -n accepts it', () => {
    const r = spawnSync(BASH, ['-n'], { input: readFileSync(SH, 'utf8'), encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  });

  test('build one service rebuilds and recreates only it', () => {
    const r = sh(['--dry-run', 'build', 'api', '--no-cache']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(r.stdout.trim().split('\n'), [
      'docker compose build --no-cache api',
      'docker compose up -d --no-deps api',
    ]);
  });

  test('build all, start, restart, stop', () => {
    assert.match(sh(['--dry-run', 'build']).stdout, /^docker compose build\ndocker compose up -d --remove-orphans$/m);
    assert.strictEqual(sh(['--dry-run', 'start']).stdout.trim(), 'docker compose up -d --remove-orphans');
    assert.strictEqual(sh(['--dry-run', 'restart', 'api']).stdout.trim(), 'docker compose restart api');
    assert.strictEqual(sh(['--dry-run', 'stop']).stdout.trim(), 'docker compose down --remove-orphans');
    assert.strictEqual(sh(['--dry-run', 'stop', 'api']).stdout.trim(), 'docker compose stop api');
  });

  test('logs takes --since, --tail and -f', () => {
    const r = sh(['--dry-run', 'logs', 'api', '--since', '10m', '--tail', '50', '-f']);
    assert.strictEqual(r.stdout.trim(), 'docker compose logs --tail 50 --since 10m --follow api');
  });

  test('settings come from env vars', () => {
    const r = sh(['--dry-run', 'status'], {
      STACK_PROJECT: 'demo',
      STACK_PROFILES: 'tools',
      STACK_HEALTH_URL: 'http://127.0.0.1:8080/health',
    });
    assert.strictEqual(
      r.stdout.trim(),
      'docker compose -p demo --profile tools ps --all\ncurl http://127.0.0.1:8080/health',
    );
  });

  test('prune keeps volumes by default', () => {
    const r = sh(['--dry-run', 'prune']);
    assert.strictEqual(r.status, 0);
    assert.ok(!/volume/.test(r.stdout));
  });

  test('prune --volumes needs the typed project name', () => {
    const refused = sh(['--dry-run', 'prune', '--volumes'], { STACK_PROJECT: 'demo' });
    assert.strictEqual(refused.status, 5);
    assert.ok(!refused.stdout.includes('down --volumes'));
    const wrong = sh(['--dry-run', 'prune', '--volumes'], { STACK_PROJECT: 'demo', STACK_CONFIRM: 'yes' });
    assert.strictEqual(wrong.status, 5);
    const ok = sh(['--dry-run', 'prune', '--volumes'], { STACK_PROJECT: 'demo', STACK_CONFIRM: 'demo' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /docker compose -p demo down --volumes --remove-orphans/);
  });

  test('env check names missing keys and never prints values', () => {
    const r = sh(['env']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stderr, /FAKE_B/);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  });

  test('unknown command exits 2; help exits 0', () => {
    assert.strictEqual(sh(['bogus']).status, 2);
    const help = sh(['help']);
    assert.strictEqual(help.status, 0);
    assert.match(help.stdout, /server\.sh logs/);
  });
});

describe('server.ps1', { skip: PWSH ? false : 'PowerShell not found' }, () => {
  let root;
  before(() => {
    root = makeProject();
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const ps = (args, env = {}) =>
    spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'server.ps1', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, STACK_DOCKER: 'docker', STACK_CONFIRM: '', ...env },
      input: '',
      timeout: 60000,
    });
  const lines = (r) => r.stdout.trim().split(/\r?\n/);

  test('the PowerShell parser accepts it', () => {
    const script = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${PS1.replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }`;
    const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  });

  test('build one service rebuilds and recreates only it', () => {
    const r = ps(['build', 'api', '-NoCache', '-DryRun']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(lines(r), ['docker compose build --no-cache api', 'docker compose up -d --no-deps api']);
  });

  test('stop, logs and status', () => {
    assert.deepStrictEqual(lines(ps(['stop', '-DryRun'])), ['docker compose down --remove-orphans']);
    assert.deepStrictEqual(lines(ps(['logs', 'api', '-Since', '10m', '-Tail', '50', '-Follow', '-DryRun'])), [
      'docker compose logs --tail 50 --since 10m --follow api',
    ]);
    assert.deepStrictEqual(lines(ps(['status', '-DryRun'], { STACK_PROJECT: 'demo' })), [
      'docker compose -p demo ps --all',
    ]);
  });

  test('prune keeps volumes unless the project name is typed', () => {
    assert.ok(!/volume/.test(ps(['prune', '-DryRun']).stdout));
    const refused = ps(['prune', '-Volumes', '-DryRun'], { STACK_PROJECT: 'demo' });
    assert.strictEqual(refused.status, 5);
    assert.ok(!refused.stdout.includes('down --volumes'));
    const ok = ps(['prune', '-Volumes', '-DryRun'], { STACK_PROJECT: 'demo', STACK_CONFIRM: 'demo' });
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /docker compose -p demo down --volumes --remove-orphans/);
  });

  test('env check names missing keys and never prints values', () => {
    const r = ps(['env']);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /FAKE_B/);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  });

  test('unknown command exits 2', () => {
    assert.strictEqual(ps(['bogus']).status, 2);
  });
});
