/**
 * routing-log.cjs — one line per routing hint in .topia/metrics/routing.jsonl.
 *
 * The intent-router hook writes a line each time it hints at a skill, so a
 * later cleanup can ask "was the hinted skill used, and how soon?" by joining
 * on session id and time with the skill invocations in chains.jsonl.
 *
 * A line holds the time, the session id, the hinted skill ids in rank order,
 * the hook's run time and whether it was a bare-slash redirect. Never the
 * prompt, and nothing taken from it beyond the skill ids.
 *
 *   {"ts":"2026-11-13T10:00:00.000Z","session":"…","skills":["build","test"],"ms":41,"bare":false}
 *
 * The file is trimmed to its newest half once it passes MAX_BYTES. Every
 * failure is swallowed: a log never blocks a prompt.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;

function routingLogPath(cwd) {
  return path.join(cwd, '.topia', 'metrics', 'routing.jsonl');
}

/** Keep the newest whole lines that fit in half the cap. */
function trimToNewest(file, maxBytes) {
  const text = fs.readFileSync(file, 'utf-8');
  const keep = Math.floor(maxBytes / 2);
  let tail = text.slice(-keep);
  const firstBreak = tail.indexOf('\n');
  tail = firstBreak === -1 ? '' : tail.slice(firstBreak + 1);
  fs.writeFileSync(file, tail);
}

/**
 * @param {string} cwd — project directory
 * @param {{ session?: string|null, skills: string[], ms: number, bare?: boolean, now?: Date }} entry
 * @param {{ maxBytes?: number }} [opts]
 * @returns {boolean} whether a line was written
 */
function appendRouting(cwd, { session = null, skills, ms, bare = false, now = new Date() }, { maxBytes = MAX_BYTES } = {}) {
  try {
    const ids = (Array.isArray(skills) ? skills : []).filter((s) => typeof s === 'string' && /^[\w:-]+$/.test(s));
    if (ids.length === 0) return false;
    const file = routingLogPath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = JSON.stringify({
      ts: now.toISOString(),
      session: typeof session === 'string' && session ? session : null,
      skills: ids,
      ms: Number.isFinite(ms) ? Math.round(ms) : null,
      bare: bare === true,
    });
    fs.appendFileSync(file, `${line}\n`);
    if (fs.statSync(file).size > maxBytes) trimToNewest(file, maxBytes);
    return true;
  } catch {
    return false;
  }
}

module.exports = { MAX_BYTES, routingLogPath, appendRouting };
