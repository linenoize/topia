import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHELL_RULE =
  "Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.";
// Other work owns these. They aren't guidance content.
const NOT_OURS = new Set(['enable.md', 'disable.md', 'connect.md']);
const INVESTIGATIVE = [
  'ask',
  'capture',
  'context',
  'diagnose',
  'diff',
  'enhance',
  'explain',
  'inspect',
  'query',
  'report',
  'review-access',
  'review-flow',
  'verify',
  'vendor',
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function read(file) {
  return readFileSync(file, 'utf-8');
}

function rel(file) {
  return relative(ROOT, file).replaceAll('\\', '/');
}

const commands = walk(join(ROOT, 'commands', 'sf')).filter((file) => !NOT_OURS.has(file.split(/[\\/]/).pop()));
const skills = walk(join(ROOT, 'salesforce', 'skills'));
const agent = join(ROOT, 'agents', 'sf-practice-review.md');
const guidance = [...commands, ...skills, agent];

describe('Salesforce guidance', () => {
  test('every command and working skill carries the shell rule', () => {
    const exempt = new Set([
      'salesforce/skills/scenarios/acceptance.md',
      'salesforce/skills/references/reversibility.md',
    ]);
    for (const file of [...commands, ...skills]) {
      if (exempt.has(rel(file))) continue;
      assert.ok(read(file).includes(SHELL_RULE), `${rel(file)} is missing the shell rule`);
    }
  });

  test('every command says what to do where a person-gated tool is missing', () => {
    for (const file of commands) {
      const text = read(file);
      assert.match(text, /exists? only on Claude Code/, `${rel(file)} doesn't name the host limit`);
      assert.match(text, /stop and say so/, `${rel(file)} doesn't say to stop`);
    }
  });

  test('investigative commands clarify through the confirmed-brief tools', () => {
    for (const name of INVESTIGATIVE) {
      const text = read(join(ROOT, 'commands', 'sf', `${name}.md`));
      assert.ok(text.includes('sf_brief_confirm'), `${name} must use sf_brief_confirm`);
      if (name !== 'verify') {
        assert.ok(text.includes('brief_propose'), `${name} must use brief_propose`);
        assert.ok(text.includes("A chat reply isn't confirmation"), `${name} must rule out a chat reply`);
      }
    }
  });

  test('tool names use the current names, with no dots', () => {
    const old =
      /\b(org\.inspect|schema\.describe|records\.query|records\.plan_update|records\.execute_plan|reports\.describe|reports\.run|metadata\.retrieve|metadata\.diff|audit\.query|users\.resolve|deployment\.validate|deployment\.execute|tests\.run|packages\.inventory)\b/;
    for (const file of guidance) assert.doesNotMatch(read(file), old, rel(file));
  });

  test('banned upstream material stays out', () => {
    for (const file of guidance) {
      assert.doesNotMatch(read(file), /CONFIRM_PROD|FIELDS\(ALL\)|--I-CONFIRM-PROD|subagent_type/, rel(file));
    }
  });

  test('"dry run" appears only where it is about metadata, or to say records have none', () => {
    const allowed = /--dry-run|no dry run|Never call|Asked for a dry run|Do a dry run of|preview a dry run/i;
    for (const file of guidance) {
      for (const line of read(file).split('\n')) {
        if (/dry.?run/i.test(line)) assert.match(line, allowed, `${rel(file)}: ${line}`);
      }
    }
  });

  test('the record preview and plan commands present checked and not_checked', () => {
    for (const file of ['commands/sf/plan.md', 'salesforce/skills/data-steward.md']) {
      const text = read(join(ROOT, file));
      assert.ok(text.includes('not_checked'), file);
      assert.ok(text.includes('Anonymous Apex is banned'), file);
    }
  });

  test('the practice-review agent is read-only and can approve nothing', () => {
    const text = read(agent);
    const front = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    assert.match(front, /^name: sf-practice-review$/m);
    assert.match(front, /^model: sonnet$/m);
    assert.deepStrictEqual(
      front
        .match(/^tools: (.*)$/m)?.[1]
        .split(',')
        .map((tool) => tool.trim()),
      ['Read', 'Grep', 'Glob'],
    );
    assert.match(text, /isn't evidence of safety/);
    assert.match(text, /can't approve anything/);
  });

  test('every ported file has its header, and every header is pinned', () => {
    const pin = JSON.parse(read(join(ROOT, 'salesforce', 'upstream', 'sf-skills.json')));
    const pairs = new Set();
    for (const source of pin.sources) {
      for (const target of source.portedInto) {
        pairs.add(`${target}|${source.sourcePath}`);
        if (target === 'salesforce/THIRD_PARTY_NOTICES.md') continue;
        const header = `Adapted from forcedotcom/sf-skills ${source.sourcePath} @219a84a, Apache-2.0; modified`;
        assert.ok(read(join(ROOT, target)).includes(header), `${target} lacks a header for ${source.sourcePath}`);
      }
    }
    for (const file of guidance) {
      for (const [, sourcePath] of read(file).matchAll(/Adapted from forcedotcom\/sf-skills (\S+) @/g)) {
        assert.ok(pairs.has(`${rel(file)}|${sourcePath}`), `${rel(file)} has an unpinned header for ${sourcePath}`);
      }
    }
  });

  test('a registered vendor name resolves with no stop, and an unknown one still stops', () => {
    const text = read(join(ROOT, 'salesforce', 'skills', 'enhance-request.md'));
    assert.match(text, /registered vendor[^\n]*resolves to "vendor\/package", with no stop/);
    assert.match(text, /An unknown product name still stops/);
    assert.ok(text.includes('vendor_findings_list'));
  });

  test('the vendor command names its subcommands and its tools', () => {
    const text = read(join(ROOT, 'commands', 'sf', 'vendor.md'));
    for (const word of [
      'fingerprint',
      'add-finding',
      'list',
      'reverify',
      'packages_inventory',
      'vendor_fingerprint',
      'vendor_finding_add',
      'vendor_findings_list',
      'vendor_finding_reverify',
    ]) {
      assert.ok(text.includes(word), word);
    }
    assert.match(text, /managed code is hidden/i);
  });

  test('the skill says how to record a vendor finding, with the status rules', () => {
    const text = read(join(ROOT, 'salesforce', 'skills', 'documentation-maintainer.md'));
    assert.match(text, /## Recording vendor findings/);
    for (const word of [
      'suspected',
      'confirmed-in-org',
      'vendor-confirmed',
      'vendor-version-drift',
      'opaque: managed code hidden',
    ]) {
      assert.ok(text.includes(word), word);
    }
  });

  test('practice review reports vendor impact as a fifth measurement', () => {
    const text = read(agent);
    assert.match(text, /## Report these five measurements/);
    assert.match(text, /5\. \*\*Vendor impact:\*\*/);
    for (const phrase of [
      'managed or namespaced components',
      'package upgrade overwrite',
      'subscriber-editable setting',
    ]) {
      assert.ok(text.includes(phrase), phrase);
    }
  });

  test('the docs give an admin the first steps, and the checklist covers the inventory', () => {
    const readme = read(join(ROOT, 'docs', 'salesforce', 'README.md'));
    assert.match(readme, /## If a vendor package is installed/);
    for (const word of [
      'sandbox, then in production',
      'version history',
      'release notes',
      '`suspected`',
      'Pin every finding',
      'upgrade or sandbox refresh',
    ]) {
      assert.ok(readme.includes(word), word);
    }
    const checklist = read(join(ROOT, 'docs', 'salesforce', 'LIVE-CHECKLIST.md'));
    assert.match(checklist, /## \d+\. Package inventory/);
    for (const name of [
      'InstalledSubscriberPackage',
      'ApexTrigger',
      'ApexClass',
      'FlowDefinition',
      'EntityDefinition',
      'PermissionSet',
    ]) {
      assert.ok(checklist.includes(`FROM ${name}`), name);
    }
  });

  test('the notices hold the license and the copyright line', () => {
    const notices = read(join(ROOT, 'salesforce', 'THIRD_PARTY_NOTICES.md'));
    assert.ok(notices.includes('Copyright (c) 2026 Salesforce, Inc.'));
    assert.ok(notices.includes('219a84a028387366f9d73fd2551ce7ed47bb1103'));
    assert.ok(notices.includes('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION'));
  });
});
