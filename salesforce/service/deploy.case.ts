import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen } from './approval-screen.js'
import { registerWriterFake, USERNAME, WRITER, writerScenario } from './test-support.js'
import { proposeBrief } from './brief.js'
import { componentSummary, contentHashOf, manifestOf, packageXml, VALIDATION_MAX_AGE_MS, zipFile as storedZip } from './deploy-zip.js'
import { deploymentValidate } from './deploy.js'
import { prepareValidate, runValidate, type ValidateApprove } from './validate-run.js'
import { prepareDeployWrite, runDeployWrite, type DeployApproveReply, type DeployReply, type DeployStep, type PinnedDeploy } from './deploy-run.js'
import { readJournal } from './journal.js'
import { readJson, writeJson } from './json-file.js'
import { readLedger, type DeployLedger } from './ledger.js'
import { localFile, planFile } from './paths.js'
import { prepareRestore } from './restore.js'
import { SfCliAdapter } from './sf-adapter.js'
import { DEPLOY_WORKSPACE, prepareDeployWorkspace } from './sf-cli.js'
import { parseDeployRun } from './sf-parse.js'
import { STAMP_KEY } from './stamp.js'
import { baseScenario, changeFakeOrg, contextFor, fakeCalls, fakeDeploys, fakeHome, fakeOrg, fakeWrites, ORG, registerFake, writeScenario, type FakeHome } from './test-support.js'
import { callTool, refuse, type ToolResult } from './tools.js'
import { readZip, writeZip } from './zip.js'

const PACKAGE = packageXml(['ApexClass:Widget'])
const OLD = { 'classes/Widget.cls': 'public class Widget { /* old */ }', 'classes/Widget.cls-meta.xml': '<ApexClass/>' }
const NEW = { 'classes/Widget.cls': 'public class Widget { /* new */ }', 'classes/Widget.cls-meta.xml': '<ApexClass/>' }

type Kind = 'sandbox' | 'production'

type Rig = {
  home: FakeHome
  adapter: SfCliAdapter
  briefHash: string
  briefId: string
  /** Writes the artifact into the project, and a plan for it. */
  plan: (over?: Record<string, unknown>, files?: Record<string, string>) => Promise<string>
  validate: (planId: string, over?: Record<string, unknown>) => Promise<ToolResult>
  verify: (planId: string) => Promise<ToolResult>
  prepare: (planId: string, over?: { brief?: string | null; mode?: 'execute' | 'validate' | 'read-only'; now?: number; cancel?: boolean }) => Promise<DeployReply>
  approve: (planId: string, over?: { cancel?: boolean }) => Promise<DeployApproveReply>
  run: (pinned: PinnedDeploy, over?: { onStep?: (step: DeployStep) => void; pollBudgetMs?: number; brief?: string | null; mode?: 'execute' | 'validate' | 'read-only' }) => Promise<DeployReply>
  /** Plan, validate until it passes, approve. */
  ready: (over?: Record<string, unknown>, files?: Record<string, string>) => Promise<{ planId: string; reply: DeployApproveReply }>
  rescenario: (change: (scenario: Record<string, unknown>) => Record<string, unknown>) => void
  shipped: () => { id: string; zipSha?: string }[]
}

/** Production writes as one user only because a person accepted that. The writer's own tests are below. */
const ONE_USER = { singleUserAcceptedAt: '2026-06-01T00:00:00.000Z', writeAccess: { canWrite: 'yes' as const, reasons: ['Modify All Data'] } }

function rig(kind: Kind, body: (rig: Rig) => Promise<void>, options: { scenario?: Record<string, unknown>; register?: Record<string, unknown> } = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      const isSandbox = kind === 'sandbox'
      registerFake(home, { isSandbox, name: isSandbox ? 'Acme Sales' : 'Acme Production', ...(isSandbox ? {} : ONE_USER), ...options.register })
      writeScenario(home, baseScenario({ org: { IsSandbox: isSandbox, Name: isSandbox ? 'Acme Sales' : 'Acme Production' }, metadata: { 'ApexClass:Widget': OLD }, ...options.scenario }))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000, writeTimeoutMs: 8000 })
      const input = (at = Date.now()) => contextFor(home, { hookHost: true, now: at, correlationId: `corr-${at}`, pollBudgetMs: 300, pollIntervalMs: 10 })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'Ship Widget', environment: 'Sandbox', subjects: [], change: 'A class', blockingQuestions: [] }, new Date().toISOString())
      const stamp = (mode: string) => ({ mode, agentId: null, confirmedBriefHash: briefHash, ack: null })
      const plan: Rig['plan'] = async (over = {}, files = { 'package.xml': PACKAGE, ...NEW }) => {
        const root = join(home.project, 'deploy')
        rmSync(root, { recursive: true, force: true })
        for (const [path, text] of Object.entries(files)) {
          mkdirSync(dirname(join(root, path)), { recursive: true })
          writeFileSync(join(root, path), text)
        }
        const review = await callTool(adapter, 'practice_record', { briefId, practice: 'fine', experience: 'fine', security: 'fine', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['deploy'], [STAMP_KEY]: stamp('plan') }, input())
        assert.equal(review.ok, true, JSON.stringify(review))
        const args = JSON.parse(JSON.stringify({ orgId: ORG, briefId, practiceReviewId: (review.data as { practiceReviewId: string }).practiceReviewId, artifactPath: 'deploy', destructive: false, businessObjective: 'Ship it', notes: '', ...over, [STAMP_KEY]: stamp('plan') })) as Record<string, unknown>
        const made = await callTool(adapter, 'deployment_plan', args, input())
        assert.equal(made.ok, true, JSON.stringify(made))
        return (made.data as { planId: string }).planId
      }
      // The person-gated path (sf_deployment_validate) runs this same function once a person answered. Most test zips hold Apex, which stdio refuses.
      const validate: Rig['validate'] = async (planId, over = {}) => {
        const ctx = { ...input(), mode: 'validate' as const, stamp: null, brief: null, apexApproved: true as const }
        try {
          return await deploymentValidate(adapter as never, { orgId: ORG, planId, ...over }, ctx)
        } catch (error) {
          // What callTool does with a throw.
          return refuse(ctx, 'deployment_validate', ORG, '', error instanceof Error ? error.message : 'failed')
        }
      }
      const verify: Rig['verify'] = planId => callTool(adapter, 'deployment_verify', { orgId: ORG, briefId, planId, [STAMP_KEY]: stamp('validate') }, input())
      const prepare: Rig['prepare'] = (planId, over = {}) => prepareDeployWrite(adapter, input(over.now), { planId, cancel: over.cancel }, over.brief === undefined ? briefHash : over.brief, over.mode ?? 'execute')
      const approve: Rig['approve'] = async (planId, over = {}) => {
        const reply = await prepare(planId, over)
        assert.equal(reply.ok, true, JSON.stringify(reply))
        assert.equal((reply as DeployApproveReply).action, 'approve', JSON.stringify(reply))
        const screen = buildApprovalScreen((reply as DeployApproveReply).screenPlan, (reply as DeployApproveReply).facts)
        assert.equal(approvalAccepted(screen, screen.requiresTypedOrgName ? (screen.typedOrgName as string) : screen.approveLabel), true)
        return reply as DeployApproveReply
      }
      const run: Rig['run'] = (pinned, over = {}) => runDeployWrite(adapter, input(), pinned, over.brief === undefined ? briefHash : over.brief, over.mode ?? 'execute', { onStep: over.onStep, pollBudgetMs: over.pollBudgetMs ?? 3000, pollIntervalMs: 10 })
      const ready: Rig['ready'] = async (over = {}, files) => {
        const planId = await plan(over, files)
        const validated = await validate(planId)
        assert.equal((validated.data as { state?: string }).state, 'passed', JSON.stringify(validated))
        return { planId, reply: await approve(planId) }
      }
      const rescenario: Rig['rescenario'] = change => writeScenario(home, change(JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>))
      const shipped: Rig['shipped'] = () => fakeWrites(home).filter(item => item.kind === 'deploy')
      await body({ home, adapter, briefHash, briefId, plan, validate, verify, prepare, approve, run, ready, rescenario, shipped })
    } finally {
      home.cleanup()
    }
  }
}

function refused(reply: DeployReply, shape: RegExp): void {
  assert.equal(reply.ok, false, JSON.stringify(reply))
  assert.match((reply as { reason: string }).reason, shape)
}

function reported(reply: DeployReply): Record<string, any> {
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal((reply as { action: string }).action, 'report', JSON.stringify(reply))
  return (reply as { data: Record<string, any> }).data
}

const sandbox = (body: (rig: Rig) => Promise<void>, options: { scenario?: Record<string, unknown> } = {}) => rig('sandbox', body, options)
const production = (body: (rig: Rig) => Promise<void>, options: { scenario?: Record<string, unknown>; register?: Record<string, unknown> } = {}) => rig('production', body, options)

function validationFile(rigged: Rig, planId: string): string {
  return localFile(rigged.home.store, rigged.home.project, 'validations', planId)
}

function zipFile(rigged: Rig, planId: string): string {
  return storedZip(rigged.home.store, rigged.home.project, planId)
}

