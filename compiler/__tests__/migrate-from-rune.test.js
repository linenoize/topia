import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  detectRuneState,
  MIGRATED_FLAG,
  migrateFromRune,
  planMigration,
  SKIP_FLAG,
} from '../commands/migrate-from-rune.js';

function makeRuneProject(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'topia-rune-mig-'));
  if (opts.withRune) {
    const runeDir = join(root, '.rune');
    mkdirSync(runeDir, { recursive: true });
    writeFileSync(join(runeDir, 'decisions.md'), '# Decisions\n- chose Zustand for state\n');
    writeFileSync(join(runeDir, 'conventions.md'), '# Conventions\n- async-first I/O\n');
    writeFileSync(join(runeDir, 'progress.md'), '# Progress\n- onboarded\n');
    writeFileSync(join(runeDir, 'learnings.jsonl'), '{"tag":"auth","text":"magic-link works"}\n');
    mkdirSync(join(runeDir, 'adr'), { recursive: true });
    writeFileSync(join(runeDir, 'adr', 'ADR-0001-stack.md'), '# ADR-0001\nUse Zustand.\n');
  }
  return root;
}

describe('migrate-from-rune', () => {
  let root;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('detectRuneState returns present:false when no .rune/', () => {
    root = makeRuneProject();
    const state = detectRuneState(root);
    assert.strictEqual(state.present, false);
    assert.deepStrictEqual(state.files, []);
  });

  test('detectRuneState finds known state files and dirs', () => {
    root = makeRuneProject({ withRune: true });
    const state = detectRuneState(root);
    assert.strictEqual(state.present, true);
    assert.ok(state.files.includes('decisions.md'));
    assert.ok(state.files.includes('conventions.md'));
    assert.ok(state.files.includes('progress.md'));
    assert.ok(state.files.includes('learnings.jsonl'));
    assert.ok(state.dirs.includes('adr'));
  });

  test('planMigration returns flag-aware state', () => {
    root = makeRuneProject({ withRune: true });
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(join(root, '.topia', SKIP_FLAG), 'skipped\n');
    const plan = planMigration(root);
    assert.strictEqual(plan.flags.skipped, true);
    assert.strictEqual(plan.flags.migrated, false);
  });

  test('--skip writes flag and exits without copying', async () => {
    root = makeRuneProject({ withRune: true });
    const result = await migrateFromRune({ cwd: root, skip: true });
    assert.strictEqual(result.status, 'skipped');
    assert.ok(existsSync(join(root, '.topia', SKIP_FLAG)));
    // State NOT copied
    assert.ok(!existsSync(join(root, '.topia', 'decisions.md')));
  });

  test('no-op when neither .rune/ nor rune-kit detected', async () => {
    root = makeRuneProject();
    // Use the tmpdir as homeDir so rune-kit detection sees nothing
    const result = await migrateFromRune({ cwd: root, autoYes: true, homeDir: root });
    assert.strictEqual(result.status, 'no-op');
  });

  test('--dry-run reports plan but writes nothing', async () => {
    root = makeRuneProject({ withRune: true });
    const result = await migrateFromRune({ cwd: root, dryRun: true, homeDir: root });
    assert.strictEqual(result.status, 'dry-run');
    assert.ok(!existsSync(join(root, '.topia', 'decisions.md')));
    assert.ok(!existsSync(join(root, '.topia', MIGRATED_FLAG)));
  });

  test('--yes migrates state files into .topia/', async () => {
    root = makeRuneProject({ withRune: true });
    const result = await migrateFromRune({ cwd: root, autoYes: true, homeDir: root });
    assert.strictEqual(result.status, 'migrated');
    assert.ok(existsSync(join(root, '.topia', 'decisions.md')));
    assert.ok(existsSync(join(root, '.topia', 'conventions.md')));
    assert.ok(existsSync(join(root, '.topia', 'progress.md')));
    assert.ok(existsSync(join(root, '.topia', 'learnings.jsonl')));
    assert.ok(existsSync(join(root, '.topia', 'adr', 'ADR-0001-stack.md')));

    // Content preserved verbatim
    const decisions = readFileSync(join(root, '.topia', 'decisions.md'), 'utf-8');
    assert.match(decisions, /chose Zustand/);

    // Flag written
    assert.ok(existsSync(join(root, '.topia', MIGRATED_FLAG)));
    const flag = JSON.parse(readFileSync(join(root, '.topia', MIGRATED_FLAG), 'utf-8'));
    assert.ok(Array.isArray(flag.stateFiles));
    assert.ok(flag.stateFiles.length >= 4);
  });

  test('skips files that already exist in .topia/ by default', async () => {
    root = makeRuneProject({ withRune: true });
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'decisions.md'), '# Existing — do not overwrite\n');

    await migrateFromRune({ cwd: root, autoYes: true });

    const decisions = readFileSync(join(root, '.topia', 'decisions.md'), 'utf-8');
    assert.match(decisions, /Existing — do not overwrite/);
    assert.doesNotMatch(decisions, /chose Zustand/);

    // Other files still copied
    assert.ok(existsSync(join(root, '.topia', 'conventions.md')));
  });

  test('--force overwrites existing .topia/ files', async () => {
    root = makeRuneProject({ withRune: true });
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(join(root, '.topia', 'decisions.md'), '# Existing\n');

    await migrateFromRune({ cwd: root, autoYes: true, force: true });

    const decisions = readFileSync(join(root, '.topia', 'decisions.md'), 'utf-8');
    assert.match(decisions, /chose Zustand/);
  });
});
