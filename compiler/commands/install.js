/**
 * `topia install` — one-shot end-to-end installer.
 *
 * Replaces the manual 5-step process (clone → npm install → claude plugin add
 * → setup --global → doctor) with a single command. Pre-flights rune-kit so
 * users don't end up with both plugins fighting over skill names.
 *
 * Steps (in order):
 *   0. Pre-flight: rune-kit conflict check. If detected, present options
 *      (migrate / abort / skip-with-warning) and act on the choice.
 *   1. claude plugin marketplace add + install — register via Protopia marketplace (fallback: plugin add .)
 *   2. setup --global --preset gentle — wire discipline hooks globally
 *   3. agora-code MCP — detect Python 3.10+, pip install, register in .mcp.json
 *   4. doctor — verify nexus integrity
 *   5. Print "restart Claude Code" + edit `.topia/org/org.md` hints
 *
 * Flags:
 *   --yes              non-interactive (auto-accept defaults, skip rune-kit migration)
 *   --skip-agora       don't attempt to install the agora-code MCP
 *   --skip-rune-check  don't check for rune-kit (for CI)
 *   --here             install hooks per-project instead of --global
 *   --preset <name>    gentle | strict | off (default: gentle)
 *   --dry-run          preview only; no changes
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { migrateFromRune, planMigration as planRuneMigration } from './migrate-from-rune.js';
import { resolveTopiaRoot } from './hooks/resolve-topia-root.js';
import { runSetup } from './setup.js';

/** Claude Code marketplace id (`.claude-plugin/marketplace.json` → `name`). */
const MARKETPLACE_ID = 'protopia';
/** Plugin entry id inside the marketplace catalog. */
const MARKETPLACE_PLUGIN = 'skill-topia';

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function which(cmd) {
  // Cross-platform binary detection. Returns absolute path or null.
  const winCmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(winCmd, [cmd], { encoding: 'utf-8' });
  if (result.status === 0 && result.stdout) {
    return result.stdout.split(/\r?\n/)[0].trim() || null;
  }
  return null;
}

function detectPython() {
  // Tries python3, python, py -3 in order. Returns { cmd, args, version } or null.
  const candidates = [
    { cmd: 'python3', args: ['--version'] },
    { cmd: 'python', args: ['--version'] },
    { cmd: 'py', args: ['-3', '--version'] },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, c.args, { encoding: 'utf-8' });
    if (r.status === 0) {
      const out = `${r.stdout}${r.stderr}`.trim();
      const match = out.match(/Python\s+(\d+\.\d+\.\d+)/i);
      if (!match) continue;
      const [major, minor] = match[1].split('.').map(Number);
      if (major === 3 && minor >= 10) {
        return { cmd: c.cmd, args: c.args.slice(0, -1), version: match[1] };
      }
    }
  }
  return null;
}

function detectPip(pythonCmd) {
  // Returns the command parts to invoke pip for the given python.
  // Falls back to `<python> -m pip` if `pip` isn't on PATH.
  if (which('pip3')) return { cmd: 'pip3', prefix: [] };
  if (which('pip')) return { cmd: 'pip', prefix: [] };
  if (pythonCmd) return { cmd: pythonCmd.cmd, prefix: ['-m', 'pip'] };
  return null;
}

function header(line) {
  console.log(`\n  ${line}`);
  console.log(`  ${'─'.repeat(Math.min(line.length, 60))}`);
}

function step(icon, msg) {
  console.log(`    ${icon} ${msg}`);
}