function byCommand(rigged: Rig, name: string) {
  return fakeCalls(rigged.home).filter(item => item.command === name)
}

// ── the zip ──────────────────────────────────────────────────────────────────

test('the zip is built from the artifact, in a private folder, and bound to the plan', sandbox(async rigged => {
  const planId = await rigged.plan()
  const result = await rigged.validate(planId)
  assert.equal(result.ok, true, JSON.stringify(result))
  const file = zipFile(rigged, planId)
  assert.equal(existsSync(file), true)
  assert.equal(file.startsWith(rigged.home.project), false, 'off the project')
  const entries = readZip(readFileSync(file))
  assert.deepEqual(entries.map(item => item.path).sort(), ['classes/Widget.cls', 'classes/Widget.cls-meta.xml', 'package.xml'])
  const plan = readJson<{ plan: { artifactHash: string } }>(planFile(rigged.home.project, planId))
  assert.equal(contentHashOf(entries), plan?.plan.artifactHash)
}))

test('.forceignore in the folder changes nothing about what ships, or about the hash', sandbox(async rigged => {
  const first = await rigged.plan({}, { 'package.xml': PACKAGE, ...NEW })
  const second = await rigged.plan({}, { 'package.xml': PACKAGE, ...NEW, '.forceignore': 'classes/Widget.cls\n' })
  const hash = (id: string) => readJson<{ plan: { artifactHash: string } }>(planFile(rigged.home.project, id))?.plan.artifactHash
  assert.equal(hash(first), hash(second))
  await rigged.validate(second)
  const entries = readZip(readFileSync(zipFile(rigged, second)))
  assert.ok(entries.some(item => item.path === 'classes/Widget.cls'))
  assert.equal(entries.some(item => item.path === '.forceignore'), false)
}))

test('a working-tree edit after the plan stops the build', sandbox(async rigged => {
  const planId = await rigged.plan()
  writeFileSync(join(rigged.home.project, 'deploy', 'classes', 'Widget.cls'), 'public class Widget { /* evil */ }')
  const result = await rigged.validate(planId)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /changed since the plan/)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

test('a working-tree edit after validating can not change what ships', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  const validatedSha = fakeDeploys(rigged.home)[0]?.zipSha
  writeFileSync(join(rigged.home.project, 'deploy', 'classes', 'Widget.cls'), 'public class Widget { /* evil */ }')
  reported(await rigged.run(reply.pinned))
  assert.equal(rigged.shipped()[0]?.zipSha, validatedSha)
  assert.equal(fakeOrg(rigged.home).metadata['ApexClass:Widget']?.['classes/Widget.cls'], NEW['classes/Widget.cls'])
  void planId
}))

test('a zip file as the artifact is used as it is', sandbox(async rigged => {
  const bytes = writeZip([{ path: 'package.xml', bytes: Buffer.from(PACKAGE) }, ...Object.entries(NEW).map(([path, text]) => ({ path, bytes: Buffer.from(text) }))])
  const planId = await rigged.plan({ artifactPath: 'bundle.zip' }, { 'package.xml': PACKAGE }).catch(async () => {
    writeFileSync(join(rigged.home.project, 'bundle.zip'), bytes)
    return rigged.plan({ artifactPath: 'bundle.zip' })
  })
  const result = await rigged.validate(planId)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(readFileSync(zipFile(rigged, planId)), bytes)
}))

/**
 * A file symlink needs a privilege on Windows. A directory junction does not, and Node reports it as a link too,
 * so it proves the same refusal there. Where neither can be made, the test is skipped by name, never passed empty.
 */
function makeLink(outsideFile: string, outsideDir: string, at: string): boolean {
  try {
    symlinkSync(outsideFile, at)
    return true
  } catch {
    // Windows without the privilege.
  }
  try {
    symlinkSync(outsideDir, at, 'junction')
    return true
  } catch {
    return false
  }
}

