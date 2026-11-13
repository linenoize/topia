#!/usr/bin/env node

// usage-report.js — which Topia skills and MCP servers actually get used.
//
//   node scripts/usage-report.js --project <dir>            one project's .topia/metrics
//   node scripts/usage-report.js --transcripts [dir]        Claude Code transcripts (default ~/.claude/projects)
//   options: --since YYYY-MM-DD   --json
//
// Read-only. Prints counts, skill ids and MCP server names only: never prompt
// text, file contents or paths. See docs/MAINTENANCE.md for what the numbers
// mean and how to act on them.

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Topia skill names, from the generated catalog the hooks ship with. */
export function topiaSkillNames() {
  try {
    return require(path.join(ROOT, 'hooks', 'lib', 'skill-catalog.cjs')).CATALOG.map((s) => s.name);
  } catch {
    return [];
  }
}

const VIAS = ['skill', 'agent', 'slash'];

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  const rows = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* skip a torn line */
    }
  }
  return rows;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function afterSince(ts, since) {
  if (!since) return true;
  return typeof ts === 'string' && ts.slice(0, 10) >= since;
}

// ── project mode ─────────────────────────────────────────────────────────

/**
 * Per-skill hint and use counts from <dir>/.topia/metrics.
 * A hint is "followed" when the same session used that skill at or after the
 * hint (chains.jsonl steps carry `at` and `via`; older rows without them count
 * as uses with unknown time and via).
 * @param {string} dir
 * @param {{ since?: string|null, catalog?: string[] }} [opts]
 */
export function projectReport(dir, { since = null, catalog = topiaSkillNames() } = {}) {
  const metrics = path.join(dir, '.topia', 'metrics');
  const routing = readJsonl(path.join(metrics, 'routing.jsonl')).filter((r) => afterSince(r.ts, since));
  const chains = readJsonl(path.join(metrics, 'chains.jsonl'));
  const sessions = readJsonl(path.join(metrics, 'sessions.jsonl')).filter((r) =>
    afterSince(r.started || r.date, since),
  );
  const skillsJson = readJson(path.join(metrics, 'skills.json'))?.skills || {};

  const rows = new Map();
  const row = (skill) => {
    if (!rows.has(skill)) {
      rows.set(skill, {
        skill,
        hinted: 0,
        hinted_top: 0,
        used: 0,
        used_by: { skill: 0, agent: 0, slash: 0, unknown: 0 },
        followed: 0,
        followed_pct: null,
        median_seconds_to_use: null,
        lifetime_invocations: 0,
        _lags: [],
      });
    }
    return rows.get(skill);
  };

  // Uses, per session, with their times.
  const usesBySession = new Map();
  for (const c of chains) {
    const chain = Array.isArray(c.chain) ? c.chain : [];
    chain.forEach((skill, i) => {
      if (typeof skill !== 'string') return;
      const at = Array.isArray(c.at) ? c.at[i] : null;
      if (since && at && !afterSince(at, since)) return;
      if (since && !at) return;
      const via = Array.isArray(c.via) && VIAS.includes(c.via[i]) ? c.via[i] : 'unknown';
      const r = row(skill);
      r.used += 1;
      r.used_by[via] += 1;
      if (!usesBySession.has(c.session)) usesBySession.set(c.session, []);
      usesBySession.get(c.session).push({ skill, at: at ? Date.parse(at) : null });
    });
  }

  for (const [skill, s] of Object.entries(skillsJson)) row(skill).lifetime_invocations = s?.total_invocations || 0;

  let bareRedirects = 0;
  const hookMs = [];
  for (const h of routing) {
    const skills = Array.isArray(h.skills) ? h.skills : [];
    if (h.bare) bareRedirects += 1;
    if (Number.isFinite(h.ms)) hookMs.push(h.ms);
    const hintAt = Date.parse(h.ts);
    const uses = usesBySession.get(h.session) || [];
    skills.forEach((skill, rank) => {
      const r = row(skill);
      r.hinted += 1;
      if (rank === 0) r.hinted_top += 1;
      const later = uses.filter((u) => u.skill === skill && (u.at === null || !(u.at < hintAt)));
      if (h.session && later.length > 0) {
        r.followed += 1;
        const timed = later.filter((u) => u.at !== null).map((u) => (u.at - hintAt) / 1000);
        if (timed.length > 0) r._lags.push(Math.min(...timed));
      }
    });
  }

  const skills = [...rows.values()]
    .map(({ _lags, ...r }) => ({
      ...r,
      followed_pct: pct(r.followed, r.hinted),
      median_seconds_to_use: _lags.length ? Math.round(median(_lags)) : null,
    }))
    .sort((a, b) => b.used + b.hinted - (a.used + a.hinted) || a.skill.localeCompare(b.skill));

  const seen = (key) => new Set(skills.filter((s) => s[key] > 0).map((s) => s.skill));
  const used = new Set([...seen('used'), ...seen('lifetime_invocations')]);
  const hinted = seen('hinted');

  return {
    project: path.basename(path.resolve(dir)),
    since,
    files: {
      routing: routing.length,
      chains: chains.length,
      sessions: sessions.length,
      skills_json: Object.keys(skillsJson).length,
    },
    hints: routing.length,
    bare_redirects: bareRedirects,
    hook_ms_median: median(hookMs),
    skills,
    never_used: catalog.filter((s) => !used.has(s)),
    never_hinted: catalog.filter((s) => !hinted.has(s)),
    never_used_or_hinted: catalog.filter((s) => !used.has(s) && !hinted.has(s)),
  };
}

