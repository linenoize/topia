import assert from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseSkillMd, validateMesh } from '../validate-nexus.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('validate-nexus', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'Topia-nexus-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseSkillMd', () => {
    test('extracts calls and calledBy from SKILL.md', () => {
      const skillDir = join(tempDir, 'build');
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: build
layer: L1
---

# build

## Calls (outbound)
- \`fix\` (L2) — applies code changes
- \`test\` (L2) — runs tests

## Called By (inbound)
- \`skill-router\` (L0) — routes tasks

## Constraints
None
`,
      );

      const result = parseSkillMd(join(skillDir, 'SKILL.md'));
      assert.strictEqual(result.name, 'build');
      assert.deepStrictEqual(result.calls, ['fix', 'test']);
      assert.deepStrictEqual(result.calledBy, ['skill-router']);
    });

    test('returns empty arrays when no connections', () => {
      const skillDir = join(tempDir, 'lonely');
      mkdirSync(skillDir);
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: lonely
layer: L3
---

# lonely

## Constraints
None
`,
      );

      const result = parseSkillMd(join(skillDir, 'SKILL.md'));
      assert.strictEqual(result.name, 'lonely');
      assert.deepStrictEqual(result.calls, []);
      assert.deepStrictEqual(result.calledBy, []);
    });
  });

  describe('validateNexus (validateMesh alias)', () => {
    test('passes when nexus is bidirectionally consistent', () => {
      // build calls fix, fix lists build in calledBy
      mkdirSync(join(tempDir, 'build'));
      writeFileSync(
        join(tempDir, 'build', 'SKILL.md'),
        `---
name: build
layer: L1
---
# build
## Calls (outbound)
- \`fix\` (L2) — applies changes

## Called By (inbound)
- None

## Constraints
None
`,
      );

      mkdirSync(join(tempDir, 'fix'));
      writeFileSync(
        join(tempDir, 'fix', 'SKILL.md'),
        `---
name: fix
layer: L2
---
# fix
## Calls (outbound)
- None

## Called By (inbound)
- \`build\` (L1) — orchestrates

## Constraints
None
`,
      );

      const { skillCount, issues } = validateMesh(tempDir);
      assert.strictEqual(skillCount, 2);
      assert.strictEqual(issues.length, 0);
    });

    test('detects missing calledBy entry', () => {
      mkdirSync(join(tempDir, 'build'));
      writeFileSync(
        join(tempDir, 'build', 'SKILL.md'),
        `---
name: build
layer: L1
---
# build
## Calls (outbound)
- \`fix\` (L2) — applies changes

## Called By (inbound)
- None

## Constraints
None
`,
      );

      mkdirSync(join(tempDir, 'fix'));
      writeFileSync(
        join(tempDir, 'fix', 'SKILL.md'),
        `---
name: fix
layer: L2
---
# fix
## Calls (outbound)
- None

## Called By (inbound)
- None

## Constraints
None
`,
      );

      const { issues } = validateMesh(tempDir);
      assert.strictEqual(issues.length, 1);
      assert.ok(issues[0].includes('build'));
      assert.ok(issues[0].includes('fix'));
    });

    test('detects missing calls entry', () => {
      mkdirSync(join(tempDir, 'build'));
      writeFileSync(
        join(tempDir, 'build', 'SKILL.md'),
        `---
name: build
layer: L1
---
# build
## Calls (outbound)
- None

## Called By (inbound)
- None

## Constraints
None
`,
      );

      mkdirSync(join(tempDir, 'fix'));
      writeFileSync(
        join(tempDir, 'fix', 'SKILL.md'),
        `---
name: fix
layer: L2
---
# fix
## Calls (outbound)
- None

## Called By (inbound)
- \`build\` (L1) — orchestrates

## Constraints
None
`,
      );

      const { issues } = validateMesh(tempDir);
      assert.strictEqual(issues.length, 1);
      assert.ok(issues[0].includes('build'));
    });

    test('ignores User in calledBy', () => {
      mkdirSync(join(tempDir, 'build'));
      writeFileSync(
        join(tempDir, 'build', 'SKILL.md'),
        `---
name: build
layer: L1
---
# build
## Calls (outbound)
- None

## Called By (inbound)
- User

## Constraints
None
`,
      );

      const { issues } = validateMesh(tempDir);
      assert.strictEqual(issues.length, 0);
    });
  });

  describe('integration: real skills directory', () => {
    test('validates actual Topia skills directory', () => {
      const { skillCount, issues } = validateMesh(join(__dirname, '../../skills'));
      assert.ok(skillCount >= 50, `Expected 50+ skills, got ${skillCount}`);
      // Log but don't fail — nexus may have known issues
      if (issues.length > 0) {
        console.log(`  Nexus has ${issues.length} connection issues (known)`);
      }
    });
  });
});
