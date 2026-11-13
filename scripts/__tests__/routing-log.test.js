/**
 * hooks/lib/routing-log.cjs and the chain-step fields the usage report joins on.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { appendRouting, routingLogPath } = require('../../hooks/lib/routing-log.cjs');
const { mergeChain } = require('../../hooks/lib/session-rows.cjs');

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'routing-log-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const rows = (dir) =>
  readFileSync(routingLogPath(dir), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));

describe('routing log', () => {
  test('writes one line per hint with time, session, ranked skills, run time and bare flag', () => {
    const dir = mkdtempSync(path.join(SCRATCH, 'p-'));
    const now = new Date('2026-11-01T10:00:00.000Z');
    assert.equal(appendRouting(dir, { session: 's1', skills: ['build', 'test'], ms: 41.6, now }), true);
    assert.equal(appendRouting(dir, { session: null, skills: ['debug'], ms: 12, bare: true, now }), true);
    assert.deepEqual(rows(dir), [
      { ts: '2026-11-01T10:00:00.000Z', session: 's1', skills: ['build', 'test'], ms: 42, bare: false },
      { ts: '2026-11-01T10:00:00.000Z', session: null, skills: ['debug'], ms: 12, bare: true },
    ]);
  });

  test('writes nothing without a skill id, and keeps only id-shaped strings', () => {
    const dir = mkdtempSync(path.join(SCRATCH, 'p-'));
    assert.equal(appendRouting(dir, { session: 's', skills: [], ms: 1 }), false);
    assert.equal(appendRouting(dir, { session: 's', skills: ['fix the bug please'], ms: 1 }), false);
    appendRouting(dir, { session: 's', skills: ['build', 'not an id', 7], ms: 1 });
    assert.deepEqual(rows(dir)[0].skills, ['build']);
  });

  test('trims to the newest whole lines once past the size cap', () => {
    const dir = mkdtempSync(path.join(SCRATCH, 'p-'));
    for (let i = 0; i < 200; i++)
      appendRouting(dir, { session: `s${i}`, skills: ['build'], ms: i }, { maxBytes: 4096 });
    const size = statSync(routingLogPath(dir)).size;
    assert.ok(size <= 4096, `${size} bytes`);
    const kept = rows(dir);
    assert.equal(kept.at(-1).session, 's199', 'the newest line survives');
    assert.ok(kept.length < 200 && kept.length > 10);
  });

  test('fails silently when the metrics folder cannot be made', () => {
    const file = path.join(SCRATCH, 'a-file');
    writeFileSync(file, '');
    assert.equal(appendRouting(file, { session: 's', skills: ['build'], ms: 1 }), false);
  });
});

describe('chain rows carry when and how each step ran', () => {
  test('merging appends at and via alongside chain', () => {
    const merged = mergeChain(
      { session: 's', chain: ['plan'], at: ['2026-11-01T10:00:00Z'], via: ['slash'], depth: 1 },
      { session: 's', chain: ['build'], at: ['2026-11-01T10:05:00Z'], via: ['skill'], depth: 1 },
    );
    assert.deepEqual(merged.chain, ['plan', 'build']);
    assert.deepEqual(merged.at, ['2026-11-01T10:00:00Z', '2026-11-01T10:05:00Z']);
    assert.deepEqual(merged.via, ['slash', 'skill']);
    assert.equal(merged.depth, 2);
  });

  test('rows written before the fields existed stay aligned, with nulls', () => {
    const merged = mergeChain(
      { session: 's', chain: ['plan', 'fix'], depth: 2 },
      { session: 's', chain: ['build'], at: ['2026-11-01T10:05:00Z'], via: ['agent'], depth: 1 },
    );
    assert.deepEqual(merged.at, [null, null, '2026-11-01T10:05:00Z']);
    assert.deepEqual(merged.via, [null, null, 'agent']);
  });
});

describe('hint and use land where the usage report can join them', () => {
  const REPO = path.resolve(import.meta.dirname, '..', '..');
  const RUN_HOOK = path.join(REPO, 'hooks', 'run-hook.cjs');
  const run = (name, payload, cwd, tmp) => {
    const res = spawnSync(process.execPath, [RUN_HOOK, name], {
      input: JSON.stringify(payload),
      cwd,
      encoding: 'utf8',
      timeout: 60000,
      env: {
        ...process.env,
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        CLAUDE_PLUGIN_ROOT: REPO,
        CURSOR_HOOK: '',
        CURSOR_AGENT: '',
        CURSOR_VERSION: '',
        CURSOR_PROJECT_DIR: '',
      },
    });
    assert.equal(res.status, 0, `${name}: ${res.stderr}`);
  };

  test('routing.jsonl and chains.jsonl share the session id, with times on both sides', () => {
    const project = mkdtempSync(path.join(SCRATCH, 'e2e-'));
    const tmp = path.join(project, 'tmp');
    mkdirSync(tmp);
    const base = { cwd: project, session_id: 'sess-e2e' };
    run('intent-router', { ...base, prompt: 'write a unit test for the parser' }, project, tmp);
    run('metrics-collector', { ...base, tool_name: 'Skill', tool_input: { skill: 'topia:test' } }, project, tmp);
    run('post-session-reflect', { ...base, hook_event_name: 'Stop' }, project, tmp);

    const hint = rows(project)[0];
    assert.equal(hint.session, 'sess-e2e');
    assert.ok(hint.skills.includes('test'));
    const chain = JSON.parse(readFileSync(path.join(project, '.topia', 'metrics', 'chains.jsonl'), 'utf8').trim());
    assert.equal(chain.session, 'sess-e2e');
    assert.deepEqual(chain.chain, ['test']);
    assert.deepEqual(chain.via, ['skill']);
    assert.ok(Date.parse(chain.at[0]) >= Date.parse(hint.ts));
  });
});
