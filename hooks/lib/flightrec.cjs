/**
 * Topia hook-dispatch flight recorder — the single source of truth for the
 * dispatch record schema. Written by the launcher (compiler/assets/
 * hook-dispatch-launcher.cjs) at runtime and asserted by the conformance
 * harness (compiler/__tests__/hook-conformance.test.js).
 *
 * node builtins ONLY — this module is `require`d from a copied launcher
 * location that has no node_modules, so a non-builtin import would crash the
 * hot path.
 *
 * RECORD shape (frozen at v:1 — bump `v` to add fields, then update
 * validateRecord + both consumers):
 *   { v: 1, ts: <ISO8601>, hook: string, target: string,
 *     exit: number|null, durationMs: number }
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const FILE_NAME = 'hook-flightrec.jsonl';
const DEFAULT_CAP = 200;

/**
 * Build a dispatch record. `nowMs` is injected (epoch ms) for testability —
 * the launcher passes Date.now(); tests pass a fixed value.
 */
function formatRecord({ hook, target, exit, durationMs, nowMs }) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) {
    throw new TypeError('formatRecord: nowMs must be a finite number');
  }
  return {
    v: SCHEMA_VERSION,
    ts: new Date(nowMs).toISOString(),
    hook: typeof hook === 'string' && hook ? hook : '(unknown)',
    target: typeof target === 'string' ? target : '',
    exit: exit === null || typeof exit === 'number' ? exit : null,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) ? durationMs : 0,
  };
}

/** Serialize a record to a single JSONL line (no embedded newlines). */
function serializeRecord(rec) {
  return JSON.stringify(rec);
}

/** Transient filesystem errors common on Windows (AV / search indexer locks). */
function isTransientFsError(err) {
  return (
    err != null &&
    (err.code === 'EPERM' ||
      err.code === 'EBUSY' ||
      err.code === 'EACCES' ||
      err.code === 'EEXIST')
  );
}

/** Synchronous backoff — no busy-spin. Falls through if SharedArrayBuffer is absent. */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    /* SAB unavailable — retry immediately */
  }
}

/**
 * Write `out` to `file` durably. Happy path is atomic (tmp + rename) so a crash
 * mid-write cannot corrupt the buffer. On Windows, renameSync over an existing
 * file transiently throws EPERM/EBUSY when AV or the search indexer briefly
 * holds the handle — retry with backoff, then fall back to a direct in-place
 * write (the buffer tolerates a torn final line; parseRecords skips it).
 */
function writeFileResilient(file, out) {
  const tmp = `${file}.tmp`;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      fs.writeFileSync(tmp, out);
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!isTransientFsError(err) || attempt === 7) {
        fs.writeFileSync(file, out); // last-resort direct write
        try {
          fs.rmSync(tmp, { force: true });
        } catch {
          /* ignore */
        }
        return;
      }
      sleepSync(8 * (attempt + 1));
    }
  }
}

/**
 * Append a record to <dir>/hook-flightrec.jsonl, keeping at most `cap` lines.
 * Best-effort but may throw on a non-transient IO error — the launcher wraps
 * this in try/catch.
 */
function appendRecord(dir, rec, { cap = DEFAULT_CAP } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, FILE_NAME);
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch {
    existing = '';
  }
  const lines = existing.split('\n').filter((l) => l.trim() !== '');
  lines.push(serializeRecord(rec));
  const kept = cap > 0 ? lines.slice(-cap) : [];
  const out = kept.length ? `${kept.join('\n')}\n` : '';
  writeFileResilient(file, out);
}

/** Total validator — never throws. Returns { valid, errors }. */
function validateRecord(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['record is not an object'] };
  }
  if (obj.v !== SCHEMA_VERSION) errors.push(`v must be ${SCHEMA_VERSION}`);
  if (typeof obj.ts !== 'string' || Number.isNaN(Date.parse(obj.ts))) {
    errors.push('ts must be an ISO8601 string');
  }
  if (typeof obj.hook !== 'string') errors.push('hook must be a string');
  if (typeof obj.target !== 'string') errors.push('target must be a string');
  if (!(obj.exit === null || typeof obj.exit === 'number')) {
    errors.push('exit must be a number or null');
  }
  if (typeof obj.durationMs !== 'number') errors.push('durationMs must be a number');
  return { valid: errors.length === 0, errors };
}

/** Parse a JSONL buffer into records — total, skips blank/unparseable lines. */
function parseRecords(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip unparseable line */
    }
  }
  return out;
}

module.exports = {
  SCHEMA_VERSION,
  FILE_NAME,
  DEFAULT_CAP,
  formatRecord,
  serializeRecord,
  appendRecord,
  validateRecord,
  parseRecords,
};
