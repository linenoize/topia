import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import type { IssueKind } from './contract.js'
import { FINDING_STATUSES, packageFilePath, parseVendorFinding, REVERIFY_TRIGGERS, SUBSCRIBER_EDITABLE, vendorFindingPath } from './document.js'
import { issue, noticeText, showsContinue } from './issues.js'
import { SfCliAdapter } from './sf-adapter.js'
import { baseScenario, contextFor, fakeCalls, fakeHome, inventoryQueries, ORG, registerFake, USERNAME, writeScenario, type FakeHome } from './test-support.js'
import { TOOL_SCHEMAS, validateArgs } from './tool-schemas.js'
import { proposeBrief } from './brief.js'
import { callTool, type ToolResult } from './tools.js'

const DRIFT = 'vendor-version-drift' as IssueKind
const OTHER_ORG = '00D000000000002AAA'
const JUNE = '2026-06-01'
const JULY = Date.parse('2026-07-01T00:00:00.000Z')

test('version drift is a notice a person can continue past', () => {
  assert.equal(showsContinue(DRIFT), true)
  const notice = noticeText(issue({ kind: DRIFT, orgId: ORG, orgName: 'Acme Sales', user: 'u', operationClass: 'read', message: 'A finding is stale.' }))
  assert.match(notice, /A finding is stale/)
  assert.doesNotMatch(notice, /cannot continue/)
})

type Call = (name: string, args: unknown, now?: number) => Promise<ToolResult>

const TEST_BRIEF = { objective: 'Check Widget__c', environment: 'Sandbox', subjects: [{ name: 'Widget__c', status: 'known' as const }], change: '', blockingQuestions: [] }

function rig(body: (home: FakeHome, call: Call) => Promise<void>, queries: unknown[] = inventoryQueries()): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario({ queries }))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId } = proposeBrief(home.store, home.project, TEST_BRIEF, new Date(Date.parse('2026-06-01T00:00:00.000Z')).toISOString())
      await body(home, (name, args, now) => callTool(adapter, name, { briefId, ...(args as object) }, contextFor(home, now === undefined ? {} : { now })))
    } finally {
      home.cleanup()
    }
  }
}

const VERSION_15 = inventoryQueries({ packages: [{ name: 'VendorCo Widgets', namespace: 'vendorco', version: [1, 5, 0, 0] }] })

function upgraded(home: FakeHome): void {
  writeScenario(home, baseScenario({ queries: VERSION_15 }))
}

const FINGERPRINT = { orgId: ORG, vendor: 'vendorco', namespace: 'vendorco' }

const ADD = {
  orgId: ORG,
  vendor: 'vendorco',
  id: 'delete-blocked',
  scope: 'Widget__c delete',
  owner: 'Salesforce admin team',
  evidence: 'A delete failed in the UI with a package error',
  rationale: 'Admins keep hitting this during cleanup',
  dependencies: 'None known',
  uncertainty: 'Not reproduced through the API',
  standardBehavior: 'Delete All allows the delete',
  observedBehavior: 'A package trigger blocks the delete.',
  component: 'ApexTrigger:vendorco__Guard',
  adminImpact: 'Cleanup jobs fail on these rows',
  workaround: 'None known',
  subscriberEditable: 'no',
  reverifyOn: ['package upgrade'],
}

function say(result: ToolResult): string {
  return JSON.stringify(result.data)
}

function readFinding(home: FakeHome, id = 'delete-blocked') {
  const parsed = parseVendorFinding(readFileSync(vendorFindingPath(home.project, 'vendorco', id), 'utf8'), { vendor: 'vendorco', id })
  assert.ok('entry' in parsed, JSON.stringify(parsed))
  return parsed.entry
}

async function recorded(call: Call): Promise<void> {
  const fingerprint = await call('vendor_fingerprint', FINGERPRINT)
  assert.equal(fingerprint.ok, true, say(fingerprint))
  const added = await call('vendor_finding_add', ADD)
  assert.equal(added.ok, true, say(added))
}

// ── the schemas and the rules agree ──