const CAN_LINK = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-link-probe-'))
  try {
    mkdirSync(join(dir, 'real'))
    writeFileSync(join(dir, 'real', 'f.txt'), 'x')
    return makeLink(join(dir, 'real', 'f.txt'), join(dir, 'real'), join(dir, 'link'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()

test('a link in the artifact folder is refused, so it can not carry a file in from elsewhere', { skip: CAN_LINK ? false : 'this machine can make neither a symlink nor a junction, so the refusal of a link is NOT exercised here' }, sandbox(async rigged => {
  const outsideDir = join(rigged.home.root, 'outside')
  mkdirSync(outsideDir)
  const outside = join(outsideDir, 'outside.txt')
  writeFileSync(outside, 'a secret')
  const planned = await rigged.plan({}, { 'package.xml': PACKAGE, ...NEW })
  assert.equal(makeLink(outside, outsideDir, join(rigged.home.project, 'deploy', 'classes', 'Linked.cls')), true, 'the link was made')
  const result = await rigged.validate(planned)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result), /holds a link/)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

test('source format is refused, with what to do instead', sandbox(async rigged => {
  const planId = await rigged.plan({}, { 'force-app/main/default/classes/Widget.cls': 'x' })
  const result = await rigged.validate(planId)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /package\.xml/)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

test('a wildcard manifest is refused, because a component list could not be compared', sandbox(async rigged => {
  const planId = await rigged.plan({}, { 'package.xml': packageXml(['ApexClass:*']), ...NEW })
  const result = await rigged.validate(planId)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /wildcard/i)
}))

// ── a manifest is read in one plain form, and anything else is refused ──

const META = 'http://soap.sforce.com/2006/04/metadata'
const PLAIN_TYPES = '  <types>\n    <members>Widget</members>\n    <name>ApexClass</name>\n  </types>'
const OTHER_TYPES = '  <types>\n    <members>Admin</members>\n    <name>Profile</name>\n  </types>'
const manifestXml = (body: string, root = `<Package xmlns="${META}">`) => `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n${body}\n  <version>66.0</version>\n</Package>\n`
const packageOnly = (xml: string, extra: { path: string; text: string }[] = []) => [{ path: 'package.xml', bytes: Buffer.from(xml) }, ...extra.map(item => ({ path: item.path, bytes: Buffer.from(item.text) }))]

/** Each of these hides ApexClass:Widget from a reader that looks for `<name>` and `<members>`, next to an ordinary block that keeps the file looking valid. */
const SPELLINGS: [string, string][] = [
  ['a space inside the closing tag', '  <types>\n    <members>Widget</members>\n    <name >ApexClass</name >\n  </types>'],
  ['a CDATA type name', '  <types>\n    <members>Widget</members>\n    <name><![CDATA[ApexClass]]></name>\n  </types>'],
  ['a CDATA member', '  <types>\n    <members><![CDATA[Widget]]></members>\n    <name>ApexClass</name>\n  </types>'],
  ['an attribute on <types>', '  <types xmlns="urn:other">\n    <members>Widget</members>\n    <name>ApexClass</name>\n  </types>'],
  ['an attribute on <members>', '  <types>\n    <members id="1">Widget</members>\n    <name>ApexClass</name>\n  </types>'],
  ['prefixed tags', '  <sf:types>\n    <sf:members>Widget</sf:members>\n    <sf:name>ApexClass</sf:name>\n  </sf:types>'],
  ['two names in one block', '  <types>\n    <members>Widget</members>\n    <name>Profile</name>\n    <name>ApexClass</name>\n  </types>'],
  ['a numeric entity in the name', '  <types>\n    <members>Widget</members>\n    <name>&#65;pexClass</name>\n  </types>'],
  ['a hex entity in the name', '  <types>\n    <members>Widget</members>\n    <name>&#x41;pexClass</name>\n  </types>'],
  ['an unknown entity', '  <types>\n    <members>Widget</members>\n    <name>&Apex;Class</name>\n  </types>'],
  ['a comment inside the block', '  <types>\n    <members>Widget</members>\n    <!-- <name>Profile</name> -->\n    <name>ApexClass</name>\n  </types>'],
  ['a comment in the name', '  <types>\n    <members>Widget</members>\n    <name>Apex<!-- x -->Class</name>\n  </types>'],
  ['spaces around the name', '  <types>\n    <members>Widget</members>\n    <name> ApexClass </name>\n  </types>'],
  ['spaces around a member', '  <types>\n    <members> Widget</members>\n    <name>ApexClass</name>\n  </types>'],
  ['an empty block', '  <types>\n    <name>ApexClass</name>\n  </types>'],
  ['a block with no name', '  <types>\n    <members>Widget</members>\n  </types>'],
  ['a self-closing tag', '  <types>\n    <members>Widget</members>\n    <name>ApexClass</name>\n    <members/>\n  </types>'],
  ['an element nobody asked for', '  <types>\n    <members>Widget</members>\n    <name>ApexClass</name>\n    <fullName>Widget</fullName>\n  </types>'],
]

for (const [name, types] of SPELLINGS) {
  test(`a manifest with ${name} is refused, and says why, instead of reading as fewer members`, () => {
    const result = manifestOf(packageOnly(manifestXml(`${types}\n${OTHER_TYPES}`)))
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /package\.xml isn't in the plain form/)
    assert.match(result.problem, /nothing was planned from it/)
  })
}

for (const [name, xml] of [
  ['a comment before the root', `<?xml version="1.0" encoding="UTF-8"?>\n<!-- hi -->\n<Package xmlns="${META}">\n${PLAIN_TYPES}\n</Package>`],
  ['a doctype', `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Package [<!ENTITY a "b">]>\n<Package xmlns="${META}">\n${PLAIN_TYPES}\n</Package>`],
  ['another namespace', manifestXml(PLAIN_TYPES, '<Package xmlns="urn:other">')],
  ['a second attribute on the root', manifestXml(PLAIN_TYPES, `<Package xmlns="${META}" xmlns:sf="urn:other">`)],
  ['a prefixed root', manifestXml(PLAIN_TYPES, `<sf:Package xmlns:sf="${META}">`).replace('</Package>', '</sf:Package>')],
  ['text after the root', `${manifestXml(PLAIN_TYPES)}<Package xmlns="${META}">${OTHER_TYPES}</Package>`],
  ['a file cut short', manifestXml(PLAIN_TYPES).replace('</Package>\n', '')],
  ['a file that is not xml', 'ApexClass:Widget'],
  ['an empty file', ''],
] as [string, string][]) {
  test(`a manifest with ${name} is refused`, () => {
    const result = manifestOf(packageOnly(xml))
    assert.ok('problem' in result, JSON.stringify(result))
    assert.match(result.problem, /plain form/)
  })
}

test('a destructive file in another form is refused too, because it is read the same way', () => {
  for (const file of ['destructiveChanges.xml', 'destructiveChangesPre.xml', 'destructiveChangesPost.xml']) {
    const result = manifestOf(packageOnly(packageXml(['ApexClass:Widget']), [{ path: file, text: manifestXml('  <types>\n    <members>Old</members>\n    <name >CustomField</name >\n  </types>') }]))
    assert.ok('problem' in result, file)
    assert.match(result.problem, new RegExp(`${file.replace('.', '[.]')} isn't in the plain form`))
  }
})

test('the plain forms are read: Windows line ends, a byte order mark, no indentation, any order, and named entities', () => {
  const body = '<types><name>ApexClass</name><members>Widget</members><members>Other</members></types><version>66.0</version>'
  const compact = `<Package xmlns="${META}">${body}${OTHER_TYPES}</Package>`
  for (const xml of [compact, `﻿${compact}`, `<?xml version="1.0" encoding="UTF-8"?>\r\n${compact.replaceAll('><', '>\r\n<')}\r\n`]) {
    const result = manifestOf(packageOnly(xml))
    assert.ok(!('problem' in result), JSON.stringify(result))
    assert.deepEqual([...result.members].sort(), ['ApexClass:Other', 'ApexClass:Widget', 'Profile:Admin'])
  }
  const encoded = manifestOf(packageOnly(manifestXml('  <types>\n    <members>a&amp;b</members>\n    <name>ApexClass</name>\n  </types>')))
  assert.ok('problem' in encoded)
  assert.match(encoded.problem, /ApexClass:a&b/, 'the five named entities are decoded before the name is checked')
})

test('a manifest this service wrote reads back as it was written', () => {
  const members = ['ApexClass:Widget', 'ApexTrigger:WidgetTrigger', 'CustomField:Widget__c.Status__c', 'Profile:Admin']
  const result = manifestOf(packageOnly(packageXml(members)))
  assert.ok(!('problem' in result), JSON.stringify(result))
  assert.deepEqual([...result.members].sort(), [...members].sort())
})

test('a plan over a manifest in another form is refused at plan time, and nothing is read from the org', sandbox(async rigged => {
  const files = { 'package.xml': manifestXml(`${'  <types>\n    <members>Widget</members>\n    <name >ApexClass</name >\n  </types>'}\n${OTHER_TYPES}`), ...NEW }
  await assert.rejects(rigged.plan({}, files), /isn't in the plain form this service reads/)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

// ── files in the zip are compared with the manifest ──

const stored = (paths: Record<string, string>, members: string[]) => manifestOf(packageOnly(packageXml(members), Object.entries(paths).map(([path, text]) => ({ path, text }))))

test('a class file the manifest does not name is refused, whatever else the manifest names', () => {
  const result = stored({ 'classes/Widget.cls': 'x', 'classes/Widget.cls-meta.xml': '<x/>', 'classes/Sneaky.cls': 'evil' }, ['ApexClass:Widget', 'Profile:Admin'])
  assert.ok('problem' in result, JSON.stringify(result))
  assert.match(result.problem, /classes\/Sneaky\.cls/)
  assert.match(result.problem, /does not name ApexClass:Sneaky/)
})

test('a trigger, a page, a component, and a bundle the manifest does not name are refused', () => {
  for (const [path, why] of [['triggers/Evil.trigger', 'ApexTrigger:Evil'], ['triggers/Evil.trigger-meta.xml', 'ApexTrigger:Evil'], ['pages/Evil.page', 'ApexPage:Evil'], ['components/Evil.component', 'ApexComponent:Evil'], ['lwc/evil/evil.js', 'LightningComponentBundle:evil'], ['aura/evil/evil.cmp', 'AuraDefinitionBundle:evil']] as const) {
    const result = stored({ [path]: 'x' }, ['Profile:Admin'])
    assert.ok('problem' in result, path)
    assert.match(result.problem, new RegExp(`does not name ${why}`))
  }
})

test('code in the wrong place, or under a name this service cannot match, is refused', () => {
  for (const path of ['src/Evil.cls', 'src/Evil.trigger', 'Classes/Evil.cls', 'classes/sub/Evil.cls', 'classes/Evil.txt', 'classes/.cls', 'lwc/evil.js']) {
    const result = stored({ [path]: 'x' }, ['ApexClass:Evil'])
    assert.ok('problem' in result, path)
  }
})

test('files the manifest names, and kinds this check does not cover, pass', () => {
  const result = stored({ 'classes/Widget.cls': 'x', 'classes/Widget.cls-meta.xml': '<x/>', 'lwc/chip/chip.js': 'x', 'staticresources/logo.resource': 'x', 'profiles/Admin.profile': '<Profile/>' }, ['ApexClass:Widget', 'LightningComponentBundle:chip', 'StaticResource:logo', 'Profile:Admin'])
  assert.ok(!('problem' in result), JSON.stringify(result))
})

test('a plan over a folder with a class the manifest does not name is refused at plan time', sandbox(async rigged => {
  await assert.rejects(rigged.plan({}, { 'package.xml': PACKAGE, ...NEW, 'classes/Sneaky.cls': 'evil' }), /does not name ApexClass:Sneaky/)
}))

test('the manifest is read from the zip, with destructive changes as members too', () => {
  const entries = [
    { path: 'package.xml', bytes: Buffer.from(packageXml(['ApexClass:Widget', 'Profile:Admin'])) },
    { path: 'destructiveChangesPost.xml', bytes: Buffer.from(packageXml(['CustomField:Widget__c.Old__c'])) },
  ]
  const manifest = manifestOf(entries)
  assert.ok(!('problem' in manifest))
  assert.deepEqual(manifest.members, ['ApexClass:Widget', 'Profile:Admin'])
  assert.deepEqual(manifest.destructive, ['CustomField:Widget__c.Old__c'])
  assert.deepEqual(componentSummary(manifest, ['Profile:Admin']), [
    { type: 'ApexClass', added: ['Widget'], changed: [], deleted: [] },
    { type: 'CustomField', added: [], changed: [], deleted: ['Widget__c.Old__c'] },
    { type: 'Profile', added: [], changed: ['Admin'], deleted: [] },
  ])
})

// ── validating ───────────────────────────────────────────────────────────────

test('production validates with validate, and sandbox with start --dry-run, from the live flag', async () => {
  await production(async rigged => {
    await rigged.validate(await rigged.plan())
    const [call] = byCommand(rigged, 'project deploy validate')
    assert.ok(call, 'project deploy validate')
    assert.equal(call.flags['test-level'], 'RunLocalTests')
    assert.equal(call.flags['single-package'], true)
    assert.equal(call.flags.async, true)
    assert.equal(call.flags['target-org'], 'ada@example.com')
    assert.equal(byCommand(rigged, 'project deploy start').length, 0)
  })()
  await sandbox(async rigged => {
    await rigged.validate(await rigged.plan())
    const [call] = byCommand(rigged, 'project deploy start')
    assert.ok(call, 'project deploy start')
    assert.equal(call.flags['dry-run'], true)
    assert.equal(call.flags['test-level'], 'RunLocalTests')
    assert.equal(byCommand(rigged, 'project deploy validate').length, 0)
  })()
})

test('validating changes nothing in the org', sandbox(async rigged => {
  await rigged.validate(await rigged.plan())
  assert.equal(rigged.shipped().length, 0)
  assert.equal(fakeOrg(rigged.home).metadata['ApexClass:Widget']?.['classes/Widget.cls'], OLD['classes/Widget.cls'])
}))

test('a baseline is retrieved with the same manifest, before the check starts', sandbox(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const calls = fakeCalls(rigged.home).map(item => item.command)
  assert.ok(calls.indexOf('project retrieve start') < calls.indexOf('project deploy start'), calls.join())
  const record = readJson<{ baseline: { files: Record<string, string>; fetched: string[] } }>(validationFile(rigged, planId))
  assert.deepEqual(record?.baseline.fetched, ['ApexClass:Widget'])
  assert.ok(record?.baseline.files['classes/Widget.cls'])
}))

test('the job id is saved before anything polls, and a budget that runs out returns a status', sandbox(async rigged => {
  const planId = await rigged.plan()
  const result = await rigged.validate(planId)
  const data = result.data as { state: string; jobId: string; next: string }
  assert.equal(data.state, 'in-progress')
  assert.match(data.jobId, /^0Af/)
  assert.equal(readJson<{ jobId: string }>(validationFile(rigged, planId))?.jobId, data.jobId)
  // A later call picks up the same job.
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 1 } }))
  const later = await rigged.validate(planId)
  assert.equal((later.data as { state: string }).state, 'passed', JSON.stringify(later))
  assert.equal(fakeDeploys(rigged.home).length, 1)
}, { scenario: { deploy: { pollsUntilDone: 500 } } }))

for (const [name, deploy, shape] of [
  ['no tests ran', { noTests: true }, /tests/i],
  // Each of these flips one field alone, so removing either check on its own is caught (contract 8.8).
  ['the job ran with tests turned off, though tests completed', { testsOff: true }, /tests turned off/],
  ['the job completed no tests, though tests were turned on', { zeroTests: true }, /completed no tests/],
  ['a test failed', { testErrors: 2 }, /test/i],
  ['a component failed', { componentErrors: 1 }, /component/i],
  ['the job failed', { validationFails: true }, /Failed|succeed/],
  ['the org says it was not check-only', { pretendNotCheckOnly: true }, /check-only/],
] as const) {
  test(`a validation does not count when ${name}`, sandbox(async rigged => {
    const planId = await rigged.plan()
    const result = await rigged.validate(planId)
    const data = result.data as { state: string; problems: string[] }
    assert.equal(data.state, 'failed', JSON.stringify(result))
    assert.match(data.problems.join(' '), shape)
    refused(await rigged.prepare(planId), /validat/i)
    assert.equal(rigged.shipped().length, 0)
  }, { scenario: { deploy } }))
}

test('a rate limit on validate says it did not validate, and did not retry', sandbox(async rigged => {
  const planId = await rigged.plan()
  rigged.rescenario(scenario => ({ ...scenario, mode: 'rate-limit', modeOn: 'project deploy start' }))
  const result = await rigged.validate(planId)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result), /rate limit/i)
  assert.equal(readJson(validationFile(rigged, planId)), null, 'no job was recorded')
  assert.equal(byCommand(rigged, 'project deploy start').length, 1)
}))

test('--ignore-warnings goes out only when the approved plan names it', sandbox(async rigged => {
  await rigged.validate(await rigged.plan())
  assert.equal(byCommand(rigged, 'project deploy start')[0]?.flags['ignore-warnings'], undefined)
  await rigged.validate(await rigged.plan({ ignoreWarnings: true }))
  assert.equal(byCommand(rigged, 'project deploy start')[1]?.flags['ignore-warnings'], true)
}))

test('a plan that names --ignore-warnings says so on the screen, and is hashed with it', sandbox(async rigged => {
  const { reply } = await rigged.ready({ ignoreWarnings: true })
  assert.match(buildApprovalScreen(reply.screenPlan, reply.facts).text, /Ignores warnings/)
  reported(await rigged.run(reply.pinned))
  const applies = byCommand(rigged, 'project deploy start').filter(item => item.flags['dry-run'] === undefined)
  assert.equal(applies[0]?.flags['ignore-warnings'], true)
}))

test('both project forms sit behind one function, so the live check can flip it', () => {
  assert.equal(DEPLOY_WORKSPACE, 'temp-project')
  const dir = mkdtempSync(join(tmpdir(), 'sf-workspace-'))
  try {
    prepareDeployWorkspace(dir, 'bare')
    assert.equal(existsSync(join(dir, 'sfdx-project.json')), false)
    prepareDeployWorkspace(dir, 'temp-project')
    assert.equal(existsSync(join(dir, 'sfdx-project.json')), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a deploy runs from a temp project, so a CLI that needs one gets one', sandbox(async rigged => {
  const result = await rigged.validate(await rigged.plan())
  assert.equal((result.data as { state: string }).state, 'passed', JSON.stringify(result))
  const [call] = byCommand(rigged, 'project deploy start')
  assert.equal(call?.cwd.startsWith(rigged.home.project), false)
}, { scenario: { deploy: { needsProject: true } } }))

// ── the screen ───────────────────────────────────────────────────────────────

test('the screen comes from the zip, with what a redeploy can not restore first', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.approveLabel, 'Deploy 1 component to Sandbox')
  assert.ok(screen.text.indexOf("What a redeploy can't restore") < screen.text.indexOf('Class: Sandbox'))
  assert.match(screen.text, /"ApexClass": 0 added, 1 changed, 0 deleted/)
  assert.match(screen.text, /Flags: Runs code\./)
  assert.match(screen.text, /Validated with test level: RunLocalTests/)
  assert.match(screen.text, /Job id: 0Af/)
  assert.match(screen.text, /Job age: /)
}))

