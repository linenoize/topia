import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { generateSlashAliases } from '../commands/generate-slash-aliases.js';
import {
  formatBareSlashRedirect,
  loadSkillCatalog,
  matchBareTopiaSlash,
} from '../lib/skill-catalog.js';

const REPO = join(import.meta.dirname, '..', '..');

describe('skill-catalog', () => {
  test('loadSkillCatalog includes design with slash alias', () => {
    const catalog = loadSkillCatalog(REPO);
    const design = catalog.find((s) => s.name === 'design');
    assert.ok(design);
    assert.equal(design.slashAlias, 'topia-design');
    assert.equal(design.userInvocable, true);
    assert.equal(design.model, 'sonnet');
  });

  test('loadSkillCatalog excludes user-invocable false skills from invocable set', () => {
    const catalog = loadSkillCatalog(REPO);
    const router = catalog.find((s) => s.name === 'skill-router');
    assert.ok(router);
    assert.equal(router.userInvocable, false);
  });

  test('matchBareTopiaSlash detects bare skill names only', () => {
    const catalog = loadSkillCatalog(REPO);
    assert.equal(matchBareTopiaSlash('/design', catalog), 'design');
    assert.equal(matchBareTopiaSlash('/topia-design', catalog), null);
    assert.equal(matchBareTopiaSlash('/topia:design', catalog), null);
    assert.equal(matchBareTopiaSlash('design the page', catalog), null);
    assert.equal(matchBareTopiaSlash('/finalize', catalog), null);
  });

  test('formatBareSlashRedirect mentions topia- prefix', () => {
    const catalog = loadSkillCatalog(REPO);
    const msg = formatBareSlashRedirect('design', catalog);
    assert.match(msg, /topia-design/);
    assert.match(msg, /topia:design/);
  });
});

describe('generateSlashAliases', () => {
  let scratch;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test('writes topia-design.md and skips skill-router', () => {
    scratch = mkdtempSync(join(tmpdir(), 'topia-alias-'));
    mkdirSync(join(scratch, 'skills', 'design'), { recursive: true });
    mkdirSync(join(scratch, 'skills', 'skill-router'), { recursive: true });
    mkdirSync(join(scratch, 'commands'), { recursive: true });
    mkdirSync(join(scratch, 'references'), { recursive: true });
    mkdirSync(join(scratch, 'hooks', 'lib'), { recursive: true });

    writeFileSync(
      join(scratch, 'skills', 'design', 'SKILL.md'),
      `---
name: design
description: "Design system"
metadata:
  layer: L2
  model: sonnet
---

# design
`,
      'utf-8',
    );

    writeFileSync(
      join(scratch, 'skills', 'skill-router', 'SKILL.md'),
      `---
name: skill-router
description: "Router"
user-invocable: false
metadata:
  layer: L0
  model: haiku
---

# skill-router
`,
      'utf-8',
    );

    const { written, catalog } = generateSlashAliases(scratch);
    assert.equal(written, 1);
    assert.equal(catalog.length, 2);

    const aliasPath = join(scratch, 'commands', 'topia-design.md');
    assert.ok(existsSync(aliasPath));
    const content = readFileSync(aliasPath, 'utf-8');
    assert.match(content, /name: topia-design/);
    assert.match(content, /topia:design/);
    assert.ok(!existsSync(join(scratch, 'commands', 'topia-skill-router.md')));

    const cjs = readFileSync(join(scratch, 'hooks', 'lib', 'skill-catalog.cjs'), 'utf-8');
    assert.match(cjs, /AUTO-GENERATED/);
  });
});
