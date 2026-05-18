import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseOrgConfig } from '../parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '../../skills');

// ─── parseOrgConfig unit tests ────────────────────────────────────

describe('parseOrgConfig', () => {
  const minimalTemplate = `---
name: test-org
description: Test organization template
version: "1.0.0"
---

# Organization: Test Template

## Teams

| Team | Lead | Domain Packs | Members |
|------|------|-------------|---------|
| Engineering | CTO | — | eng-team |
| Product | VP Product | @Topia/product | product-team |

## Roles

| Role | Permissions | Approval Authority |
|------|------------|-------------------|
| admin | all | Can override any gate |
| contributor | write | Requires admin approval |

## Policies

### Code Review
- **Minimum reviewers**: 2
- **Self-merge allowed**: No

### Security
- **Dependency audit frequency**: Weekly
- **Secret rotation**: Monthly

### Deployment
- **Staging required**: Yes
- **Production deploy window**: Weekdays 09:00-16:00

## Approval Flows

### Feature Launch
\`\`\`
contributor proposes → admin approves → deploy
\`\`\`

### Budget Approval
\`\`\`
< $5,000: admin approves
> $5,000: board approves
\`\`\`

## Governance Level

**Moderate** — Balanced speed and safety.

- sentinel: enforce mode
- preflight: full checks
`;

  test('parses frontmatter correctly', () => {
    const result = parseOrgConfig(minimalTemplate);
    assert.strictEqual(result.name, 'test-org');
    assert.strictEqual(result.description, 'Test organization template');
    assert.strictEqual(result.version, '1.0.0');
  });

  test('parses teams table', () => {
    const result = parseOrgConfig(minimalTemplate);
    assert.strictEqual(result.teams.length, 2);
    assert.strictEqual(result.teams[0].team, 'Engineering');
    assert.strictEqual(result.teams[0].lead, 'CTO');
    assert.strictEqual(result.teams[1].team, 'Product');
    assert.strictEqual(result.teams[1].domain_packs, '@Topia/product');
  });

  test('parses roles table', () => {
    const result = parseOrgConfig(minimalTemplate);
    assert.strictEqual(result.roles.length, 2);
    assert.strictEqual(result.roles[0].role, 'admin');
    assert.strictEqual(result.roles[0].permissions, 'all');
    assert.strictEqual(result.roles[1].role, 'contributor');
  });

  test('parses policies into structured map', () => {
    const result = parseOrgConfig(minimalTemplate);
    assert.ok(result.policies.code_review, 'Expected code_review policy');
    assert.ok(result.policies.security, 'Expected security policy');
    assert.ok(result.policies.deployment, 'Expected deployment policy');

    const cr = result.policies.code_review;
    assert.strictEqual(cr.length, 2);
    assert.strictEqual(cr[0].key, 'minimum_reviewers');
    assert.strictEqual(cr[0].value, '2');
    assert.strictEqual(cr[1].key, 'self-merge_allowed');
    assert.strictEqual(cr[1].value, 'No');
  });

  test('parses security policies', () => {
    const result = parseOrgConfig(minimalTemplate);
    const sec = result.policies.security;
    assert.strictEqual(sec.length, 2);
    assert.strictEqual(sec[0].key, 'dependency_audit_frequency');
    assert.strictEqual(sec[0].value, 'Weekly');
    assert.strictEqual(sec[1].key, 'secret_rotation');
    assert.strictEqual(sec[1].value, 'Monthly');
  });

  test('parses deployment policies', () => {
    const result = parseOrgConfig(minimalTemplate);
    const dep = result.policies.deployment;
    assert.strictEqual(dep.length, 2);
    assert.strictEqual(dep[0].key, 'staging_required');
    assert.strictEqual(dep[0].value, 'Yes');
  });

  test('parses approval flows', () => {
    const result = parseOrgConfig(minimalTemplate);
    assert.ok(result.approvalFlows.feature_launch, 'Expected feature_launch flow');
    assert.ok(result.approvalFlows.budget_approval, 'Expected budget_approval flow');
    assert.ok(
      result.approvalFlows.feature_launch.includes('contributor proposes'),
      'Expected contributor proposes in feature launch flow',
    );
  });

  test('parses governance level', () => {
    const result = parseOrgConfig(minimalTemplate);
    assert.strictEqual(result.governanceLevel.level, 'moderate');
    assert.ok(result.governanceLevel.settings.length >= 2);
    assert.ok(result.governanceLevel.settings[0].includes('sentinel'));
  });

  test('handles missing sections gracefully', () => {
    const sparse = `---
name: sparse
---

# Sparse Org

## Teams

No table here.

## Governance Level

**Minimal** — Fast.

- basic checks
`;
    const result = parseOrgConfig(sparse);
    assert.strictEqual(result.name, 'sparse');
    assert.strictEqual(result.teams.length, 0);
    assert.strictEqual(result.roles.length, 0);
    assert.deepStrictEqual(result.policies, {});
    assert.deepStrictEqual(result.approvalFlows, {});
    assert.strictEqual(result.governanceLevel.level, 'minimal');
  });

  test('handles empty content', () => {
    const result = parseOrgConfig('');
    assert.strictEqual(result.name, '');
    assert.strictEqual(result.teams.length, 0);
    assert.strictEqual(result.roles.length, 0);
  });

  test('preserves filePath', () => {
    const result = parseOrgConfig(minimalTemplate, '/test/org.md');
    assert.strictEqual(result.filePath, '/test/org.md');
  });
});

