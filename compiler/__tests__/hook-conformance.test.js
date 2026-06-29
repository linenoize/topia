/**
 * Hook conformance harness — spawns every native hook with fixture payloads
 * across 4 platform-contract variants and asserts the cross-platform contract:
 *
 *   - exit code 0 (hooks fail open; the dispatcher never throws)
 *   - Cursor mode: stdout is empty OR every non-blank line is valid JSON
 *   - tolerates CRLF-tainted stdin and Windows-style paths without crashing
 *
 * Runs on windows-latest + ubuntu-latest via .github/workflows/ci.yml. New
 * hooks added under hooks/<name>/index.cjs WITHOUT a fixture entry fail here.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import flightrec from '../../hooks/lib/flightrec.cjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const RUN_HOOK = path.join(REPO, 'hooks', 'run-hook.cjs');
const HOOKS_DIR = path.join(REPO, 'hooks');
const { fixtures } = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', 'hook-contract.json'), 'utf8'));

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'hook-conf-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

/** Hook directories that actually ship a hook (have index.cjs). */
function hooksOnDisk() {
  return readdirSync(HOOKS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'lib')
    .map((e) => e.name)
    .filter((name) => {
      try {
        readFileSync(path.join(HOOKS_DIR, name, 'index.cjs'));
        return true;
      } catch {
        return false;
      }
    });
}

function toCrlf(s) {
  return s.replace(/\n/g, '\r\n');
}

function winpathPayload(payload) {
  const c = JSON.parse(JSON.stringify(payload));
  c.cwd = 'C:\\Users\\test\\proj';
  if (c.tool_input && typeof c.tool_input.file_path === 'string') {
    c.tool_input.file_path = 'C:\\Users\\test\\proj\\src\\file.ts';
  }
  return c;
}

function runHook(hook, input, extraEnv = {}) {
  const res = spawnSync(process.execPath, [RUN_HOOK, hook], {
    input,
    cwd: SCRATCH,
    encoding: 'utf8',
    timeout: 15000,
    // Hermetic: isolate HOME so session-start's auto-repair/auto-finalize can
    // never touch the developer's real ~/.claude/settings.json, and disable
    // auto-repair outright (this harness tests output contracts, not install
    // side effects).
    env: {
      ...process.env,
      HOME: SCRATCH,
      USERPROFILE: SCRATCH,
      CLAUDE_PROJECT_DIR: SCRATCH,
      TOPIA_NO_AUTOREPAIR: '1',
      ...extraEnv,
    },
  });
  return res;
}

function assertExitOk(hook, variant, res) {
  if (res.error && res.error.code === 'ETIMEDOUT') {
    assert.fail(`${hook} [${variant}] timed out (possible stdin hang)`);
  }
  assert.equal(
    res.status,
    0,
    `${hook} [${variant}] must exit 0 (fail-open). got status=${res.status} signal=${res.signal}\nstderr: ${res.stderr}`,
  );
}

function assertCursorJson(hook, res) {
  const lines = (res.stdout || '').split('\n').filter((l) => l.trim() !== '');
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      assert.fail(`${hook} [cursor] emitted non-JSON stdout line: ${JSON.stringify(line)}`);
    }
  }
}

describe('hook conformance — fixtures cover every hook', () => {
  test('every hooks/<name>/index.cjs has a fixture entry', () => {
    const onDisk = new Set(hooksOnDisk());
    const mapped = new Set(fixtures.map((f) => f.hook));
    const missing = [...onDisk].filter((h) => !mapped.has(h));
    const orphan = [...mapped].filter((h) => !onDisk.has(h));
    assert.deepEqual(missing, [], `hooks missing a fixture: ${missing.join(', ')}`);
    assert.deepEqual(orphan, [], `fixtures naming nonexistent hooks: ${orphan.join(', ')}`);
  });
});

describe('hook conformance — platform contracts', () => {
  for (const { hook, payload } of fixtures) {
    test(`${hook} honors the cross-platform contract`, () => {
      const claudeIn = JSON.stringify(payload);

      // claude: plain stdin, no cursor env — must exit 0 (no JSON requirement)
      assertExitOk(hook, 'claude', runHook(hook, claudeIn));

      // cursor: CURSOR_HOOK=1 — exit 0 AND stdout empty-or-valid-JSON
      const cursorRes = runHook(hook, claudeIn, { CURSOR_HOOK: '1' });
      assertExitOk(hook, 'cursor', cursorRes);
      assertCursorJson(hook, cursorRes);

      // crlf: CRLF-tainted stdin must not crash the hook
      assertExitOk(hook, 'crlf', runHook(hook, toCrlf(JSON.stringify(payload, null, 2))));

      // winpath: Windows-style paths in the payload must not crash the hook
      assertExitOk(hook, 'winpath', runHook(hook, JSON.stringify(winpathPayload(payload))));
    });
  }
});

describe('hook conformance — dispatch record is a shared fixture (#1↔#6 synergy)', () => {
  test('a launcher-shaped record passes flightrec.validateRecord', () => {
    const rec = flightrec.formatRecord({
      hook: 'readiness',
      target: path.join(REPO, 'compiler', 'bin', 'topia.js'),
      exit: 0,
      durationMs: 12,
      nowMs: 1700000000000,
    });
    assert.equal(flightrec.validateRecord(rec).valid, true);
  });
});
