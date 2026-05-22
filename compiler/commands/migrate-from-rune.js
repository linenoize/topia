/**
 * migrate-from-rune.js — Pull `.rune/` memories into `.topia/`, optionally
 * disable the rune-kit Claude Code plugin to prevent skill-name conflicts.
 *
 * Usage:
 *   node compiler/bin/topia.js migrate-from-rune              # interactive
 *   node compiler/bin/topia.js migrate-from-rune --dry-run    # preview, no writes
 *   node compiler/bin/topia.js migrate-from-rune --skip       # write skip flag (suppresses warnings) and exit
 *   node compiler/bin/topia.js migrate-from-rune --force      # overwrite existing .topia/ files
 *
 * Behavior:
 *   1. Detect `.rune/` in project cwd. If absent and no rune-kit plugin → exit no-op.
 *   2. Detect rune-kit at ~/.claude/plugins/cache/rune-kit/.
 *   3. Print a plan + warning of what happens if user declines.
 *   4. Ask confirmation. If declined → write `.topia/skip-rune-migration.flag` and exit.
 *   5. Copy `.rune/<file>` → `.topia/<file>` for known state files.
 *   6. Optionally push learnings to agora-code MCP (advisory note — agent calls the MCP).
 *   7. Optionally rename `~/.claude/plugins/cache/rune-kit/` → `rune-kit.disabled`.
 *   8. Write `.topia/migrated-from-rune.flag` recording what was done.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { normalizeTopiaDir, planRuneFileCopies, topiaDirForWrite } from '../lib/topia-paths.js';

const RUNE_STATE_FILES = [
  'decisions.md',
  'conventions.md',
  'progress.md',
  'session-log.md',
  'instincts.md',
  'checkpoint.md',
  'cumulative-notes.md',
  'learnings.jsonl',
  'task-notes.md',
  'invariants.md',
  'INVARIANTS.md',
];

const RUNE_STATE_DIRS = ['adr', 'features', 'metrics'];

const MIGRATED_FLAG = 'migrated-from-rune.flag';
const SKIP_FLAG = 'skip-rune-migration.flag';

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function detectRuneState(cwd) {
  const runeDir = path.join(cwd, '.rune');
  if (!existsSync(runeDir)) {
    return { present: false, files: [], dirs: [] };
  }
  const foundFiles = [];
  for (const name of RUNE_STATE_FILES) {
    const p = path.join(runeDir, name);
    if (existsSync(p) && statSync(p).isFile()) foundFiles.push(name);
  }
  const foundDirs = [];
  for (const name of RUNE_STATE_DIRS) {
    const p = path.join(runeDir, name);
    if (existsSync(p) && statSync(p).isDirectory()) foundDirs.push(name);
  }
  return { present: true, dir: runeDir, files: foundFiles, dirs: foundDirs };
}

function detectRuneKit(homeDir = os.homedir()) {
  const candidates = [
    path.join(homeDir, '.claude', 'plugins', 'cache', 'rune-kit'),
    path.join(homeDir, '.claude', 'plugins', 'rune-kit'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isDirectory()) {
      return { present: true, path: c };
    }
  }
  return { present: false };
}

function copyRecursive(srcDir, destDir, force) {
  const copied = [];
  const skipped = [];
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      const sub = copyRecursive(src, dest, force);
      copied.push(...sub.copied);
      skipped.push(...sub.skipped);
    } else if (entry.isFile()) {
      if (existsSync(dest) && !force) {
        skipped.push(dest);
      } else {
        copyFileSync(src, dest);
        copied.push(dest);
      }
    }
  }
  return { copied, skipped };
}

function writeFlag(topiaDir, name, payload) {
  if (!existsSync(topiaDir)) mkdirSync(topiaDir, { recursive: true });
  const flagPath = path.join(topiaDir, name);
  writeFileSync(flagPath, `${payload}\n`, 'utf-8');
  return flagPath;
}

function checkExistingFlags(topiaDir) {
  if (!existsSync(topiaDir)) return { migrated: false, skipped: false };
  return {
    migrated: existsSync(path.join(topiaDir, MIGRATED_FLAG)),
    skipped: existsSync(path.join(topiaDir, SKIP_FLAG)),
  };
}

function planMigration(cwd, homeDir) {
  const runeState = detectRuneState(cwd);
  const runeKit = detectRuneKit(homeDir);
  const topiaDir = topiaDirForWrite(cwd);
  const flags = checkExistingFlags(topiaDir);
  const fileCopies = runeState.present ? planRuneFileCopies(runeState.files) : [];
  return { cwd, topiaDir, runeState, runeKit, flags, fileCopies };
}

function printPlan(plan, opts) {
  const { runeState, runeKit, flags } = plan;
  const lines = [];
  lines.push('');
  lines.push('  Topia Rune Migration');
  lines.push('  ────────────────────');

  if (flags.migrated) {
    lines.push('  ⚠ Already migrated (.topia/migrated-from-rune.flag exists).');
  }
  if (flags.skipped) {
    lines.push('  ⚠ Migration previously skipped (.topia/skip-rune-migration.flag exists).');
  }

  lines.push('');
  if (runeState.present) {
    lines.push(`  .rune/ detected at ${runeState.dir}`);
    if (plan.fileCopies?.length) {
      const copyDesc = plan.fileCopies.map(({ src, dest }) =>
        src === dest ? src : `${src} → ${dest}`,
      );
      lines.push(`    files to copy: ${copyDesc.join(', ')}`);
    } else if (runeState.files.length) {
      lines.push(`    files to copy: ${runeState.files.join(', ')}`);
    }
    if (runeState.dirs.length) {
      lines.push(`    dirs to copy : ${runeState.dirs.join('/, ')}/`);
    }
    if (!runeState.files.length && !runeState.dirs.length) {
      lines.push('    (directory exists but contains no recognised state files)');
    }
  } else {
    lines.push('  .rune/ — not detected in this project.');
  }

  lines.push('');
  if (runeKit.present) {
    lines.push(`  rune-kit plugin detected at ${runeKit.path}`);
    lines.push('    Action: rename to "rune-kit.disabled" so Claude Code stops loading it.');
  } else {
    lines.push('  rune-kit plugin — not detected.');
  }

  lines.push('');
  lines.push('  Why this matters:');
  lines.push('    If rune-kit stays active alongside Topia, both plugins expose');
  lines.push('    overlapping skill names (build, plan, scout, graft, etc.).');
  lines.push('    The router picks one non-deterministically — silently broken routing.');
  lines.push('    Migrating .rune/ also preserves your prior decisions and notes.');
  lines.push('');
  if (opts.dryRun) {
    lines.push('  Mode: DRY-RUN (nothing will be written or moved).');
  }
  console.log(lines.join('\n'));
}

export async function migrateFromRune({
  cwd = process.cwd(),
  dryRun = false,
  force = false,
  skip = false,
  autoYes = false,
  homeDir,
} = {}) {
  if (!dryRun) {
    const pathNorm = normalizeTopiaDir(cwd);
    if (pathNorm.changed && pathNorm.actions.length > 0) {
      console.log(`  ℹ Normalized Topia paths: ${pathNorm.actions.join('; ')}`);
    }
  }

  const plan = planMigration(cwd, homeDir);
  const { topiaDir, runeState, runeKit, fileCopies } = plan;

  // --skip path: write flag and exit
  if (skip) {
    writeFlag(topiaDir, SKIP_FLAG, `Skipped on ${new Date().toISOString()}\n`);
    console.log('\n  ✓ Skip flag written. Topia session-start will stop prompting about rune migration.');
    console.log(`    File: ${path.join(topiaDir, SKIP_FLAG)}`);
    return { status: 'skipped' };
  }

  // No-op if nothing to do
  if (!runeState.present && !runeKit.present) {
    console.log('\n  ✓ No rune-kit or .rune/ detected. Nothing to migrate.');
    return { status: 'no-op' };
  }

  printPlan(plan, { dryRun });

  if (dryRun) {
    return { status: 'dry-run', plan };
  }

  // Confirmation (unless auto-yes / non-interactive)
  if (!autoYes) {
    const answer = await prompt('  Proceed? [y/N/skip] ');
    if (answer === 'skip') {
      writeFlag(topiaDir, SKIP_FLAG, `Skipped on ${new Date().toISOString()}\n`);
      console.log('  ✓ Skip flag written. Suppressing future warnings.');
      return { status: 'skipped' };
    }
    if (answer !== 'y' && answer !== 'yes') {
      console.log('  Aborted. No changes made.');
      console.log('  (Run again with --skip to suppress future session-start warnings.)');
      return { status: 'aborted' };
    }
  }

  const result = { status: 'migrated', stateCopied: { copied: [], skipped: [] }, pluginDisabled: false };

  // 1. State migration
  if (runeState.present) {
    if (!existsSync(topiaDir)) mkdirSync(topiaDir, { recursive: true });

    for (const { src: srcName, dest: destName } of fileCopies) {
      const src = path.join(runeState.dir, srcName);
      const dest = path.join(topiaDir, destName);
      if (existsSync(dest) && !force) {
        result.stateCopied.skipped.push(dest);
        console.log(`  ⚠ skip (exists): .topia/${destName}`);
      } else {
        copyFileSync(src, dest);
        result.stateCopied.copied.push(dest);
        const label =
          srcName === destName
            ? `.rune/${srcName} → .topia/${destName}`
            : `.rune/${srcName} → .topia/${destName}`;
        console.log(`  ✓ copied ${label}`);
      }
    }

    for (const dir of runeState.dirs) {
      const src = path.join(runeState.dir, dir);
      const dest = path.join(topiaDir, dir);
      const sub = copyRecursive(src, dest, force);
      result.stateCopied.copied.push(...sub.copied);
      result.stateCopied.skipped.push(...sub.skipped);
      console.log(`  ✓ copied .rune/${dir}/ → .topia/${dir}/ (${sub.copied.length} files)`);
      if (sub.skipped.length) {
        console.log(`    (${sub.skipped.length} skipped — already exist in .topia/${dir}/; use --force to overwrite)`);
      }
    }
  }

  // 2. Disable rune-kit plugin (rename cache dir)
  if (runeKit.present) {
    try {
      const disabledPath = `${runeKit.path}.disabled`;
      renameSync(runeKit.path, disabledPath);
      result.pluginDisabled = true;
      result.pluginDisabledPath = disabledPath;
      console.log(`  ✓ rune-kit cache renamed → ${disabledPath}`);
      console.log('    (restart Claude Code to fully unload it)');
    } catch (err) {
      console.log(`  ✗ Could not rename rune-kit cache: ${err.message}`);
      console.log('    Try manually: mv ~/.claude/plugins/cache/rune-kit ~/.claude/plugins/cache/rune-kit.disabled');
    }
  }

  // 3. Note for agora-code
  if (result.stateCopied.copied.some((p) => p.endsWith('learnings.jsonl') || p.includes(`${path.sep}adr${path.sep}`))) {
    console.log('');
    console.log('  ℹ The next Claude Code session will see the imported state in .topia/.');
    console.log('    If the agora-code MCP is registered, ask Claude to push the new ADRs/learnings');
    console.log('    into agora-code via `store_learning` calls (one per ADR / non-trivial learning).');
  }

  // 4. Write completion flag
  const completionPayload = JSON.stringify(
    {
      migratedAt: new Date().toISOString(),
      stateFiles: result.stateCopied.copied.map((p) => path.relative(topiaDir, p)),
      skippedFiles: result.stateCopied.skipped.map((p) => path.relative(topiaDir, p)),
      pluginDisabled: result.pluginDisabled,
      pluginDisabledPath: result.pluginDisabledPath || null,
    },
    null,
    2,
  );
  writeFlag(topiaDir, MIGRATED_FLAG, completionPayload);
  console.log(`\n  ✓ Migration complete. Marker: ${path.join(topiaDir, MIGRATED_FLAG)}`);

  return result;
}

// Export for tests
export {
  detectRuneKit,
  detectRuneState,
  MIGRATED_FLAG,
  planMigration,
  planRuneFileCopies,
  RUNE_STATE_DIRS,
  RUNE_STATE_FILES,
  SKIP_FLAG,
};
