#!/usr/bin/env node

/**
 * bin/topia.js — Topia CLI entry point.
 *
 * Dispatch table (top-level `topia <cmd>`):
 *   install            one-shot setup: rune-check → plugin add → hooks → agora-code → doctor
 *   setup              hooks-only wizard (scope + preset)
 *   init               compile skills for non-Claude IDE
 *   build              recompile using existing topia.config.json
 *   doctor             validate output + nexus integrity (--nexus, --hooks, --strict)
 *   status             neofetch-style dashboard
 *   visualize          open skill-graph in browser
 *   analytics          usage analytics
 *   hooks <sub>        install / uninstall / status — runtime hook lifecycle
 *   migrate-from-rune  pull .rune/ → .topia/, disable rune-kit plugin
 *   migrate-v1         rewrite v1 skill names in .topia/ state files
 *
 * Argument parsing: `parseArgs(argv)` splits flags. All commands accept
 * `--platform`, `--output`, `--disable`. Command-specific flags live in the
 * `case` block.
 *
 * Side effects: writes to disk per the chosen command. Read-only commands:
 * doctor, status, visualize, analytics. All others mutate.
 *
 * Exit codes: 0 success, 1 fatal error caught in main().catch().
 *
 * TOPIA_ROOT is computed once from __dirname; downstream code receives it
 * as an explicit argument — never re-derived deeper in the call stack.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { getAdapter, listPlatforms } from '../adapters/index.js';
import { getAllAnalytics } from '../analytics.js';
import { dispatchHook } from '../commands/hook-dispatch.js';
import { checkHookDrift, formatHookDriftResult } from '../commands/hooks/drift.js';
import { installHooks } from '../commands/hooks/install.js';
import { hookStatus } from '../commands/hooks/status.js';
import { uninstallHooks } from '../commands/hooks/uninstall.js';
import { runInstall } from '../commands/install.js';
import { migrateFromRune } from '../commands/migrate-from-rune.js';
import { migrateFromV1 } from '../commands/migrate-v1.js';
import { formatSetupResult, runSetup } from '../commands/setup.js';
import { generateDashboardHTML } from '../dashboard.js';
import { checkNexusIntegrity, formatDoctorResults, formatNexusResults, runDoctor } from '../doctor.js';
import { buildAll } from '../emitter.js';
import { collectStats, detectMemoryHealth, renderStatus, renderStatusJson } from '../status.js';
import { collectGraphData, generateNexusHTML } from '../visualizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOPIA_ROOT = path.resolve(__dirname, '../..');

const CONFIG_FILE = 'topia.config.json';

// ─── Helpers ───

function log(msg) {
  console.log(msg);
}
function logStep(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

async function readConfig(projectRoot) {
  const configPath = path.join(projectRoot, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  return JSON.parse(await readFile(configPath, 'utf-8'));
}

async function writeConfig(projectRoot, config) {
  const configPath = path.join(projectRoot, CONFIG_FILE);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function detectPlatform(projectRoot) {
  if (existsSync(path.join(projectRoot, '.claude-plugin'))) return 'claude';
  if (existsSync(path.join(projectRoot, '.cursor'))) return 'cursor';
  if (existsSync(path.join(projectRoot, '.windsurf'))) return 'windsurf';
  if (existsSync(path.join(projectRoot, '.agents'))) return 'antigravity';
  if (existsSync(path.join(projectRoot, '.openclaw'))) return 'openclaw';
  if (existsSync(path.join(projectRoot, '.codex'))) return 'codex';
  if (existsSync(path.join(projectRoot, '.opencode'))) return 'opencode';
  return null;
}

async function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Command handlers ───
// Each cmd<X> is a top-level CLI subcommand. Contract:
//   - Side effects allowed; document them in the handler's header comment.
//   - Print user-visible status via log() / logStep(). Throw to exit non-zero.
//   - Receive (projectRoot, args). projectRoot = process.cwd(). args = parsed flags.
//   - Do not re-derive TOPIA_ROOT; pass the module-level constant down.

/**
 * cmdInit — for non-Claude IDEs: detect platform → write topia.config.json
 * → compile all skills into the platform's rule directory.
 * No-op for Claude (native plugin loads source directly).
 * Side effects: writes topia.config.json + <outputDir>/*
 */
