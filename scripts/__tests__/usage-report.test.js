/**
 * usage-report.js — project metrics and transcript scans on small synthetic fixtures.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { agentSkill, main, parseArgs, projectReport, transcriptReport } from '../usage-report.js';

const SCRATCH = mkdtempSync(path.join(tmpdir(), 'usage-report-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const CATALOG = ['build', 'debug', 'test', 'plan', 'docs'];
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

function project() {
  const dir = path.join(SCRATCH, 'example-app');
  const metrics = path.join(dir, '.topia', 'metrics');
  mkdirSync(metrics, { recursive: true });
  writeFileSync(
    path.join(metrics, 'routing.jsonl'),
    jsonl([
      { ts: '2026-11-01T10:00:00.000Z', session: 's1', skills: ['build', 'test'], ms: 40, bare: false },
      { ts: '2026-11-01T11:00:00.000Z', session: 's1', skills: ['debug'], ms: 60, bare: false },
      { ts: '2026-11-02T09:00:00.000Z', session: 's2', skills: ['build'], ms: 50, bare: true },
    ]),
  );
  writeFileSync(
    path.join(metrics, 'chains.jsonl'),
    jsonl([
      {
        session: 's1',
        chain: ['build', 'test', 'build'],
        at: ['2026-11-01T10:00:30.000Z', '2026-11-01T09:00:00.000Z', '2026-11-01T10:02:00.000Z'],
        via: ['skill', 'agent', 'slash'],
        depth: 3,
      },
      { session: 's0', chain: ['plan'], depth: 1 },
    ]),
  );
  writeFileSync(
    path.join(metrics, 'skills.json'),
    JSON.stringify({ version: 2, skills: { build: { total_invocations: 9 }, plan: { total_invocations: 1 } } }),
  );
  return dir;
}

describe('usage-report --project', () => {
  const report = projectReport(project(), { catalog: CATALOG });
  const by = Object.fromEntries(report.skills.map((s) => [s.skill, s]));

  test('counts hints, top-ranked hints and bare redirects', () => {
    assert.equal(report.hints, 3);
    assert.equal(report.bare_redirects, 1);
    assert.equal(report.hook_ms_median, 50);
    assert.equal(by.build.hinted, 2);
    assert.equal(by.build.hinted_top, 2);
    assert.equal(by.test.hinted, 1);
    assert.equal(by.test.hinted_top, 0);
  });

  test('counts uses by via; rows without via are unknown', () => {
    assert.deepEqual(by.build.used_by, { skill: 1, agent: 0, slash: 1, unknown: 0 });
    assert.deepEqual(by.plan.used_by, { skill: 0, agent: 0, slash: 0, unknown: 1 });
    assert.equal(by.build.lifetime_invocations, 9);
  });

  test('a hint is followed only by a use in the same session at or after it', () => {
    assert.equal(by.build.followed, 1, 'the s1 hint was followed; the s2 hint was not');
    assert.equal(by.build.followed_pct, 50);
    assert.equal(by.build.median_seconds_to_use, 30);
    assert.equal(by.test.followed, 0, 'test ran before its hint');
    assert.equal(by.debug.followed, 0);
  });

  test('lists skills never used or never hinted', () => {
    assert.deepEqual(report.never_used, ['debug', 'docs']);
    assert.deepEqual(report.never_hinted, ['plan', 'docs']);
    assert.deepEqual(report.never_used_or_hinted, ['docs']);
  });

  test('--since drops older hints and untimed uses', () => {
    const later = projectReport(project(), { catalog: CATALOG, since: '2026-11-02' });
    assert.equal(later.hints, 1);
    assert.equal(later.skills.find((s) => s.skill === 'plan')?.used ?? 0, 0);
  });
});

function transcripts() {
  const root = path.join(SCRATCH, 'projects');
  const proj = path.join(root, 'C--src-example-app');
  mkdirSync(path.join(proj, 'sess-a', 'subagents'), { recursive: true });
  const tool = (id, name, input = {}) => ({
    type: 'assistant',
    timestamp: '2026-11-01T10:00:00.000Z',
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });
  writeFileSync(
    path.join(proj, 'sess-a.jsonl'),
    jsonl([
      { type: 'user', message: { content: 'please write the release notes for example.com' } },
      {
        type: 'attachment',
        attachment: {
          type: 'deferred_tools_delta',
          addedNames: ['mcp__example_docs__search', 'mcp__example_mail__send', 'Read'],
        },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: { content: '<command-name>/topia:plan</command-name>\n<command-args>x</command-args>' },
      },
      {
        type: 'user',
        uuid: 'u1',
        message: { content: '<command-name>/topia:plan</command-name>' },
      },
      { type: 'user', message: { content: 'Base directory for this skill: <command-name>/topia:docs</command-name>' } },
      {
        type: 'user',
        uuid: 'u2',
        message: { content: '<command-name>/topia</command-name><command-args>debug it</command-args>' },
      },
      { type: 'user', uuid: 'u3', message: { content: '<command-name>/clear</command-name>' } },
      tool('t1', 'Skill', { skill: 'topia:build' }),
      tool('t1', 'Skill', { skill: 'topia:build' }),
      tool('t2', 'Skill', { skill: 'other-plugin:thing' }),
      tool('t3', 'Agent', { subagent_type: 'topia:test-agent', prompt: 'secret words' }),
      tool('t4', 'Agent', { subagent_type: 'general-purpose' }),
      tool('t5', 'mcp__example_docs__search', { q: 'private query' }),
    ]),
  );
  writeFileSync(
    path.join(proj, 'sess-a', 'subagents', 'agent-1.jsonl'),
    jsonl([
      tool('t6', 'mcp__example_docs__search'),
      { type: 'user', isSidechain: true, message: { content: '<command-name>/topia:docs</command-name>' } },
    ]),
  );
  writeFileSync(
    path.join(proj, 'sess-b.jsonl'),
    jsonl([
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: '<system-reminder>deferred tools: mcp__example_mail__send</system-reminder>' },
            { type: 'text', text: 'ask about mcp__example_chat__post here' },
          ],
        },
      },
    ]),
  );
  return root;
}

describe('usage-report --transcripts', async () => {
  const report = await transcriptReport(transcripts(), { catalog: CATALOG });
  const by = Object.fromEntries(report.skills.map((s) => [s.skill, s]));
  const server = Object.fromEntries(report.mcp_servers.map((s) => [s.server, s]));

  test('counts Topia skills by Skill tool, slash command and agent, once each', () => {
    assert.equal(by.build.skill_tool, 1);
    assert.equal(by.plan.slash, 1);
    assert.equal(by.debug.slash, 1, '/topia debug names the skill in its args');
    assert.equal(by.test.agent, 1, 'topia:test-agent counts as test');
    assert.equal(by.docs, undefined, 'skill bodies and sidechain commands are not invocations');
    assert.equal(report.totals.other_plugin_skill_calls, 1);
  });

  test('counts MCP calls per server and the sessions that listed its tools', () => {
    assert.equal(server.example_docs.calls, 2);
    assert.equal(server.example_docs.sessions_used, 1, 'a subagent file belongs to its parent session');
    assert.equal(server.example_docs.sessions_listed, 1);
    assert.equal(server.example_mail.calls, 0);
    assert.equal(server.example_mail.sessions_listed, 2);
    assert.equal(server.example_chat, undefined, 'plain prompt text is not a tool listing');
    assert.deepEqual(report.mcp_listed_never_used, ['example_mail']);
  });

  test('reports scan totals without paths or text', async () => {
    assert.equal(report.scanned.files, 3);
    assert.equal(report.scanned.sessions, 2);
    assert.equal(report.scanned.projects, 1);
    assert.equal(report.scanned.bad_lines, 0, 'lines without markers are skipped before parsing');
    const out = [];
    await main(['--transcripts', transcripts(), '--json'], (line) => out.push(line));
    const text = out.join('\n');
    for (const secret of ['secret words', 'private query', 'release notes', 'example.com', SCRATCH]) {
      assert.equal(text.includes(secret), false, secret);
    }
  });
});

describe('usage-report cli', () => {
  test('agentSkill maps topia agents to skills', () => {
    assert.equal(agentSkill('topia:debug-agent'), 'debug');
    assert.equal(agentSkill('topia:coder'), 'coder');
    assert.equal(agentSkill('Explore'), null);
  });

  test('parses flags and rejects bad dates', () => {
    assert.equal(parseArgs(['--project', 'x', '--json']).json, true);
    assert.match(parseArgs(['--transcripts']).transcripts, /projects$/);
    assert.throws(() => parseArgs(['--project', 'x', '--since', 'yesterday']));
    assert.equal(parseArgs([]).help, true);
  });

  test('prints a readable table for a project', async () => {
    const out = [];
    const code = await main(['--project', project()], (line) => out.push(line));
    assert.equal(code, 0);
    assert.match(out.join('\n'), /^Project example-app/);
    assert.match(out.join('\n'), /build\s+2\s+2\s+2/);
  });
});
