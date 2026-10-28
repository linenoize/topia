/**
 * Append-only session metrics buffer (tmpdir JSONL).
 * Shared by token-meter, metrics-collector, pre-compact, post-session-reflect.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

/**
 * Stable per-project key for the tmpdir session files.
 *
 * Hashes the WHOLE resolved path. The old key was the first 16 base64url chars
 * of the raw path, which encode only its first 12 bytes, so every project under
 * one parent (`C:\CodeBase\`, `/home/me/src/`) shared one buffer, one tool
 * counter and one session id. Any session's Stop then flushed (and cleared)
 * the other projects' skill events into its own .topia/metrics.
 * Windows paths compare case-insensitively, so fold case there.
 */
function cwdHash(cwd) {
  let resolved = path.resolve(cwd || process.cwd());
  if (process.platform === 'win32') resolved = resolved.toLowerCase();
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16);
}

/** Tool-call counter / session state shared by session-start, context-watch, reflect. */
function watchFilePath(cwd) {
  return path.join(os.tmpdir(), `Topia-context-watch-${cwdHash(cwd)}.json`);
}

/** Per-project cache of estimated skill-load tokens (metrics-collector). */
function skillCacheFilePath(cwd) {
  return path.join(os.tmpdir(), `Topia-skill-cache-${cwdHash(cwd)}.json`);
}

/** Byte offset already scanned, per transcript (post-session-reflect, pre-compact). */
function transcriptCursorFilePath(cwd) {
  return path.join(os.tmpdir(), `Topia-transcript-cursor-${cwdHash(cwd)}.json`);
}

function metricsFilePath(cwd) {
  return path.join(os.tmpdir(), `Topia-metrics-${cwdHash(cwd)}.jsonl`);
}

function readEvents(cwd) {
  const file = metricsFilePath(cwd);
  if (!fs.existsSync(file)) return [];
  try {
    return fs
      .readFileSync(file, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param {string} cwd
 * @param {object} event — must include `event` type field
 */
function appendEvent(cwd, event) {
  const file = metricsFilePath(cwd);
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    ...event,
  });
  try {
    fs.appendFileSync(file, `${entry}\n`);
    return true;
  } catch {
    return false;
  }
}

function clearEvents(cwd) {
  try {
    fs.unlinkSync(metricsFilePath(cwd));
  } catch {
    /* already gone */
  }
}

module.exports = {
  cwdHash,
  metricsFilePath,
  watchFilePath,
  skillCacheFilePath,
  transcriptCursorFilePath,
  readEvents,
  appendEvent,
  clearEvents,
};
