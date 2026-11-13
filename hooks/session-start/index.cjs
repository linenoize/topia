// Topia Session Start Hook
// Loads and injects .topia/ state file CONTENTS into context at session start

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { isCursorRuntime, writeHookResponse } = require('../lib/cursor-io.cjs');
const { isAgoraMemoryRegistered, agoraCodeOnPath } = require('../lib/agora-detect.cjs');
const { resolveTopiaDir, topiaDirForWrite } = require('../lib/topia-paths.cjs');
const memory = require('../lib/memory-sources.cjs');
const autofix = require('../lib/autofix.cjs');
const { watchFilePath } = require('../lib/metrics-buffer.cjs');

const hookLines = [];
const origLog = console.log.bind(console);
console.log = (...args) => {
  hookLines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
};

const cwd = process.cwd();
const TopiaDirRead = resolveTopiaDir(cwd);
const TopiaDirWrite = topiaDirForWrite(cwd);

// Initialize fresh session state (shared between context-watch and metrics-collector)
const counterFile = watchFilePath(cwd);
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

// Opt-in auto-finalize — when explicitly enabled, wire global hooks for a
// never-finalized machine (backed up, additive). Runs before the nudge so a
// successful wire suppresses it. Default is the nudge below.
detectAutoFinalize();

// First-run finalize nudge — one-line offer that points at /topia finalize.
// Self-suppresses once .topia/.finalized OR .topia/skip-finalize.flag exists.
detectFinalizeNudge();

// Stale-hook detection — warn if settings.json hooks point at a plugin path that
// no longer exists (the classic "Cannot find module .../topia.js" after a plugin
// upgrade). Repair = re-run /topia finalize, which now writes a stable launcher.
detectStaleHooks();

// Outdated launcher — setup copies the launcher once and plugin updates never
// touch it again, so refresh the global copy when this plugin bundles a newer
// revision. Same opt-out as auto-repair. A project-scope copy only gets a warn,
// matching project settings.json (it lives in the repo).
refreshOutdatedLauncher();

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
  console.log('    [ ] /topia-faq       — list bundled docs + visualizer entry points');
  console.log('    [ ] /topia-tut       — replay this menu later with current status');
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
  const home = os.homedir();
  const globalSettings = path.join(home, '.claude', 'settings.json');
  const projectSettings = path.join(cwd, '.claude', 'settings.json');
  const optOutDirs = [TopiaDirWrite, TopiaDirRead, path.join(home, '.claude', 'topia')];

  const globalStale = autofix.staleTargetsIn(globalSettings);
  const projectStale =
    projectSettings === globalSettings ? [] : autofix.staleTargetsIn(projectSettings);
  if (globalStale.length === 0 && projectStale.length === 0) return;

  // Auto-repair the GLOBAL file only (the documented rot-on-upgrade case).
  // Project scope is left to a warn — auto-editing a repo's settings.json is
  // higher surprise and may be intentionally divergent.
  if (globalStale.length > 0 && !autofix.repairOptedOut(optOutDirs)) {
    const preset = autofix.detectPreset(autofix.readSettings(globalSettings)) || 'gentle';
    const res = autofix.runGlobalSetup(preset);
    if (res.ok && autofix.staleTargetsIn(globalSettings).length === 0) {
      console.log('');
      console.log('  ✓ topia: auto-repaired stale global hooks → stable launcher');
      console.log(
        '      Backup saved beside ~/.claude/settings.json · disable via TOPIA_NO_AUTOREPAIR=1',
      );
      if (projectStale.length === 0) return;
    }
  }

  // Warn fallback: opted out, repair failed, or project-scope stale.
  const example = globalStale[0] || projectStale[0];
  console.log('');
  console.log('  ⚠ topia: some hooks point at a plugin path that no longer exists');
  console.log(`      (e.g. ${example})`);
  console.log('      This usually means the plugin was upgraded. Repair with:');
  console.log('        /topia finalize     (rewrites hooks to a version-stable launcher)');
}

function refreshOutdatedLauncher() {
  const home = os.homedir();
  const globalLauncher = path.join(home, '.claude', 'topia', 'hook-dispatch.cjs');
  const projectLauncher = path.join(cwd, '.claude', 'topia', 'hook-dispatch.cjs');
  const optOutDirs = [TopiaDirWrite, TopiaDirRead, path.join(home, '.claude', 'topia')];
  if (!autofix.repairOptedOut(optOutDirs) && autofix.refreshLauncher(globalLauncher)) {
    console.log('');
    console.log('  ✓ topia: updated the hook launcher (~/.claude/topia/hook-dispatch.cjs)');
    console.log('      disable via TOPIA_NO_AUTOREPAIR=1');
  }
  if (projectLauncher === globalLauncher || !autofix.outdatedLauncher(projectLauncher)) return;
  console.log('');
  console.log("  ⚠ topia: this project's hook launcher (.claude/topia/hook-dispatch.cjs) is outdated");
  console.log('      Update it with:  topia setup --here');
}

