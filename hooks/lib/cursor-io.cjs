/**
 * Shared Cursor / Claude Code hook I/O helpers.
 * Cursor requires JSON on stdout; Claude Code accepts plain text for many hooks.
 */
const { stdin: processStdin, stdout: processStdout } = process;

const MAX_STDIN = 1_000_000;
const CURSOR_STDIN_TIMEOUT_MS = 30_000;
const CLAUDE_STDIN_TIMEOUT_MS = 500;

/**
 * @param {object} [event]
 * @returns {boolean}
 */
function isCursorRuntime(event = {}) {
  if (process.env.CURSOR_HOOK === '1' || process.env.CURSOR_AGENT === '1') return true;
  if (process.env.CURSOR_VERSION || process.env.CURSOR_PROJECT_DIR) return true;
  if (event?.cursor_version || event?.hook_event_name) return true;
  return false;
}

/**
 * @param {object} payload
 * @param {{ stream?: NodeJS.WritableStream }} [opts]
 */
function writeHookResponse(payload, opts = {}) {
  const stream = opts.stream || processStdout;
  stream.write(`${JSON.stringify(payload)}\n`);
}

/**
 * @param {string} text
 * @param {{ stream?: NodeJS.WritableStream }} [opts]
 */
function writeClaudeLine(text, opts = {}) {
  const stream = opts.stream || processStdout;
  stream.write(`${text}\n`);
}

/**
 * @param {object} payload
 * @param {{ event?: object, claudeLine?: string, stream?: NodeJS.WritableStream }} [opts]
 */
function emitHookOutput(payload, opts = {}) {
  const event = opts.event || {};
  if (isCursorRuntime(event)) {
    writeHookResponse(payload, { stream: opts.stream });
  } else if (opts.claudeLine) {
    writeClaudeLine(opts.claudeLine, { stream: opts.stream });
  }
}

/**
 * @param {NodeJS.ReadableStream} [stream]
 * @param {{ cursor?: boolean }} [opts]
 * @returns {Promise<string>}
 */
function readStdinRaw(stream = processStdin, opts = {}) {
  const cursor = opts.cursor ?? isCursorRuntime();
  const timeoutMs = cursor ? CURSOR_STDIN_TIMEOUT_MS : CLAUDE_STDIN_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    if (stream.isTTY) {
      resolve('');
      return;
    }
    let buf = '';
    let timer = null;
    // Settle exactly once and ALWAYS clear the fallback timer. Without this the
    // (uncleared, non-unref'd) timer keeps the Node process alive for the full
    // timeout after stdin already ended — 30s of zombie process per Cursor hook.
    const settle = (fn, val) => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      fn(val);
    };
    stream.setEncoding('utf-8');
    const onData = (chunk) => {
      buf += chunk;
      if (buf.length > MAX_STDIN) {
        stream.removeListener('data', onData);
        stream.destroy();
        settle(reject, new Error('stdin too large'));
      }
    };
    stream.on('data', onData);
    stream.on('end', () => settle(resolve, buf));
    stream.on('error', (err) => settle(reject, err));
    if (timeoutMs > 0) {
      timer = setTimeout(() => settle(resolve, buf), timeoutMs);
      // Don't let the fallback timer itself hold the event loop open.
      if (typeof timer.unref === 'function') timer.unref();
    }
  });
}

/**
 * @param {NodeJS.ReadableStream} [stream]
 * @param {{ cursor?: boolean }} [opts]
 * @returns {Promise<object>}
 */
async function readStdinJson(stream = processStdin, opts = {}) {
  try {
    const raw = await readStdinRaw(stream, opts);
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Map hook event name to Cursor-native stdout shape.
 * @param {string} hookEventName
 * @param {string} [message]
 * @returns {object}
 */
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

module.exports = {
  isCursorRuntime,
  writeHookResponse,
  writeClaudeLine,
  emitHookOutput,
  readStdinRaw,
  readStdinJson,
  cursorPayloadForEvent,
};