test('deletes are found in the zip, whatever the plan said', sandbox(async rigged => {
  const { reply } = await rigged.ready({ destructive: false }, { 'package.xml': PACKAGE, ...NEW, 'destructiveChanges.xml': packageXml(['CustomField:Widget__c.Old__c']) })
  const { text } = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.match(text, /Deletes\./)
  assert.match(text, /"CustomField": 0 added, 0 changed, 1 deleted/)
}, { scenario: { metadata: { 'ApexClass:Widget': OLD, 'CustomField:Widget__c.Old__c': { 'objects/Widget__c.object': '<x/>' } } } }))

test('Profile and PermissionSet say Changes access', sandbox(async rigged => {
  const files = { 'package.xml': packageXml(['Profile:Admin', 'PermissionSet:Widget_User']), 'profiles/Admin.profile': '<Profile/>', 'permissionsets/Widget_User.permissionset': '<PermissionSet/>' }
  const { reply } = await rigged.ready({}, files)
  assert.match(buildApprovalScreen(reply.screenPlan, reply.facts).text, /Changes access or opens an outbound path\./)
}))

test('production needs the typed org name', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const reply = (await rigged.prepare(planId)) as DeployApproveReply
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.requiresTypedOrgName, true)
  assert.equal(approvalAccepted(screen, screen.approveLabel), false)
  assert.equal(approvalAccepted(screen, 'Acme Production'), true)
}))

// ── before applying ──────────────────────────────────────────────────────────

test('no validation, no dialog', sandbox(async rigged => {
  refused(await rigged.prepare(await rigged.plan()), /deployment_validate/)
}))

for (const mode of ['validate', 'read-only'] as const) {
  test(`mode ${mode} can not deploy, in either step`, sandbox(async rigged => {
    const { planId, reply } = await rigged.ready()
    refused(await rigged.prepare(planId, { mode }), /does not run/)
    refused(await rigged.run(reply.pinned, { mode }), /does not run/)
    assert.equal(rigged.shipped().length, 0)
  }))
}

test('the brief is compared with what a person confirmed, in both steps', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  refused(await rigged.prepare(planId, { brief: null }), /confirm/)
  refused(await rigged.run(reply.pinned, { brief: 'b'.repeat(64) }), /confirm/)
  assert.equal(rigged.shipped().length, 0)
}))

test('on a sandbox, a Setup Audit Trail nobody can read goes on the screen first', sandbox(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  rigged.rescenario(scenario => ({ ...scenario, queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }, ...(scenario.queries as unknown[])] }))
  const reply = await rigged.prepare(planId)
  assert.equal((reply as { action?: string }).action, 'approve', JSON.stringify(reply))
  assert.match(buildApprovalScreen((reply as DeployApproveReply).screenPlan, (reply as DeployApproveReply).facts).text, /^Couldn't check:/)
}))

test('on production, a Setup Audit Trail nobody can read refuses the deploy, and names the permission to grant', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  rigged.rescenario(scenario => ({ ...scenario, queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }, ...(scenario.queries as unknown[])] }))
  const reply = await rigged.prepare(planId)
  refused(reply, /View Setup and Configuration/)
  refused(reply, /nothing shipped/i)
  assert.equal(rigged.shipped().length, 0)
}))

test('a zip swapped on disk after validating stops it', sandbox(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  writeFileSync(zipFile(rigged, planId), writeZip([{ path: 'package.xml', bytes: Buffer.from(PACKAGE) }, { path: 'classes/Widget.cls', bytes: Buffer.from('evil') }]))
  refused(await rigged.prepare(planId), /zip/i)
  assert.equal(rigged.shipped().length, 0)
}))

test('a zip with the same contents and other bytes is not the one validated: the hash is over the bytes', sandbox(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const bytes = readFileSync(zipFile(rigged, planId))
  // The date on the first entry. Nothing that reads the contents looks at it.
  bytes.writeUInt16LE(0x0022, 12)
  assert.equal(contentHashOf(readZip(bytes)), readJson<{ plan: { artifactHash: string } }>(planFile(rigged.home.project, planId))?.plan.artifactHash)
  writeFileSync(zipFile(rigged, planId), bytes)
  refused(await rigged.prepare(planId), /not the one that was validated/)
}))

