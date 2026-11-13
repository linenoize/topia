/**
 * stack skill — env-sync.js: .env vs .env.example by key name only.
 * Every fixture uses fake keys and sentinel values; the tests assert that no
 * value ever reaches stdout, stderr, JSON or the debug trace.
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendMissingKeys,
  checkEnvFiles,
  compareKeys,
  EXIT,
  main,
  parseEnvKeys,
  resolveExamplePath,
  resolveOutDir,
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

  test('--fix --yes creates .env when it is missing', async () => {
    write('.env.example', 'FAKE_A=x\n');
    const c = capture();
    assert.strictEqual(await main(['--root', root, '--fix', '--yes'], c.io), EXIT.OK);
    assert.strictEqual(
      readFileSync(join(root, '.env'), 'utf8'),
      '# Added by env-sync. Fill in these values.\nFAKE_A=\n',
    );
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
    assert.match(asked[0], /Append 1 empty key/);
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
