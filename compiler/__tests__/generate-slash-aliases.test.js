import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { generateSlashAliases, renderSkillRoutes, renderSkillRoutesJson } from '../commands/generate-slash-aliases.js';
import { INTENT_CHAINS, INTENT_KEYWORDS } from '../lib/intent-keywords.js';
import { formatBareSlashRedirect, loadSkillCatalog, matchBareTopiaSlash } from '../lib/skill-catalog.js';

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

    const routes = readFileSync(join(scratch, 'mods', 'lib', 'skill-routes.generated.ts'), 'utf-8');
    assert.match(routes, /AUTO-GENERATED/);
    assert.match(routes, /"name": "design"/);
    assert.match(routes, /"wireframe"/);

    const hookRoutes = JSON.parse(readFileSync(join(scratch, 'hooks', 'lib', 'skill-routes.json'), 'utf-8'));
    assert.deepEqual(
      hookRoutes.map((route) => route.name),
      ['design', 'skill-router'],
    );
  });
});

describe('intent-keywords', () => {
  test('names only skills that exist, in keywords and in chains', () => {
    const known = new Set(loadSkillCatalog(REPO).map((s) => s.name));
    for (const name of Object.keys(INTENT_KEYWORDS)) {
      assert.ok(known.has(name), `INTENT_KEYWORDS names unknown skill ${name}`);
    }
    for (const [name, chain] of Object.entries(INTENT_CHAINS)) {
      assert.ok(known.has(name), `INTENT_CHAINS names unknown skill ${name}`);
      for (const next of chain) assert.ok(known.has(next), `INTENT_CHAINS.${name} names unknown skill ${next}`);
    }
  });

  test('the checked-in routing tables match what the generator writes', () => {
    const catalog = loadSkillCatalog(REPO);
    const checkedIn = (rel) => readFileSync(join(REPO, rel), 'utf-8').replace(/\r\n/g, '\n');
    assert.equal(checkedIn('mods/lib/skill-routes.generated.ts'), renderSkillRoutes(catalog));
    assert.equal(checkedIn('hooks/lib/skill-routes.json'), renderSkillRoutesJson(catalog));
  });

  // The hook's scorer is a Node port of the mod's; the two must read a prompt
  // the same way. Loading the mod's TS needs Node's type stripping (22.18+).
  const canLoadTs = Boolean(process.features?.typescript) && typeof module.registerHooks === 'function';
  test('the intent-router hook and the prompt-routing mod read prompts alike', { skip: !canLoadTs }, async () => {
    module.registerHooks({
      resolve(specifier, context, nextResolve) {
        const isBareRelative = specifier.startsWith('.') && !/\.(?:[cm]?[jt]sx?|json)$/.test(specifier);
        if (isBareRelative && context.parentURL?.endsWith('.ts')) return nextResolve(`${specifier}.ts`, context);
        return nextResolve(specifier, context);
      },
    });
    const mod = await import(pathToFileURL(join(REPO, 'mods', 'lib', 'prompt-routing.ts')).href);
    const hook = createRequire(import.meta.url)('../../hooks/lib/prompt-routing.cjs');
    const reading = ({ skills, chain }) => ({
      skills: skills.map(({ name, keywords, isExplicit, score }) => ({ name, keywords, isExplicit, score })),
      chain,
    });
    const prompts = [
      'fix the crash in the parser and add a unit test',
      'login page is broken, 500 error after deploy',
      'review my PR and check for security issues',
      'where is the router config',
      'plan a migration of the database schema',
      'ask topia:recon where the router lives',
      '/topia-review the login change',
      'update the address field',
      'hello there',
      'the tests are red; it crashes when we deployed',
    ];
    for (const prompt of prompts) assert.deepEqual(reading(hook.predict(prompt)), reading(mod.predict(prompt)), prompt);
  });
});
