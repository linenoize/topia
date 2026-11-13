import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { generateSkillCatalog, renderSkillRoutes, renderSkillRoutesJson } from '../commands/generate-slash-aliases.js';
import { INTENT_CHAINS, INTENT_KEYWORDS, INTENT_PROMPTS } from '../lib/intent-keywords.js';
import {
  findSlashCollisions,
  formatBareSlashRedirect,
  loadCommandNames,
  loadSkillCatalog,
  matchBareTopiaSlash,
} from '../lib/skill-catalog.js';

const REPO = join(import.meta.dirname, '..', '..');

describe('skill-catalog', () => {
  test('loadSkillCatalog includes design', () => {
    const catalog = loadSkillCatalog(REPO);
    const design = catalog.find((s) => s.name === 'design');
    assert.ok(design);
    assert.equal(design.userInvocable, true);
    assert.equal(design.model, 'sonnet');
  });

  test('loadSkillCatalog excludes user-invocable false skills from invocable set', () => {
    const catalog = loadSkillCatalog(REPO);
    const router = catalog.find((s) => s.name === 'skill-router');
    assert.ok(router);
    assert.equal(router.userInvocable, false);
  });

  test('loadSkillCatalog marks context: fork skills as forked', () => {
    const catalog = loadSkillCatalog(REPO);
    const forked = catalog
      .filter((s) => s.forked)
      .map((s) => s.name)
      .sort();
    assert.deepEqual(forked, ['build', 'launch', 'rescue', 'team']);
    assert.equal(catalog.find((s) => s.name === 'design').forked, false);
  });

  test('matchBareTopiaSlash detects bare skill names only', () => {
    const catalog = loadSkillCatalog(REPO);
    assert.equal(matchBareTopiaSlash('/design', catalog), 'design');
    assert.equal(matchBareTopiaSlash('/topia-design', catalog), null);
    assert.equal(matchBareTopiaSlash('/topia:design', catalog), null);
    assert.equal(matchBareTopiaSlash('design the page', catalog), null);
    assert.equal(matchBareTopiaSlash('/finalize', catalog), null);
  });

  test('formatBareSlashRedirect points at /topia:<skill>', () => {
    const msg = formatBareSlashRedirect('design');
    assert.match(msg, /`\/topia:design`/);
    assert.doesNotMatch(msg, /topia-design/);
  });
});

// Every skill is `/topia:<name>`, and every command in commands/ is too. Two
// claims on one name put it in the slash menu twice; a `topia-<skill>` command
// is a second entry for the same skill.
describe('slash menu', () => {
  test('no two skills or commands claim the same slash name', () => {
    assert.deepEqual(findSlashCollisions(REPO), []);
  });

  test('commands/ holds no topia-<skill> alias files', () => {
    const skills = new Set(loadSkillCatalog(REPO).map((s) => s.name));
    const aliases = readdirSync(join(REPO, 'commands')).filter(
      (file) => file.startsWith('topia-') && skills.has(file.slice('topia-'.length, -'.md'.length)),
    );
    assert.deepEqual(aliases, []);
  });

  test('every command name is distinct from every skill name', () => {
    const skills = new Set(loadSkillCatalog(REPO).map((s) => s.name));
    const commands = loadCommandNames(REPO).map((c) => c.name);
    assert.ok(commands.includes('topia'), 'the /topia router command is still there');
    assert.deepEqual(
      commands.filter((name) => skills.has(name)),
      [],
    );
  });
});

describe('findSlashCollisions', () => {
  let scratch;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  const skill = (name) => `---\nname: ${name}\ndescription: "x"\nmetadata:\n  layer: L2\n  model: sonnet\n---\n`;

  test('flags a command named like a skill, and a topia-<skill> alias', () => {
    scratch = mkdtempSync(join(tmpdir(), 'topia-slash-'));
    for (const name of ['build', 'org-config']) {
      mkdirSync(join(scratch, 'skills', name), { recursive: true });
      writeFileSync(join(scratch, 'skills', name, 'SKILL.md'), skill(name), 'utf-8');
    }
    mkdirSync(join(scratch, 'commands'), { recursive: true });
    writeFileSync(join(scratch, 'commands', 'org-config.md'), '---\nname: org-config\n---\n', 'utf-8');
    writeFileSync(join(scratch, 'commands', 'topia-build.md'), '# alias\n', 'utf-8');
    writeFileSync(join(scratch, 'commands', 'finalize.md'), '---\nname: finalize\n---\n', 'utf-8');

    assert.deepEqual(findSlashCollisions(scratch), [
      { name: 'build', sources: ['skills/build/SKILL.md', 'commands/topia-build.md'] },
      { name: 'org-config', sources: ['skills/org-config/SKILL.md', 'commands/org-config.md'] },
    ]);
    assert.throws(() => generateSkillCatalog(scratch), /org-config/);
  });
});

describe('generateSkillCatalog', () => {
  let scratch;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  test('writes no alias commands and deletes old generated ones', () => {
    scratch = mkdtempSync(join(tmpdir(), 'topia-alias-'));
    mkdirSync(join(scratch, 'skills', 'design'), { recursive: true });
    mkdirSync(join(scratch, 'skills', 'skill-router'), { recursive: true });
    mkdirSync(join(scratch, 'commands'), { recursive: true });
    mkdirSync(join(scratch, 'references'), { recursive: true });
    mkdirSync(join(scratch, 'hooks', 'lib'), { recursive: true });
    writeFileSync(
      join(scratch, 'commands', 'topia-design.md'),
      '---\nname: topia-design\n---\n\nUser-facing alias for the Topia **design** skill.\n',
      'utf-8',
    );

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

    const { removed, catalog } = generateSkillCatalog(scratch);
    assert.equal(removed, 1);
    assert.equal(catalog.length, 2);
    assert.deepEqual(readdirSync(join(scratch, 'commands')), []);

    const cjs = readFileSync(join(scratch, 'hooks', 'lib', 'skill-catalog.cjs'), 'utf-8');
    assert.match(cjs, /AUTO-GENERATED/);
    assert.doesNotMatch(cjs, /slashAlias/);

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
    for (const name of Object.keys(INTENT_PROMPTS)) {
      assert.ok(known.has(name), `INTENT_PROMPTS names unknown skill ${name}`);
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
      'status',
      '  Status? ',
      'git status',
      'check the HTTP status code',
      'where did we leave off',
      'what’s left on the importer',
      'whats left',
      "what's the status?",
      '/status',
    ];
    for (const prompt of prompts) assert.deepEqual(reading(hook.predict(prompt)), reading(mod.predict(prompt)), prompt);
  });
});