async function cmdInit(projectRoot, args) {
  log('');
  log('  ╭─────────╮');
  log('  │  Topia  │');
  log('  ╰─────────╯');
  log('');

  // Platform detection / selection
  let platform = args.platform || detectPlatform(projectRoot);

  if (platform) {
    logStep('→', `Detected: ${platform}`);
  } else {
    log(`  Available platforms: ${listPlatforms().join(', ')}`);
    const answer = await prompt('  ? Select platform: ');
    platform = answer.toLowerCase();
    if (!listPlatforms().includes(platform)) {
      platform = 'generic';
      logStep('→', `Unknown platform, using generic adapter`);
    }
  }

  if (platform === 'claude') {
    logStep('✓', 'Claude Code detected — Topia works as a native plugin. No compilation needed.');
    log('');
    return;
  }

  // Extension pack selection
  const extensions = args.extensions ? args.extensions.split(',') : null; // null = all

  // Build config
  const config = {
    $schema: 'https://protopia.github.io/skill-topia/config-schema.json',
    version: 1,
    platform,
    source: '@protopia/skill-topia',
    skills: {
      disabled: args.disable ? args.disable.split(',') : [],
    },
    extensions: {
      enabled: extensions,
    },
    output: {
      index: true,
    },
  };

  await writeConfig(projectRoot, config);
  logStep('✓', 'Created topia.config.json');

  // Auto-build
  const adapter = getAdapter(platform);
  const stats = await buildAll({
    topiaRoot: TOPIA_ROOT,
    outputRoot: projectRoot,
    adapter,
    disabledSkills: config.skills.disabled,
    enabledPacks: config.extensions.enabled,
  });

  logStep('✓', `Built ${stats.skillCount} skills + ${stats.packCount} extensions to ${adapter.outputDir}/`);

  if (stats.errors.length > 0) {
    for (const err of stats.errors) {
      logStep('✗', `Error: ${err.file} — ${err.error}`);
    }
  }

  log('');
  log('  Next steps:');
  log('    1. /topia onboard       Generate project context (CLAUDE.md + .topia/)');
  log('    2. /topia build "..."    Build a feature (full TDD cycle)');
  log('    3. /topia help          See all skills');
  log('');
}

/**
 * cmdBuild — recompile skills using the existing topia.config.json.
 * Requires `topia init` to have run first (or `--platform <name>`).
 * No-op for Claude. Side effects: overwrites <adapter.outputDir>/*.
 */
async function cmdBuild(projectRoot, args) {
  const config = await readConfig(projectRoot);

  const platform = args.platform || config?.platform;
  if (!platform) {
    log('  ✗ No platform configured. Run `Topia init` first.');
    process.exit(1);
  }

  if (platform === 'claude') {
    log('  Claude Code uses source SKILL.md files directly. No compilation needed.');
    return;
  }

  const adapter = getAdapter(platform);
  const topiaRoot = config?.source === '@protopia/skill-topia' ? TOPIA_ROOT : config?.source || TOPIA_ROOT;
  const outputRoot = typeof args.output === 'string' ? args.output : projectRoot;
  const disabledSkills = config?.skills?.disabled || [];
  const enabledPacks = config?.extensions?.enabled || null;

  log('');
  log(`  [parse]     Discovering skills...`);

  const stats = await buildAll({
    topiaRoot,
    outputRoot,
    adapter,
    disabledSkills,
    enabledPacks,
  });

  log(`  [transform] Platform: ${stats.platform}`);
  log(`  [transform] Resolved ${stats.crossRefsResolved} cross-references`);
  log(`  [transform] Resolved ${stats.toolRefsResolved} tool-name references`);
  log(`  [emit]      ${stats.skillCount} skills + ${stats.packCount} extensions`);

  if (stats.skipped.length > 0) {
    log(`  [skip]      ${stats.skipped.length} disabled: ${stats.skipped.join(', ')}`);
  }

  if (stats.errors.length > 0) {
    for (const err of stats.errors) {
      log(`  [error]     ${err.file}: ${err.error}`);
    }
  }

  log('');
  log(`  ✓ Built ${stats.files.length} files to ${adapter.outputDir}/`);
  log('');
}