test('the published enums match the rules in document.ts', () => {
  const properties = (TOOL_SCHEMAS.vendor_finding_add.inputSchema as { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> }).properties
  assert.deepEqual(properties.subscriberEditable?.enum, [...SUBSCRIBER_EDITABLE])
  assert.deepEqual(properties.reverifyOn?.items?.enum, [...REVERIFY_TRIGGERS])
  const reverify = (TOOL_SCHEMAS.vendor_finding_reverify.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties
  assert.deepEqual(reverify.status?.enum, [...FINDING_STATUSES])
})

test('a new finding cannot be handed a status, a version, a date, or an org list', () => {
  const schema = TOOL_SCHEMAS.vendor_finding_add.inputSchema
  assert.equal(validateArgs(schema, ADD), null)
  for (const extra of [{ status: 'vendor-confirmed' }, { pinnedVersion: '9.9.9' }, { lastVerified: JUNE }, { orgs: [ORG] }, { namespace: 'other' }, { packageName: 'Other' }]) {
    assert.match(String(validateArgs(schema, { ...ADD, ...extra })), /not accepted/, JSON.stringify(extra))
  }
})

// ── fingerprint ──

test('fingerprint writes package.md from the live inventory, with no username in it', rig(async (home, call) => {
  const result = await call('vendor_fingerprint', { ...FINGERPRINT, product: 'Widget Suite' })
  assert.equal(result.ok, true, say(result))
  const text = readFileSync(packageFilePath(home.project, 'vendorco'), 'utf8')
  assert.ok(text.includes('Package name: VendorCo Widgets'))
  assert.ok(text.includes('Product: Widget Suite'))
  assert.ok(text.includes(`| ${ORG} | 1.4.2.1 | packages_inventory | ${JUNE} |`))
  assert.ok(text.includes('vendorco__Guard'))
  assert.equal(text.includes(USERNAME), false)
  assert.equal((result.data as { wrote: string }).wrote, 'docs/salesforce/vendors/vendorco/package.md')
  assert.equal((result.data as { version: string }).version, '1.4.2.1')
}))

test('a package that is not installed is refused, and what is installed is listed', rig(async (home, call) => {
  const result = await call('vendor_fingerprint', { ...FINGERPRINT, namespace: 'nothere' })
  assert.equal(result.ok, false)
  assert.match(say(result), /isn't installed/)
  assert.match(say(result), /VendorCo Widgets/)
  assert.equal(existsSync(packageFilePath(home.project, 'vendorco')), false)
}))

test('fingerprint names one package: by namespace, or by name if it has none', rig(async (home, call) => {
  for (const args of [{ orgId: ORG, vendor: 'plain' }, { orgId: ORG, vendor: 'plain', namespace: 'x', packageName: 'y' }]) {
    const result = await call('vendor_fingerprint', args)
    assert.equal(result.ok, false)
    assert.match(say(result), /namespace or a package name/)
  }
  const result = await call('vendor_fingerprint', { orgId: ORG, vendor: 'plain', packageName: 'plain pack' })
  assert.equal(result.ok, true, say(result))
  const text = readFileSync(packageFilePath(home.project, 'plain'), 'utf8')
  assert.ok(text.includes('Namespace: none'))
  assert.ok(text.includes('cannot be grouped by namespace'))
}, inventoryQueries({ packages: [{ name: 'Plain Pack', namespace: null, version: [2, 0, 0, 0] }], components: {} })))

test('a partial inventory still writes, says so in the file, and says so in the result', rig(async (home, call) => {
  const result = await call('vendor_fingerprint', FINGERPRINT)
  assert.equal(result.ok, true)
  assert.equal((result.data as { partial: boolean }).partial, true)
  assert.equal(result.issue?.kind, 'partial-dependency-coverage')
  assert.ok(readFileSync(packageFilePath(home.project, 'vendorco'), 'utf8').includes('- ApexTrigger: denied.'))
}, [{ match: 'FROM ApexTrigger', error: { name: 'INSUFFICIENT_ACCESS', message: 'Insufficient access.' } }, ...inventoryQueries()]))

test('with the package list unreadable, nothing is written', rig(async (home, call) => {
  const result = await call('vendor_fingerprint', FINGERPRINT)
  assert.equal(result.ok, false)
  assert.match(say(result), /could not be checked/)
  assert.equal(existsSync(packageFilePath(home.project, 'vendorco')), false)
}, [{ match: 'FROM InstalledSubscriberPackage', error: { name: 'INVALID_TYPE', message: 'Not here.' } }, ...inventoryQueries()]))

test('an email in the org text stops package.md, says why, and writes nothing', rig(async (home, call) => {
  const result = await call('vendor_fingerprint', FINGERPRINT)
  assert.equal(result.ok, false)
  assert.match(say(result), /email/)
  assert.match(say(result), /committed/)
  assert.equal(existsSync(packageFilePath(home.project, 'vendorco')), false)
}, inventoryQueries({ packages: [{ name: 'Support ada@example.com', namespace: 'vendorco', version: [1, 0, 0, 0] }] })))

test('a vendor folder already holding another namespace is not overwritten', rig(async (home, call) => {
  await call('vendor_fingerprint', FINGERPRINT)
  const before = readFileSync(packageFilePath(home.project, 'vendorco'), 'utf8')
  writeScenario(home, baseScenario({ queries: inventoryQueries({ packages: [{ name: 'Other Pack', namespace: 'other', version: [1, 0, 0, 0] }] }) }))
  const result = await call('vendor_fingerprint', { ...FINGERPRINT, namespace: 'other' })
  assert.equal(result.ok, false)
  assert.match(say(result), /already records/)
  assert.equal(readFileSync(packageFilePath(home.project, 'vendorco'), 'utf8'), before)
}))

test('a package.md that cannot be read back is reported and left alone', rig(async (home, call) => {
  mkdirSync(dirname(packageFilePath(home.project, 'vendorco')), { recursive: true })
  writeFileSync(packageFilePath(home.project, 'vendorco'), 'hand written notes')
  const result = await call('vendor_fingerprint', FINGERPRINT)
  assert.equal(result.ok, false)
  assert.match(say(result), /wasn't overwritten/)
  assert.equal(readFileSync(packageFilePath(home.project, 'vendorco'), 'utf8'), 'hand written notes')
}))

test('a vendor name cannot leave the vendors folder', rig(async (home, call) => {
  for (const vendor of ['..', '../..', 'a/b', '.hidden']) {
    const result = await call('vendor_fingerprint', { ...FINGERPRINT, vendor })
    assert.equal(result.ok, false, vendor)
    assert.match(say(result), /allowed form/, vendor)
  }
  assert.equal(existsSync(join(home.project, 'docs', 'salesforce', 'package.md')), false)
  assert.equal(fakeCalls(home).length, 0)
}))

// ── add a finding ──

test('a new finding starts at suspected, pinned to the live version, in this org, dated today', rig(async (home, call) => {
  await recorded(call)
  const entry = readFinding(home)
  assert.equal(entry.status, 'suspected')
  assert.equal(entry.pinnedVersion, '1.4.2.1')
  assert.equal(entry.namespace, 'vendorco')
  assert.equal(entry.packageName, 'VendorCo Widgets')
  assert.deepEqual(entry.orgs, [ORG])
  assert.equal(entry.lastVerified, JUNE)
}))

test('a finding needs the fingerprint first', rig(async (home, call) => {
  const result = await call('vendor_finding_add', ADD)
  assert.equal(result.ok, false)
  assert.match(say(result), /fingerprint/)
  assert.equal(existsSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked')), false)
}))

test('an email in a finding is refused, says why, writes nothing, and is not repeated', rig(async (home, call) => {
  await call('vendor_fingerprint', FINGERPRINT)
  const result = await call('vendor_finding_add', { ...ADD, evidence: 'Reported by ada@example.com' })
  assert.equal(result.ok, false)
  assert.match(say(result), /email/)
  assert.match(say(result), /committed/)
  assert.equal(say(result).includes('ada@example.com'), false)
  assert.equal(existsSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked')), false)
}))

test('adding the same id again is refused, so it cannot reset a status', rig(async (home, call) => {
  await recorded(call)
  const before = readFileSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked'), 'utf8')
  const result = await call('vendor_finding_add', { ...ADD, scope: 'Something else' })
  assert.equal(result.ok, false)
  assert.match(say(result), /already exists/)
  assert.equal(readFileSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked'), 'utf8'), before)
}))

test('a package that is not in this org cannot pin a finding here', rig(async (home, call) => {
  await call('vendor_fingerprint', FINGERPRINT)
  writeScenario(home, baseScenario({ queries: inventoryQueries({ packages: [] }) }))
  const result = await call('vendor_finding_add', ADD)
  assert.equal(result.ok, false)
  assert.match(say(result), /isn't installed/)
}))

test('a version that cannot be read is not guessed', rig(async (home, call) => {
  await call('vendor_fingerprint', FINGERPRINT)
  writeScenario(home, baseScenario({ queries: [{ match: 'FROM InstalledSubscriberPackage', error: { name: 'INVALID_TYPE', message: 'Not here.' } }] }))
  const result = await call('vendor_finding_add', ADD)
  assert.equal(result.ok, false)
  assert.equal(existsSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked')), false)
}))

// ── re-verify ──

const REVERIFY = { orgId: ORG, vendor: 'vendorco', id: 'delete-blocked', status: 'suspected', evidence: 'Looked at it again' }

test('re-verifying pins the live version and dates it today', rig(async (home, call) => {
  await recorded(call)
  upgraded(home)
  const result = await call('vendor_finding_reverify', REVERIFY, JULY)
  assert.equal(result.ok, true, say(result))
  const entry = readFinding(home)
  assert.equal(entry.pinnedVersion, '1.5.0.0')
  assert.equal(entry.lastVerified, '2026-07-01')
  assert.equal(entry.evidence, 'Looked at it again')
}))

test('confirmed-in-org needs evidence naming this org, and nothing changes without it', rig(async (home, call) => {
  await recorded(call)
  const before = readFileSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked'), 'utf8')
  for (const evidence of ['Reproduced it in the sandbox', `Reproduced it in ${OTHER_ORG}`]) {
    const result = await call('vendor_finding_reverify', { ...REVERIFY, status: 'confirmed-in-org', evidence })
    assert.equal(result.ok, false, evidence)
    assert.match(say(result), /names? (an org|this org)/, evidence)
  }
  assert.equal(readFileSync(vendorFindingPath(home.project, 'vendorco', 'delete-blocked'), 'utf8'), before)
  const good = await call('vendor_finding_reverify', { ...REVERIFY, status: 'confirmed-in-org', evidence: `Reproduced it in ${ORG} with a test Widget__c` })
  assert.equal(good.ok, true, say(good))
  assert.equal(readFinding(home).status, 'confirmed-in-org')
}))

test('vendor-confirmed needs a ticket, and the ticket stays', rig(async (home, call) => {
  await recorded(call)
  const refused = await call('vendor_finding_reverify', { ...REVERIFY, status: 'vendor-confirmed' })
  assert.equal(refused.ok, false)
  assert.match(say(refused), /vendor ticket/)
  assert.equal(readFinding(home).status, 'suspected')
  const good = await call('vendor_finding_reverify', { ...REVERIFY, status: 'vendor-confirmed', vendorTicket: 'CASE-1234' })
  assert.equal(good.ok, true, say(good))
  assert.equal(readFinding(home).status, 'vendor-confirmed')
  await call('vendor_finding_reverify', { ...REVERIFY, status: 'vendor-confirmed' })
  assert.equal(readFinding(home).vendorTicket, 'CASE-1234')
}))

test('a finding that stops reproducing can go back to suspected', rig(async (home, call) => {
  await recorded(call)
  await call('vendor_finding_reverify', { ...REVERIFY, status: 'confirmed-in-org', evidence: `Seen in ${ORG}` })
  const result = await call('vendor_finding_reverify', { ...REVERIFY, evidence: `Could not reproduce it in ${ORG} after the upgrade` })
  assert.equal(result.ok, true, say(result))
  assert.equal(readFinding(home).status, 'suspected')
}))

test('re-verifying a finding that is missing, or malformed, is refused and says why', rig(async (home, call) => {
  await recorded(call)
  const missing = await call('vendor_finding_reverify', { ...REVERIFY, id: 'not-there' })
  assert.equal(missing.ok, false)
  assert.match(say(missing), /no finding/i)
  const file = vendorFindingPath(home.project, 'vendorco', 'delete-blocked')
  writeFileSync(file, readFileSync(file, 'utf8').replace('Owner: Salesforce admin team\n', ''))
  const broken = await call('vendor_finding_reverify', REVERIFY)
  assert.equal(broken.ok, false)
  assert.match(say(broken), /Owner is missing/)
}))

// ── list ──

test('with nothing recorded, the list is empty and no CLI runs', rig(async (home, call) => {
  const result = await call('vendor_findings_list', {})
  assert.equal(result.ok, true, say(result))
  assert.deepEqual((result.data as { vendors: unknown[] }).vendors, [])
  assert.deepEqual((result.data as { findings: unknown[] }).findings, [])
  assert.equal(fakeCalls(home).length, 0)
}))

type Listed = {
  vendors: { vendor: string; packageName: string; namespace: string | null; product: string }[]
  findings: { id: string; status: string; stale: boolean; text: string; version: { state: string; live: string | null } }[]
  malformed: { file: string; problems: string[] }[]
}

test('with no org it reads no org, says the version was not checked, and always shows the status', rig(async (home, call) => {
  await recorded(call)
  const before = fakeCalls(home).length
  const result = await call('vendor_findings_list', {})
  assert.equal(fakeCalls(home).length, before)
  assert.equal(result.untrusted, true)
  const data = result.data as Listed
  assert.deepEqual(data.vendors, [{ vendor: 'vendorco', product: 'not recorded', packageName: 'VendorCo Widgets', namespace: 'vendorco' }])
  const item = data.findings[0]
  assert.equal(item?.version.state, 'not-checked')
  assert.equal(item?.stale, false)
  assert.match(item?.text ?? '', /status suspected/)
  assert.match(item?.text ?? '', /wasn't checked/)
}))

test('the annotation sentence says what, which version, when, and how sure', rig(async (_home, call) => {
  await recorded(call)
  const result = await call('vendor_findings_list', { orgId: ORG })
  const item = (result.data as Listed).findings[0]
  assert.equal(item?.text, `Known vendor behavior: A package trigger blocks the delete, verified v1.4.2.1 on ${JUNE}, status suspected.`)
  assert.equal(item?.version.state, 'current')
  assert.equal(result.issue, undefined)
}))

test('with an org, a changed version shows the finding as stale, with the drift issue', rig(async (home, call) => {
  await recorded(call)
  upgraded(home)
  const result = await call('vendor_findings_list', { orgId: ORG })
  const item = (result.data as Listed).findings[0]
  assert.equal(item?.stale, true)
  assert.equal(item?.version.live, '1.5.0.0')
  assert.match(item?.text ?? '', /Stale: this org has v1\.5\.0\.0/)
  assert.equal(result.issue?.kind, 'vendor-version-drift')
  assert.equal(result.canContinue, true)
  assert.match(result.notice ?? '', /delete-blocked/)
}))

test('a malformed finding is reported by file, and the good ones still list', rig(async (home, call) => {
  await recorded(call)
  await call('vendor_finding_add', { ...ADD, id: 'other-one' })
  const file = vendorFindingPath(home.project, 'vendorco', 'other-one')
  writeFileSync(file, readFileSync(file, 'utf8').replace('Status: suspected', 'Status: vendor-confirmed'))
  const data = (await call('vendor_findings_list', {})).data as Listed
  assert.deepEqual(data.findings.map(item => item.id), ['delete-blocked'])
  assert.equal(data.malformed.length, 1)
  assert.equal(data.malformed[0]?.file, 'docs/salesforce/vendors/vendorco/findings/other-one.md')
  assert.match(data.malformed[0]?.problems.join(' ') ?? '', /vendor ticket/)
}))

test('an email added by hand is reported as malformed, and not shown', rig(async (home, call) => {
  await recorded(call)
  const file = vendorFindingPath(home.project, 'vendorco', 'delete-blocked')
  writeFileSync(file, readFileSync(file, 'utf8').replace('Owner: Salesforce admin team', 'Owner: ada@example.com'))
  const result = await call('vendor_findings_list', {})
  const data = result.data as Listed
  assert.equal(data.findings.length, 0)
  assert.match(data.malformed[0]?.problems.join(' ') ?? '', /email/)
  assert.equal(say(result).includes('ada@example.com'), false)
}))

test('findings with no package.md still list, and the gap is reported', rig(async (home, call) => {
  await recorded(call)
  writeFileSync(packageFilePath(home.project, 'vendorco'), 'junk')
  const data = (await call('vendor_findings_list', {})).data as Listed
  assert.equal(data.findings.length, 1)
  assert.equal(data.malformed[0]?.file, 'docs/salesforce/vendors/vendorco/package.md')
}))

test('a finding whose namespace disagrees with package.md is reported', rig(async (home, call) => {
  await recorded(call)
  const file = vendorFindingPath(home.project, 'vendorco', 'delete-blocked')
  writeFileSync(file, readFileSync(file, 'utf8').replace('Namespace: vendorco', 'Namespace: other'))
  const data = (await call('vendor_findings_list', {})).data as Listed
  assert.equal(data.findings.length, 0)
  assert.match(data.malformed[0]?.problems.join(' ') ?? '', /package\.md/)
}))

test('a name that is not safe in the vendors folder is reported, not read', rig(async (home, call) => {
  mkdirSync(join(home.project, 'docs', 'salesforce', 'vendors', 'has space', 'findings'), { recursive: true })
  const data = (await call('vendor_findings_list', {})).data as Listed
  assert.equal(data.malformed.length, 1)
  assert.match(data.malformed[0]?.problems.join(' ') ?? '', /name/)
}))

test('a vendor filter narrows the list', rig(async (_home, call) => {
  await recorded(call)
  const data = (await call('vendor_findings_list', { vendor: 'someone-else' })).data as Listed
  assert.deepEqual(data.vendors, [])
  assert.deepEqual(data.findings, [])
}))

test('with the version unreadable, a finding says not checked, never current', rig(async (home, call) => {
  await recorded(call)
  writeScenario(home, baseScenario({ queries: [{ match: 'FROM InstalledSubscriberPackage', error: { name: 'INVALID_TYPE', message: 'Not here.' } }] }))
  const result = await call('vendor_findings_list', { orgId: ORG })
  assert.equal(result.ok, true)
  const item = (result.data as Listed).findings[0]
  assert.equal(item?.version.state, 'not-checked')
  assert.equal(result.issue, undefined)
}))

test('expired auth on the version check is expired auth', rig(async (home, call) => {
  await recorded(call)
  writeScenario(home, baseScenario({ queries: [{ match: 'FROM InstalledSubscriberPackage', error: { name: 'INVALID_SESSION_ID', message: 'Session expired or invalid' } }] }))
  const result = await call('vendor_findings_list', { orgId: ORG })
  assert.equal(result.issue?.kind, 'expired-auth')
}))

// ── the inventory sees findings ──

test('after an upgrade the inventory shows the finding stale, with the drift issue', rig(async (home, call) => {
  await recorded(call)
  upgraded(home)
  const result = await call('packages_inventory', { orgId: ORG })
  assert.equal(result.issue?.kind, 'vendor-version-drift')
  const data = result.data as { findings: { id: string; stale: boolean }[]; issues: { kind: string }[] }
  assert.deepEqual(data.findings.map(item => [item.id, item.stale]), [['delete-blocked', true]])
  assert.deepEqual(data.issues.map(item => item.kind), ['vendor-version-drift'])
}))

test('drift and a partial inventory are both reported, and neither hides the other', rig(async (home, call) => {
  await recorded(call)
  writeScenario(home, baseScenario({ queries: [{ match: 'FROM ApexTrigger', error: { name: 'INSUFFICIENT_ACCESS', message: 'No.' } }, ...VERSION_15] }))
  const result = await call('packages_inventory', { orgId: ORG })
  assert.equal(result.issue?.kind, 'vendor-version-drift')
  const data = result.data as { issues: { kind: string }[]; partial: boolean }
  assert.deepEqual(data.issues.map(item => item.kind), ['vendor-version-drift', 'partial-dependency-coverage'])
  assert.equal(data.partial, true)
}))

test('a package this org does not have is not drift', rig(async (home, call) => {
  await recorded(call)
  writeScenario(home, baseScenario({ queries: inventoryQueries({ packages: [] }) }))
  const result = await call('packages_inventory', { orgId: ORG })
  assert.equal(result.issue, undefined)
  const data = result.data as { findings: { version: { state: string }; stale: boolean; text: string }[] }
  assert.equal(data.findings[0]?.version.state, 'not-installed')
  assert.equal(data.findings[0]?.stale, false)
  assert.match(data.findings[0]?.text ?? '', /isn't installed/)
}))
