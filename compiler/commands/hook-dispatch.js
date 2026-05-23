/**
 * `Topia hook-dispatch <skill> [--gentle]`
 *
 * Runtime dispatcher invoked by Claude Code hooks. Reads event JSON from stdin,
 * validates the skill name against an allowlist, then forwards to the skill's
 * execution (currently a no-op placeholder that emits a verdict line — skill
 * invocation wiring happens when skills gain a headless mode).
 *
 * In gentle mode: always exits 0, prints advisory line.
 * In strict mode: exits 2 on BLOCK verdict (Claude Code blocks the tool call).
 *
 * Security:
 *   - Skill name MUST match the allowlist (no arbitrary shell injection)
 *   - Event payload is parsed but never passed to shell commands
 *   - Unknown skills fail closed (error in strict, warn in gentle)
 */

import { WIRED_SKILLS } from './hooks/presets.js';

/** v1 skill IDs accepted with deprecation warning (one release cycle). */
const V1_SKILL_ALIASES = {
  preflight: 'readiness',
  sentinel: 'guardian',
};

const ALLOWLIST = new Set([...WIRED_SKILLS, ...Object.keys(V1_SKILL_ALIASES)]);

function isCursorRuntime(event = {}) {
  if (process.env.CURSOR_HOOK === '1' || process.env.CURSOR_AGENT === '1') return true;
  if (process.env.CURSOR_VERSION || process.env.CURSOR_PROJECT_DIR) return true;
  if (event?.cursor_version || event?.hook_event_name) return true;
  return false;
}

function cursorPayloadForEvent(hookEventName, message) {
  const name = (hookEventName || '').toLowerCase();
  if (
    name === 'pretooluse' ||
    name === 'beforeshellexecution' ||
    name === 'beforemcpexecution' ||
    name === 'beforereadfile'
  ) {
    return { permission: 'allow', agent_message: message };
  }
  if (name === 'posttooluse' || name === 'sessionstart' || name === 'precompact') {
    return message ? { additional_context: message } : {};
  }
  if (name === 'stop' || name === 'subagentstop' || name === 'sessionend') {
    return {};
  }
  if (!name) {
    return message
      ? { permission: 'allow', agent_message: message }
      : { permission: 'allow' };
  }
  if (message) return { additional_context: message };
  return {};
}

/**
 * @param {string[]} argv — positional args after `hook-dispatch`
 * @param {{stdin?: NodeJS.ReadableStream, stdout?: NodeJS.WritableStream, stderr?: NodeJS.WritableStream}} io
 * @returns {Promise<number>} exit code
 */
export async function dispatchHook(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const stdin = io.stdin || process.stdin;

  const positional = argv.filter((a) => !a.startsWith('--'));
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const skill = positional[0];
  const gentle = flags.has('--gentle');

  if (!skill) {
    stderr.write('Topia hook-dispatch: missing skill name\n');
    return gentle ? 0 : 1;
  }

  if (!ALLOWLIST.has(skill)) {
    stderr.write(`Topia hook-dispatch: unknown skill "${skill}"\n`);
    return gentle ? 0 : 1;
  }

  const resolvedSkill = V1_SKILL_ALIASES[skill] || skill;
  if (V1_SKILL_ALIASES[skill]) {
    stderr.write(`Topia hook-dispatch: "${skill}" is deprecated — use "${resolvedSkill}" (v2.0)\n`);
  }

  const cursor = isCursorRuntime();
  let eventJson = {};
  try {
    const raw = await readStdin(stdin, cursor);
    if (raw.trim()) eventJson = JSON.parse(raw);
  } catch {
    // Non-JSON stdin is tolerable — skills may not need the payload
  }

  const mode = gentle ? 'advisory' : 'enforcing';
  const toolName = eventJson?.tool_name || eventJson?.toolName || 'unknown';
  const advisoryLine = `Topia-hook: ${resolvedSkill} [${mode}] — tool=${toolName}`;

  if (isCursorRuntime(eventJson)) {
    const payload = cursorPayloadForEvent(eventJson.hook_event_name, advisoryLine);
    stdout.write(`${JSON.stringify(payload)}\n`);
  } else {
    stdout.write(`${advisoryLine}\n`);
  }

  return 0;
}

function readStdin(stream, cursor = false) {
  const timeoutMs = cursor ? 30_000 : 500;
  return new Promise((resolve, reject) => {
    if (stream.isTTY) {
      resolve('');
      return;
    }
    let buf = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 1_000_000) {
        stream.destroy();
        reject(new Error('stdin too large'));
      }
    });
    stream.on('end', () => resolve(buf));
    stream.on('error', reject);
    if (timeoutMs > 0) {
      setTimeout(() => resolve(buf), timeoutMs);
    }
  });
}