// ─── Sentinel + preflight org integration ─────────────────────────

describe('sentinel/preflight org policy integration', () => {
  const sentinelPath = path.join(SKILLS_DIR, 'sentinel', 'SKILL.md');
  const preflightPath = path.join(SKILLS_DIR, 'preflight', 'SKILL.md');

  test('sentinel references .topia/org/org.md', () => {
    const content = readFileSync(sentinelPath, 'utf-8');
    assert.ok(
      content.includes('.topia/org/org.md'),
      'sentinel should reference .topia/org/org.md for org policy loading',
    );
  });

  test('sentinel has Organization Policy Enforcement step', () => {
    const content = readFileSync(sentinelPath, 'utf-8');
    assert.ok(
      content.includes('Organization Policy Enforcement'),
      'sentinel should have Organization Policy Enforcement step',
    );
  });

  test('sentinel handles missing org config gracefully', () => {
    const content = readFileSync(sentinelPath, 'utf-8');
    assert.ok(content.includes('no org config'), 'sentinel should handle missing org config');
  });

  test('preflight references .topia/org/org.md', () => {
    const content = readFileSync(preflightPath, 'utf-8');
    assert.ok(content.includes('.topia/org/org.md'), 'preflight should reference .topia/org/org.md for org requirements');
  });

  test('preflight has Organization Approval Requirements step', () => {
    const content = readFileSync(preflightPath, 'utf-8');
    assert.ok(
      content.includes('Organization Approval Requirements'),
      'preflight should have Organization Approval Requirements step',
    );
  });

  test('preflight handles missing org config gracefully', () => {
    const content = readFileSync(preflightPath, 'utf-8');
    assert.ok(content.includes('no org config'), 'preflight should handle missing org config');
  });

  test('sentinel step is numbered 4.86 (between contract 4.85 and six-gate 4.9)', () => {
    const content = readFileSync(sentinelPath, 'utf-8');
    assert.ok(content.includes('Step 4.86'), 'sentinel org policy step should be numbered 4.86');
  });

  test('preflight step is numbered 4.6 (between domain hooks 4.5 and composite score 4.8)', () => {
    const content = readFileSync(preflightPath, 'utf-8');
    assert.ok(content.includes('Step 4.6'), 'preflight org requirements step should be numbered 4.6');
  });
});
