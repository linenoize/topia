/**
 * Skill hygiene — guardrails from the 2026-11 skill review.
 *
 * Claude picks a skill from its description alone, and a crowded or ambiguous
 * list means it picks none. These checks keep the fixes from that review in
 * place: one name per skill, agent and command; "Use when" descriptions; no
 * retired skill names or tools; internal skills hidden from Claude's list.
 * docs/MAINTENANCE.md explains how to re-run the usage assessment.
 */

import assert from 'node:assert';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function frontmatter(file) {
  const text = readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const fields = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
      if (kv) fields[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
    }
  }
  return { fields, body: match ? text.slice(match[0].length) : text, text };
}

const skills = readdirSync(path.join(ROOT, 'skills'))
  .filter((d) => existsSync(path.join(ROOT, 'skills', d, 'SKILL.md')))
  .map((dir) => ({
    dir,
    file: path.join(ROOT, 'skills', dir, 'SKILL.md'),
    ...frontmatter(path.join(ROOT, 'skills', dir, 'SKILL.md')),
  }));
const agents = readdirSync(path.join(ROOT, 'agents'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ file: path.join(ROOT, 'agents', f), ...frontmatter(path.join(ROOT, 'agents', f)) }));
const commands = readdirSync(path.join(ROOT, 'commands'))
  .filter((f) => f.endsWith('.md'))
  .map((f) => ({ file: path.join(ROOT, 'commands', f), ...frontmatter(path.join(ROOT, 'commands', f)) }));

const hidden = (s) => s.fields['disable-model-invocation'] === 'true';
const skillName = (s) => s.fields.name || s.dir;
const commandName = (c) => c.fields.name || path.basename(c.file, '.md');

/** Every text file under a folder, recursively. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|js|cjs|mjs|ts|json)$/.test(entry)) out.push(full);
  }
  return out;
}
const shipped = [
  ...walk(path.join(ROOT, 'skills')),
  ...walk(path.join(ROOT, 'agents')),
  ...walk(path.join(ROOT, 'commands')),
];
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

describe('skill hygiene: one name each', () => {
  test('no skill, agent or command shares a name', () => {
    const seen = new Map();
    const clashes = [];
    for (const [kind, name, file] of [
      ...skills.map((s) => ['skill', skillName(s), s.file]),
      ...agents.map((a) => ['agent', a.fields.name, a.file]),
      ...commands.map((c) => ['command', commandName(c), c.file]),
    ]) {
      if (seen.has(name)) clashes.push(`${name}: ${seen.get(name)} and ${kind} ${rel(file)}`);
      else seen.set(name, `${kind} ${rel(file)}`);
    }
    assert.deepStrictEqual(clashes, []);
  });

  test('a skill folder and its name agree', () => {
    for (const s of skills) assert.strictEqual(skillName(s), s.dir, rel(s.file));
  });
});

describe('skill hygiene: descriptions Claude can choose from', () => {
  test('every skill Claude can see says when to use it', () => {
    const missing = skills
      .filter((s) => !hidden(s) && !/\bUse when\b/i.test(s.fields.description || ''))
      .map((s) => s.dir);
    assert.deepStrictEqual(missing, [], 'add a "Use when …" line to these descriptions');
  });

  test('no shouting boilerplate in skill or agent descriptions', () => {
    const loud = /\b(?:ALWAYS|MUST|EVERY|NEVER|ANY)\b|70%/;
    const bad = [...skills, ...agents].filter((x) => loud.test(x.fields.description || '')).map((x) => rel(x.file));
    assert.deepStrictEqual(bad, []);
  });
});

describe('skill hygiene: retired names and tools', () => {
  // sentinel → guardian, scout → recon, preflight → verification (2026-11).
  // Kept on purpose: the `.topia/sentinel-baseline.md` file users already have,
  // and the chrome-ext pack's own `cws-preflight` step.
  const RETIRED = /\bsentinel\b(?!-baseline)|(?<!trend-)\bscout\b|(?<!cws-)\bpreflight\b|\bTodoWrite\b/i;

  test('no retired skill names or the old TodoWrite tool in shipped skills, agents and commands', () => {
    const hits = [];
    for (const file of shipped) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (RETIRED.test(line)) hits.push(`${rel(file)}:${i + 1}`);
        });
    }
    assert.deepStrictEqual(hits, []);
  });

  test('skills find MCP tools by name, not a hardcoded plugin prefix', () => {
    // A plugin MCP's tool names depend on how the user installed it, so a
    // fixed `mcp__plugin_<x>_<y>__` prefix silently misses other installs.
    const hits = [];
    for (const file of walk(path.join(ROOT, 'skills'))) {
      readFileSync(file, 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/mcp__plugin_(?!topia)/.test(line)) hits.push(`${rel(file)}:${i + 1}`);
        });
    }
    assert.deepStrictEqual(hits, []);
  });
});

describe('skill hygiene: hidden skills and pointer stubs', () => {
  test('a hidden skill that only points elsewhere names a skill that exists', () => {
    const names = new Set(skills.map(skillName));
    for (const s of skills.filter(hidden)) {
      const pointer = s.body.match(/now part of `?(?:topia:)?([a-z-]+)`?/i);
      if (pointer) assert.ok(names.has(pointer[1]), `${s.dir} points at missing skill ${pointer[1]}`);
    }
  });

  test('no skill tells Claude to invoke a skill hidden from it', () => {
    const hiddenNames = skills.filter(hidden).map(skillName);
    const hits = [];
    for (const s of skills) {
      for (const name of hiddenNames) {
        const call = new RegExp(`(?:invoke|call|run|route to|Skill tool with)[^\\n]{0,40}\`?topia:${name}\\b`, 'i');
        if (s.dir !== name && call.test(s.body)) hits.push(`${s.dir} → ${name}`);
      }
    }
    assert.deepStrictEqual(hits, [], 'hidden skills are read as files, not invoked');
  });
});
