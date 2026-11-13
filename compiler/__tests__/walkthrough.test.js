/**
 * docs show-and-tell builder (skills/docs/scripts/build-walkthrough.js).
 *
 * Builds a throwaway git repo so the evidence check runs against real commits.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  normalizeWalkthrough,
  renderHtml,
  renderMarkdown,
  run,
  verifyEvidence,
  WalkthroughError,
} from '../../skills/docs/scripts/build-walkthrough.js';

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let root;
let base;
let featureSha;

function git(...args) {
  return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

before(() => {
  root = mkdtempSync(path.join(tmpdir(), 'topia-walkthrough-'));
  git('init', '-q');
  writeFileSync(path.join(root, 'old.txt'), 'old\n');
  writeFileSync(path.join(root, 'README.md'), '# demo\n');
  git('add', '.');
  git('commit', '-q', '-m', 'chore: start');
  base = git('rev-parse', 'HEAD');
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'feature.js'), 'export const x = 1;\n');
  git('rm', '-q', 'old.txt');
  git('add', '.');
  git('commit', '-q', '-m', 'feat: add feature <x>');
  featureSha = git('rev-parse', '--short', 'HEAD');
  mkdirSync(path.join(root, 'shots'));
  writeFileSync(path.join(root, 'shots', 'home page.png'), PNG);
});

after(() => rmSync(root, { recursive: true, force: true }));

const spec = (over = {}) => ({
  title: 'Feature X walkthrough',
  summary: 'Adds `x`. It replaces the old file.',
  range: `${base}..HEAD`,
  changes: [
    { what: 'New feature module.', why: 'Callers need `x`.', files: ['src/feature.js'], commits: [featureSha] },
    { what: 'Old file removed.', why: 'Nothing read it.', files: ['old.txt'] },
  ],
  tryIt: [{ step: 'Import it.', command: 'node -e "import(\'./src/feature.js\')"', expect: 'No error.' }],
  lookFor: ['The export is named `x`.'],
  limits: ['Only one value so far.'],
  screenshots: [{ path: 'shots/home page.png', caption: 'Home <page>' }],
  ...over,
});

describe('normalizeWalkthrough', () => {
  test('requires evidence on every change', () => {
    assert.throws(
      () => normalizeWalkthrough(spec({ changes: [{ what: 'Faster.', why: 'Users asked.' }] })),
      (err) => err instanceof WalkthroughError && /cites no files or commits/.test(err.message),
    );
  });

  test('requires summary, steps, lookFor and limits', () => {
    assert.throws(
      () => normalizeWalkthrough({ title: 't', changes: [{ what: 'a', why: 'b', files: ['f'] }] }),
      (err) => {
        const all = err.problems.join('\n');
        return /summary/.test(all) && /tryIt/.test(all) && /lookFor/.test(all) && /limits/.test(all);
      },
    );
  });
});

describe('verifyEvidence', () => {
  test('passes for real commits, existing files, and files deleted in the range', () => {
    const { problems, log } = verifyEvidence(normalizeWalkthrough(spec()), root);
    assert.deepEqual(problems, []);
    assert.equal(log.length, 1);
    assert.equal(log[0].subject, 'feat: add feature <x>');
  });

  test('flags unknown commits, commits outside the range, and missing files', () => {
    const outside = base.slice(0, 7);
    const bad = spec({
      changes: [
        { what: 'a', why: 'b', commits: ['deadbeef'] },
        { what: 'c', why: 'd', commits: [outside] },
        { what: 'e', why: 'f', files: ['src/nope.js'] },
      ],
    });
    const { problems } = verifyEvidence(normalizeWalkthrough(bad), root);
    const all = problems.join('\n');
    assert.match(all, /deadbeef is not in this repo/);
    assert.match(all, new RegExp(`${outside} is outside`));
    assert.match(all, /src\/nope\.js does not exist/);
  });

  test('flags a range that does not resolve', () => {
    const { problems } = verifyEvidence(normalizeWalkthrough(spec({ range: 'nope..HEAD' })), root);
    assert.match(problems.join('\n'), /does not resolve/);
  });
});

describe('render', () => {
  test('markdown has every section, the evidence, and the git log', () => {
    const s = normalizeWalkthrough(spec());
    const { log } = verifyEvidence(s, root);
    const md = renderMarkdown(s, { log, root, outDir: path.join(root, '.topia', 'show-and-tell') });
    for (const h of ['## What changed and why', '## Try it', '## What to look for', '## Known limits', '## Commits']) {
      assert.ok(md.includes(h), h);
    }
    assert.ok(md.includes(`Commits: \`${featureSha}\``));
    assert.ok(md.includes('](../../shots/home%20page.png)'));
    assert.ok(md.includes('feat: add feature <x>'));
  });

  test('html is one escaped file with screenshots inlined', () => {
    const s = normalizeWalkthrough(spec());
    const html = renderHtml(s, { log: verifyEvidence(s, root).log, root });
    assert.ok(html.includes('data:image/png;base64,'));
    assert.ok(html.includes('alt="Home &lt;page&gt;"'));
    assert.ok(html.includes('feat: add feature &lt;x&gt;'));
    assert.ok(html.includes('<code>x</code>'));
    assert.ok(!/\b(?:src|href)=["']?(?:https?:)?\/\//i.test(html));
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(!html.includes('<script'));
  });
});

describe('CLI', () => {
  const io = () => {
    const o = { out: '', err: '' };
    o.stdout = { write: (s) => (o.out += s) };
    o.stderr = { write: (s) => (o.err += s) };
    return o;
  };

  test('writes .topia/show-and-tell/<id>.md by default and .html on request', () => {
    writeFileSync(path.join(root, 'w.json'), JSON.stringify(spec()));
    const a = io();
    assert.equal(run(['--spec', 'w.json'], { env: {}, cwd: root, ...a }), 0, a.err);
    const mdPath = a.out.trim();
    assert.equal(mdPath, path.join(root, '.topia', 'show-and-tell', 'feature-x-walkthrough.md'));
    assert.ok(readFileSync(mdPath, 'utf8').startsWith('# Feature X walkthrough'));

    const b = io();
    assert.equal(run(['--spec', 'w.json', '--format', 'html', '--json'], { env: {}, cwd: root, ...b }), 0, b.err);
    assert.equal(JSON.parse(b.out).verified, true);
  });

  test('exits 3 when evidence fails, 2 on a bad format', () => {
    writeFileSync(
      path.join(root, 'bad.json'),
      JSON.stringify(spec({ changes: [{ what: 'a', why: 'b', commits: ['abcdef12'] }] })),
    );
    const a = io();
    assert.equal(run(['--spec', 'bad.json'], { env: {}, cwd: root, ...a }), 3);
    assert.match(a.err, /not in this repo/);
    assert.equal(run(['--spec', 'w.json', '--format', 'pdf'], { env: {}, cwd: root, ...io() }), 2);
  });
});
