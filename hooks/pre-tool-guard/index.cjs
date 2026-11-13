// Topia Pre-Tool Guard Hook — Privacy Nexus
// Three-tier security gate: ALLOW / WARN / BLOCK
// Configurable via .topia/privacy.json per project
// Skill-aware: guardian/review can access files other skills cannot
//
// Upgrades over basic path matching:
// - Per-project .topia/privacy.json config (custom patterns + overrides)
// - Three tiers: ALLOW (silent), WARN (log), BLOCK (exit code 2)
// - Content-aware: scans first bytes for secret patterns on WARN files

const fs = require('fs');
const path = require('path');
const { isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');

// Cursor permission hooks (beforeReadFile, preToolUse) block the read when the
// hook prints no JSON or bad JSON, so under Cursor every path prints a decision.
// https://cursor.com/docs/hooks
function allowAndExit(event) {
  if (isCursorRuntime(event)) writeHookResponse({ permission: 'allow' });
  process.exit(0);
}

// Claude Code: { tool_input: { file_path } }. Cursor beforeReadFile: { file_path, content }.
let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let toolInput = {};
  let event = {};
  try {
    const parsed = JSON.parse(input);
    event = parsed;
    toolInput = parsed.tool_input || parsed;
  } catch {
    // If no stdin or parse fails, exit cleanly (non-blocking)
    allowAndExit({});
  }

  const filePath = toolInput.file_path || toolInput.path || '';
  if (!filePath) allowAndExit(event);
  const cursor = isCursorRuntime(event);
  // beforeReadFile output has only `permission` and `user_message`.
  const readFileEvent = event.hook_event_name === 'beforeReadFile';

  const basename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');

  // Load project-specific privacy config
  const privacyConfig = loadPrivacyConfig();

  // Default sensitive file patterns — BLOCK tier (hard block)
  const blockPatterns = [
    /^id_rsa$/,
    /^id_ed25519$/,
    /^id_ecdsa$/,
    /\.p12$/,
    /\.pfx$/,
    /\.pem$/,
    /^\.netrc$/,
    /private[-_.]?key/i,
    ...privacyConfig.block.map((p) => new RegExp(p)),
  ];

  // WARN tier (log warning, allow through)
  const warnPatterns = [
    /^\.env$/,
    /^\.env\.[^e]/,                  // .env.* but NOT .env.example
    /\.key$/,
    /^credentials\.json$/,
    /\.secret$/,
    /secret[-_.]?key/i,
    ...privacyConfig.warn.map((p) => new RegExp(p)),
  ];

  // Safe exceptions (always allow)
  const safeExceptions = [
    /\.env\.example$/,
    /\.env\.sample$/,
    /\.env\.template$/,
    /\.env\.test$/,
    /test.*credential/i,
    /fixture/i,
    /mock/i,
    ...privacyConfig.allow.map((p) => new RegExp(p)),
  ];

  // Skills with elevated access (can read WARN-tier files without warning)
  const elevatedSkills = new Set([
    'sentinel', 'review', 'audit', 'secrets-scan', 'onboard',
    ...privacyConfig.elevatedSkills,
  ]);

  // Detect active skill from environment (set by metrics-collector or skill invocation)
  const activeSkill = process.env.Topia_ACTIVE_SKILL || '';
  const isElevated = elevatedSkills.has(activeSkill);

  const isSafe = safeExceptions.some((p) => p.test(basename) || p.test(normalized));
  if (isSafe) allowAndExit(event);

  const isBlocked = blockPatterns.some((p) => p.test(basename) || p.test(normalized));
  if (isBlocked) {
    const blockMsg = `[Topia privacy-nexus] BLOCKED: ${filePath} — BLOCK-tier pattern (private keys, certificates).`;
    if (cursor) {
      // A JSON deny with exit 0: Cursor uses the JSON, so the person sees why.
      const response = {
        permission: 'deny',
        user_message: `Topia blocked reading ${filePath}. To allow it, add the path to the "allow" list in .topia/privacy.json.`,
      };
      if (!readFileEvent) response.agent_message = blockMsg;
      writeHookResponse(response);
      process.exit(0);
    } else {
      // On exit 2 Claude Code hands stderr to the model as the reason; stdout is dropped.
      process.stderr.write(
        `🚫 ${blockMsg}\nOverride: add the path to the "allow" list in .topia/privacy.json if reading it is intentional.\n`,
      );
    }
    process.exit(2); // Exit code 2 = BLOCK
  }

  const isWarned = warnPatterns.some((p) => p.test(basename) || p.test(normalized));
  if (isWarned && !isElevated) {
    // Content-aware check: scan first 4KB for secret patterns
    // Cursor's beforeReadFile sends the file content, so scan that when present.
    const contentWarning = scanContentForSecrets(filePath, event.content);

    const lines = [`⚠ [Topia privacy-nexus] Sensitive file: ${filePath}`];
    if (contentWarning) lines.push(`Content scan: ${contentWarning}`);
    lines.push('This file may contain secrets. Read it only if the task needs it, and never repeat secret values.');
    lines.push('Elevated skills (guardian, review, audit) bypass this warning.');
    if (cursor) {
      // beforeReadFile cannot send text to the agent; preToolUse can.
      writeHookResponse(
        readFileEvent
          ? { permission: 'allow', user_message: lines.join(' ') }
          : { permission: 'allow', agent_message: lines.join('\n') },
      );
      process.exit(0);
    }
    // Plain stdout on exit 0 never reaches the model; this JSON does. It warns, and leaves the permission alone.
    process.stdout.write(
      JSON.stringify({
        systemMessage: `Topia: sensitive file read — ${filePath}`,
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: lines.join('\n') },
      }),
    );
    process.exit(0);
  }

  allowAndExit(event);
});

