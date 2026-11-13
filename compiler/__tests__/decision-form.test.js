/**
 * decision-form generator + answer-block parser (skills/decision-form/scripts/decision-form.js).
 *
 * Covers: spec validation, HTML output (each question present, default preselected,
 * no network references, the in-page formatter is the tested one), and the answer
 * block round trip through the shipped parser.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AnswerBlockError,
  BASE_CSS,
  buildAnswerJson,
  formatAnswerBlock,
  normalizeSpec,
  parseAnswerBlock,
  parseAnswerJson,
  parseAnswers,
  renderFormHtml,
  run,
  SpecError,
} from '../../skills/decision-form/scripts/decision-form.js';
import { BASE_CSS as WALKTHROUGH_BASE_CSS } from '../../skills/docs/scripts/build-walkthrough.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../skills/decision-form/scripts/decision-form.js');

const SPEC = {
  id: 'release-plan',
  title: 'Release plan <choices>',
  intro: 'Five calls for the next release.',
  decisions: [
    {
      id: 'tag',
      question: 'Move the old tag or cut a new one?',
      options: [
        { id: 'new', label: 'Cut a new tag' },
        { id: 'move', label: 'Move the old tag' },
      ],
      default: 'new',
      reason: 'Moved tags are invisible to installed plugins.',
    },
    {
      id: 'merge',
      question: 'How should the branch land?',
      group: 'Git',
      options: ['Squash', 'Merge commit', 'Rebase'],
      default: 'a',
      reason: 'One commit per feature keeps the log readable.',
    },
    {
      question: 'Which runtime floor?',
      context: 'CI runs 22 today.',
      options: [
        { id: 'n18', label: 'Node 18' },
        { id: 'n20', label: 'Node 20' },
        { id: 'n22', label: 'Node 22', detail: 'matches CI' },
      ],
      default: 'Node 22',
      reason: 'It is what CI already tests.',
    },
    {
      id: 'color',
      question: 'Pick a badge color & style',
      options: ['Blue', 'Green', 'Gray', 'Orange', 'Purple', 'Red', 'Teal'],
      default: 'c',
      reason: 'Gray stays quiet next to the logo.',
    },
    {
      id: 'docs.site',
      question: 'Publish docs now?',
      options: [
        { id: 'yes', label: 'Yes' },
        { id: 'later', label: 'After the release' },
      ],
      default: 'later',
      reason: 'The guide still names the old command.',
    },
  ],
};

describe('normalizeSpec', () => {
  test('fills ids, letter option ids, and maps a label default to its id', () => {
    const spec = normalizeSpec(SPEC);
    assert.equal(spec.id, 'release-plan');
    assert.equal(spec.decisions[2].id, 'd3');
    assert.deepEqual(
      spec.decisions[1].options.map((o) => o.id),
      ['a', 'b', 'c'],
    );
    assert.equal(spec.decisions[2].default, 'n22');
  });

  test('is idempotent, so a saved .spec.json validates again', () => {
    const once = normalizeSpec(SPEC);
    assert.deepEqual(normalizeSpec(once), once);
  });

  test('derives the form id from the title when missing', () => {
    const spec = normalizeSpec({ ...SPEC, id: undefined, title: 'Auth rework: 6 calls!' });
    assert.equal(spec.id, 'auth-rework-6-calls');
  });

  test('lists every problem at once', () => {
    const bad = {
      title: '',
      decisions: [
        { id: 'x', question: '', options: ['only one'], default: 'zz' },
        { id: 'x', question: 'Dup id', options: ['a', 'b'], default: 'a', reason: 'r' },
      ],
    };
    assert.throws(
      () => normalizeSpec(bad),
      (err) => {
        assert.ok(err instanceof SpecError);
        const all = err.problems.join('\n');
        assert.match(all, /title is required/);
        assert.match(all, /question is required/);
        assert.match(all, /at least 2 options/);
        assert.match(all, /default "zz" is not one of its option ids/);
        assert.match(all, /reason is required/);
        assert.match(all, /"x" is used twice/);
        return true;
      },
    );
  });

  test('rejects option ids that would break the answer line grammar', () => {
    const bad = {
      title: 't',
      decisions: [{ question: 'q', options: [{ id: 'has space', label: 'A' }, 'B'], default: 'b', reason: 'r' }],
    };
    assert.throws(() => normalizeSpec(bad), /may use only letters/);
  });
});

describe('renderFormHtml', () => {
  const html = renderFormHtml(SPEC, { generatedAt: '2026-01-01T00:00:00Z' });
  const spec = normalizeSpec(SPEC);

  test('contains each question, escaped', () => {
    for (const d of spec.decisions) {
      const escaped = d.question.replace(/&/g, '&amp;');
      assert.ok(html.includes(escaped), `missing question: ${d.question}`);
    }
    assert.ok(html.includes('<title>Release plan &lt;choices&gt;</title>'));
    assert.ok(!html.includes('<choices>'));
  });

  test('preselects exactly the recommended option for every decision', () => {
    for (const d of spec.decisions) {
      const useSelect = d.options.length > 6;
      if (useSelect) {
        const sel = html.match(new RegExp(`<select id="sel-${d.id}"[\\s\\S]*?</select>`))[0];
        const selected = [...sel.matchAll(/<option value="([^"]+)" selected>/g)].map((m) => m[1]);
        assert.deepEqual(selected, [d.default], `select ${d.id}`);
      } else {
        const checked = [...html.matchAll(new RegExp(`name="d-${d.id}" value="([^"]+)" checked`, 'g'))].map(
          (m) => m[1],
        );
        assert.deepEqual(checked, [d.default], `radios ${d.id}`);
      }
      assert.ok(html.includes(`data-default="${d.default}"`));
      assert.ok(html.includes(d.reason));
    }
  });

  test('renders a select above six options and radios otherwise', () => {
    assert.ok(html.includes('<select id="sel-color"'));
    assert.ok(!html.includes('<select id="sel-tag"'));
    assert.ok(html.includes('type="radio" id="opt-tag-new"'));
  });

  test('is self-contained: no external URLs, a CSP that blocks network', () => {
    assert.ok(!/\b(?:src|href)=["']?(?:https?:)?\/\//i.test(html), 'no external src/href');
    assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), 'no remote CSS');
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes('<meta name="viewport"'));
    assert.ok(html.includes('prefers-color-scheme:dark'));
  });

  test('the page runs the same formatter the parser is tested against', () => {
    assert.ok(html.includes(formatAnswerBlock.toString()));
    assert.ok(html.includes(buildAnswerJson.toString()));
    assert.equal(html.split('</script>').length, 2, 'exactly one script element');
  });

  test('base look matches the walkthrough builder', () => {
    assert.equal(BASE_CSS, WALKTHROUGH_BASE_CSS);
  });
});

describe('answer block round trip', () => {
  const spec = normalizeSpec(SPEC);
  const answers = [
    { id: 'tag', choice: 'new', status: 'default', note: '' },
    { id: 'merge', choice: 'c', status: 'changed', note: 'We rebase | always.\nSecond line "quoted"' },
    { id: 'd3', choice: 'n22', status: 'default', note: '' },
    { id: 'color', choice: 'f', status: 'changed', note: 'END TOPIA-DECISIONS is fine inside a note — ünïcode' },
    { id: 'docs.site', choice: 'later', status: 'default', note: '  padded  ' },
  ];

  test('format → parse gives the same answers', () => {
    const block = formatAnswerBlock(spec.id, answers);
    const parsed = parseAnswerBlock(block);
    assert.equal(parsed.formId, 'release-plan');
    assert.deepEqual(
      parsed.answers,
      answers.map((a) => ({ ...a, note: a.note.trim() })),
    );
  });

  test('block is compact and line-oriented', () => {
    const block = formatAnswerBlock(spec.id, answers);
    const lines = block.split('\n');
    assert.equal(lines[0], 'TOPIA-DECISIONS v1 form=release-plan count=5');
    assert.equal(lines[1], 'tag = new | default');
    assert.equal(lines.at(-1), 'END TOPIA-DECISIONS');
    assert.equal(lines.length, 7);
  });

  test('survives chat wrapping: prose, code fences, CRLF, indentation', () => {
    const block = formatAnswerBlock(spec.id, answers);
    const pasted = `Here you go:\r\n\r\n\`\`\`text\r\n${block
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\r\n')}\r\n\`\`\`\r\nThanks`;
    assert.equal(parseAnswerBlock(pasted).answers.length, 5);
  });

  test('with the spec, adds question/label and corrects a wrong status', () => {
    const block = formatAnswerBlock(spec.id, answers).replace('tag = new | default', 'tag = new | changed');
    const parsed = parseAnswerBlock(block, spec);
    assert.equal(parsed.answers[0].status, 'default');
    assert.equal(parsed.answers[0].label, 'Cut a new tag');
    assert.equal(parsed.answers[1].question, 'How should the branch land?');
    assert.equal(parsed.warnings.length, 1);
  });

  test('JSON download parses to the same answers', () => {
    const json = JSON.stringify(buildAnswerJson(spec.id, answers));
    const fromJson = parseAnswerJson(json, spec);
    const fromBlock = parseAnswerBlock(formatAnswerBlock(spec.id, answers), spec);
    assert.deepEqual(fromJson.answers, fromBlock.answers);
    assert.deepEqual(parseAnswers(json, spec).answers, fromBlock.answers);
  });

  test('.md download (block inside a fence) parses', () => {
    const md = `# Release plan — answers\n\nPaste this block into the chat.\n\n\`\`\`text\n${formatAnswerBlock(spec.id, answers)}\n\`\`\`\n`;
    assert.equal(parseAnswers(md, spec).answers.length, 5);
  });

  const block = () => formatAnswerBlock(spec.id, answers);
  const rejects = [
    ['no block', () => parseAnswerBlock('just prose'), /No TOPIA-DECISIONS block/],
    ['two blocks', () => parseAnswerBlock(`${block()}\n${block()}`), /exactly one/],
    ['cut off', () => parseAnswerBlock(block().replace('\nEND TOPIA-DECISIONS', '')), /may be cut off/],
    ['count mismatch', () => parseAnswerBlock(block().replace('count=5', 'count=6')), /count=6/],
    ['bad line', () => parseAnswerBlock(block().replace('tag = new | default', 'tag: new')), /Not an answer line/],
    ['duplicate', () => parseAnswerBlock(block().replace('d3 = n22', 'tag = n22')), /answered twice/],
    ['bad note', () => parseAnswerBlock(block().replace('note: "We', 'note: We')), /Not an answer line|JSON string/],
    ['future version', () => parseAnswerBlock(block().replace(' v1 ', ' v2 ')), /Unsupported block version/],
    ['wrong form', () => parseAnswerBlock(block().replace('form=release-plan', 'form=other'), spec), /form "other"/],
    ['unknown option', () => parseAnswerBlock(block().replace('d3 = n22', 'd3 = n99'), spec), /not an option/],
    [
      'missing decision',
      () =>
        parseAnswerBlock(
          formatAnswerBlock(
            spec.id,
            answers.filter((a) => a.id !== 'tag'),
          ),
          spec,
        ),
      /Missing answers for: tag/,
    ],
  ];
  for (const [name, fn, re] of rejects) {
    test(`rejects: ${name}`, () => {
      assert.throws(fn, (err) => err instanceof AnswerBlockError && re.test(err.message));
    });
  }
});

describe('CLI', () => {
  const capture = () => {
    let out = '';
    let err = '';
    return {
      stdout: { write: (s) => (out += s) },
      stderr: { write: (s) => (err += s) },
      get out() {
        return out;
      },
      get err() {
        return err;
      },
    };
  };

  test('builds into <root>/.topia/decision-form and parses back with the saved spec', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'topia-decision-form-'));
    try {
      writeFileSync(path.join(root, 'spec.json'), JSON.stringify(SPEC));
      const io = capture();
      const code = run(['--spec', 'spec.json', '--root', root], { env: {}, cwd: root, ...io });
      assert.equal(code, 0, io.err);
      const [htmlPath, specPath] = io.out.trim().split('\n');
      assert.equal(htmlPath, path.join(root, '.topia', 'decision-form', 'release-plan.html'));
      assert.ok(readFileSync(htmlPath, 'utf8').startsWith('<!doctype html>'));
      assert.deepEqual(JSON.parse(readFileSync(specPath, 'utf8')), normalizeSpec(SPEC));

      const spec = normalizeSpec(SPEC);
      const answers = spec.decisions.map((d) => ({ id: d.id, choice: d.default, status: 'default' }));
      writeFileSync(path.join(root, 'answers.txt'), `ok\n${formatAnswerBlock(spec.id, answers)}\n`);
      const io2 = capture();
      assert.equal(
        run(['--parse', 'answers.txt', '--root', root, '--json'], { env: {}, cwd: root, ...io2 }),
        0,
        io2.err,
      );
      const parsed = JSON.parse(io2.out);
      assert.equal(parsed.checkedAgainstSpec, true);
      assert.equal(parsed.answers[0].label, 'Cut a new tag');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('warns when git would commit the form', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'topia-decision-form-git-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      writeFileSync(path.join(root, 'spec.json'), JSON.stringify(SPEC));
      const io = capture();
      assert.equal(run(['--spec', 'spec.json', '--root', root, '--json'], { env: {}, cwd: root, ...io }), 0);
      assert.match(io.err, /git would commit/);
      assert.equal(JSON.parse(io.out).gitIgnored, false);

      writeFileSync(path.join(root, '.gitignore'), '/.topia/*\n');
      const io2 = capture();
      assert.equal(run(['--spec', 'spec.json', '--root', root, '--json'], { env: {}, cwd: root, ...io2 }), 0);
      assert.equal(io2.err, '');
      assert.equal(JSON.parse(io2.out).gitIgnored, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('exit codes: 2 usage, 3 bad spec, dry run writes nothing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'topia-decision-form-codes-'));
    try {
      const io = capture();
      assert.equal(run([], { env: {}, cwd: root, ...io }), 2);
      writeFileSync(path.join(root, 'bad.json'), JSON.stringify({ title: 'x', decisions: [] }));
      assert.equal(run(['--spec', 'bad.json'], { env: {}, cwd: root, ...capture() }), 3);
      writeFileSync(path.join(root, 'spec.json'), JSON.stringify(SPEC));
      const io3 = capture();
      assert.equal(run(['--spec', 'spec.json', '--dry-run', '--json'], { env: {}, cwd: root, ...io3 }), 0);
      assert.equal(JSON.parse(io3.out).status, 'dry-run');
      assert.throws(() => readFileSync(path.join(root, '.topia', 'decision-form', 'release-plan.html')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('runs as a script (--version, --help)', () => {
    assert.match(execFileSync(process.execPath, [SCRIPT, '--version'], { encoding: 'utf8' }), /^\d+\.\d+\.\d+\n$/);
    assert.match(execFileSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' }), /TOPIA-DECISIONS/);
  });
});
