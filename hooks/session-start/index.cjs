// Topia Session Start Hook
// Loads and injects .topia/ state file CONTENTS into context at session start

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { isAgoraMemoryRegistered, agoraCodeOnPath } = require('../lib/agora-detect.cjs');
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

// Stale-hook detection — warn if settings.json hooks point at a plugin path that
// no longer exists (the classic "Cannot find module .../topia.js" after a plugin
// upgrade). Repair = re-run /topia finalize, which now writes a stable launcher.
detectStaleHooks();

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

  console.log('\n=== topia: Rune migration recommended ===');
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
  // Top-level dismiss — written by `/topia finalize --dismiss` (or --reset).
  // If present, suppress the entire first-run menu permanently.
  const dismissFlags = ['.dismissed', 'skip-first-run.flag'];
  for (const f of dismissFlags) {
    if (fs.existsSync(path.join(TopiaDirRead, f)) || fs.existsSync(path.join(TopiaDirWrite, f))) {
      return;
    }
  }

  // Detect per-task completion state. Each block has its own flag so the menu
  // shrinks as the user completes steps (e.g. once they run /topia onboard,
  // the onboarding line disappears next session).
  const has = (flag) =>
    fs.existsSync(path.join(TopiaDirRead, flag)) ||
    fs.existsSync(path.join(TopiaDirWrite, flag));

  // Auto-detect finalize from ~/.claude/settings.json so users who finalized
  // via the CLI before this menu existed don't keep getting nudged.
  let finalized = has('.finalized');
  if (!finalized) {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8');
        if (
          raw.includes('topia.js hook-dispatch') ||
          raw.includes('hook-dispatch.cjs') ||
          raw.includes('Topia-managed')
        ) {
          try {
            fs.mkdirSync(TopiaDirWrite, { recursive: true });
            fs.writeFileSync(
              path.join(TopiaDirWrite, '.finalized'),
              `finalized: ${new Date().toISOString()} (auto-detected from settings.json)\n`,
            );
          } catch { /* non-critical */ }
          finalized = true;
        }
      }
    } catch { /* fall through */ }
  }

  // Onboard is "done" once the repo has any persisted state file written by
  // onboard (DEVELOPER-GUIDE / conventions / progress / decisions). Without
  // this heuristic, onboarded users on machines that didn't run finalize
  // would still see "set up this repo" — confusing for them.
  const onboardSignals = ['DEVELOPER-GUIDE.md', 'conventions.md', 'progress.md', 'decisions.md'];
  const onboarded = onboardSignals.some((f) => has(f));

  // If everything is done, no menu. Self-suppressed.
  if (finalized && onboarded) {
    try {
      fs.mkdirSync(TopiaDirWrite, { recursive: true });
      fs.writeFileSync(
        path.join(TopiaDirWrite, '.dismissed'),
        `auto-dismissed: ${new Date().toISOString()} (finalize + onboard complete)\n`,
      );
    } catch { /* non-critical */ }
    return;
  }

  // Structured first-run menu. Each line indicates state with [ ] / [x] so
  // the user sees what's left. Dismissible at any time.
  console.log('\n  ╭───────────────────────────────────────────────────────────╮');
  console.log('  │  Topia Step 1 done. Complete install:                     │');
  console.log('  ╰───────────────────────────────────────────────────────────╯');
  console.log(`    [${finalized ? 'x' : ' '}] /topia finalize  — Step 2: dispatch hooks + team org.md`);
  console.log('                          (recommended; without it, gates may not auto-fire everywhere)');
  console.log(`    [${onboarded ? 'x' : ' '}] /topia onboard   — per-repo: CLAUDE.md + .topia/ context`);
  console.log('    [ ] /topia org-config — per-repo/team: .topia/org/org.md (commit for teams)');
  console.log('    [ ] /topia doctor    — verify install health and surface any fixes');
  console.log('    [ ] /topia:faq       — list bundled docs + visualizer entry points');
  console.log('    [ ] /topia:tut       — replay this menu later with current status');
  console.log('    [ ] /topia --help    — full command reference');
  console.log('');
  console.log('  Hide this menu permanently:   /topia finalize --dismiss');
  console.log('  (Each completed step auto-checks itself the next session.)');
}

