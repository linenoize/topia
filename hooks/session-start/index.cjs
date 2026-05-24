// Topia Session Start Hook
// Loads and injects .topia/ state file CONTENTS into context at session start

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { resolveTopiaDir, topiaDirForWrite } = require('../lib/topia-paths.cjs');

const hookLines = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  hookLines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
};

const cwd = process.cwd();
const TopiaDirRead = resolveTopiaDir(cwd);
const TopiaDirWrite = topiaDirForWrite(cwd);

// Initialize fresh session state (shared between context-watch and metrics-collector)
const hash = Buffer.from(cwd).toString('base64url').slice(0, 16);
const counterFile = path.join(os.tmpdir(), `Topia-context-watch-${hash}.json`);
const now = new Date().toISOString();
const sessionId = `s-${now.slice(0, 10).replace(/-/g, '')}-${now.slice(11, 19).replace(/:/g, '')}`;
try {
  fs.writeFileSync(counterFile, JSON.stringify({
    count: 0, lastWarning: 0, sessionStart: now, sessionId, toolCounts: {}
  }));
} catch { /* non-critical */ }

// Rune migration detection — fires before state load so the user sees the
// prompt prominently. Self-suppressing via flag files in .topia/.
detectRuneMigration();

// First-run finalize nudge — one-line offer that points at /topia finalize.
// Self-suppresses once .topia/.finalized OR .topia/skip-finalize.flag exists.
detectFinalizeNudge();

function detectRuneMigration() {
  const runeDir = path.join(cwd, '.rune');
  const home = os.homedir();
  const runeKitCandidates = [
    path.join(home, '.claude', 'plugins', 'cache', 'rune-kit'),
    path.join(home, '.claude', 'plugins', 'rune-kit'),
  ];
  const runeKitPath = runeKitCandidates.find((p) => {
    try { return fs.existsSync(p) && fs.statSync(p).isDirectory(); }
    catch { return false; }
  });

  const hasRuneDir = fs.existsSync(runeDir) && fs.statSync(runeDir).isDirectory();
  if (!hasRuneDir && !runeKitPath) return;

  function topiaFlagExists(name) {
    return (
      fs.existsSync(path.join(TopiaDirRead, name)) ||
      fs.existsSync(path.join(TopiaDirWrite, name))
    );
  }
  if (topiaFlagExists('migrated-from-rune.flag') || topiaFlagExists('skip-rune-migration.flag')) return;

  console.log('\n=== Topia: Rune migration recommended ===');
  if (hasRuneDir) {
    console.log(`  · Found .rune/ in this project (rune-kit's state directory)`);
  }
  if (runeKitPath) {
    console.log(`  · Found rune-kit plugin at ${runeKitPath}`);
  }
  console.log('');
  console.log('  Why migrate:');
  console.log('    1. Pull your prior decisions, ADRs, conventions, and learnings');
  console.log('       from .rune/ into .topia/ so this session can recall them.');
  console.log('    2. Disable rune-kit so it does not conflict with Topia. The two');
  console.log('       plugins share ~30 skill names (build, plan, recon, integrate, etc.);');
  console.log('       with both active, the router will pick one non-deterministically.');
  console.log('');
  console.log('  If you decline:');
  console.log('    · Past .rune/ context will stay unread by Topia skills.');
  console.log('    · rune-kit will keep shadowing Topia commands — expect silent');
  console.log('      routing surprises until one is removed.');
  console.log('');
  console.log('  To proceed (preview first, then run):');
  console.log('    node compiler/bin/topia.js migrate-from-rune --dry-run');
  console.log('    node compiler/bin/topia.js migrate-from-rune');
  console.log('');
  console.log('  To suppress this warning without migrating:');
  console.log('    node compiler/bin/topia.js migrate-from-rune --skip');
  console.log('');
}

function detectFinalizeNudge() {
  // Skip if user has already finalized or explicitly opted out.
  const flags = ['.finalized', 'skip-finalize.flag'];
  for (const f of flags) {
    if (fs.existsSync(path.join(TopiaDirRead, f)) || fs.existsSync(path.join(TopiaDirWrite, f))) {
      return;
    }
  }
  // Heuristic: if ~/.claude/settings.json already has Topia dispatch hooks,
  // the user finalized via the CLI before this nudge existed — write the flag
  // silently so we never bother them.
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      if (raw.includes('topia.js hook-dispatch') || raw.includes('Topia-managed')) {
        try {
          fs.mkdirSync(TopiaDirWrite, { recursive: true });
          fs.writeFileSync(
            path.join(TopiaDirWrite, '.finalized'),
            `finalized: ${new Date().toISOString()} (auto-detected from settings.json)\n`,
          );
        } catch { /* non-critical */ }
        return;
      }
    }
  } catch { /* non-critical — fall through to nudge */ }

  console.log('\n[Topia: first-run tip] Plugin is installed — you are ready to use /topia build.');
  console.log('  Optional extras (system-wide hooks, agora-code memory, project .gitignore):');
  console.log('    /topia finalize        — interactive opt-in (recommended)');
  console.log('    /topia finalize --reset  hides this tip permanently');
}

