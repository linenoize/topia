import assert from 'node:assert';
import { test } from 'node:test';
import openclaw from '../adapters/openclaw.js';

// --- Adapter shape ---

test('openclaw adapter has all required properties', () => {
  const required = [
    'name',
    'outputDir',
    'fileExtension',
    'skillPrefix',
    'skillSuffix',
    'transformReference',
    'transformToolName',
    'generateHeader',
    'generateFooter',
    'transformSubagentInstruction',
    'postProcess',
    'generateManifest',
    'generateEntryPoint',
  ];
  for (const prop of required) {
    assert.ok(prop in openclaw, `missing property: ${prop}`);
  }
});

test('openclaw adapter has correct name and outputDir', () => {
  assert.strictEqual(openclaw.name, 'openclaw');
  assert.strictEqual(openclaw.outputDir, '.openclaw/Topia/skills');
  assert.strictEqual(openclaw.fileExtension, '.md');
  assert.strictEqual(openclaw.skillPrefix, 'Topia-');
  assert.strictEqual(openclaw.skillSuffix, '');
});

// --- transformReference ---

test('transformReference returns correct skill file reference', () => {
  const result = openclaw.transformReference('build', 'build');
  assert.strictEqual(result, 'Topia-build.md');
});

test('transformReference preserves backticks', () => {
  const result = openclaw.transformReference('plan', '`plan`');
  assert.strictEqual(result, '`Topia-plan.md`');
});

// --- transformToolName ---

test('transformToolName maps Claude Code tools to OpenClaw equivalents', () => {
  assert.strictEqual(openclaw.transformToolName('Read'), 'read_file');
  assert.strictEqual(openclaw.transformToolName('Write'), 'write_file');
  assert.strictEqual(openclaw.transformToolName('Edit'), 'edit_file');
  assert.strictEqual(openclaw.transformToolName('Bash'), 'run_command');
  assert.strictEqual(openclaw.transformToolName('Glob'), 'glob');
  assert.strictEqual(openclaw.transformToolName('Grep'), 'grep');
});

test('transformToolName passes through unknown tools', () => {
  assert.strictEqual(openclaw.transformToolName('CustomTool'), 'CustomTool');
});

// --- generateHeader / generateFooter ---

test('generateHeader produces valid markdown', () => {
  const skill = { name: 'build', layer: 'L1', group: 'orchestrator' };
  const header = openclaw.generateHeader(skill);
  assert.ok(header.startsWith('# Topia-build'));
  assert.ok(header.includes('L1'));
  assert.ok(header.includes('orchestrator'));
});

test('generateFooter includes Topia branding', () => {
  const footer = openclaw.generateFooter();
  assert.ok(footer.includes('Topia Skill Mesh'));
  assert.ok(footer.includes('github.com/linenoize/topia'));
});

// --- postProcess ---

test('postProcess strips Claude-specific directives', () => {
  const input = 'context: fork\nsome content\nagent: general-purpose\nmore content';
  const result = openclaw.postProcess(input);
  assert.ok(!result.includes('context: fork'));
  assert.ok(!result.includes('agent: general-purpose'));
  assert.ok(result.includes('some content'));
  assert.ok(result.includes('more content'));
});

// --- generateManifest ---

test('generateManifest returns valid openclaw.plugin.json structure', () => {
  const skills = [
    { name: 'build', layer: 'L1', group: 'orchestrator' },
    { name: 'plan', layer: 'L2', group: 'workflow' },
  ];
  const pluginJson = { version: '2.1.1', name: 'Topia' };

  const manifest = openclaw.generateManifest(skills, pluginJson);

  assert.strictEqual(manifest.id, 'Topia');
  assert.strictEqual(manifest.name, 'Topia');
  assert.strictEqual(manifest.kind, 'skills');
  assert.strictEqual(manifest.version, '2.1.1');
  assert.ok(Array.isArray(manifest.skills));
  assert.deepStrictEqual(manifest.skills, ['./skills']);
  assert.ok(manifest.configSchema);
  assert.ok(manifest.configSchema.jsonSchema);
  assert.strictEqual(manifest.configSchema.jsonSchema.type, 'object');
});

test('generateManifest defaults version when missing', () => {
  const manifest = openclaw.generateManifest([], {});
  assert.strictEqual(manifest.version, '0.0.0');
});

test('generateManifest declares artifact convention for OpenClaw skills', () => {
  const manifest = openclaw.generateManifest([{ name: 'build', layer: 'L1', group: 'orchestrator' }], {
    version: '1.0.0',
  });
  assert.ok(manifest.artifactConvention, 'artifactConvention field exists');
  assert.ok(Array.isArray(manifest.artifactConvention.outputDirPriority), 'outputDirPriority is array');
  assert.ok(manifest.artifactConvention.outputDirPriority.length >= 4, 'at least 4 fallback tiers');
  assert.ok(
    manifest.artifactConvention.outputDirPriority.some((tier) => tier.includes('OPENCLAW_AGENT_DIR')),
    'OPENCLAW_AGENT_DIR is a tier',
  );
  assert.ok(manifest.artifactConvention.outputContract, 'outputContract documented');
  assert.strictEqual(manifest.artifactConvention.outputContract.exitCodes[0], 'success');
  assert.strictEqual(manifest.artifactConvention.outputContract.exitCodes[4], 'timeout with partial results (accept)');
  assert.strictEqual(
    manifest.artifactConvention.outputContract.exitCodes[124],
    'timeout with zero results (retry or abort)',
  );
});

test('generateManifest description scales with skill count', () => {
  const fewSkills = openclaw.generateManifest(
    [
      { name: 'build', layer: 'L1' },
      { name: 'plan', layer: 'L2' },
    ],
    { version: '1.0.0' },
  );
  assert.ok(fewSkills.description.includes('2-skill'), 'description reflects actual skill count');
});

// --- generateEntryPoint ---

test('generateEntryPoint returns valid TypeScript with register(api)', () => {
  const skills = [
    { name: 'build', layer: 'L1', group: 'orchestrator', description: 'Feature orchestrator' },
    { name: 'fix', layer: 'L2', group: 'workflow', description: 'Apply fixes' },
  ];
  const routerContent = '# skill-router\n\nRoute all tasks.';

  const ts = openclaw.generateEntryPoint(skills, routerContent);

  assert.ok(ts.includes('register(api'));
  assert.ok(ts.includes('before_agent_start'));
  assert.ok(ts.includes('prependSystemContext'));
  assert.ok(ts.includes('export default plugin'));
  assert.ok(ts.includes('build'));
  assert.ok(ts.includes('fix'));
  assert.ok(ts.includes('skill-router'));
});

test('generateEntryPoint handles empty router content', () => {
  const ts = openclaw.generateEntryPoint([], '');
  assert.ok(ts.includes('register(api'));
  assert.ok(ts.includes('export default plugin'));
});

test('generateEntryPoint escapes backticks in router content', () => {
  const routerContent = 'Use `build` skill for code tasks';
  const ts = openclaw.generateEntryPoint([], routerContent);
  // Should not have unescaped backticks inside template literal
  assert.ok(!ts.includes('Use `build`'));
  assert.ok(ts.includes('\\`build\\`'));
});
