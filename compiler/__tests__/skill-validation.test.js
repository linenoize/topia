/**
 * Skill Validation Tests
 *
 * Verifies ALL 58 SKILL.md files parse correctly and meet structural requirements.
 * This is the "mesh integrity" test — if any skill breaks parsing, mesh connections fail.
 */

import assert from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSkill } from '../parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '../../skills');

// Discover all skill directories
const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const VALID_LAYERS = ['L0', 'L1', 'L2', 'L3'];
const VALID_MODELS = ['haiku', 'sonnet', 'opus'];

// --- Discovery ---

test(`discovers all 58 core skills`, () => {
  assert.ok(skillDirs.length >= 58, `expected >=58 skills, found ${skillDirs.length}`);
});

// --- Per-skill validation ---

describe('skill parsing', () => {
  for (const skillName of skillDirs) {
    const skillFile = path.join(SKILLS_DIR, skillName, 'SKILL.md');

    test(`${skillName}/SKILL.md exists`, () => {
      assert.ok(existsSync(skillFile), `missing SKILL.md for ${skillName}`);
    });

    test(`${skillName} parses without errors`, () => {
      const content = readFileSync(skillFile, 'utf-8');
      const parsed = parseSkill(content, `${skillName}/SKILL.md`);

      // Must have a name
      assert.ok(parsed.name, `${skillName}: missing name`);
      assert.strictEqual(parsed.name, skillName, `${skillName}: parsed name mismatch`);
    });

    test(`${skillName} has valid layer`, () => {
      const content = readFileSync(skillFile, 'utf-8');
      const parsed = parseSkill(content, `${skillName}/SKILL.md`);
      assert.ok(VALID_LAYERS.includes(parsed.layer), `${skillName}: invalid layer "${parsed.layer}"`);
    });

    test(`${skillName} has valid model`, () => {
      const content = readFileSync(skillFile, 'utf-8');
      const parsed = parseSkill(content, `${skillName}/SKILL.md`);
      if (parsed.model) {
        assert.ok(VALID_MODELS.includes(parsed.model), `${skillName}: invalid model "${parsed.model}"`);
      }
    });

    test(`${skillName} has description`, () => {
      const content = readFileSync(skillFile, 'utf-8');
      const parsed = parseSkill(content, `${skillName}/SKILL.md`);
      assert.ok(parsed.description && parsed.description.length > 10, `${skillName}: missing or too short description`);
    });

    test(`${skillName} has non-empty body`, () => {
      const content = readFileSync(skillFile, 'utf-8');
      const parsed = parseSkill(content, `${skillName}/SKILL.md`);
      assert.ok(
        parsed.body && parsed.body.length > 100,
        `${skillName}: body too short (${parsed.body?.length || 0} chars)`,
      );
    });
  }
});

// --- Mesh integrity ---

describe('mesh integrity', () => {
  const allParsed = skillDirs.map((name) => {
    const content = readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8');
    return parseSkill(content, `${name}/SKILL.md`);
  });
  const allNames = new Set(allParsed.map((s) => s.name));

  test('all string cross-references point to existing skills', () => {
    const broken = [];
    for (const skill of allParsed) {
      for (const ref of skill.crossRefs) {
        // Skip non-string refs (parser quirk for some metadata formats)
        if (typeof ref !== 'string') continue;
        if (!allNames.has(ref)) {
          broken.push(`${skill.name} → ${ref}`);
        }
      }
    }
    assert.strictEqual(broken.length, 0, `broken cross-refs:\n  ${broken.join('\n  ')}`);
  });

  test('L0 layer has exactly 1 skill (skill-router)', () => {
    const l0 = allParsed.filter((s) => s.layer === 'L0');
    assert.strictEqual(l0.length, 1);
    assert.strictEqual(l0[0].name, 'skill-router');
  });

  test('L1 orchestrators exist', () => {
    const l1 = allParsed.filter((s) => s.layer === 'L1');
    const l1Names = l1.map((s) => s.name);
    for (const expected of ['build', 'team', 'launch', 'rescue', 'scaffold']) {
      assert.ok(l1Names.includes(expected), `missing L1 orchestrator: ${expected}`);
    }
  });

  test('mesh has 200+ total cross-references', () => {
    const totalRefs = allParsed.reduce((sum, s) => sum + s.crossRefs.length, 0);
    assert.ok(totalRefs >= 200, `expected >=200 cross-refs, found ${totalRefs}`);
  });

  test('no true orphan skills (every skill is referenced by at least one other)', () => {
    // Collect all names referenced via crossRefs OR mentioned in body text as Topia:name
    const referenced = new Set();
    const refPattern = /Topia:([a-z][\w-]*)/g;
    for (const skill of allParsed) {
      // From parsed crossRefs
      for (const ref of skill.crossRefs) {
        if (typeof ref === 'string') referenced.add(ref);
      }
      // From body text mentions
      let match;
      while ((match = refPattern.exec(skill.body)) !== null) {
        referenced.add(match[1]);
      }
    }
    // Skills that are dispatched dynamically by skill-router (not via explicit Topia:X refs)
    const dynamicDispatch = new Set(['constraint-check', 'context-engine', 'sast', 'scope-guard', 'worktree']);
    // A skill is orphan only if it's never referenced and not dynamically dispatched
    const orphans = allParsed.filter(
      (s) => !referenced.has(s.name) && !dynamicDispatch.has(s.name) && s.layer !== 'L0',
    );
    assert.strictEqual(orphans.length, 0, `orphan skills (never referenced): ${orphans.map((s) => s.name).join(', ')}`);
  });
});
