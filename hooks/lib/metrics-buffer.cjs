/**
 * Append-only session metrics buffer (tmpdir JSONL).
 * Shared by token-meter, metrics-collector, pre-compact, post-session-reflect.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function cwdHash(cwd) {
  return Buffer.from(cwd || process.cwd()).toString('base64url').slice(0, 16);
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
  readEvents,
  appendEvent,
  clearEvents,
};
