/**
 * memory-sources.cjs — Topia's file-based memory, shared by session-start and
 * commit-memory.
 *
 * Default memory is plain files under .topia/ (read with Read/Grep/Glob or
 * topia:recall). MCP memory servers are optional and only named when their
 * registration is found in an MCP config on disk. Everything here is
 * best-effort: callers wrap it in try/catch and stay silent on failure.
 */

const fs = require('node:fs');
const path = require('node:path');

// Session-start budget. Entries are `## ` sections (session-bridge format).
const TAIL_ENTRIES = 5;
const FILE_BYTES = 1500;
const TOTAL_BYTES = 6000;
const LEARNINGS_SHOWN = 5;
const LEARNING_LINE_CHARS = 160;

// learnings.jsonl bounds (commit rows are the only ones the hook adds).
const MAX_COMMIT_ROWS = 300;
const MAX_LEARNINGS_BYTES = 512 * 1024;
const MAX_FILES_PER_COMMIT = 50;
const MAX_SUBJECT_CHARS = 200;

/** Read a file as UTF-8, or null when missing, empty, or unreadable. */
function readText(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    const text = fs.readFileSync(filePath, 'utf-8').trim();
    return text || null;
  } catch {
    return null;
  }
}

/** Keep the last `maxBytes` of text, cut at a line start. */
function tailBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return { text, cut: false };
  let out = buf.subarray(buf.length - maxBytes).toString('utf-8');
  const nl = out.indexOf('\n');
  if (nl !== -1 && nl < out.length - 1) out = out.slice(nl + 1);
  return { text: out.replace(/^�+/, ''), cut: true };
}

/** Keep the first `maxBytes` of text, cut at a line end. */
function headBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return { text, cut: false };
  let out = buf.subarray(0, maxBytes).toString('utf-8');
  const nl = out.lastIndexOf('\n');
  if (nl > 0) out = out.slice(0, nl);
  return { text: out.replace(/�+$/, ''), cut: true };
}

/**
 * Newest `n` `## ` entries of a markdown log, then a byte cap.
 * @returns {{ text: string, cut: boolean, total: number, shown: number }}
 */
function tailEntries(text, n = TAIL_ENTRIES, maxBytes = FILE_BYTES) {
  const starts = [];
  const re = /^## /gm;
  let m = re.exec(text);
  while (m) {
    starts.push(m.index);
    m = re.exec(text);
  }
  let body = text;
  let cut = false;
  if (starts.length > n) {
    body = text.slice(starts[starts.length - n]);
    cut = true;
  }
  const capped = tailBytes(body, maxBytes);
  return {
    text: capped.text.trim(),
    cut: cut || capped.cut,
    total: starts.length,
    shown: Math.min(starts.length, n),
  };
}

/** One short line per learnings.jsonl row; skips rows that do not parse. */
function formatLearning(row) {
  const day = typeof row.ts === 'string' ? row.ts.slice(0, 10) : '';
  let line;
  if (row.type === 'commit') {
    const sha = typeof row.sha === 'string' ? row.sha.slice(0, 7) : '';
    const files = Array.isArray(row.files) ? ` (${row.files.length} file${row.files.length === 1 ? '' : 's'})` : '';
    line = `commit ${sha}: ${row.subject || row.insight || ''}${files}`;
  } else {
    const head = [row.type, row.key].filter(Boolean).join(' ');
    line = `${head ? `${head}: ` : ''}${row.insight || row.text || ''}`;
  }
  line = `${day} ${line}`.trim().replace(/\s+/g, ' ');
  return line.length > LEARNING_LINE_CHARS ? `${line.slice(0, LEARNING_LINE_CHARS - 1)}…` : line;
}

/** Last `n` parseable rows of learnings.jsonl as short lines. */
function learningsTail(filePath, n = LEARNINGS_SHOWN) {
  const text = readText(filePath);
  if (!text) return { lines: [], total: 0 };
  const raw = text.split('\n').filter((l) => l.trim());
  const lines = [];
  for (let i = raw.length - 1; i >= 0 && lines.length < n; i--) {
    try {
      const row = JSON.parse(raw[i]);
      if (row && typeof row === 'object') lines.unshift(formatLearning(row));
    } catch {
      /* skip bad row */
    }
  }
  return { lines, total: raw.length };
}