/**
 * cmdDoctor — validate install + nexus integrity. Read-only.
 *
 * Mode flags (mutually exclusive, checked in order):
 *   --hooks   hook drift report only (always exit 0; reporter)
 *   --nexus    nexus integrity check only (exit 1 on errors)
 *   (default) full: runDoctor() + nexus check + version-sync-check
 *
 * --strict   treat warnings as errors (CI mode).
 */
async function cmdDoctor(projectRoot, args) {
  const config = await readConfig(projectRoot);

  // --hooks flag: run hook drift report only (reporter, exit 0 always)
  if (args.hooks) {
    log('');
    const driftResult = await checkHookDrift(projectRoot);
    log(formatHookDriftResult(driftResult));
    return;
  }

  const runNexusOnly = args.nexus || args.mesh;
  if (args.mesh && !args.nexus) {
    log('  ⚠ --mesh is deprecated; use --nexus');
  }
  if (runNexusOnly) {
    log('');
    const nexusResults = await checkNexusIntegrity(TOPIA_ROOT);
    log(formatNexusResults(nexusResults));
    if (nexusResults.errors.length > 0) process.exit(1);
    if (args.strict && nexusResults.warnings.length > 0) process.exit(1);
    return;
  }

  if (!config) {
    // No config = CI or fresh clone. Run source-only checks (split packs).
    log('');
    log('  ℹ No topia.config.json found — running source-only checks.');
    const results = await runDoctor({
      outputRoot: projectRoot,
      adapter: getAdapter('claude'),
      config: {},
      topiaRoot: TOPIA_ROOT,
    });
    log(formatDoctorResults(results));

    // Also run nexus check in source-only mode
    log('');
    const meshResults = await checkNexusIntegrity(TOPIA_ROOT);
    log(formatNexusResults(meshResults));

    if (!results.healthy) process.exit(1);
    return;
  }

  const platform = args.platform || config.platform;
  const adapter = getAdapter(platform);
  const topiaRoot = config.source === '@protopia/skill-topia' ? TOPIA_ROOT : config.source || TOPIA_ROOT;

  const results = await runDoctor({
    outputRoot: projectRoot,
    adapter,
    config,
    topiaRoot,
  });

  log(formatDoctorResults(results));

  // Also run nexus check
  log('');
  const meshResults = await checkNexusIntegrity(topiaRoot);
  log(formatNexusResults(meshResults));

  if (!results.healthy) process.exit(1);
}

/**
 * cmdSetup — hooks-only wizard. Asks scope (current/global) + preset
 * (gentle/strict/off). Non-interactive when --here/--global + --preset given.
 * Side effects: writes <scope-root>/.claude/settings.json (and equivalents).
 * Called transitively by `topia install`.
 */
async function cmdSetup(projectRoot, args) {
  log('');
  log('  Topia Setup Wizard');
  log('  ──────────────────');
  log(`  Version:    ${await readVersion()} (cached)`);

  try {
    const result = await runSetup({ projectRoot, topiaRoot: TOPIA_ROOT, args });
    log(formatSetupResult(result));
  } catch (err) {
    log('');
    log(`  ✗ Setup failed: ${err.message}`);
    process.exit(1);
  }
}

