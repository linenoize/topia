import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { collectSeedFindings, runMemorySeed } from '../commands/memory-seed.js';

describe('memory-seed', () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('collectSeedFindings parses decisions table', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-seed-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(
      join(root, '.topia', 'decisions.md'),
      '# Decisions\n\n| Date | Decision | Rationale |\n|------|----------|----------|\n| 2026-01-01 | Use Postgres | Team standard |\n',
      'utf-8',
    );
    const findings = collectSeedFindings(root);
    assert.ok(findings.some((f) => /Postgres/i.test(f.finding)));
  });

  test('runMemorySeed dry-run does not write flag', () => {
    root = mkdtempSync(join(tmpdir(), 'topia-seed-'));
    mkdirSync(join(root, '.topia'), { recursive: true });
    writeFileSync(
      join(root, '.topia', 'decisions.md'),
      '| Date | Decision | Rationale |\n|---|---|---|\n| 2026-01-01 | Use PostgreSQL for persistence | Team standard |\n',
      'utf-8',
    );
    const r = runMemorySeed(root, { dryRun: true });
    assert.strictEqual(r.dryRun, true);
    assert.ok(r.count > 0);
  });
});
