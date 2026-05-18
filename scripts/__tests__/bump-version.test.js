import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'bump-version.js');

/**
 * Spin up a tiny mirror of the Topia root (just the touchpoint files)
 * so we can run bump-version.js against it without mutating the real repo.
 */
function seedFixture(version) {
  const root = mkdtempSync(join(tmpdir(), 'Topia-bump-'));
  mkdirSync(join(root, 'docs'), { recursive: true });
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });

  // type: module required so the ESM bump-version.js can be executed from this fixture root
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: '@linenoize/topia', version, type: 'module' }, null, 2),
  );
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Topia', version }, null, 2));
  writeFileSync(
    join(root, 'docs', 'index.html'),
    `<p class="hero-badge">v${version} &middot; 65 skills &middot; MIT</p>\n`,
  );

  copyFileSync(SCRIPT, join(root, 'scripts', 'bump-version.js'));
  writeFileSync(join(root, 'scripts', 'version-sync-check.js'), `process.exit(0);\n`);
  return root;
}

function runBump(root, args) {
  return execFileSync('node', [join(root, 'scripts', 'bump-version.js'), ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('bump-version', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('rejects when no version argument is provided', () => {
    root = seedFixture('1.0.0');
    assert.throws(() => runBump(root, ['--dry-run']), /Usage:/);
  });

  test('rejects when version equals current version', () => {
    root = seedFixture('1.0.0');
    assert.throws(() => runBump(root, ['1.0.0', '--dry-run']), /already at 1\.0\.0/);
  });

  test('dry-run reports targets without writing', () => {
    root = seedFixture('1.0.0');
    const out = runBump(root, ['1.1.0', '--dry-run']);
    assert.match(out, /Bumping 1\.0\.0 → 1\.1\.0 \(DRY RUN\)/);
    assert.match(out, /package\.json/);
    assert.match(out, /plugin\.json/);
    assert.match(out, /docs\/index\.html/);

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.0.0', 'dry-run must not mutate files');
  });

  test('write mode bumps all files', () => {
    root = seedFixture('1.0.0');
    runBump(root, ['1.1.0']);

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.1.0');

    const plugin = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
    assert.strictEqual(plugin.version, '1.1.0');

    const indexHtml = readFileSync(join(root, 'docs', 'index.html'), 'utf8');
    assert.match(indexHtml, /v1\.1\.0\s*&middot;/);
    assert.ok(!indexHtml.includes('v1.0.0'), 'old version must be replaced');
  });
});
