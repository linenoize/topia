import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import flightrec from '../../hooks/lib/flightrec.cjs';

const { formatRecord, serializeRecord, appendRecord, validateRecord, parseRecords, FILE_NAME } = flightrec;

describe('flightrec.formatRecord', () => {
  test('produces a v:1 record with an ISO ts from injected nowMs', () => {
    const rec = formatRecord({
      hook: 'readiness',
      target: '/p/compiler/bin/topia.js',
      exit: 0,
      durationMs: 42,
      nowMs: 0,
    });
    assert.equal(rec.v, 1);
    assert.equal(rec.ts, '1970-01-01T00:00:00.000Z');
    assert.equal(rec.hook, 'readiness');
    assert.equal(rec.exit, 0);
    assert.equal(rec.durationMs, 42);
  });

  test('throws when nowMs is not finite', () => {
    assert.throws(() => formatRecord({ hook: 'x', target: 'y', exit: 0, durationMs: 1 }), TypeError);
    assert.throws(() => formatRecord({ hook: 'x', target: 'y', exit: 0, durationMs: 1, nowMs: NaN }), TypeError);
  });

  test('defaults a blank hook to (unknown) and tolerates null exit', () => {
    const rec = formatRecord({ hook: '', target: 't', exit: null, durationMs: 0, nowMs: 1000 });
    assert.equal(rec.hook, '(unknown)');
    assert.equal(rec.exit, null);
  });
});

describe('flightrec.serialize/parse', () => {
  test('round-trips a record containing quotes in target', () => {
    const rec = formatRecord({
      hook: 'guardian',
      target: 'C:\\Users\\a "b"\\topia.js',
      exit: 1,
      durationMs: 5,
      nowMs: 1000,
    });
    const line = serializeRecord(rec);
    assert.equal(line.includes('\n'), false);
    const [back] = parseRecords(`${line}\n`);
    assert.deepEqual(back, rec);
  });

  test('parseRecords skips blank and unparseable lines without throwing', () => {
    const recs = parseRecords('{"v":1}\n\n  \nnot json\n{"v":1,"hook":"a"}\n');
    assert.equal(recs.length, 2);
  });

  test('parseRecords is total on non-string input', () => {
    assert.deepEqual(parseRecords(undefined), []);
    assert.deepEqual(parseRecords(''), []);
  });
});

describe('flightrec.appendRecord', () => {
  test('creates a missing dir and writes one line', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'flightrec-'));
    try {
      const dir = path.join(base, 'nested', '.topia');
      appendRecord(dir, formatRecord({ hook: 'a', target: 't', exit: 0, durationMs: 1, nowMs: 1 }));
      const text = await readFile(path.join(dir, FILE_NAME), 'utf8');
      assert.equal(parseRecords(text).length, 1);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  test('trims to cap, keeping the newest records', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flightrec-cap-'));
    try {
      for (let i = 0; i < 250; i++) {
        appendRecord(dir, formatRecord({ hook: `h${i}`, target: 't', exit: 0, durationMs: 0, nowMs: 1 }), {
          cap: 200,
        });
      }
      const recs = parseRecords(await readFile(path.join(dir, FILE_NAME), 'utf8'));
      assert.equal(recs.length, 200);
      assert.equal(recs[0].hook, 'h50'); // oldest 50 dropped
      assert.equal(recs[199].hook, 'h249'); // newest kept
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('cap 0 keeps nothing and leaves no .tmp', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'flightrec-zero-'));
    try {
      appendRecord(dir, formatRecord({ hook: 'a', target: 't', exit: 0, durationMs: 1, nowMs: 1 }), {
        cap: 0,
      });
      const text = await readFile(path.join(dir, FILE_NAME), 'utf8');
      assert.equal(text, '');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('flightrec.validateRecord', () => {
  test('accepts a well-formed record', () => {
    const rec = formatRecord({ hook: 'a', target: 't', exit: 0, durationMs: 1, nowMs: 1 });
    assert.deepEqual(validateRecord(rec), { valid: true, errors: [] });
  });

  test('flags each malformed field and never throws', () => {
    assert.equal(validateRecord(null).valid, false);
    const bad = validateRecord({ v: 2, ts: 'nope', hook: 1, target: null, exit: 'x', durationMs: 'y' });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.length >= 5);
  });
});