async function preflightRune({ cwd, autoYes, skipRuneCheck }) {
  if (skipRuneCheck) {
    step('—', 'rune-kit check skipped (--skip-rune-check)');
    return { proceeded: true };
  }

  const plan = planRuneMigration(cwd, os.homedir());
  const { runeState, runeKit, flags } = plan;

  if (!runeState.present && !runeKit.present) {
    step('✓', 'No rune-kit or .rune/ detected.');
    return { proceeded: true };
  }
  if (flags.migrated) {
    step('✓', 'rune-kit already migrated (flag file present).');
    return { proceeded: true };
  }
  if (flags.skipped) {
    step('!', 'rune-kit migration was previously skipped — proceeding anyway.');
    return { proceeded: true };
  }

  console.log('');
  console.log('  ⚠ rune-kit conflict detected');
  if (runeKit.present) console.log(`    plugin: ${runeKit.path}`);
  if (runeState.present) console.log(`    state : ${runeState.dir}`);
  console.log('');
  console.log('    Topia and rune-kit share ~30 skill names (build, plan, scout, graft, …).');
  console.log('    With both active, the router picks one non-deterministically.');
  console.log('    Recommended: migrate `.rune/` state into `.topia/` and disable rune-kit.');
  console.log('');
  console.log('    Options:');
  console.log('      [m] migrate now (copies .rune/ → .topia/, renames rune-kit cache)');
  console.log('      [a] abort install (remove rune-kit manually, then re-run)');
  console.log('      [s] skip — proceed anyway (you will see routing surprises)');
  console.log('');

  if (autoYes) {
    step('→', 'Auto-mode (--yes): aborting so you can decide on rune-kit explicitly.');
    return { proceeded: false, reason: 'rune-kit detected; re-run with explicit migration' };
  }
  const choice = await prompt('    Choose [m/a/s]: ');

  if (choice === 'a' || choice === 'abort') {
    return { proceeded: false, reason: 'aborted by user; remove rune-kit and re-run' };
  }
  if (choice === 's' || choice === 'skip') {
    step('!', 'Proceeding with rune-kit active — expect non-deterministic routing.');
    return { proceeded: true };
  }
  if (choice === 'm' || choice === 'migrate' || choice === '') {
    console.log('');
    const result = await migrateFromRune({ cwd, autoYes: true, homeDir: os.homedir() });
    if (result.status === 'migrated' || result.status === 'no-op') {
      step('✓', 'rune migration complete.');
      return { proceeded: true };
    }
    return { proceeded: false, reason: `rune migration returned status: ${result.status}` };
  }
  return { proceeded: false, reason: 'unrecognised choice; re-run install' };
}

function hasMarketplaceCatalog(TopiaRoot) {
  return existsSync(path.join(TopiaRoot, '.claude-plugin', 'marketplace.json'));
}