const hasTopiaState = fs.existsSync(TopiaDirRead) || fs.existsSync(TopiaDirWrite);
if (hasTopiaState) {
  const TopiaDir = TopiaDirRead;
  const stateFiles = [
    'progress.md',
    'decisions.md',
    'conventions.md',
    'RESCUE-STATE.md',
    'DEVELOPER-GUIDE.md',
    'logic-manifest.json'
  ];
  const loaded = [];

  for (const file of stateFiles) {
    const filePath = path.join(TopiaDir, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content.length > 0) {
        console.log(`\n=== .topia/${file} ===\n${content}`);
        loaded.push(file);
      }
    }
  }

  // Inject active behavioral context mode
  const activeContextFile = path.join(TopiaDir, 'active-context.md');
  if (fs.existsSync(activeContextFile)) {
    try {
      const mode = fs.readFileSync(activeContextFile, 'utf-8').trim();
      if (mode) {
        // Look for the context file in plugin's contexts/ directory
        const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(__dirname, '..', '..');
        const contextFile = path.join(pluginRoot, 'contexts', `${mode}.md`);
        if (fs.existsSync(contextFile)) {
          const contextContent = fs.readFileSync(contextFile, 'utf-8').trim();
          console.log(`\n=== Active Context: ${mode} mode ===\n${contextContent}`);
          loaded.push(`active-context(${mode})`);
        }
      }
    } catch {
      // Non-critical — skip silently
    }
  }

  const activePacksPath = path.join(TopiaDir, 'active-packs.json');
  if (fs.existsSync(activePacksPath)) {
    try {
      const ap = JSON.parse(fs.readFileSync(activePacksPath, 'utf-8'));
      if (Array.isArray(ap.enabled) && ap.enabled.length > 0) {
        console.log(`[Topia: active L4 packs: ${ap.enabled.join(', ')}]`);
      }
    } catch { /* non-critical */ }
  }

    console.log('');
  console.log('[Topia: Memory checklist]');
  console.log('  1. Invoke Topia:recall (unified .topia/ + .remember/ + MCP)');
  console.log('  2. If agora-memory MCP registered: recall_learnings before large reads');
  console.log('  3. After decisions: Topia:journal then neural-memory Capture');

if (loaded.length > 0) {
    console.log(`\n[Topia: injected project state from ${loaded.join(', ')}]`);
  } else {
    console.log('[Topia: .topia/ directory found but no state files yet. Run /topia onboard to populate.]');
  }
} else {
  console.log('[Topia: No .topia/ directory found. Run /topia onboard to set up project context.]');
}

// Tier detection hint — historical Pro/Business plugin paths; tiers no longer ship
// and aren't auto-loaded like the Free plugin. If detected at sibling / env /
// well-known path AND tier hooks aren't already wired in settings.json, nudge
// user toward `Topia setup`. Self-suppressing — once wired, the check fails and
// the hint stops firing.
detectTierHint();

function detectTierHint() {
  const envVars = { pro: 'Topia_PRO_ROOT', business: 'Topia_BUSINESS_ROOT' };
  const wellKnown = {
    pro: [
      'D:/Project/Topia/Pro',
      path.join(os.homedir(), 'Topia-pro'),
      path.join(os.homedir(), 'Project', 'Topia', 'Pro'),
    ],
    business: [
      'D:/Project/Topia/Business',
      path.join(os.homedir(), 'Topia-business'),
      path.join(os.homedir(), 'Project', 'Topia', 'Business'),
    ],
  };

  const detected = [];
  for (const tier of ['pro', 'business']) {
    let manifest = null;
    let source = null;

    const fromEnv = process.env[envVars[tier]];
    if (fromEnv) {
      const m = path.join(fromEnv, 'hooks', 'manifest.json');
      if (fs.existsSync(m)) {
        manifest = m;
        source = `$${envVars[tier]}`;
      }
    }
    if (!manifest) {
      const m = path.join(cwd, '..', tier === 'pro' ? 'Pro' : 'Business', 'hooks', 'manifest.json');
      if (fs.existsSync(m)) {
        manifest = m;
        source = 'sibling';
      }
    }
    if (!manifest) {
      for (const root of wellKnown[tier]) {
        const m = path.join(root, 'hooks', 'manifest.json');
        if (fs.existsSync(m)) {
          manifest = m;
          source = 'well-known';
          break;
        }
      }
    }

    if (manifest) {
      detected.push({ tier, source, version: readManifestVersion(manifest) });
    }
  }

  if (detected.length === 0) return;

  // Suppress hint if any tier hook already wired (project-local OR global)
  const tierEnvRe = /\$\{Topia_[A-Z][A-Z0-9_]*_ROOT\}/;
  const settingsPaths = [path.join(cwd, '.claude', 'settings.json'), path.join(os.homedir(), '.claude', 'settings.json')];
  for (const settingsPath of settingsPaths) {
    if (!fs.existsSync(settingsPath)) continue;
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      if (tierEnvRe.test(content)) return;
    } catch {
      // ignore unreadable settings.json — fall through to print hint
    }
  }

  console.log('\n=== Topia Tier Hint ===');
  for (const { tier, source, version } of detected) {
    const cap = tier.charAt(0).toUpperCase() + tier.slice(1);
    console.log(`${cap} detected: ${source} (v${version})`);
  }
  const tierFlag = detected.map((d) => d.tier).join(',');
  console.log('Wire dispatch hooks: `node <skill-topia>/compiler/bin/topia.js setup --global --preset gentle`');
  console.log('(See docs/INSTALL-CLAUDE-CODE.md — do not use npx unless @protopia/skill-topia is on npm.)');
  console.log('(adds tier-specific hooks: autopilot circuit-breaker, context-sense, statusline)');
}

function readManifestVersion(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

const sessionText = hookLines.join('\n').trim();
if (isCursorRuntime()) {
  writeHookResponse(sessionText ? { additional_context: sessionText } : {});
} else {
  for (const line of hookLines) origLog(line);
}
