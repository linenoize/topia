import assert from 'node:assert';
import { describe, test } from 'node:test';
import { extractSynapseSkillsFromSection } from '../lib/synapse-tables.js';

const BUILD_CALLS_EXCERPT = `
| Phase | Sub-skill | Layer | Purpose |
|-------|-----------|-------|---------|
| 0 / 8 | \`neural-memory\` | ext | Recall context at start |
| 2.5 | \`adversary\` | L2 | Red-team challenge on approved plan |
| 4 | \`fix\` | L2 | Implement code changes (GREEN phase) |
| any | L4 extension packs | L4 | Domain-specific patterns when stack matches |
`;

describe('synapse-tables', () => {
  test('extracts skills from phase-table column 2', () => {
    const skills = extractSynapseSkillsFromSection(BUILD_CALLS_EXCERPT);
    assert.ok(skills.includes('neural-memory'));
    assert.ok(skills.includes('adversary'));
    assert.ok(skills.includes('fix'));
    assert.strictEqual(skills.includes('phase'), false);
  });

  test('extracts skills from bullet lists with layer', () => {
    const section = `
- \`plan\` (L2): high-level task decomposition
- \`build\` (L1): delegate feature tasks
- User: direct invocation
`;
    const skills = extractSynapseSkillsFromSection(section);
    assert.deepStrictEqual(skills.sort(), ['build', 'plan']);
  });

  test('extracts skills from pipe-style bullets', () => {
    const section = '- `neural-memory` | Before architecture decisions | Recall past decisions';
    const skills = extractSynapseSkillsFromSection(section);
    assert.deepStrictEqual(skills, ['neural-memory']);
  });

  test('extracts skills from simple two-column table', () => {
    const section = `
| Skill | When |
| \`recon\` | Phase 1 |
| \`plan\` | Phase 2 |
`;
    const skills = extractSynapseSkillsFromSection(section);
    assert.deepStrictEqual(skills.sort(), ['plan', 'recon']);
  });
});