test('a zip swapped during the dialog stops the write', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  writeFileSync(zipFile(rigged, planId), writeZip([{ path: 'package.xml', bytes: Buffer.from(PACKAGE) }, { path: 'classes/Widget.cls', bytes: Buffer.from('evil') }]))
  refused(await rigged.run(reply.pinned), /zip/i)
  assert.equal(rigged.shipped().length, 0)
}))

/** F8 attack 2: a file names a job. Salesforce is what's asked. */
test('a job id swapped in the record, for a job with another component list, stops it', production(async rigged => {
  const decoy = await rigged.plan({}, { 'package.xml': packageXml(['ApexClass:Decoy']), 'classes/Decoy.cls': 'evil' })
  await rigged.validate(decoy)
  const decoyJob = readJson<{ jobId: string }>(validationFile(rigged, decoy))?.jobId as string
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const record = readJson<Record<string, unknown>>(validationFile(rigged, planId)) as Record<string, unknown>
  writeJson(validationFile(rigged, planId), { ...record, jobId: decoyJob })
  refused(await rigged.prepare(planId), /component list/i)
  assert.equal(rigged.shipped().length, 0)
  assert.equal(byCommand(rigged, 'project deploy quick').length, 0)
}))

test('a job that some other user started stops it', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  refused(await rigged.prepare(planId), /user/i)
}, { scenario: { deploy: { createdBy: '00500000000000ZZZZ' } } }))

test('a job older than the margin stops it, counted from when it started', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  refused(await rigged.prepare(planId), /days|old/i)
  assert.ok(VALIDATION_MAX_AGE_MS < 10 * 24 * 60 * 60 * 1000, 'with margin')
}, { scenario: { deploy: { startDate: new Date(Date.now() - 9.5 * 24 * 60 * 60 * 1000).toISOString() } } }))

test('a job one day old is fine', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  assert.equal((await rigged.approve(planId)).action, 'approve')
}, { scenario: { deploy: { startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() } } }))

test('the CLI job cache pointing this job at another org stops it, because that cache beats the flag', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const jobId = readJson<{ jobId: string }>(validationFile(rigged, planId))?.jobId as string
  const dir = join(rigged.home.env.HOME as string, '.sf')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'deploy-cache.json'), JSON.stringify({ [jobId]: { 'target-org': 'grace@example.com', timestamp: new Date().toISOString() } }))
  const before = byCommand(rigged, 'project deploy report').length
  refused(await rigged.prepare(planId), /cache/i)
  assert.equal(byCommand(rigged, 'project deploy report').length, before)
}))

test('a plan edit voids everything after it', sandbox(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const file = planFile(rigged.home.project, planId)
  const stored = readJson<{ plan: Record<string, unknown>; planHash: string }>(file) as { plan: Record<string, unknown>; planHash: string }
  writeJson(file, { ...stored, plan: { ...stored.plan, destructive: true } })
  refused(await rigged.prepare(planId), /edited/)
}))

// ── drift ────────────────────────────────────────────────────────────────────

function drift(rigged: Rig): void {
  changeFakeOrg(rigged.home, org => {
    const files = org.metadata['ApexClass:Widget'] as Record<string, string>
    files['classes/Widget.cls'] = 'public class Widget { /* someone in Setup */ }'
  })
}

test('sandbox: drift after validating stops the deploy, before anything ships', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  drift(rigged)
  refused(await rigged.run(reply.pinned), /drift|changed since/i)
  assert.equal(rigged.shipped().length, 0)
  assert.equal(byCommand(rigged, 'project deploy start').filter(item => item.flags['dry-run'] === undefined).length, 0)
}))

test('production: drift after validating stops the quick deploy', production(async rigged => {
  const { reply } = await rigged.ready()
  drift(rigged)
  refused(await rigged.run(reply.pinned), /drift|changed since/i)
  assert.equal(rigged.shipped().length, 0)
  assert.equal(byCommand(rigged, 'project deploy quick').length, 0)
}))

test('a component that appeared since the baseline is drift too', sandbox(async rigged => {
  const files = { 'package.xml': packageXml(['ApexClass:Widget', 'ApexClass:Brand_New']), ...NEW, 'classes/Brand_New.cls': 'x', 'classes/Brand_New.cls-meta.xml': '<ApexClass/>' }
  const { reply } = await rigged.ready({}, files)
  changeFakeOrg(rigged.home, org => {
    org.metadata['ApexClass:Brand_New'] = { 'classes/Brand_New.cls': 'someone made this' }
  })
  refused(await rigged.run(reply.pinned), /drift|changed since/i)
}))

test('the drift retrieve is saved as the rollback snapshot, with its hash journaled, before anything ships', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  await rigged.run(reply.pinned, {
    onStep: step => {
      if (step !== 'send') return
      const file = localFile(rigged.home.store, rigged.home.project, 'snapshots', planId).replace(/\.json$/, '.zip')
      assert.equal(existsSync(file), true)
      const entries = readZip(readFileSync(file))
      assert.equal(entries.find(item => item.path === 'classes/Widget.cls')?.bytes.toString(), OLD['classes/Widget.cls'])
      assert.ok(entries.some(item => item.path === 'package.xml'))
      assert.equal(rigged.shipped().length, 0)
      assert.ok(readJournal(rigged.home.project, planId).some(line => line.event === 'preimage.saved' && /^[a-f0-9]{64}$/.test(String(line.hash))))
    },
  })
}))

test('no snapshot, no deploy', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  mkdirSync(localFile(rigged.home.store, rigged.home.project, 'snapshots', planId).replace(/\.json$/, '.zip'), { recursive: true })
  refused(await rigged.run(reply.pinned), /snapshot/i)
  assert.equal(rigged.shipped().length, 0)
}))

test('a retrieve that names components and leaves no files reads as unknown, and never as no drift', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, retrieveLeavesNoFiles: true }))
  refused(await rigged.run(reply.pinned), /left no files|retriev/i)
  assert.equal(rigged.shipped().length, 0)
}))

test('a long component list is cut on the screen, and its counts stay exact', sandbox(async rigged => {
  const names = Array.from({ length: 40 }, (_, index) => `Widget_${index}`)
  const files: Record<string, string> = { 'package.xml': packageXml(names.map(name => `ApexClass:${name}`)) }
  for (const name of names) files[`classes/${name}.cls`] = 'x'
  const { reply } = await rigged.ready({}, files)
  const { text } = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.match(text, /"ApexClass": 40 added, 0 changed, 0 deleted/)
  assert.match(text, /and 30 more not listed/)
}))

test('a failed drift retrieve stops it, and never reads as no drift', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, mode: 'unexplained', modeOn: 'project retrieve start' }))
  refused(await rigged.run(reply.pinned), /retriev|read/i)
  assert.equal(rigged.shipped().length, 0)
}))

test('identity that moved during the dialog stops the deploy', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, org: { Id: '00D000000000009AAA' }, queries: [{ match: 'FROM Organization', result: { records: [{ Id: '00D000000000009AAA', Name: 'Other', IsSandbox: true, OrganizationType: 'x', InstanceName: 'y' }], totalSize: 1, done: true } }, ...(scenario.queries as unknown[])] }))
  refused(await rigged.run(reply.pinned), /org id|registered/i)
  assert.equal(rigged.shipped().length, 0)
}))

// ── applying ─────────────────────────────────────────────────────────────────

test('sandbox: start with the same zip, and no test level of its own', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'done')
  const [dryRun, apply] = byCommand(rigged, 'project deploy start')
  assert.equal(dryRun?.flags['dry-run'], true)
  assert.equal(apply?.flags['dry-run'], undefined)
  assert.equal(apply?.flags['metadata-dir'], zipFile(rigged, planId))
  assert.equal(fakeDeploys(rigged.home)[0]?.zipSha, fakeDeploys(rigged.home)[1]?.zipSha)
  assert.equal(byCommand(rigged, 'project deploy quick').length, 0)
}))

test('production: quick by job id with a target, and never a start', production(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  const jobId = readJson<{ jobId: string }>(validationFile(rigged, planId))?.jobId
  const reply = await rigged.approve(planId)
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'done')
  const [quick] = byCommand(rigged, 'project deploy quick')
  assert.equal(quick?.flags['job-id'], jobId)
  assert.equal(quick?.flags['target-org'], 'ada@example.com')
  assert.equal(quick?.argv.some(word => word.includes('use-most-recent')), false)
  assert.equal(byCommand(rigged, 'project deploy start').length, 0)
  assert.equal(rigged.shipped().length, 1)
}))

test('a refused validation means revalidate, and no path falls back to a full deploy', production(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { quickRefused: true } }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'refused')
  assert.match(String(data.next), /revalidate|deployment_validate/i)
  assert.match(String(data.next), /never a full deploy/i)
  assert.equal(byCommand(rigged, 'project deploy start').length, 0, 'no full deploy, not even a check')
  assert.equal(rigged.shipped().length, 0)
  // That job is spent, so nothing offers it again without a new validation.
  refused(await rigged.prepare(planId), /refused/)
  // Revalidating, then a new approval, gets it through.
  rigged.rescenario(({ deploy: _gone, ...rest }) => rest)
  const validated = await rigged.validate(planId, { revalidate: true })
  assert.equal((validated.data as { state: string }).state, 'passed', JSON.stringify(validated))
  reported(await rigged.run((await rigged.approve(planId)).pinned))
  assert.equal(rigged.shipped().length, 1)
}))