// Detect Topia hook commands whose concrete script path no longer exists. This
// is the failure the stable launcher fixes: older installs baked a versioned
// plugin-cache path into settings.json, which upgrades delete. We only flag
// CONCRETE paths (skip `${CLAUDE_PROJECT_DIR}`/`${CLAUDE_PLUGIN_ROOT}` — those are
// resolved by Claude Code, not us) so the check never false-positives.
function detectStaleHooks() {
  const candidates = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(cwd, '.claude', 'settings.json'),
  ];
  const seen = new Set();
  const stale = [];

  for (const settingsPath of candidates) {
    if (seen.has(settingsPath)) continue;
    seen.add(settingsPath);
    let settings;
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      if (!raw.trim()) continue;
      settings = JSON.parse(raw);
    } catch {
      continue; // unreadable / invalid JSON — not our problem to diagnose here
    }
    if (!settings || typeof settings.hooks !== 'object') continue;

    for (const groups of Object.values(settings.hooks)) {
      if (!Array.isArray(groups)) continue;
      for (const group of groups) {
        if (!Array.isArray(group?.hooks)) continue;
        for (const entry of group.hooks) {
          const cmd = entry && typeof entry.command === 'string' ? entry.command : '';
          if (!/hook-dispatch/.test(cmd)) continue;
          // Extract the `node "<path>" …` target.
          const m = cmd.match(/node\s+"([^"]+\.(?:cjs|js))"/) || cmd.match(/node\s+(\S+\.(?:cjs|js))/);
          if (!m) continue;
          const target = m[1];
          if (target.includes('${')) continue; // variable path — Claude Code resolves it
          try {
            if (!fs.existsSync(target)) stale.push({ settingsPath, target });
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  if (stale.length === 0) return;
  console.log('');
  console.log('  ⚠ topia: some hooks point at a plugin path that no longer exists');
  console.log(`      (e.g. ${stale[0].target})`);
  console.log('      This usually means the plugin was upgraded. Repair with:');
  console.log('        /topia finalize     (rewrites hooks to a version-stable launcher)');
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
        console.log(`[topia: active L4 packs: ${ap.enabled.join(', ')} — shipped with Topia, not a separate install]`);
      }
    } catch { /* non-critical */ }
  }

if (loaded.length > 0) {
    console.log(`\n[topia: injected project state from ${loaded.join(', ')}]`);
  } else {
    console.log('[topia: .topia/ directory found but no state files yet. Run /topia onboard to populate.]');
  }
} else {
  console.log('[topia: No .topia/ directory found. Run /topia onboard to set up project context.]');
}

if (isAgoraMemoryRegistered(cwd) && agoraCodeOnPath()) {
  try {
    const agoraCtx = execFileSync('agora-code', ['inject', '--quiet'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (agoraCtx) {
      console.log(`\n=== agora-code session context ===\n${agoraCtx}`);
    }
  } catch { /* non-critical */ }
}

const agoraOn = isAgoraMemoryRegistered(cwd);
console.log('');
console.log('[topia: Memory checklist]');
if (agoraOn) {
  console.log('  1. MUST invoke topia:recall before large reads or architecture work (first user turn if not done)');
  console.log('  2. agora-memory is registered — recall merges .topia/ + MCP learnings');
  console.log('  3. After decisions: topia:journal then neural-memory Capture');
} else {
  console.log('  1. Invoke topia:recall (unified .topia/ + .remember/ + MCP)');
  console.log('  2. If agora-memory MCP registered: recall_learnings before large reads');
  console.log('  3. After decisions: topia:journal then neural-memory Capture');
}

const sessionText = hookLines.join('\n').trim();
if (isCursorRuntime()) {
  writeHookResponse(sessionText ? { additional_context: sessionText } : {});
} else {
  for (const line of hookLines) origLog(line);
}