// ── transcript mode ──────────────────────────────────────────────────────

function listTranscripts(dir, since) {
  const out = [];
  const sinceMs = since ? Date.parse(since) : null;
  const walk = (d, depth) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (depth < 4) walk(full, depth + 1);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = statSync(full);
          if (sinceMs && st.mtimeMs < sinceMs) continue;
          out.push({ file: full, bytes: st.size });
        } catch {
          /* vanished */
        }
      }
    }
  };
  walk(dir, 0);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Session key and project folder for a transcript file under <root>/<project>/... */
function sessionOf(root, file) {
  const parts = path.relative(root, file).split(path.sep);
  const project = parts.length > 1 ? parts[0] : '(root)';
  const sub = parts.indexOf('subagents');
  const session = sub > 0 ? parts[sub - 1] : path.basename(file, '.jsonl');
  return { project, session: `${project}/${session}` };
}

const MCP_NAME = /mcp__([A-Za-z0-9_-]+?)__[A-Za-z0-9_-]+/g;
const COMMAND = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/;
const COMMAND_ARGS = /<command-args>\s*([^<]*)<\/command-args>/;
const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const SKILL_BODY = 'Base directory for this skill';

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

function mcpServers(text, into) {
  for (const m of String(text).matchAll(MCP_NAME)) into.add(m[1]);
}

/** `topia:x-agent` → x, `topia:x` → x; null when not a Topia agent. */
export function agentSkill(subagentType) {
  if (typeof subagentType !== 'string' || !/^topia:/i.test(subagentType.trim())) return null;
  return subagentType
    .trim()
    .replace(/^topia:/i, '')
    .replace(/-agent$/, '');
}

/**
 * Scan Claude Code transcripts line by line. Counts only.
 * @param {string} dir
 * @param {{ since?: string|null, catalog?: string[] }} [opts]
 */