test('a job refused between the dialog and the write stops before quick, and asks to revalidate', production(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { createdBy: '00500000000000ZZZZ' } }))
  changeFakeOrg(rigged.home, org => {
    for (const deploy of Object.values(org.deploys)) deploy.createdBy = '00500000000000ZZZZ'
  })
  refused(await rigged.run(reply.pinned), /revalidat/i)
  assert.equal(byCommand(rigged, 'project deploy quick').length, 0)
  assert.equal(byCommand(rigged, 'project deploy start').length, 0)
}))

test('a sandbox deploy that fails is not retried', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { applyFails: true } }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.jobStatus, 'Failed')
  assert.equal(byCommand(rigged, 'project deploy start').filter(item => item.flags['dry-run'] === undefined).length, 1)
  assert.notEqual((await rigged.prepare(planId) as { action?: string }).action, 'approve')
}))

test('the deploy id is on the ledger before the first poll', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  await rigged.run(reply.pinned, {
    onStep: step => {
      if (step !== 'sent') return
      const ledger = readLedger(rigged.home.store, rigged.home.project, planId) as { state: string; entry: DeployLedger }
      assert.equal(ledger.state, 'started')
      assert.match(String(ledger.entry.deployId), /^0Af/)
    },
  })
}))

test('a deploy still running comes back as a status, and the next call queries it, never retries', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 500 } }))
  const data = reported(await rigged.run(reply.pinned, { pollBudgetMs: 0 }))
  assert.equal(data.status, 'started')
  assert.match(String(data.deployId), /^0Af/)
  const applies = () => byCommand(rigged, 'project deploy start').filter(item => item.flags['dry-run'] === undefined).length
  assert.equal(applies(), 1)
  const next = await rigged.prepare(planId)
  assert.equal(reported(next).status, 'started')
  assert.equal(applies(), 1)
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 1 } }))
  assert.equal(reported(await rigged.prepare(planId)).status, 'done')
  assert.equal(applies(), 1)
  assert.equal(rigged.shipped().length, 1)
}))

test('a CLI killed on the apply call is unknown, and it is never retried', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, mode: 'not-json', modeOn: 'project deploy start' }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'unknown')
  assert.match(String(data.next), /never retried|not retried|query/i)
  rigged.rescenario(({ mode: _m, modeOn: _o, ...rest }) => rest)
  const applies = byCommand(rigged, 'project deploy start').length
  assert.notEqual((await rigged.prepare(planId) as { action?: string }).action, 'approve')
  assert.equal(byCommand(rigged, 'project deploy start').length, applies)
}))

const DEATHS: DeployStep[] = ['identity', 'zip', 'job', 'drift', 'ledger', 'send', 'sent', 'poll', 'verify', 'finish']

class Death extends Error {}

for (const step of DEATHS) {
  test(`dying at ${step}: a deploy that may have landed is queried, and nothing ships twice`, sandbox(async rigged => {
    const { planId, reply } = await rigged.ready()
    await assert.rejects(rigged.run(reply.pinned, { onStep: seen => { if (seen === step) throw new Death(step) } }), Death)
    const applies = () => byCommand(rigged, 'project deploy start').filter(item => item.flags['dry-run'] === undefined).length
    const landedApply = applies()
    const next = await rigged.prepare(planId)
    if ((next as { action?: string }).action === 'approve') {
      assert.equal(landedApply, 0, 'a dialog is only on offer when nothing was sent')
      reported(await rigged.run((next as DeployApproveReply).pinned))
    }
    assert.ok(applies() <= 1, `${applies()} deploys started`)
    assert.ok(rigged.shipped().length <= 1)
  }))
}

test('a deleted deploy ledger can not cause a second deploy: the journal finds the deploy, and it is queried', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  rmSync(localFile(rigged.home.store, rigged.home.project, 'ledger', planId))
  const data = reported(await rigged.prepare(planId))
  assert.equal(data.status, 'done')
  assert.equal(rigged.shipped().length, 1)
  assert.equal(byCommand(rigged, 'project deploy start').filter(item => item.flags['dry-run'] === undefined).length, 1)
}))

test('a deleted ledger and a deleted journal: drift against the baseline is what stops a second deploy', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  rmSync(localFile(rigged.home.store, rigged.home.project, 'ledger', planId))
  rmSync(join(rigged.home.project, '.topia', 'salesforce', 'journal'), { recursive: true, force: true })
  const again = await rigged.prepare(planId)
  if ((again as { action?: string }).action === 'approve') refused(await rigged.run((again as DeployApproveReply).pinned), /drift|changed since/i)
  assert.equal(rigged.shipped().length, 1)
}))

test('a truncated deploy ledger stops: it queries from the journal, and leaves the file as evidence', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  const file = localFile(rigged.home.store, rigged.home.project, 'ledger', planId)
  const damaged = readFileSync(file, 'utf8').slice(0, 30)
  writeFileSync(file, damaged)
  const data = reported(await rigged.prepare(planId))
  assert.equal(data.status, 'unreadable')
  assert.equal(data.jobStatus, 'Succeeded')
  assert.equal(readFileSync(file, 'utf8'), damaged)
  assert.equal(rigged.shipped().length, 1)
}))

test('a canceled deploy does not offer a rollback of something that did not land', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 500 } }))
  reported(await rigged.run(reply.pinned, { pollBudgetMs: 0 }))
  const dialog = await rigged.approve(planId, { cancel: true })
  const data = reported(await rigged.run(dialog.pinned))
  assert.equal(data.canceled, true)
  assert.equal(data.rollback, undefined)
}))

// ── after applying ───────────────────────────────────────────────────────────

test('a planned change showing neither changed nor created fails, even with success: true', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { unchanged: ['ApexClass:Widget'] } }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.checks.components, 'failed')
  assert.equal(data.jobStatus, 'Succeeded')
  assert.match(JSON.stringify(data.failedChecks), /ApexClass:Widget/)
  assert.equal(readLedger(rigged.home.store, rigged.home.project, planId).state, 'partial')
}))

test('a re-retrieve that does not match what shipped fails', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { landsAs: { 'ApexClass:Widget': { 'classes/Widget.cls': 'something else', 'classes/Widget.cls-meta.xml': '<ApexClass/>' } } } }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.checks.retrieve, 'failed')
}))

test('Setup Audit Trail is read, and one that can not be read is not called passed', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }, ...(scenario.queries as unknown[])] }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.checks.audit, 'could-not-check')
  assert.equal(data.status, 'partial')
  assert.ok(fakeCalls(rigged.home).some(item => (item.soql ?? '').includes('FROM SetupAuditTrail')))
}))

test('the audit check says it read the trail, and a finished deploy does not claim the trail was compared with anything', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(data.checks.audit, 'passed')
  assert.doesNotMatch(String(data.next), /every check passed/)
  assert.match(String(data.next), /read, not judged|read but not judged/)
}))

test('a failed post-deploy check stays failed, however often it is read again', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { unchanged: ['ApexClass:Widget'] } }))
  reported(await rigged.run(reply.pinned))
  rigged.rescenario(({ deploy: _gone, ...rest }) => rest)
  for (let round = 0; round < 2; round += 1) {
    const verified = await rigged.verify(planId)
    assert.equal((verified.data as { status: string }).status, 'partial', JSON.stringify(verified))
    assert.equal((verified.data as { checks: { components: string } }).checks.components, 'failed')
  }
  const reread = await rigged.prepare(planId)
  assert.equal(reported(reread).status, 'partial')
}))

test('SucceededPartial is partial, never done', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { endStatus: 'SucceededPartial' } }))
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.jobStatus, 'SucceededPartial')
}))

test('identity after a deploy that differs says written to the wrong org', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  const data = reported(await rigged.run(reply.pinned, {
    onStep: step => {
      if (step !== 'verify') return
      rigged.rescenario(scenario => ({ ...scenario, queries: [{ match: 'FROM Organization', result: { records: [{ Id: '00D000000000009AAA', Name: 'Other', IsSandbox: true, OrganizationType: 'x', InstanceName: 'y' }], totalSize: 1, done: true } }, ...(scenario.queries as unknown[])] }))
    },
  }))
  assert.equal(data.status, 'unknown')
  assert.match(String(data.wrongOrg), /written to the wrong org/i)
  assert.equal(data.checks.identity, 'failed')
}))

test('the deploy is journaled the way the audit comparison reads it', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  const line = readJournal(rigged.home.project, planId).find(item => item.event === 'change.executed')
  assert.ok(line)
  assert.equal(line.orgId, ORG)
  assert.equal(line.counts?.rows, 1)
  assert.ok(Date.parse(line.at) > 0)
  assert.ok(readJournal(rigged.home.project, planId).some(item => item.event === 'change.started' && /^0Af/.test(String(item.jobId))))
}))