async function readVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(TOPIA_ROOT, 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/**
 * cmdStatus — neofetch-style dashboard. Read-only.
 * --json emits machine-readable; default is ANSI box.
 */
async function cmdStatus(projectRoot, args) {
  const config = await readConfig(projectRoot);
  const topiaRoot =
    config?.source === '@protopia/skill-topia'
      ? TOPIA_ROOT
      : config?.source
        ? path.resolve(projectRoot, config.source)
        : TOPIA_ROOT;
  const platform = config?.platform || detectPlatform(projectRoot) || '';

  const pkg = JSON.parse(await readFile(path.join(TOPIA_ROOT, 'package.json'), 'utf-8'));
  const projectName = path.basename(projectRoot);

  const stats = await collectStats(topiaRoot);
  const memoryHealth = detectMemoryHealth(projectRoot);
  const opts = { version: pkg.version, platform, projectName, memoryHealth };

  if (args.json) {
    log(renderStatusJson(stats, opts));
  } else {
    log('');
    log(renderStatus(stats, opts));
    log('');
  }
}

/**
 * cmdVisualize — generate HTML skill-graph and open in browser.
 * Side effect: writes <projectRoot>/.topia/nexus.html (or temp file) and opens it.
 */
async function cmdVisualize(projectRoot, args) {
  const config = await readConfig(projectRoot);
  const topiaRoot =
    config?.source === '@protopia/skill-topia'
      ? TOPIA_ROOT
      : config?.source
        ? path.resolve(projectRoot, config.source)
        : TOPIA_ROOT;

  logStep('◎', 'Collecting nexus data...');
  const graphData = await collectGraphData(topiaRoot);

  logStep(
    '◎',
    `Found ${graphData.stats.nodeCount} nodes, ${graphData.stats.edgeCount} synapses, ${graphData.stats.signalCount} pulses`,
  );

  const html = generateNexusHTML(graphData);

  const topiaDir = path.join(projectRoot, '.topia');
  if (!existsSync(topiaDir)) {
    const { mkdir: mkdirFs } = await import('node:fs/promises');
    await mkdirFs(topiaDir, { recursive: true });
  }

  const outputPath = args.output ? path.resolve(projectRoot, args.output) : path.join(topiaDir, 'nexus.html');

  const { writeFile: writeFileFs } = await import('node:fs/promises');
  await writeFileFs(outputPath, html, 'utf-8');
  logStep('✓', `Nexus visualization written to ${path.relative(projectRoot, outputPath)}`);

  if (args.json) {
    log(JSON.stringify(graphData, null, 2));
  } else {
    // Try to open in browser
    try {
      const { exec } = await import('node:child_process');
      const cmd =
        process.platform === 'win32'
          ? `start "" "${outputPath}"`
          : process.platform === 'darwin'
            ? `open "${outputPath}"`
            : `xdg-open "${outputPath}"`;
      exec(cmd);
    } catch {
      /* ignore if browser open fails */
    }
  }
}

/**
 * cmdAnalytics — usage analytics over the last N days (default 30).
 * Reads `.topia/metrics/*.jsonl`. --json emits raw; default writes
 * a self-contained HTML dashboard via generateDashboardHTML().
 */
async function cmdAnalytics(projectRoot, args) {
  const days = args.days ? parseInt(args.days, 10) : 30;

  logStep('◎', `Querying metrics (${days > 0 ? `${days} days` : 'all time'})...`);
  const data = await getAllAnalytics(projectRoot, days);

  if (args.json) {
    log(JSON.stringify(data, null, 2));
    return;
  }

  logStep('◎', `${data.overview.total_sessions} sessions, ${data.overview.total_skill_invocations} skill invocations`);

  const html = generateDashboardHTML(data);

  const topiaDir = path.join(projectRoot, '.topia');
  if (!existsSync(topiaDir)) {
    const { mkdir: mkdirFs } = await import('node:fs/promises');
    await mkdirFs(topiaDir, { recursive: true });
  }

  const outputPath = args.output ? path.resolve(projectRoot, args.output) : path.join(topiaDir, 'analytics.html');

  const { writeFile: writeFileFs } = await import('node:fs/promises');
  await writeFileFs(outputPath, html, 'utf-8');
  logStep('✓', `Dashboard written to ${path.relative(projectRoot, outputPath)}`);

  // Open in browser
  try {
    const { exec } = await import('node:child_process');
    const cmd =
      process.platform === 'win32'
        ? `start "" "${outputPath}"`
        : process.platform === 'darwin'
          ? `open "${outputPath}"`
          : `xdg-open "${outputPath}"`;
    exec(cmd);
  } catch {
    /* ignore if browser open fails */
  }
}

// ─── Hook Commands ───
// `topia hooks <sub>` — runtime hook lifecycle.
//   install     write Topia hooks to .claude/settings.json (and equivalents)
//   uninstall   remove only Topia-managed entries (signature-matched)
//   status      report which hooks are wired
//
// Hooks are platform-aware: each adapter knows how to translate the canonical
// preset into its native settings format (Claude JSON, Cursor mdc, etc.).
// `--global` operates on ~/.claude/settings.json across all projects.

async function cmdHooks(projectRoot, args, subcommand) {
  if (!subcommand) {
    log('');
    log('  Topia hooks — Auto-discipline entry point for AI IDEs');
    log('');
    log('  Subcommands:');
    log('    install [--preset strict|gentle|off] [--platform <name>|all]');
    log('                                                                   Wire Topia hooks / rules / workflows');
    log(
      '    uninstall [--platform <name>|all]                              Remove Topia-managed entries (keeps user entries)',
    );
    log('    status [--platform <name>|all]                                Show active preset, wired skills');
    log('');
    log('  Platforms: claude, cursor, windsurf, antigravity (auto-detected if omitted)');
    log('');
    log('  Options:');
    log('    --dry    Preview changes without writing');
    log('');
    return;
  }

  switch (subcommand) {
    case 'install': {
      // --global writes to ~/.claude/settings.json (covers every Claude Code session)
      const targetRoot = args.global ? os.homedir() : projectRoot;
      const platform = args.global ? 'claude' : args.platform;
      const result = await installHooks(targetRoot, {
        preset: args.preset,
        dry: args.dry,
        platform,
        topiaRoot: TOPIA_ROOT,
      });
      log('');
      if (result.platforms.length === 0) {
        for (const note of result.notes) logStep('·', note);
        log('');
        break;
      }
      if (result.written) {
        logStep('✓', `Installed preset "${result.preset}" across: ${result.platforms.join(', ')}`);
      } else if (args.dry) {
        logStep('◎', `Dry-run — no changes written (platforms: ${result.platforms.join(', ')})`);
      }
      for (const r of result.results) {
        log('');
        log(`  [${r.platform}]`);
        for (const file of r.files) {
          const rel = path.relative(projectRoot, file.path);
          logStep(file.deleted ? '−' : '→', rel);
        }
        for (const note of r.notes) logStep('·', note);
      }
      log('');
      break;
    }
    case 'uninstall': {
      const result = await uninstallHooks(projectRoot, { dry: args.dry, platform: args.platform });
      log('');
      if (result.platforms.length === 0) {
        for (const note of result.notes) logStep('·', note);
        log('');
        break;
      }
      if (result.written) {
        logStep('✓', `Uninstalled Topia entries across: ${result.platforms.join(', ')}`);
      } else if (args.dry) {
        logStep('◎', `Dry-run — would uninstall across: ${result.platforms.join(', ')}`);
      }
      for (const r of result.results) {
        log('');
        log(`  [${r.platform}]`);
        for (const file of r.files) {
          const rel = path.relative(projectRoot, file.path);
          logStep(file.deleted ? '−' : '→', rel);
        }
        for (const note of r.notes) logStep('·', note);
      }
      log('');
      break;
    }
    case 'status': {
      const result = await hookStatus(projectRoot, TOPIA_ROOT, { platform: args.platform });
      log('');
      if (result.platforms.length === 0) {
        for (const note of result.notes) logStep('·', note);
        log('');
        break;
      }
      for (const r of result.results) {
        log(`  [${r.platform}]${r.capability ? ` (${r.capability.maturity})` : ''}`);
        log(`    installed: ${r.installed ? 'yes' : 'no'}`);
        log(`    preset:    ${r.preset ?? 'none'}`);
        if (r.wired.length > 0) log(`    wired:     ${r.wired.join(', ')}`);
        if (r.missing.length > 0) logStep('⚠', `missing: ${r.missing.join(', ')}`);
        if (r.events) {
          for (const [event, skills] of Object.entries(r.events)) {
            log(`    ${event}: ${skills.join(', ')}`);
          }
        }
        for (const note of r.notes) logStep('·', note);
        log('');
      }
      if (result.missingInRepo.length > 0) {
        logStep('⚠', `Skills referenced by presets but not found in repo: ${result.missingInRepo.join(', ')}`);
        log('');
      }
      break;
    }
    default:
      log(`  ✗ Unknown hooks subcommand: ${subcommand}. Run \`Topia hooks\` for help.`);
      process.exit(1);
  }
}

// ─── Arg Parsing ───

// Flags that require a string value (not boolean)
const VALUE_REQUIRED_FLAGS = new Set(['platform', 'output', 'disable', 'extensions', 'days', 'preset']);

function parseArgs(argv) {
  const args = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else if (VALUE_REQUIRED_FLAGS.has(key)) {
        log(`  ✗ Flag --${key} requires a value. Example: --${key} <value>`);
        process.exit(1);
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0], subcommand: positional[1], args, positional };
}