function registerPlugin({ TopiaRoot, dryRun }) {
  if (!which('claude')) {
    step('!', 'claude CLI not on PATH — skipping plugin registration.');
    step(' ', `Install Claude Code, then:  /plugin marketplace add protopia/skill-topia`);
    step(' ', `              then:  /plugin install ${MARKETPLACE_PLUGIN}@${MARKETPLACE_ID}`);
    return { ok: false, skipped: true };
  }

  const useMarketplace = hasMarketplaceCatalog(TopiaRoot);
  const installSpec = `${MARKETPLACE_PLUGIN}@${MARKETPLACE_ID}`;

  if (dryRun) {
    if (useMarketplace) {
      step('·', `[dry-run] would: claude plugin marketplace add ${TopiaRoot}`);
      step('·', `[dry-run] would: claude plugin install ${installSpec}`);
    } else {
      step('·', `[dry-run] would: claude plugin add ${TopiaRoot}`);
    }
    return { ok: true, dryRun: true };
  }

  if (useMarketplace) {
    try {
      execFileSync('claude', ['plugin', 'marketplace', 'add', TopiaRoot], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      execFileSync('claude', ['plugin', 'install', installSpec], { stdio: ['pipe', 'pipe', 'pipe'] });
      step('✓', `Plugin installed via marketplace (${installSpec}).`);
      return { ok: true, via: 'marketplace' };
    } catch (err) {
      step('!', `Marketplace install failed: ${err.message.split('\n')[0]}`);
      step(' ', 'Falling back to local plugin registration…');
    }
  }

  try {
    execFileSync('claude', ['plugin', 'add', TopiaRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
    step('✓', 'Plugin registered with Claude Code (local path).');
    return { ok: true, via: 'plugin-add' };
  } catch (err) {
    step('!', `claude plugin add failed: ${err.message.split('\n')[0]}`);
    step(' ', `Manual: /plugin marketplace add protopia/skill-topia`);
    step(' ', `        /plugin install ${installSpec}`);
    return { ok: false, error: err };
  }
}

async function wireHooks({ projectRoot, TopiaRoot, args, dryRun, here, preset }) {
  if (dryRun) {
    step('·', `[dry-run] would: setup ${here ? '--here' : '--global'} --preset ${preset}`);
    return { ok: true, dryRun: true };
  }
  const result = await runSetup({
    projectRoot,
    TopiaRoot,
    args: { ...args, global: !here, here, preset },
  });
  if (result.written) {
    step('✓', `Hooks wired (${result.scope}, preset: ${result.preset}).`);
    return { ok: true, result };
  }
  step('!', 'Hooks setup did not write — check the message above.');
  return { ok: false, result };
}

function installAgoraCode({ TopiaRoot, projectRoot, dryRun }) {
  const py = detectPython();
  if (!py) {
    step('—', 'Python 3.10+ not detected — agora-code MCP not installed.');
    step(' ', 'Install Python 3.10+ later if you want persistent memory.');
    return { ok: false, reason: 'no-python' };
  }
  const pip = detectPip(py);
  if (!pip) {
    step('—', `pip not available alongside ${py.cmd} — agora-code MCP not installed.`);
    return { ok: false, reason: 'no-pip' };
  }
  const agoraDir = path.join(TopiaRoot, 'mcp-servers', 'agora-code');
  if (!existsSync(agoraDir)) {
    step('!', `agora-code source not found at ${agoraDir}`);
    return { ok: false, reason: 'no-source' };
  }
  if (dryRun) {
    step('·', `[dry-run] would: ${pip.cmd} ${[...pip.prefix, 'install', agoraDir].join(' ')}`);
    step('·', '[dry-run] would: register agora-memory in .mcp.json');
    return { ok: true, dryRun: true };
  }

  try {
    execFileSync(pip.cmd, [...pip.prefix, 'install', agoraDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    step('✓', `agora-code installed via ${pip.cmd} (Python ${py.version}).`);
  } catch (err) {
    step('!', `pip install failed: ${err.message.split('\n')[0]}`);
    step(' ', `Manual: ${pip.cmd} ${[...pip.prefix, 'install', agoraDir].join(' ')}`);
    return { ok: false, error: err };
  }

  // Register in project-local .mcp.json (additive — preserves existing entries)
  const mcpPath = path.join(projectRoot, '.mcp.json');
  let mcp = { mcpServers: {} };
  if (existsSync(mcpPath)) {
    try {
      mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      if (!mcp.mcpServers) mcp.mcpServers = {};
    } catch {
      step('!', `${mcpPath} exists but is not valid JSON — leaving it alone.`);
      step(' ', 'Add agora-memory manually after fixing.');
      return { ok: true, mcpRegistered: false };
    }
  }
  if (mcp.mcpServers['agora-memory']) {
    step('—', 'agora-memory already in .mcp.json — no change.');
  } else {
    mcp.mcpServers['agora-memory'] = {
      command: 'agora-code',
      args: ['memory-server'],
    };
    writeFileSync(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`, 'utf-8');
    step('✓', 'agora-memory registered in .mcp.json.');
  }
  return { ok: true, mcpRegistered: true };
}

function runDoctorBriefly({ TopiaRoot, dryRun }) {
  if (dryRun) {
    step('·', '[dry-run] would: topia doctor');
    return { ok: true, dryRun: true };
  }
  try {
    const doctorPath = path.join(TopiaRoot, 'compiler', 'bin', 'topia.js');
    execFileSync('node', [doctorPath, 'doctor'], { stdio: ['pipe', 'pipe', 'pipe'] });
    step('✓', 'topia doctor — nexus healthy.');
    return { ok: true };
  } catch (err) {
    step('!', `topia doctor reported issues: ${err.message.split('\n')[0]}`);
    return { ok: false, error: err };
  }
}

export async function runInstall({ TopiaRoot, projectRoot = process.cwd(), args = {} } = {}) {
  const dryRun = Boolean(args['dry-run']);
  const autoYes = Boolean(args.yes);
  const skipAgora = Boolean(args['skip-agora']);
  const skipRuneCheck = Boolean(args['skip-rune-check']);
  const here = Boolean(args.here);
  const preset = args.preset || 'gentle';

  console.log('');
  console.log('  ╭───────────────────────────────────────────────╮');
  console.log('  │  Topia install — one-shot setup                │');
  console.log('  ╰───────────────────────────────────────────────╯');
  if (dryRun) console.log('  Mode: DRY-RUN (nothing will be written)');

  header('Step 0 — Pre-flight: rune-kit conflict check');
  const pre = await preflightRune({ cwd: projectRoot, autoYes, skipRuneCheck });
  if (!pre.proceeded) {
    console.log('');
    console.log(`  ✗ Install halted: ${pre.reason}`);
    console.log('');
    return { status: 'aborted', reason: pre.reason };
  }

  header('Step 1 — Register plugin with Claude Code');
  const plugin = registerPlugin({ TopiaRoot, dryRun });

  header('Step 2 — Wire discipline hooks');
  const hooks = await wireHooks({ projectRoot, TopiaRoot, args, dryRun, here, preset });

  let agora = { ok: false, skipped: true };
  if (!skipAgora) {
    header('Step 3 — agora-code MCP (optional persistent memory)');
    agora = installAgoraCode({ TopiaRoot, projectRoot, dryRun });
  } else {
    step('—', 'agora-code skipped (--skip-agora).');
  }

  header('Step 4 — Verify install');
  const doctor = runDoctorBriefly({ TopiaRoot, dryRun });

  // ─── Final summary ───
  console.log('');
  console.log('  ╭───────────────────────────────────────────────╮');
  console.log('  │  Install summary                               │');
  console.log('  ╰───────────────────────────────────────────────╯');
  console.log(`    Plugin registered  : ${plugin.ok ? '✓' : plugin.skipped ? '— (claude CLI missing)' : '✗'}`);
  console.log(`    Hooks wired        : ${hooks.ok ? '✓' : '✗'}`);
  console.log(
    `    agora-code MCP     : ${agora.ok ? '✓' : agora.skipped ? '— (skipped)' : `✗ (${agora.reason || 'failed'})`}`,
  );
  console.log(`    Nexus health       : ${doctor.ok ? '✓' : '✗'}`);

  console.log('');
  const resolvedRoot = resolveTopiaRoot(TopiaRoot);
  const setupCli = resolvedRoot
    ? `node ${JSON.stringify(path.join(resolvedRoot, 'compiler', 'bin', 'topia.js'))}`
    : 'node <path-to-skill-topia>/compiler/bin/topia.js';

  console.log('  Next steps:');
  console.log('    1. Restart Claude Code so it picks up the plugin.');
  if (!hooks.ok) {
    console.log(`    2. Wire dispatch hooks: ${setupCli} setup --global --preset gentle`);
    console.log('       (Do not use npx @protopia/skill-topia unless published to npm.)');
  } else {
    console.log('    2. Run `topia visualize` to explore the Nexus graph in your browser.');
  }
  console.log('    3. Edit `.topia/org/org.md` to define your team / policy / approval flow.');
  console.log('       (guardian + readiness read this at compile time. See docs/ORG-CONFIG.md.)');
  if (!plugin.ok && plugin.skipped) {
    console.log('    3. Install Claude Code, then:');
    console.log('         /plugin marketplace add protopia/skill-topia');
    console.log(`         /plugin install ${MARKETPLACE_PLUGIN}@${MARKETPLACE_ID}`);
    console.log('       See docs/INSTALL-CLAUDE-CODE.md');
  }
  if (!agora.ok && agora.reason === 'no-python') {
    console.log('    3. (Optional) Install Python 3.10+ then run: topia install --yes');
    console.log('       to enable persistent memory via agora-code MCP.');
  }
  console.log('');

  return {
    status: 'completed',
    plugin: plugin.ok,
    hooks: hooks.ok,
    agora: agora.ok,
    doctor: doctor.ok,
  };
}