test('the result offers a redeploy as a new plan, with what it can not restore first', sandbox(async rigged => {
  const { reply } = await rigged.ready()
  const data = reported(await rigged.run(reply.pinned))
  assert.match(String(data.rollback), /new plan/)
  assert.ok(String(data.rollback).indexOf("can't restore") < String(data.rollback).indexOf('rollbackOf'))
  assert.match(String(data.rollback), /deleted field data/)
}))

// ── the rollback snapshot as a plan ──────────────────────────────────────────

test('a redeploy of the snapshot is a new plan with its own validation and dialog', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  assert.equal(fakeOrg(rigged.home).metadata['ApexClass:Widget']?.['classes/Widget.cls'], NEW['classes/Widget.cls'])
  const rollback = await rigged.plan({ rollbackOf: planId, artifactPath: undefined })
  await rigged.validate(rollback)
  const again = await rigged.approve(rollback)
  const { text } = buildApprovalScreen(again.screenPlan, again.facts)
  assert.match(text, /What a redeploy can't restore/)
  assert.match(text, /deleted field data/)
  assert.match(text, /rollback snapshot/i)
  reported(await rigged.run(again.pinned))
  assert.equal(fakeOrg(rigged.home).metadata['ApexClass:Widget']?.['classes/Widget.cls'], OLD['classes/Widget.cls'])
}))

test('a redeploy can not name a plan with no snapshot', sandbox(async rigged => {
  const planId = await rigged.plan()
  await assert.rejects(rigged.plan({ rollbackOf: planId, artifactPath: undefined }))
}))

test('a plan names an artifact or a snapshot, not both and not neither', sandbox(async rigged => {
  await assert.rejects(rigged.plan({ artifactPath: undefined }))
}))

test('/topia:sf:restore on a deploy gives guidance, with what a redeploy can not restore first', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  const before = rigged.shipped().length
  const answer = await prepareRestore(rigged.adapter, contextFor(rigged.home, { now: Date.now(), hookHost: true }), { planId, briefId: rigged.briefId }, rigged.briefHash, 'execute')
  assert.equal(answer.ok, true, JSON.stringify(answer))
  const data = (answer as { data: Record<string, any> }).data
  assert.equal(data.class, 'forward-only')
  assert.match(String(data.guidance), /deleted field data/)
  assert.match(String(data.next), /rollbackOf/)
  assert.equal(rigged.shipped().length, before)
}))

// ── canceling ────────────────────────────────────────────────────────────────

test('a cancel takes its own dialog, finishes only at Canceled, and is followed by a verify', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 500 } }))
  reported(await rigged.run(reply.pinned, { pollBudgetMs: 0 }))
  const dialog = await rigged.approve(planId, { cancel: true })
  const screen = buildApprovalScreen(dialog.screenPlan, dialog.facts)
  assert.match(screen.approveLabel, /^Cancel deploy in Sandbox$/)
  assert.match(screen.text, /may already have been committed|can't be stopped/i)
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 500, cancelPolls: 1 } }))
  const data = reported(await rigged.run(dialog.pinned))
  assert.equal(data.jobStatus, 'Canceled')
  assert.equal(data.canceled, true)
  assert.equal(data.checks.retrieve, 'passed', 'the org still matches the snapshot')
  assert.equal(rigged.shipped().length, 0)
  assert.equal(byCommand(rigged, 'project deploy cancel').length, 1)
  assert.equal(byCommand(rigged, 'project deploy cancel')[0]?.flags.async, true)
}))

test('a cancel still Canceling is not stopped, and says so', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 500 } }))
  reported(await rigged.run(reply.pinned, { pollBudgetMs: 0 }))
  const dialog = await rigged.approve(planId, { cancel: true })
  rigged.rescenario(scenario => ({ ...scenario, deploy: { pollsUntilDone: 500, cancelStuck: true } }))
  const data = reported(await rigged.run(dialog.pinned, { pollBudgetMs: 0 }))
  assert.equal(data.status, 'started')
  assert.equal(data.jobStatus, 'Canceling')
  assert.equal(data.canceled, false)
  assert.match(String(data.next), /not stopped|isn't stopped/i)
}))

test('there is nothing to cancel with no deploy started', sandbox(async rigged => {
  const { planId } = await rigged.ready()
  refused(await rigged.prepare(planId, { cancel: true }), /nothing to cancel|no deploy/i)
}))

// ── reading the CLI's answers ────────────────────────────────────────────────

test('exit codes: 0, 1, 68, and 69 keep their meanings, and the status in the body is what is believed', () => {
  const body = (status: string) => JSON.stringify({ status: 0, result: { id: '0Af000000000001AAA', status, done: true, success: status === 'Succeeded', checkOnly: false, numberTestErrors: 0, numberComponentErrors: 0, numberTestsCompleted: 0, details: {} } })
  for (const [code, status] of [[0, 'Succeeded'], [1, 'Failed'], [1, 'Canceled'], [68, 'SucceededPartial'], [69, 'InProgress'], [69, 'Pending'], [69, 'Canceling']] as const) {
    const parsed = parseDeployRun({ outcome: 'exited', code, stdout: body(status), stderr: '' })
    assert.equal((parsed as { status: string }).status, status)
    assert.equal((parsed as { exit: number }).exit, code)
  }
})

test('any other exit, no JSON, a timeout, and a kill are all unknown', () => {
  assert.equal((parseDeployRun({ outcome: 'exited', code: 3, stdout: '{}', stderr: '' }) as { failure: string }).failure, 'unknown')
  assert.equal((parseDeployRun({ outcome: 'exited', code: 0, stdout: 'nope', stderr: '' }) as { failure: string }).failure, 'unknown')
  assert.equal((parseDeployRun({ outcome: 'timeout' }) as { failure: string }).failure, 'unknown')
  assert.equal((parseDeployRun({ outcome: 'signal', signal: 'SIGKILL' }) as { failure: string }).failure, 'unknown')
})

test('a refusal of the job has its own name, and nothing else reads as one', () => {
  const refusal = JSON.stringify({ name: 'CannotQuickDeployError', message: 'x', exitCode: 1 })
  assert.equal((parseDeployRun({ outcome: 'exited', code: 1, stdout: refusal, stderr: '' }) as { failure: string }).failure, 'validation-refused')
  const other = JSON.stringify({ name: 'SomethingElse', message: 'x', exitCode: 1 })
  assert.equal((parseDeployRun({ outcome: 'exited', code: 1, stdout: other, stderr: '' }) as { failure: string }).failure, 'unknown')
})

// ── verify ───────────────────────────────────────────────────────────────────

test('deployment_verify on a clean deploy reads it all, writes nothing, and says what it checked', sandbox(async rigged => {
  const { planId, reply } = await rigged.ready()
  reported(await rigged.run(reply.pinned))
  const shipped = rigged.shipped().length
  const verified = await rigged.verify(planId)
  assert.equal(verified.ok, true, JSON.stringify(verified))
  assert.equal(verified.sideEffect, false)
  const data = verified.data as { status: string; checks: Record<string, string> }
  assert.equal(data.status, 'done')
  assert.deepEqual(data.checks, { components: 'passed', retrieve: 'passed', audit: 'passed', identity: 'passed' })
  assert.equal(rigged.shipped().length, shipped)
}))

test('deployment_verify before any deploy says nothing has shipped', sandbox(async rigged => {
  const planId = await rigged.plan()
  const verified = await rigged.verify(planId)
  assert.equal((verified.data as { status: string }).status, 'missing')
}))

void contentHashOf

// ── production, with a writer ──

const WRITER_SIDE = { register: { singleUserAcceptedAt: undefined, writeAccess: { canWrite: 'no', reasons: [] } }, scenario: writerScenario() }

function withWriter(body: (rig: Rig) => Promise<void>): () => Promise<void> {
  return production(async rigged => {
    registerWriterFake(rigged.home, { isSandbox: false, name: 'Acme Production' })
    await body(rigged)
  }, WRITER_SIDE)
}

const LOGGED_OUT = (scenario: Record<string, unknown>) => ({ ...scenario, loggedOut: [WRITER] })

test('a production validate runs as the writer, because a quick deploy needs the same user', withWriter(async rigged => {
  const planId = await rigged.plan()
  const validated = await rigged.validate(planId)
  assert.equal((validated.data as { state?: string }).state, 'passed', JSON.stringify(validated))
  const started = fakeCalls(rigged.home).filter(item => item.command === 'project deploy validate')
  assert.equal(started.length, 1)
  assert.equal(started[0]?.flags['target-org'], WRITER)
}))

test('a production validate with the writer logged out refuses with the steps', withWriter(async rigged => {
  const planId = await rigged.plan()
  rigged.rescenario(LOGGED_OUT)
  const validated = await rigged.validate(planId)
  assert.equal(validated.ok, false)
  assert.match(JSON.stringify(validated.data), /sf org login web/)
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'project deploy validate'), false)
}))

test('a production deploy ships as the writer, and the result reminds the person to log it out', withWriter(async rigged => {
  const { reply } = await rigged.ready()
  assert.equal(reply.facts.identity.username, WRITER)
  const data = reported(await rigged.run(reply.pinned))
  assert.equal(data.status, 'done', JSON.stringify(data))
  assert.equal(fakeCalls(rigged.home).find(item => item.command === 'project deploy quick')?.flags['target-org'], WRITER)
  assert.match(String(data.afterThis), new RegExp(`sf org logout --target-org ${WRITER}`))
}))