export async function transcriptReport(dir, { since = null, catalog = topiaSkillNames() } = {}) {
  const known = new Set(catalog);
  const files = listTranscripts(dir, since);
  const seenToolIds = new Set();
  const seenUserIds = new Set();
  const skills = new Map();
  const otherSkills = new Map();
  const servers = new Map();
  const sessions = new Set();
  const projects = new Set();
  let bytes = 0;
  let lines = 0;
  let badLines = 0;

  const skillRow = (name) => {
    if (!skills.has(name))
      skills.set(name, { skill: name, skill_tool: 0, slash: 0, agent: 0, total: 0, sessions: new Set() });
    return skills.get(name);
  };
  const serverRow = (name) => {
    if (!servers.has(name))
      servers.set(name, { server: name, calls: 0, sessions_used: new Set(), sessions_listed: new Set() });
    return servers.get(name);
  };
  const countSkill = (name, via, session) => {
    const r = skillRow(name);
    r[via] += 1;
    r.total += 1;
    r.sessions.add(session);
  };
  const topiaSkillName = (raw) => {
    const name = String(raw || '')
      .trim()
      .replace(/^\//, '');
    if (/^topia:/i.test(name)) return name.replace(/^topia:/i, '');
    return known.has(name) ? name : null;
  };

  for (const { file, bytes: size } of files) {
    bytes += size;
    const { project, session } = sessionOf(dir, file);
    projects.add(project);
    sessions.add(session);
    const rl = createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const line of rl) {
      lines += 1;
      const hasMcp = line.includes('mcp__');
      const hasTool = line.includes('"tool_use"');
      const hasCommand = line.includes('<command-name>');
      if (!hasMcp && !hasTool && !hasCommand) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        badLines += 1;
        continue;
      }
      if (since && rec.timestamp && !afterSince(rec.timestamp, since)) continue;

      if (rec.type === 'assistant' && hasTool && Array.isArray(rec.message?.content)) {
        for (const block of rec.message.content) {
          if (!block || block.type !== 'tool_use' || typeof block.name !== 'string') continue;
          if (block.id) {
            if (seenToolIds.has(block.id)) continue;
            seenToolIds.add(block.id);
          }
          const input = block.input && typeof block.input === 'object' ? block.input : {};
          if (block.name.startsWith('mcp__')) {
            const server = block.name.slice(5).split('__')[0];
            const r = serverRow(server);
            r.calls += 1;
            r.sessions_used.add(session);
          } else if (block.name === 'Skill') {
            const raw = input.skill || input.name || input.command || '';
            const name = topiaSkillName(raw);
            if (name) countSkill(name, 'skill_tool', session);
            else if (raw) otherSkills.set(String(raw), (otherSkills.get(String(raw)) || 0) + 1);
          } else if (block.name === 'Agent' || block.name === 'Task') {
            const name = agentSkill(input.subagent_type);
            if (name) countSkill(name, 'agent', session);
          }
        }
        continue;
      }

      if (rec.type === 'attachment' && hasMcp) {
        const listed = new Set();
        mcpServers(JSON.stringify(rec.attachment ?? {}), listed);
        for (const s of listed) serverRow(s).sessions_listed.add(session);
        continue;
      }

      if (rec.type === 'user') {
        const text = textOf(rec.message?.content);
        if (hasMcp) {
          const listed = new Set();
          for (const m of text.matchAll(REMINDER)) mcpServers(m[0], listed);
          for (const s of listed) serverRow(s).sessions_listed.add(session);
        }
        if (hasCommand && rec.isSidechain !== true && !text.trimStart().startsWith(SKILL_BODY)) {
          if (rec.uuid) {
            if (seenUserIds.has(rec.uuid)) continue;
            seenUserIds.add(rec.uuid);
          }
          const m = text.match(COMMAND);
          if (!m) continue;
          let name = m[1];
          // `/topia build` names the skill in its arguments.
          if (/^topia(?::topia)?$/i.test(name)) {
            const arg = (text.match(COMMAND_ARGS)?.[1] || '').trim().split(/\s+/)[0];
            name = known.has(arg) ? `topia:${arg}` : '';
          }
          if (/^topia:/i.test(name)) countSkill(name.replace(/^topia:/i, ''), 'slash', session);
        }
      }
    }
  }

  const skillList = [...skills.values()]
    .map(({ sessions: s, ...r }) => ({ ...r, sessions: s.size }))
    .sort((a, b) => b.total - a.total || a.skill.localeCompare(b.skill));
  const serverList = [...servers.values()]
    .map((r) => ({
      server: r.server,
      calls: r.calls,
      sessions_used: r.sessions_used.size,
      sessions_listed: r.sessions_listed.size,
    }))
    .sort((a, b) => b.calls - a.calls || b.sessions_listed - a.sessions_listed || a.server.localeCompare(b.server));
  const usedSkills = new Set(skillList.map((s) => s.skill));

  return {
    since,
    scanned: {
      files: files.length,
      sessions: sessions.size,
      projects: projects.size,
      bytes,
      lines,
      bad_lines: badLines,
    },
    totals: {
      skill_tool: skillList.reduce((n, s) => n + s.skill_tool, 0),
      slash: skillList.reduce((n, s) => n + s.slash, 0),
      agent: skillList.reduce((n, s) => n + s.agent, 0),
      other_plugin_skill_calls: [...otherSkills.values()].reduce((n, v) => n + v, 0),
      mcp_calls: serverList.reduce((n, s) => n + s.calls, 0),
    },
    skills: skillList,
    never_used: catalog.filter((s) => !usedSkills.has(s)),
    mcp_servers: serverList,
    mcp_listed_never_used: serverList.filter((s) => s.calls === 0 && s.sessions_listed > 0).map((s) => s.server),
  };
}

// ── output ───────────────────────────────────────────────────────────────