/** Raw text of the MCP config files Topia knows how to find. */
function mcpConfigText(root, home) {
  const files = [
    path.join(root, '.mcp.json'),
    path.join(root, '.cursor', 'mcp.json'),
    path.join(home, '.cursor', 'mcp.json'),
    path.join(home, '.claude', '.mcp.json'),
  ];
  return files
    .map((f) => readText(f) || '')
    .filter(Boolean)
    .join('\n');
}

/** Optional MCP memory backends whose registration is on disk. */
function detectMcpBackends(root, home) {
  const raw = mcpConfigText(root, home);
  const found = [];
  if (/"neural-?memory"|nmem/i.test(raw)) found.push('neural-memory');
  if (/agora[-_]?code|"agora-memory"/i.test(raw)) found.push('agora-memory');
  return found;
}

const TOPIA_MEMORY_FILES = [
  'progress.md',
  'decisions.md',
  'conventions.md',
  'checkpoint.md',
  'session-log.md',
  'cumulative-notes.md',
  'instincts.md',
  'learnings.jsonl',
];

/** Memory files present under .topia/ (non-empty). */
function topiaMemoryFiles(topiaDir) {
  return TOPIA_MEMORY_FILES.filter((f) => readText(path.join(topiaDir, f)) !== null);
}

function hasRemember(root) {
  try {
    const dir = path.join(root, '.remember');
    return fs.statSync(dir).isDirectory() && fs.readdirSync(dir).some((f) => f.endsWith('.md'));
  } catch {
    return false;
  }
}

/**
 * Lines for the session-start memory block. Empty when no source exists.
 * @param {{ root: string, home: string, topiaDir: string }} opts
 * @returns {string[]}
 */
function memoryBlock({ root, home, topiaDir }) {
  const sources = [];
  const files = topiaMemoryFiles(topiaDir);
  if (files.length > 0) sources.push(`.topia/ (${files.join(', ')})`);
  if (hasRemember(root)) sources.push('.remember/ (session notes)');
  for (const name of detectMcpBackends(root, home)) sources.push(`${name} MCP (registered)`);
  if (sources.length === 0) return [];
  return [
    '[topia: memory]',
    '  Recall: topia:recall, or Grep/Glob the files below.',
    '  Record: topia:journal for decisions; topia:session-bridge for progress.',
    `  Sources: ${sources.join('; ')}`,
  ];
}

// ─── commit capture ───

/** Append one commit row to learnings.jsonl, dedupe by sha, keep bounded. */
function appendCommitRow(filePath, row) {
  let existing = '';
  try {
    existing = fs.readFileSync(filePath, 'utf-8');
  } catch {
    existing = '';
  }
  if (row.sha && existing.includes(`"sha":"${row.sha}"`)) return false;

  const line = JSON.stringify(row);
  const lines = existing.split('\n').filter((l) => l.trim());
  lines.push(line);

  let commitCount = 0;
  for (const l of lines) if (l.includes('"type":"commit"')) commitCount++;
  const size = Buffer.byteLength(existing, 'utf-8') + Buffer.byteLength(line, 'utf-8') + 1;

  if (commitCount <= MAX_COMMIT_ROWS && size <= MAX_LEARNINGS_BYTES) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(filePath, `${prefix}${line}\n`);
    return true;
  }

  // Over a bound: drop the oldest commit rows first, then the oldest rows.
  let drop = commitCount - MAX_COMMIT_ROWS;
  let kept = lines.filter((l) => {
    if (drop > 0 && l.includes('"type":"commit"')) {
      drop--;
      return false;
    }
    return true;
  });
  let bytes = kept.reduce((n, l) => n + Buffer.byteLength(l, 'utf-8') + 1, 0);
  while (bytes > MAX_LEARNINGS_BYTES && kept.length > 1) {
    bytes -= Buffer.byteLength(kept[0], 'utf-8') + 1;
    kept = kept.slice(1);
  }
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${kept.join('\n')}\n`);
  fs.renameSync(tmp, filePath);
  return true;
}

module.exports = {
  TAIL_ENTRIES,
  FILE_BYTES,
  TOTAL_BYTES,
  MAX_COMMIT_ROWS,
  MAX_LEARNINGS_BYTES,
  MAX_FILES_PER_COMMIT,
  MAX_SUBJECT_CHARS,
  readText,
  headBytes,
  tailBytes,
  tailEntries,
  learningsTail,
  detectMcpBackends,
  topiaMemoryFiles,
  memoryBlock,
  appendCommitRow,
};