// ─── Main ───

async function main() {
  const rawArgv = process.argv.slice(2);

  // hook-dispatch bypasses parseArgs so flags like --gentle reach the dispatcher verbatim
  if (rawArgv[0] === 'hook-dispatch') {
    const exitCode = await dispatchHook(rawArgv.slice(1));
    process.exit(exitCode);
  }

  const { command, subcommand, args } = parseArgs(rawArgv);
  const projectRoot = process.cwd();

  // Handle --version / -v as flag (not positional command)
  if (args.version || args.v) {
    const pkg = JSON.parse(await readFile(path.join(TOPIA_ROOT, 'package.json'), 'utf-8'));
    log(`  Topia v${pkg.version}`);
    return;
  }

  switch (command) {
    case 'init':
      await cmdInit(projectRoot, args);
      break;
    case 'build':
      await cmdBuild(projectRoot, args);
      break;
    case 'doctor':
      await cmdDoctor(projectRoot, args);
      break;
    case 'setup':
      await cmdSetup(projectRoot, args);
      break;
    case 'status':
      await cmdStatus(projectRoot, args);
      break;
    case 'visualize':
    case 'viz':
      await cmdVisualize(projectRoot, args);
      break;
    case 'analytics':
    case 'dash':
      await cmdAnalytics(projectRoot, args);
      break;
    case 'hooks':
      await cmdHooks(projectRoot, args, subcommand);
      break;
    case 'migrate-from-rune':
      await migrateFromRune({
        cwd: projectRoot,
        dryRun: Boolean(args['dry-run']),
        force: Boolean(args.force),
        skip: Boolean(args.skip),
        autoYes: Boolean(args.yes),
      });
      break;
    case 'migrate-v1':
      await migrateFromV1({
        cwd: projectRoot,
        dryRun: Boolean(args['dry-run']),
        force: Boolean(args.force),
        autoYes: Boolean(args.yes),
      });
      break;
    case 'install':
      await runInstall({ TopiaRoot: TOPIA_ROOT, projectRoot, args });
      break;
    case 'version':
    case '--version':
    case '-v': {
      const pkg = JSON.parse(await readFile(path.join(TOPIA_ROOT, 'package.json'), 'utf-8'));
      log(`  Topia v${pkg.version}`);
      break;
    }
    case 'help':
    case '--help':
    case undefined:
      log('');
      log('  Topia CLI — Topia Nexus for AI coding assistants');
      log('');
      log('  Commands:');
      log('    setup    Interactive wizard — pick scope, install hooks (recommended for first-time)');
      log('             [--here|--global] [--preset gentle|strict] [--dry]');
      log('    init     Interactive setup for build pipeline (auto-detects platform)');
      log('    build    Compile skills for configured platform');
      log('    doctor   Validate compiled output + nexus integrity');
      log('             --nexus   Nexus integrity only (reciprocals, versions, sections)');
      log('             --mesh    Deprecated alias for --nexus');
      log('             --hooks  Hook drift report — compare installed vs canonical preset (reporter, exit 0)');
      log('             --strict Fail on warnings (for CI)');
      log('    status   Project dashboard (skills, pulses, nexus health, memory)');
      log('    visualize  Interactive nexus graph (opens in browser)');
      log('    migrate-v1   Rewrite v1 skill names in .topia/ state');
      log('               [--dry-run] [--force] [--yes]');
      log('    analytics  Usage analytics dashboard');
      log('    hooks      Install/uninstall/status for multi-platform auto-discipline');
      log(
        '               hooks install [--preset gentle|strict|off] [--platform claude|cursor|windsurf|antigravity|all] [--global]',
      );
      log('               hooks uninstall [--platform <name>|all]');
      log('               hooks status [--platform <name>|all]');
      log('    migrate-from-rune   Pull .rune/ memories into .topia/, disable rune-kit plugin');
      log('               [--dry-run] [--force] [--skip] [--yes]');
      log('');
      log('  Options:');
      log(
        '    --platform <name>   Override platform (cursor, windsurf, antigravity, codex, openclaw, opencode, generic)',
      );
      log('    --output <dir>      Override output directory');
      log('    --disable <skills>  Comma-separated skills to disable');
      log('    --version, -v       Show version');
      log('');
      break;
    default:
      log(`  ✗ Unknown command: ${command}. Run \`topia help\` for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('  ✗ Fatal:', err.message);
  process.exit(1);
});