function table(headers, rows) {
  const cells = rows.map((r) => r.map((c) => (c === null || c === undefined ? '-' : String(c))));
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  return [fmt(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(fmt)].join('\n');
}

function wrapList(label, names) {
  return `${label} (${names.length}): ${names.length ? names.join(', ') : 'none'}`;
}

export function formatProject(r) {
  const out = [
    `Project ${r.project}${r.since ? ` since ${r.since}` : ''}`,
    `Hints logged: ${r.hints} (bare-slash redirects: ${r.bare_redirects}); median hook run time: ${
      r.hook_ms_median === null ? '-' : `${r.hook_ms_median} ms`
    }`,
    `Rows read: routing ${r.files.routing}, chains ${r.files.chains}, sessions ${r.files.sessions}, skills.json ${r.files.skills_json}`,
    '',
  ];
  if (r.skills.length > 0) {
    out.push(
      table(
        ['skill', 'hinted', 'top', 'used', 'skill', 'agent', 'slash', '?', 'followed', '%', 'med s', 'lifetime'],
        r.skills.map((s) => [
          s.skill,
          s.hinted,
          s.hinted_top,
          s.used,
          s.used_by.skill,
          s.used_by.agent,
          s.used_by.slash,
          s.used_by.unknown,
          s.followed,
          s.followed_pct,
          s.median_seconds_to_use,
          s.lifetime_invocations,
        ]),
      ),
      '',
    );
  }
  out.push(
    wrapList('Never used', r.never_used),
    wrapList('Never hinted', r.never_hinted),
    wrapList('Neither', r.never_used_or_hinted),
  );
  return out.join('\n');
}

export function formatTranscripts(r) {
  const mb = (r.scanned.bytes / 1024 / 1024).toFixed(1);
  const out = [
    `Transcripts${r.since ? ` since ${r.since}` : ''}: ${r.scanned.files} files, ${r.scanned.sessions} sessions, ${r.scanned.projects} projects, ${mb} MB, ${r.scanned.lines} lines`,
    `Topia skill uses: Skill tool ${r.totals.skill_tool}, slash ${r.totals.slash}, agent ${r.totals.agent}; other plugins' Skill calls ${r.totals.other_plugin_skill_calls}`,
    '',
  ];
  if (r.skills.length > 0) {
    out.push(
      table(
        ['skill', 'total', 'Skill tool', 'slash', 'agent', 'sessions'],
        r.skills.map((s) => [s.skill, s.total, s.skill_tool, s.slash, s.agent, s.sessions]),
      ),
      '',
    );
  }
  out.push(wrapList('Topia skills never used', r.never_used), '');
  if (r.mcp_servers.length > 0) {
    out.push(
      `MCP tool calls: ${r.totals.mcp_calls}`,
      table(
        ['mcp server', 'calls', 'sessions used', 'sessions listed'],
        r.mcp_servers.map((s) => [s.server, s.calls, s.sessions_used, s.sessions_listed]),
      ),
      '',
    );
  }
  out.push(wrapList('MCP servers listed but never called', r.mcp_listed_never_used));
  return out.join('\n');
}

// ── cli ──────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const opts = { project: null, transcripts: null, since: null, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : null);
    if (a === '--project') opts.project = value() || process.cwd();
    else if (a === '--transcripts') opts.transcripts = value() || path.join(os.homedir(), '.claude', 'projects');
    else if (a === '--since') opts.since = value();
    else if (a === '--json') opts.json = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (opts.since && !/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) throw new Error('--since wants YYYY-MM-DD');
  if (!opts.project && !opts.transcripts) opts.help = true;
  return opts;
}

const USAGE = `usage: node scripts/usage-report.js [--project <dir>] [--transcripts [dir]] [--since YYYY-MM-DD] [--json]
  --project <dir>      hints and uses from <dir>/.topia/metrics
  --transcripts [dir]  skill and MCP use across Claude Code transcripts (default ~/.claude/projects)
See docs/MAINTENANCE.md.`;

export async function main(argv = process.argv.slice(2), log = console.log) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    log(`${err.message}\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const result = {};
  if (opts.project) result.project = projectReport(opts.project, { since: opts.since });
  if (opts.transcripts) result.transcripts = await transcriptReport(opts.transcripts, { since: opts.since });
  if (opts.json) {
    log(JSON.stringify(result, null, 2));
  } else {
    const parts = [];
    if (result.project) parts.push(formatProject(result.project));
    if (result.transcripts) parts.push(formatTranscripts(result.transcripts));
    log(parts.join('\n\n'));
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