/**
 * Load .topia/privacy.json from project root
 * Returns merged config with defaults
 */
function loadPrivacyConfig() {
  const defaults = { block: [], warn: [], allow: [], elevatedSkills: [] };

  const candidates = [
    path.join(process.cwd(), '.topia', 'privacy.json'),
    path.join(process.cwd(), 'privacy.json'),
  ];

  for (const configPath of candidates) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        return {
          block: Array.isArray(raw.block) ? raw.block : defaults.block,
          warn: Array.isArray(raw.warn) ? raw.warn : defaults.warn,
          allow: Array.isArray(raw.allow) ? raw.allow : defaults.allow,
          elevatedSkills: Array.isArray(raw.elevatedSkills) ? raw.elevatedSkills : defaults.elevatedSkills,
        };
      }
    } catch {
      // Invalid config — use defaults
    }
  }

  return defaults;
}

/**
 * Scan first 4KB of a file (or of the content the host sent) for common secret patterns
 * Returns a warning string if secrets detected, null otherwise
 */
function scanContentForSecrets(filePath, sentContent) {
  try {
    let content;
    if (typeof sentContent === 'string') {
      content = sentContent.slice(0, 4096);
    } else {
      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
      fs.closeSync(fd);
      content = buffer.toString('utf-8', 0, bytesRead);
    }

    if (!content) return null;

    const secretPatterns = [
      { pattern: /AKIA[0-9A-Z]{16}/, label: 'AWS access key' },
      { pattern: /gh[ps]_[A-Za-z0-9_]{36,}/, label: 'GitHub token' },
      { pattern: /sk_(live|test)_[0-9a-zA-Z]{24,}/, label: 'Stripe key' },
      { pattern: /-----BEGIN .* PRIVATE KEY-----/, label: 'Private key' },
      { pattern: /xox[bpors]-[0-9a-zA-Z-]{10,}/, label: 'Slack token' },
      { pattern: /sk-[a-zA-Z0-9]{32,}/, label: 'OpenAI/API key' },
    ];

    for (const { pattern, label } of secretPatterns) {
      if (pattern.test(content)) {
        return `Found ${label} pattern in file content`;
      }
    }
  } catch {
    // Can't read file (doesn't exist yet, permissions, etc.) — skip silently
  }

  return null;
}