// Opt-in (TOPIA_AUTO_FINALIZE=1 or a `.auto-finalize` flag): wire the managed
// hook set into the GLOBAL settings.json for a never-finalized machine. Purely
// additive (preserves user hooks), backed up, idempotent. Fail-open — any
// problem falls through to the normal first-run nudge.
function detectAutoFinalize() {
  const home = os.homedir();
  const globalSettings = path.join(home, '.claude', 'settings.json');
  const optOutDirs = [TopiaDirWrite, TopiaDirRead, path.join(home, '.claude', 'topia')];

  const finalized =
    fs.existsSync(path.join(TopiaDirRead, '.finalized')) ||
    fs.existsSync(path.join(TopiaDirWrite, '.finalized'));
  if (finalized) return;
  if (autofix.hasManagedHooks(autofix.readSettings(globalSettings))) return;
  if (!autofix.autoFinalizeEnabled(optOutDirs)) return;

  const res = autofix.runGlobalSetup('gentle');
  if (!res.ok || !autofix.hasManagedHooks(autofix.readSettings(globalSettings))) return;

  try {
    fs.mkdirSync(TopiaDirWrite, { recursive: true });
    fs.writeFileSync(
      path.join(TopiaDirWrite, '.finalized'),
      `auto-finalized: ${new Date().toISOString()}\n`,
    );
  } catch {
    /* non-critical */
  }
  console.log('');
  console.log('  ✓ topia: wired discipline hooks for this machine (first run)');
  console.log('      Global ~/.claude/settings.json updated · backup saved alongside it');
  console.log('      Disable auto-finalize with TOPIA_NO_AUTOFINALIZE=1 (or unset TOPIA_AUTO_FINALIZE)');
}

// Project state. Each .topia/ file is capped (newest entries + a byte cap) so
// a long-lived project does not flood the context; topia:recall reads the rest.
function injectTopiaState() {
  const hasTopiaState = fs.existsSync(TopiaDirRead) || fs.existsSync(TopiaDirWrite);
  if (!hasTopiaState) {
    console.log('[topia: No .topia/ directory found. Run /topia onboard to set up project context.]');
    return;
  }
  const TopiaDir = TopiaDirRead;
  // tail = newest `## ` entries (append-only logs); head = reference docs.
  const stateFiles = [
    ['progress.md', 'tail'],
    ['decisions.md', 'tail'],
    ['conventions.md', 'tail'],
    ['RESCUE-STATE.md', 'head'],
    ['DEVELOPER-GUIDE.md', 'head'],
    ['logic-manifest.json', 'head'],
  ];
  const loaded = [];
  let budget = memory.TOTAL_BYTES;
  let trimmed = false;

  for (const [file, mode] of stateFiles) {
    try {
      const content = memory.readText(path.join(TopiaDir, file));
      if (!content) continue;
      if (budget <= 0) {
        trimmed = true;
        continue;
      }
      const cap = Math.min(memory.FILE_BYTES, budget);
      const part =
        mode === 'tail' ? memory.tailEntries(content, memory.TAIL_ENTRIES, cap) : memory.headBytes(content, cap);
      if (!part.text) continue;
      budget -= Buffer.byteLength(part.text, 'utf-8');
      if (part.cut) trimmed = true;
      console.log(`\n=== .topia/${file}${part.cut ? ' (newest part)' : ''} ===\n${part.text}`);
      loaded.push(file);
    } catch {
      /* unreadable file — skip silently */
    }
  }

  try {
    const learnings = memory.learningsTail(path.join(TopiaDir, 'learnings.jsonl'));
    if (learnings.lines.length > 0) {
      console.log(`\n=== .topia/learnings.jsonl (last ${learnings.lines.length} of ${learnings.total}) ===`);
      for (const line of learnings.lines) console.log(`- ${line}`);
      if (learnings.total > learnings.lines.length) trimmed = true;
      loaded.push('learnings.jsonl');
    }
  } catch {
    /* non-critical */
  }

  if (trimmed) {
    console.log('[topia: older entries are not shown. Use topia:recall or Grep .topia/ for the rest.]');
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
}

try {
  injectTopiaState();
} catch {
  /* non-critical */
}

// Optional agora-code context — only when it is registered AND on PATH.
try {
  if (isAgoraMemoryRegistered(cwd) && agoraCodeOnPath()) {
    const agoraCtx = execFileSync('agora-code', ['inject', '--quiet'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    if (agoraCtx) {
      console.log(`\n=== agora-code session context ===\n${memory.headBytes(agoraCtx, memory.FILE_BYTES).text}`);
    }
  }
} catch { /* non-critical */ }

// Memory block — names only the sources found on disk. MCP backends are named
// only when their registration is found in an MCP config file.
try {
  const lines = memory.memoryBlock({ root: cwd, home: os.homedir(), topiaDir: TopiaDirRead });
  if (lines.length > 0) {
    console.log('');
    for (const line of lines) console.log(line);
  }
} catch { /* non-critical */ }

const sessionText = hookLines.join('\n').trim();
if (isCursorRuntime()) {
  writeHookResponse(sessionText ? { additional_context: sessionText } : {});
} else {
  for (const line of hookLines) origLog(line);
}