test('a production deploy with the writer logged out refuses with the steps, and ships nothing', withWriter(async rigged => {
  const planId = await rigged.plan()
  await rigged.validate(planId)
  rigged.rescenario(LOGGED_OUT)
  refused(await rigged.prepare(planId), /sf org login web/)
  assert.equal(rigged.shipped().length, 0)
}))

test('a writer logged out between the dialog and the deploy stops it', withWriter(async rigged => {
  const { reply } = await rigged.ready()
  rigged.rescenario(LOGGED_OUT)
  refused(await rigged.run(reply.pinned), /sf org login web/)
  assert.equal(rigged.shipped().length, 0)
}))

test('production with no writer and no acceptance refuses a deploy, and a validate', production(async rigged => {
  const planId = await rigged.plan()
  const validated = await rigged.validate(planId)
  assert.equal(validated.ok, false)
  assert.match(JSON.stringify(validated.data), /no writer is registered/i)
  refused(await rigged.prepare(planId), /no writer is registered/i)
}, { register: { singleUserAcceptedAt: undefined, writeAccess: { canWrite: 'no', reasons: [] } } }))

test('a verify after the writer logged out reads as the reader, and says what it can', withWriter(async rigged => {
  const { planId, reply } = await rigged.ready()
  await rigged.run(reply.pinned)
  rigged.rescenario(LOGGED_OUT)
  const from = fakeCalls(rigged.home).length
  const read = await rigged.verify(planId)
  assert.equal(read.user, USERNAME)
  assert.equal(fakeCalls(rigged.home).slice(from).some(item => item.flags['target-org'] === WRITER && item.command !== 'data query'), false)
}))

test('a verify with the writer logged in reads as the writer', withWriter(async rigged => {
  const { planId, reply } = await rigged.ready()
  await rigged.run(reply.pinned)
  const read = await rigged.verify(planId)
  assert.equal(read.user, WRITER)
}))

// ── an org with no local Apex tests ──

test('production with no local tests can not validate, and hears why, and that no full deploy stands in', production(async rigged => {
  const planId = await rigged.plan()
  const validated = await rigged.validate(planId)
  assert.equal(validated.ok, false)
  const problems = (validated.data as { problems: string[] }).problems.join(' ')
  assert.match(problems, /no local Apex tests/)
  assert.match(problems, /quick deploy/)
  assert.match(problems, /full deploy is banned/)
  assert.match(problems, /Add a test class/)
  refused(await rigged.prepare(planId), /full deploy is banned/)
  assert.equal(rigged.shipped().length, 0)
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'project deploy start' && item.flags['dry-run'] !== true), false)
}, { scenario: { deploy: { noTests: true } } }))

test('a sandbox with no local tests is refused too, and the wording stays about validation', sandbox(async rigged => {
  const planId = await rigged.plan()
  const problems = ((await rigged.validate(planId)).data as { problems: string[] }).problems.join(' ')
  assert.match(problems, /completed no tests/)
  assert.doesNotMatch(problems, /quick deploy/)
}, { scenario: { deploy: { noTests: true } } }))

// ── review H3: validation that runs Apex needs a person ──

const LABELS = { 'package.xml': packageXml(['CustomLabels:CustomLabels']), 'labels/CustomLabels.labels-meta.xml': '<CustomLabels/>' }

test('H3: over stdio, a zip that holds Apex is refused, and nothing is sent to the org', sandbox(async rigged => {
  const planId = await rigged.plan()
  const stamped = await callTool(rigged.adapter, 'deployment_validate', { orgId: ORG, briefId: rigged.briefId, planId, [STAMP_KEY]: { mode: 'validate', agentId: null, confirmedBriefHash: rigged.briefHash, ack: null } }, contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: 'corr-h3' }))
  assert.equal(stamped.ok, false)
  assert.match(JSON.stringify(stamped.data), /holds Apex/)
  assert.equal(fakeDeploys(rigged.home).length, 0)
  assert.equal(fakeCalls(rigged.home).some(call => call.command.startsWith('project retrieve') || call.command.startsWith('project deploy')), false, 'not even the baseline retrieve ran')
}))

test('H3: over stdio, with no stamp, nothing is validated, even a zip with no Apex', sandbox(async rigged => {
  const planId = await rigged.plan({}, LABELS)
  const bare = await callTool(rigged.adapter, 'deployment_validate', { orgId: ORG, briefId: rigged.briefId, planId }, contextFor(rigged.home, { hookHost: false, now: Date.now(), correlationId: 'corr-h3b' }))
  assert.equal(bare.ok, false)
  assert.match(JSON.stringify(bare.data), /carries no stamp|read-only/)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

test('H3: over stdio, with a stamp, a zip with no Apex validates', sandbox(async rigged => {
  const planId = await rigged.plan({}, LABELS)
  const stamped = await callTool(rigged.adapter, 'deployment_validate', { orgId: ORG, briefId: rigged.briefId, planId, [STAMP_KEY]: { mode: 'validate', agentId: null, confirmedBriefHash: rigged.briefHash, ack: null } }, contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: 'corr-h3c', pollBudgetMs: 300, pollIntervalMs: 10 }))
  assert.equal((stamped.data as { state?: string }).state, 'passed', JSON.stringify(stamped))
  assert.equal(fakeDeploys(rigged.home).length, 1)
}))

test('H3: a model cannot send the approval flag through the tool', sandbox(async rigged => {
  const planId = await rigged.plan()
  const sent = await callTool(rigged.adapter, 'deployment_validate', { orgId: ORG, briefId: rigged.briefId, planId, apexApproved: true, [STAMP_KEY]: { mode: 'validate', agentId: null, confirmedBriefHash: rigged.briefHash, ack: null } }, contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: 'corr-h3d' }))
  assert.equal(sent.ok, false)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

test('H3: the person-gated validation names what runs in its dialog, and runs once answered', sandbox(async rigged => {
  const planId = await rigged.plan()
  const input = () => contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: `corr-${Date.now()}`, pollBudgetMs: 300, pollIntervalMs: 10 })
  const reply = await prepareValidate(rigged.adapter as never, input(), { planId }, rigged.briefHash, 'validate')
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal((reply as { action: string }).action, 'approve')
  assert.equal(fakeDeploys(rigged.home).length, 0, 'nothing runs before the dialog is answered')
  const screen = buildApprovalScreen((reply as ValidateApprove).screenPlan, (reply as ValidateApprove).facts)
  assert.match(screen.text, /runs code in the org/i)
  assert.match(screen.text, /Apex in this zip: "ApexClass Widget"/)
  const ran = await runValidate(rigged.adapter as never, input(), (reply as ValidateApprove).pinned, rigged.briefHash, 'validate')
  assert.equal(ran.ok, true, JSON.stringify(ran))
  assert.equal((ran as unknown as { data: { state: string } }).data.state, 'passed', JSON.stringify(ran))
  assert.equal(fakeDeploys(rigged.home).length, 1)
}))

test('H3: the person-gated validation needs a confirmed brief, and the right mode', sandbox(async rigged => {
  const planId = await rigged.plan()
  const input = () => contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: 'corr-h3e' })
  const noBrief = await prepareValidate(rigged.adapter as never, input(), { planId }, null, 'validate')
  assert.equal(noBrief.ok, false)
  const wrongMode = await prepareValidate(rigged.adapter as never, input(), { planId }, rigged.briefHash, 'plan')
  assert.equal(wrongMode.ok, false)
  assert.match((wrongMode as { reason: string }).reason, /does not run in plan mode/)
}))

test('H3: a pinned validation for a different plan hash runs nothing', sandbox(async rigged => {
  const planId = await rigged.plan()
  const input = () => contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: 'corr-h3f' })
  const reply = (await prepareValidate(rigged.adapter as never, input(), { planId }, rigged.briefHash, 'validate')) as ValidateApprove
  const ran = await runValidate(rigged.adapter as never, input(), { ...reply.pinned, planHash: 'f'.repeat(64) }, rigged.briefHash, 'validate')
  assert.equal(ran.ok, false)
  assert.equal(fakeDeploys(rigged.home).length, 0)
}))

test('H3: reading a validation already started opens no dialog', sandbox(async rigged => {
  const planId = await rigged.plan()
  const input = () => contextFor(rigged.home, { hookHost: true, now: Date.now(), correlationId: 'corr-h3g', pollBudgetMs: 300, pollIntervalMs: 10 })
  const first = (await prepareValidate(rigged.adapter as never, input(), { planId }, rigged.briefHash, 'validate')) as ValidateApprove
  await runValidate(rigged.adapter as never, input(), first.pinned, rigged.briefHash, 'validate')
  const again = await prepareValidate(rigged.adapter as never, input(), { planId }, rigged.briefHash, 'validate')
  assert.equal((again as { action: string }).action, 'report', JSON.stringify(again))
  assert.equal(fakeDeploys(rigged.home).length, 1, 'no second job')
}))
