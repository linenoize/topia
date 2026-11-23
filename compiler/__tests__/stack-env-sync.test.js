/**
 * stack skill — env-sync.js: .env vs .env.example by key name only.
 * Every fixture uses fake keys and sentinel values; the tests assert that no
 * value ever reaches stdout, stderr, JSON or the debug trace.
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendMissingKeys,
  backupEnv,
  checkEnvFiles,
  compareKeys,
  EXIT,
  isPlaceholder,
  isSecretKey,
  main,
  parseEnvKeys,
  planAdditions,
  resolveExamplePath,
  resolveOutDir,
  scanEnv,
} from '../../skills/stack/scripts/env-sync.js';

const SCRIPT = resolve(fileURLToPath(import.meta.url), '../../../skills/stack/scripts/env-sync.js');
const SECRET = 'SENTINEL_VALUE_MUST_NOT_PRINT';

function capture() {
  const lines = { out: [], err: [] };
  return {
    lines,
    io: { stdout: (s) => lines.out.push(s), stderr: (s) => lines.err.push(s), isTTY: false },
    all: () => [...lines.out, ...lines.err].join('\n'),
  };
}

describe('parseEnvKeys', () => {
  test('reads keys, skips comments and blanks, handles export and CRLF', () => {
    const text = `# comment\r\nFOO=${SECRET}\r\n\r\nexport BAR = x\r\n  BAZ=\r\n`;
    assert.deepStrictEqual(parseEnvKeys(text), { keys: ['FOO', 'BAR', 'BAZ'], duplicates: [], invalidLines: [] });
  });

  test('reports duplicates once and unparsed lines by number only', () => {
    const r = parseEnvKeys(`A=1\nnot a pair ${SECRET}\nA=2\nA=3\n`);
    assert.deepStrictEqual(r.keys, ['A']);
    assert.deepStrictEqual(r.duplicates, ['A']);
    assert.deepStrictEqual(r.invalidLines, [2]);
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });

  test('skips the body of a multi-line quoted value', () => {
    const text = 'CERT="-----BEGIN-----\nFAKE_INNER=looks-like-a-key\n-----END-----"\nAFTER=1\n';
    assert.deepStrictEqual(parseEnvKeys(text).keys, ['CERT', 'AFTER']);
  });

  test('a closed quote on one line does not swallow the next line', () => {
    assert.deepStrictEqual(parseEnvKeys(`A="x \\" y"\nB='z'\nC=\`w\`\nD=1`).keys, ['A', 'B', 'C', 'D']);
  });

  test('returns no values at all', () => {
    const r = parseEnvKeys(`TOKEN=${SECRET}\nOTHER="${SECRET}"\n`);
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });
});

describe('compareKeys', () => {
  test('missing keeps example order; extra keeps env order', () => {
    assert.deepStrictEqual(compareKeys(['A', 'B', 'C'], ['C', 'X', 'A']), { missing: ['B'], extra: ['X'] });
  });
  test('in sync', () => {
    assert.deepStrictEqual(compareKeys(['A'], ['A']), { missing: [], extra: [] });
  });
});

describe('files and CLI', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'topia-envsync-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (name, text) => writeFileSync(join(root, name), text, 'utf8');

  test('resolveExamplePath falls back through the candidate names', () => {
    assert.strictEqual(resolveExamplePath(root), null);
    write('.env.template', 'A=\n');
    assert.strictEqual(resolveExamplePath(root), join(root, '.env.template'));
    write('.env.example', 'A=\n');
    assert.strictEqual(resolveExamplePath(root), join(root, '.env.example'));
  });

  test('checkEnvFiles reports missing, extra and a missing .env', () => {
    write('.env.example', 'A=\nB=\n');
    const none = checkEnvFiles({ envPath: join(root, '.env'), examplePath: join(root, '.env.example') });
    assert.strictEqual(none.envExists, false);
    assert.deepStrictEqual(none.missing, ['A', 'B']);
    write('.env', `A=${SECRET}\nZ=${SECRET}\n`);
    const some = checkEnvFiles({ envPath: join(root, '.env'), examplePath: join(root, '.env.example') });
    assert.deepStrictEqual([some.missing, some.extra], [['B'], ['Z']]);
  });

  test('default mode prints key names, never values, and exits 5', async () => {
    write('.env.example', `FAKE_DB_HOST=${SECRET}\nFAKE_API_KEY=\nFAKE_PORT=8080\n`);
    write('.env', `FAKE_DB_HOST=${SECRET}-local\nFAKE_EXTRA=${SECRET}\n`);
    const c = capture();
    const code = await main(['--root', root], c.io);
    assert.strictEqual(code, EXIT.MISSING);
    assert.deepStrictEqual(c.lines.out, ['missing FAKE_API_KEY', 'missing FAKE_PORT', 'extra FAKE_EXTRA']);
    assert.ok(!c.all().includes(SECRET), 'a value leaked');
    assert.ok(!c.all().includes('8080'), 'an example value leaked');
  });

  test('keys only: different values with the same keys are in sync', async () => {
    write('.env.example', 'FAKE_A=one\nFAKE_B=two\n');
    write('.env', 'FAKE_A=other\nFAKE_B=\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root], c.io), EXIT.OK);
    assert.deepStrictEqual(c.lines.out, []);
  });

  test('extra keys alone still exit 0', async () => {
    write('.env.example', 'FAKE_A=\n');
    write('.env', 'FAKE_A=x\nFAKE_LOCAL=y\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root], c.io), EXIT.OK);
    assert.deepStrictEqual(c.lines.out, ['extra FAKE_LOCAL']);
  });

  test('--json is parseable and has no values', async () => {
    write('.env.example', `FAKE_A=${SECRET}\nFAKE_B=\n`);
    write('.env', `FAKE_A=${SECRET}\nFAKE_A=${SECRET}\n`);
    const c = capture();
    const code = await main(['--root', root, '--json'], c.io);
    const json = JSON.parse(c.lines.out.join('\n'));
    assert.strictEqual(code, EXIT.MISSING);
    assert.deepStrictEqual(json.missing, ['FAKE_B']);
    assert.deepStrictEqual(json.duplicates, ['FAKE_A']);
    assert.strictEqual(json.inSync, false);
    assert.ok(!c.all().includes(SECRET));
  });

  test('--fix --yes appends empty keys, keeps existing bytes and CRLF', async () => {
    write('.env.example', 'FAKE_A=\r\nFAKE_B=\r\nFAKE_C=\r\n');
    const before = `FAKE_A=${SECRET}\r\n# keep me\r\n`;
    write('.env', before);
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--fix', '--yes'], c.io), EXIT.OK);
    const after = readFileSync(join(root, '.env'), 'utf8');
    assert.ok(after.startsWith(before), 'existing content changed');
    assert.ok(after.endsWith('FAKE_B=\r\nFAKE_C=\r\n'));
    assert.ok(!/[^\r]\n/.test(after), 'mixed line endings');
    assert.deepStrictEqual(c.lines.out, [join(root, '.env')]);
    assert.ok(!c.all().includes(SECRET));
    const again = capture();
    assert.strictEqual(await main(['--root', root], again.io), EXIT.OK);
  });

  test('--fix adds a newline when .env lacks a trailing one', () => {
    write('.env', 'FAKE_A=1');
    appendMissingKeys(join(root, '.env'), ['FAKE_B']);
    assert.deepStrictEqual(parseEnvKeys(readFileSync(join(root, '.env'), 'utf8')).keys, ['FAKE_A', 'FAKE_B']);
  });

  test('--fix --yes creates .env when it is missing, with the example default', async () => {
    write('.env.example', 'FAKE_A=x\n');
    const c = capture();
    const now = new Date('2026-01-02T03:04:05.678Z');
    assert.strictEqual(await main(['--root', root, '--fix', '--yes'], { ...c.io, now }), EXIT.OK);
    assert.strictEqual(
      readFileSync(join(root, '.env'), 'utf8'),
      '# Added by env-sync 2026-01-02T03:04:05Z from .env.example. Review these values.\nFAKE_A=x\n',
    );
    assert.deepStrictEqual(
      readdirSync(root).filter((f) => f.startsWith('.env.bak')),
      [],
      'no backup when there was no .env',
    );
  });

  test('--fix copies example defaults and notes, but never secrets or placeholders', async () => {
    write(
      '.env.example',
      [
        '# Database',
        '# host and port share this note',
        'FAKE_DB_HOST=localhost',
        'FAKE_DB_PORT=5432',
        '',
        '# Signing',
        `FAKE_SIGNING_SECRET=${SECRET}`,
        'FAKE_API_KEY=abc123',
        'FAKE_ADMIN_EMAIL=your-email-here',
        'FAKE_OWNER=<name>',
        'FAKE_MODE="two words"',
        '',
      ].join('\n'),
    );
    write('.env', 'FAKE_DB_HOST=db\n');
    const c = capture();
    const now = new Date(2026, 0, 1, 0, 0, 0); // fixed, so the backup name cannot contain "5432"
    assert.strictEqual(await main(['--root', root, '--fix', '--yes'], { ...c.io, now }), EXIT.OK);
    const after = readFileSync(join(root, '.env'), 'utf8');
    assert.match(
      after,
      /^# host and port share this note\nFAKE_DB_PORT=5432$/m,
      'shared note written once above the key',
    );
    assert.match(after, /^# Signing\nFAKE_SIGNING_SECRET=\nFAKE_API_KEY=\n/m);
    assert.match(after, /^FAKE_ADMIN_EMAIL=$/m);
    assert.match(after, /^FAKE_OWNER=$/m);
    assert.match(after, /^FAKE_MODE="two words"$/m);
    assert.ok(!after.includes(SECRET), 'a secret example value was copied');
    assert.ok(!after.includes('abc123'), 'an API key example value was copied');
    assert.ok(!c.all().includes(SECRET) && !c.all().includes('5432'), 'a value was printed');
    assert.match(c.lines.err.join('\n'), /FAKE_DB_PORT \(default from example\)/);
    assert.match(c.lines.err.join('\n'), /FAKE_SIGNING_SECRET \(empty: secret\)/);
    assert.match(c.lines.err.join('\n'), /FAKE_ADMIN_EMAIL \(empty: example had a placeholder\)/);
  });

  test('--fix --empty keeps the 0.1 behaviour', async () => {
    write('.env.example', 'FAKE_A=one\n');
    write('.env', 'FAKE_B=1\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--fix', '--yes', '--empty', '--no-backup'], c.io), EXIT.OK);
    assert.match(readFileSync(join(root, '.env'), 'utf8'), /^FAKE_A=$/m);
  });

  test('--generate-secrets fills secret-named keys and never prints them', async () => {
    write('.env.example', 'FAKE_TOKEN=\nFAKE_PORT=80\n');
    write('.env', '');
    const c = capture();
    const random = () => 'GENERATED_SENTINEL';
    assert.strictEqual(
      await main(['--root', root, '--fix', '--yes', '--generate-secrets', '--json'], { ...c.io, random }),
      EXIT.OK,
    );
    const after = readFileSync(join(root, '.env'), 'utf8');
    assert.match(after, /^FAKE_TOKEN=GENERATED_SENTINEL$/m);
    assert.match(after, /^FAKE_PORT=80$/m);
    assert.ok(!c.all().includes('GENERATED_SENTINEL'));
    assert.deepStrictEqual(JSON.parse(c.lines.out.join('\n')).plan, [
      { key: 'FAKE_TOKEN', source: 'generated' },
      { key: 'FAKE_PORT', source: 'example' },
    ]);
  });

  test('--fix backs up an existing .env first, owner-only, without overwriting', async () => {
    write('.env.example', 'FAKE_A=\nFAKE_B=\n');
    write('.env', `FAKE_A=${SECRET}\n`);
    const now = new Date(2026, 0, 2, 3, 4, 5);
    write('.env.bak-20260102-030405', 'older backup\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--fix', '--yes'], { ...c.io, now }), EXIT.OK);
    assert.strictEqual(readFileSync(join(root, '.env.bak-20260102-030405'), 'utf8'), 'older backup\n');
    assert.strictEqual(readFileSync(join(root, '.env.bak-20260102-030405-1'), 'utf8'), `FAKE_A=${SECRET}\n`);
    assert.match(c.lines.err.join('\n'), /backup at \.env\.bak-20260102-030405-1/);
    assert.strictEqual(backupEnv(join(root, 'nope')), null);
  });

  test('a key commented out in .env is reported, not added, and does not fail the check', async () => {
    write('.env.example', 'FAKE_A=\nFAKE_B=\n');
    write('.env', 'FAKE_A=1\n# FAKE_B=off-on-purpose\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root], c.io), EXIT.OK);
    assert.deepStrictEqual(c.lines.out, ['commented FAKE_B']);
    const fix = capture();
    assert.strictEqual(await main(['--root', root, '--fix', '--yes'], fix.io), EXIT.OK);
    assert.strictEqual(readFileSync(join(root, '.env'), 'utf8'), 'FAKE_A=1\n# FAKE_B=off-on-purpose\n');
  });

  test('needs-quotes flags unquoted values a shell cannot source, by key only', async () => {
    write('.env.example', 'FAKE_CRON=\nFAKE_OK=\nFAKE_Q=\nFAKE_C=\nFAKE_H=\n');
    write('.env', `FAKE_CRON=*/5 * * * * ${SECRET}\nFAKE_OK=a.b:c/d\nFAKE_Q="x y"\nFAKE_C=plain # note\nFAKE_H=a#b\n`);
    const c = capture();
    assert.strictEqual(await main(['--root', root], c.io), EXIT.OK);
    assert.deepStrictEqual(c.lines.out, ['needs-quotes FAKE_CRON']);
    assert.ok(!c.all().includes(SECRET));
  });

  test('scanEnv returns key names only', () => {
    const r = scanEnv(`A=${SECRET} x\n# B=${SECRET}\nC="${SECRET}"\n`);
    assert.deepStrictEqual(r, {
      keys: ['A', 'C'],
      duplicates: [],
      invalidLines: [],
      commented: ['B'],
      needsQuotes: ['A'],
    });
    assert.ok(!JSON.stringify(r).includes(SECRET));
  });

  test('isSecretKey and isPlaceholder', () => {
    for (const k of [
      'JWT_SECRET',
      'GITHUB_TOKEN',
      'DB_PASSWORD',
      'STRIPE_API_KEY',
      'PRIVATE_PEM',
      'SESSION_KEY',
      'SALT',
    ]) {
      assert.ok(isSecretKey(k), k);
    }
    for (const k of ['PORT', 'DB_HOST', 'NODE_ENV', 'KEYBOARD_LAYOUT']) assert.ok(!isSecretKey(k), k);
    for (const v of ['', 'changeme', '"CHANGE_ME"', 'your_key', '<token>', 'xxxx', 'put-it-here', 'todo']) {
      assert.ok(isPlaceholder(v), v);
    }
    for (const v of ['localhost', '5432', 'production', '"two words"']) assert.ok(!isPlaceholder(v), v);
  });

  test('a multi-line example value is copied whole', () => {
    const plan = planAdditions('FAKE_CERT="line1\nline2"\nNEXT=1\n', ['FAKE_CERT']);
    assert.deepStrictEqual(plan[0].lines, ['FAKE_CERT="line1', 'line2"']);
    assert.strictEqual(plan[0].source, 'example');
  });

  test('--empty without --fix is a usage error', async () => {
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--empty'], c.io), EXIT.USAGE);
  });

  test('--fix --dry-run writes nothing', async () => {
    write('.env.example', 'FAKE_A=\nFAKE_B=\n');
    write('.env', 'FAKE_A=1\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--fix', '--yes', '--dry-run'], c.io), EXIT.MISSING);
    assert.strictEqual(readFileSync(join(root, '.env'), 'utf8'), 'FAKE_A=1\n');
    assert.match(c.lines.err.join('\n'), /Would add 1 key\(s\): FAKE_B/);
  });

  test('--fix without --yes and without a terminal refuses', async () => {
    write('.env.example', 'FAKE_A=\n');
    write('.env', '');
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--fix'], c.io), EXIT.USAGE);
    assert.strictEqual(readFileSync(join(root, '.env'), 'utf8'), '');
  });

  test('interactive --fix asks, and a "no" writes nothing', async () => {
    write('.env.example', 'FAKE_A=\n');
    write('.env', '');
    const asked = [];
    const no = {
      ...capture().io,
      isTTY: true,
      confirm: async (q) => {
        asked.push(q);
        return false;
      },
    };
    assert.strictEqual(await main(['--root', root, '--fix'], no), EXIT.MISSING);
    assert.strictEqual(readFileSync(join(root, '.env'), 'utf8'), '');
    assert.match(asked[0], /Append 1 key\(s\) to \.env: FAKE_A \(empty\) \(backup first\)/);
    const yes = { ...capture().io, isTTY: true, confirm: async () => true };
    assert.strictEqual(await main(['--root', root, '--fix'], yes), EXIT.OK);
    assert.match(readFileSync(join(root, '.env'), 'utf8'), /^FAKE_A=$/m);
  });

  test('missing example file exits 3', async () => {
    const c = capture();
    assert.strictEqual(await main(['--root', root], c.io), EXIT.NOT_FOUND);
  });

  test('unknown flag exits 2', async () => {
    const c = capture();
    assert.strictEqual(await main(['--values'], c.io), EXIT.USAGE);
  });

  test('--debug trace holds key names, not values', async () => {
    write('.env.example', `FAKE_A=${SECRET}\nFAKE_B=\n`);
    write('.env', `FAKE_A=${SECRET}\n`);
    const c = capture();
    await main(['--root', root, '--debug', '--out-dir', 'trace'], c.io);
    const trace = readFileSync(join(root, 'trace', 'env-sync.jsonl'), 'utf8');
    assert.match(trace, /FAKE_B/);
    assert.ok(!trace.includes(SECRET));
  });

  test('resolveOutDir follows the script contract order', () => {
    assert.strictEqual(resolveOutDir(root, 'x', {}), join(root, 'x'));
    assert.strictEqual(resolveOutDir(root, undefined, { STACK_OUT_DIR: join(root, 's') }), join(root, 's'));
    assert.strictEqual(resolveOutDir(root, undefined, {}), join(root, '.topia', 'stack'));
  });

  test('runs as a CLI: --help, --version and the exit code', () => {
    const help = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
    assert.strictEqual(help.status, 0);
    assert.match(help.stdout, /keys only|key name only/);
    const version = spawnSync(process.execPath, [SCRIPT, '--version'], { encoding: 'utf8' });
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
    write('.env.example', 'FAKE_A=\n');
    write('.env', `FAKE_B=${SECRET}\n`);
    const run = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.strictEqual(run.status, EXIT.MISSING);
    assert.ok(!(run.stdout + run.stderr).includes(SECRET));
    assert.ok(!existsSync(join(root, '.topia')), 'no trace without --debug');
  });
});
