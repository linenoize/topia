/**
 * Skill telemetry: every way a skill runs must reach .topia/metrics.
 *
 * Regression cover for a project whose 100 recorded "sessions" showed one skill
 * while the transcripts held slash commands, topia:* subagents and Skill calls:
 *   - tmpdir buffers keyed by the first 12 bytes of cwd (all of C:\CodeBase\ shared one)
 *   - slash commands and Agent subagent_type never counted
 *   - Stop (per turn) appended a row per turn instead of one per session
 *   - context_peak never measured on Claude; pressure_level from a tool-count proxy
 *   - platform logged as "cursor" for every Claude hook
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const { cwdHash } = require('../../hooks/lib/metrics-buffer.cjs');
const {
  extractToolSkillInvocation,
  slashCommandSkill,
  slashInvocationsFromRecords,
} = require('../../hooks/lib/skill-telemetry.cjs');
const {
  scanTranscript,
  scanTranscriptSinceLast,
  resolveContextWindow,
  pressureFromPercent,
} = require('../../hooks/lib/transcript-meter.cjs');
const { sessionPressure, mergeSessionEntry, upsertJsonl, readJsonl } = require('../../hooks/lib/session-rows.cjs');
const { detectPlatform, extractToolIoTokens, normalizeSessionTokens } = require('../../hooks/lib/token-meter.cjs');

const REPO = path.resolve(import.meta.dirname, '..', '..');
const RUN_HOOK = path.join(REPO, 'hooks', 'run-hook.cjs');

const cleanups = [];
after(() => {
  for (const d of cleanups) rmSync(d, { recursive: true, force: true });
});
function scratch(prefix) {
  const d = mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(d);
  return d;
}

// --- transcript record builders ------------------------------------------------
const userRec = (content, ts = '2026-10-28T10:00:00.000Z', extra = {}) => ({
  type: 'user',
  timestamp: ts,
  message: { role: 'user', content },
  ...extra,
});
const slashRec = (name, ts) =>
  userRec(`<command-message>${name.replace(/^\//, '')}</command-message>\n<command-name>${name}</command-name>`, ts);
const skillBody = () => userRec([{ type: 'text', text: 'Base directory for this skill: /x/skills/audit\n\n# Audit' }]);
const assistantRec = (input, cacheRead, cacheCreate, extra = {}) => ({
  type: 'assistant',
  timestamp: '2026-10-28T10:00:01.000Z',
  message: {
    model: 'claude-opus-5-5',
    usage: {
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreate,
      output_tokens: 9,
    },
  },
  ...extra,
});
const jsonl = (records) => `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;

describe('cwdHash — per-project tmpdir keys', () => {
  test('sibling projects under one parent get different keys', () => {
    const a = path.join(os.tmpdir(), 'CodeBase', 'Protopia', 'dev-stack', 'tools', 'roster-check');
    const b = path.join(os.tmpdir(), 'CodeBase', 'steepwright');
    assert.notEqual(cwdHash(a), cwdHash(b));
    // The old key — first 16 base64url chars = first 12 bytes — collided here.
    const old = (p) => Buffer.from(p).toString('base64url').slice(0, 16);
    assert.equal(old('C:\\CodeBase\\Protopia\\x'), old('C:\\CodeBase\\steepwright'));
  });

  test('stable for the same directory', () => {
    const a = path.join(os.tmpdir(), 'proj');
    assert.equal(cwdHash(a), cwdHash(`${a}${path.sep}`));
    assert.match(cwdHash(a), /^[0-9a-f]{16}$/);
  });
});

describe('extractToolSkillInvocation — Skill and Agent tools', () => {
  test('Skill tool, namespaced skill field', () => {
    assert.deepEqual(extractToolSkillInvocation({ tool_name: 'Skill', tool_input: { skill: 'topia:journal' } }), {
      skill: 'journal',
      via: 'skill',
    });
  });

  test('Skill tool, legacy name field and other plugins keep their namespace', () => {
    assert.equal(
      extractToolSkillInvocation({ tool_name: 'Skill', tool_input: { name: 'Topia:build' } }).skill,
      'build',
    );
    assert.equal(
      extractToolSkillInvocation({ tool_name: 'Skill', tool_input: { skill: 'remember:remember' } }).skill,
      'remember:remember',
    );
    assert.equal(
      extractToolSkillInvocation({ tool_name: 'Skill', tool_input: { skill: 'impeccable' } }).skill,
      'impeccable',
    );
  });

  test('Agent / Task with a topia:* subagent_type count as the skill', () => {
    assert.deepEqual(
      extractToolSkillInvocation({ tool_name: 'Agent', tool_input: { subagent_type: 'topia:guardian', prompt: 'x' } }),
      { skill: 'guardian', via: 'agent' },
    );
    assert.equal(
      extractToolSkillInvocation({ tool_name: 'Task', tool_input: { subagent_type: 'topia:perf' } }).skill,
      'perf',
    );
  });

  test('non-Topia subagents and other tools are not skills', () => {
    assert.equal(
      extractToolSkillInvocation({ tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose' } }),
      null,
    );
    assert.equal(extractToolSkillInvocation({ tool_name: 'Agent', tool_input: {} }), null);
    assert.equal(extractToolSkillInvocation({ tool_name: 'Bash', tool_input: { command: 'ls' } }), null);
    assert.equal(extractToolSkillInvocation({ tool_name: 'Skill', tool_input: { skill: '' } }), null);
  });
});

describe('slash commands', () => {
  test('/topia:<skill> counts; built-ins and aliases do not', () => {
    assert.equal(slashCommandSkill('/topia:audit'), 'audit');
    assert.equal(slashCommandSkill('/clear'), null);
    assert.equal(slashCommandSkill('/compact'), null);
    // Aliases tell the model to call the Skill tool, which is counted there.
    assert.equal(slashCommandSkill('/topia:topia-audit'), null);
    assert.equal(slashCommandSkill('/topia-audit'), null);
  });

  test('a non-Topia command counts only when Claude Code loaded a skill for it', () => {
    assert.equal(slashCommandSkill('/impeccable', { loadedSkill: true }), 'impeccable');
    assert.equal(slashCommandSkill('/impeccable'), null);
  });

  test('reads command records out of a transcript', () => {
    const records = [
      userRec('<local-command-caveat>Caveat</local-command-caveat>'),
      slashRec('/clear', '2026-10-28T09:00:00.000Z'),
      { type: 'system' },
      slashRec('/topia:audit', '2026-10-28T09:01:00.000Z'),
      skillBody(),
      assistantRec(2, 100, 10),
      slashRec('/impeccable', '2026-10-28T09:02:00.000Z'),
      skillBody(),
      userRec('plain prompt mentioning <command-name>/topia:fake</command-name>?', undefined, { isSidechain: true }),
    ];
    assert.deepEqual(slashInvocationsFromRecords(records), [
      { skill: 'audit', via: 'slash', ts: '2026-10-28T09:01:00.000Z' },
      { skill: 'impeccable', via: 'slash', ts: '2026-10-28T09:02:00.000Z' },
    ]);
  });
});

describe('transcript-meter — measured context', () => {
  test('context = input + cache_read + cache_creation; peak over main-thread records only', () => {
    const dir = scratch('tm-');
    const file = path.join(dir, 't.jsonl');
    writeFileSync(
      file,
      jsonl([
        assistantRec(2, 150_000, 10_000),
        assistantRec(1, 240_000, 5_000),
        assistantRec(1, 900_000, 0, { isSidechain: true }),
        assistantRec(1, 100_000, 0),
      ]),
    );
    const r = scanTranscript(file);
    assert.equal(r.contextPeak, 245_001);
    assert.equal(r.model, 'claude-opus-5-5');
  });

  test('incremental: each byte is scanned once, a torn last line waits', () => {
    const dir = scratch('tm-');
    const file = path.join(dir, 't.jsonl');
    const cursor = path.join(dir, 'cursor.json');
    writeFileSync(file, jsonl([slashRec('/topia:audit'), skillBody(), assistantRec(1, 50_000, 0)]));

    const first = scanTranscriptSinceLast(file, cursor);
    assert.equal(first.contextPeak, 50_001);
    assert.deepEqual(
      first.slashInvocations.map((s) => s.skill),
      ['audit'],
    );

    const torn = JSON.stringify(assistantRec(1, 70_000, 0));
    appendFileSync(file, `${JSON.stringify(assistantRec(1, 60_000, 0))}\n${torn.slice(0, 20)}`);
    const second = scanTranscriptSinceLast(file, cursor);
    assert.equal(second.contextPeak, 60_001, 'only the new complete line');
    assert.deepEqual(second.slashInvocations, [], 'the audit command is not counted twice');

    appendFileSync(file, `${torn.slice(20)}\n`);
    assert.equal(scanTranscriptSinceLast(file, cursor).contextPeak, 70_001);
    assert.equal(scanTranscriptSinceLast(file, cursor).contextPeak, null, 'nothing new');
  });

  test('missing transcript → null, never throws', () => {
    assert.equal(scanTranscript(path.join(os.tmpdir(), 'nope-does-not-exist.jsonl')), null);
    assert.equal(scanTranscriptSinceLast(undefined, path.join(os.tmpdir(), 'x.json')), null);
  });

  test('context window is reported only when it can be known', () => {
    assert.deepEqual(resolveContextWindow({ peak: 509_609, env: {} }), { size: 1_000_000, source: 'inferred' });
    assert.equal(resolveContextWindow({ peak: 150_000, env: {} }), null, 'no guess at or under 200k');
    assert.deepEqual(resolveContextWindow({ peak: 150_000, model: 'claude-opus-5-5[1m]', env: {} }), {
      size: 1_000_000,
      source: 'model',
    });
    assert.deepEqual(resolveContextWindow({ peak: 150_000, env: { TOPIA_CONTEXT_WINDOW: '200000' } }), {
      size: 200_000,
      source: 'env',
    });
    assert.equal(resolveContextWindow({ peak: 10, explicit: 128_000, env: {} }).source, 'payload');
  });

  test('pressure from % used follows context-engine Step 6b', () => {
    assert.equal(pressureFromPercent(51), 'yellow');
    assert.equal(pressureFromPercent(30), 'green');
    assert.equal(pressureFromPercent(70), 'orange');
    assert.equal(pressureFromPercent(80), 'red');
    assert.equal(pressureFromPercent(null), null);
  });
});

describe('session rows — one per session', () => {
  test('measured pressure wins; otherwise the tool-count proxy is labelled as such', () => {
    assert.deepEqual(sessionPressure({ context_peak_percent: 51 }, 'red'), {
      pressure_level: 'yellow',
      pressure_source: 'context',
    });
    assert.deepEqual(sessionPressure({ context_peak_percent: null }, 'red'), {
      pressure_level: 'red',
      pressure_source: 'tool_count',
    });
  });

  test('two turns of one session fold into one row', () => {
    const dir = scratch('rows-');
    const file = path.join(dir, 'sessions.jsonl');
    writeFileSync(file, `${JSON.stringify({ id: 'other', skills_used: [] })}\n`);
    const turn = (skills, peak, calls) => ({
      id: 's1',
      date: '2026-10-28',
      turns: 1,
      tool_calls: calls,
      duration_min: calls,
      skill_counts: skills,
      skill_invocations: Object.values(skills).reduce((a, b) => a + b, 0),
      skill_via: { skill: 1 },
      skills_used: Object.keys(skills),
      tool_count_pressure: 'green',
      tokens: { context_peak: peak, context_peak_percent: peak / 10_000, estimated_io: 100, confidence: 'mixed' },
    });
    upsertJsonl(file, turn({ audit: 1 }, 300_000, 40), { merge: mergeSessionEntry });
    upsertJsonl(file, turn({ audit: 1, journal: 1 }, 250_000, 90), { merge: mergeSessionEntry });

    const rows = readJsonl(file);
    assert.equal(rows.length, 2);
    const s1 = rows.find((r) => r.id === 's1');
    assert.deepEqual(s1.skill_counts, { audit: 2, journal: 1 });
    assert.deepEqual(s1.skills_used, ['audit', 'journal']);
    assert.equal(s1.skill_invocations, 3);
    assert.equal(s1.turns, 2);
    assert.equal(s1.tool_calls, 90);
    assert.equal(s1.tokens.context_peak, 300_000, 'peak is the max, not the latest');
    assert.equal(s1.tokens.estimated_io, 200, 'per-turn estimates add up');
    assert.equal(s1.pressure_source, 'context');
    assert.equal(rows[rows.length - 1].id, 's1', 'updated row moves to the end');
  });
});

describe('token-meter fixes', () => {
  test('Claude hook payloads are platform "claude", Cursor ones "cursor"', () => {
    const saved = {};
    for (const k of ['CURSOR_HOOK', 'CURSOR_AGENT', 'CURSOR_VERSION', 'CURSOR_PROJECT_DIR']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      assert.equal(detectPlatform({ hook_event_name: 'PostToolUse', transcript_path: '/x.jsonl' }), 'claude');
      assert.equal(detectPlatform({ hook_event_name: 'Stop' }), 'claude');
      assert.equal(detectPlatform({ hook_event_name: 'postToolUse' }), 'cursor');
      assert.equal(detectPlatform({ cursor_version: '1.7', hook_event_name: 'Stop' }), 'cursor');
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  });

  test("tool output is read from Claude's tool_response", () => {
    const io = extractToolIoTokens({ tool_name: 'Bash', tool_input: {}, tool_response: 'x'.repeat(400) });
    assert.ok(io.output_chars >= 400);
  });

  test('tool_io + tool_use for one call count once', () => {
    const { tokens, toolIoByTool } = normalizeSessionTokens([
      { event: 'tool_io', tool: 'Bash', estimated_tokens: 10 },
      { event: 'tool_use', tool: 'Bash', estimated_tokens: 10 },
    ]);
    assert.equal(toolIoByTool.Bash.invocations, 1);
    assert.equal(tokens.estimated_io, 10);
    // Cursor wires only token-meter: tool_io alone still counts.
    assert.equal(
      normalizeSessionTokens([{ event: 'tool_io', tool: 'Read', estimated_tokens: 5 }]).tokens.estimated_io,
      5,
    );
  });
});

describe('end to end — real hooks, isolated tmpdir', () => {
  function runHook(name, payload, { cwd, tmp }) {
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
    assert.equal(res.status, 0, `${name} exited ${res.status}: ${res.stderr}`);
    return res;
  }

  test('Skill call + topia subagent + slash command land in one session row and skills.json', () => {
    const root = scratch('e2e-');
    const project = path.join(root, 'proj');
    const tmp = path.join(root, 'tmp');
    mkdirSync(project, { recursive: true });
    mkdirSync(tmp, { recursive: true });
    const transcript = path.join(root, 'session.jsonl');
    writeFileSync(
      transcript,
      jsonl([slashRec('/topia:audit', '2026-10-28T10:00:00.000Z'), skillBody(), assistantRec(2, 300_000, 9_998)]),
    );
    const base = { cwd: project, session_id: 'sess-1', transcript_path: transcript };
    const ctx = { cwd: project, tmp };

    runHook(
      'metrics-collector',
      { ...base, hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'topia:journal' } },
      ctx,
    );
    runHook(
      'metrics-collector',
      { ...base, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'topia:guardian' } },
      ctx,
    );
    runHook(
      'metrics-collector',
      { ...base, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'general-purpose' } },
      ctx,
    );
    runHook('post-session-reflect', { ...base, hook_event_name: 'Stop' }, ctx);

    const metrics = path.join(project, '.topia', 'metrics');
    let rows = readJsonl(path.join(metrics, 'sessions.jsonl'));
    assert.equal(rows.length, 1);
    let row = rows[0];
    assert.equal(row.id, 'sess-1');
    assert.equal(row.platform, 'claude');
    assert.deepEqual([...row.skills_used].sort(), ['audit', 'guardian', 'journal']);
    assert.deepEqual(row.skill_via, { slash: 1, skill: 1, agent: 1 });
    assert.equal(row.tokens.context_peak, 310_000);
    assert.equal(row.tokens.context_window_size, 1_000_000);
    assert.equal(row.pressure_source, 'context');
    assert.equal(row.pressure_level, 'green');

    // Second turn of the same session: one more Skill call, more context.
    appendFileSync(transcript, jsonl([assistantRec(1, 420_000, 0)]));
    runHook(
      'metrics-collector',
      { ...base, hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'topia:journal' } },
      ctx,
    );
    runHook('post-session-reflect', { ...base, hook_event_name: 'Stop' }, ctx);

    rows = readJsonl(path.join(metrics, 'sessions.jsonl'));
    assert.equal(rows.length, 1, 'still one row for the session');
    row = rows[0];
    assert.deepEqual(row.skill_counts, { audit: 1, journal: 2, guardian: 1 });
    assert.equal(row.skill_invocations, 4);
    assert.equal(row.tokens.context_peak, 420_001);
    assert.equal(row.turns, 2);

    const skills = JSON.parse(readFileSync(path.join(metrics, 'skills.json'), 'utf8')).skills;
    assert.equal(skills.journal.total_invocations, 2);
    assert.equal(skills.audit.total_invocations, 1);
    assert.equal(skills.guardian.total_invocations, 1);
    assert.equal(skills['general-purpose'], undefined);

    const chains = readJsonl(path.join(metrics, 'chains.jsonl'));
    assert.equal(chains.length, 1);
    assert.deepEqual(chains[0].chain, ['audit', 'journal', 'guardian', 'journal']);
  });

  test("a sibling project does not see or flush this project's buffer", () => {
    const root = scratch('e2e-');
    const tmp = path.join(root, 'tmp');
    const a = path.join(root, 'parent', 'alpha');
    const b = path.join(root, 'parent', 'beta');
    for (const d of [tmp, a, b]) mkdirSync(d, { recursive: true });

    runHook(
      'metrics-collector',
      {
        cwd: a,
        session_id: 'sa',
        hook_event_name: 'PostToolUse',
        tool_name: 'Skill',
        tool_input: { skill: 'topia:plan' },
      },
      { cwd: a, tmp },
    );
    runHook('post-session-reflect', { cwd: b, session_id: 'sb', hook_event_name: 'Stop' }, { cwd: b, tmp });
    assert.equal(existsSync(path.join(b, '.topia', 'metrics', 'skills.json')), false, 'beta flushed nothing of alpha');

    runHook('post-session-reflect', { cwd: a, session_id: 'sa', hook_event_name: 'Stop' }, { cwd: a, tmp });
    const skills = JSON.parse(readFileSync(path.join(a, '.topia', 'metrics', 'skills.json'), 'utf8')).skills;
    assert.equal(skills.plan.total_invocations, 1);
  });
});
