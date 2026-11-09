import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { auditBeforeWrite, auditFacts, auditRefusal, compareAudit, type AuditResult } from './audit.js'
import { appendJournal, readJournal } from './journal.js'
import { writeJson } from './json-file.js'
import { journalDirectory, planFile, sessionKey } from './paths.js'
import { SfCliAdapter } from './sf-adapter.js'
import { storeGet } from './store.js'
import { baseScenario, contextFor, countRows, fakeCalls, fakeHome, ORG, queryRows, RECORD, registerFake, USER_ID, writeScenario, type FakeHome } from './test-support.js'
import { callTool } from './tools.js'

const here = dirname(fileURLToPath(import.meta.url))
const NOW = Date.parse('2026-06-10T12:00:00.000Z')
const IN_WINDOW = '2026-06-10T10:00:00.000+0000'

function trail(records: Record<string, unknown>[]): Record<string, unknown> {
  return { match: 'FROM SetupAuditTrail', result: queryRows(records, 'SetupAuditTrail') }
}

const QUIET = { queries: [trail([]), { match: 'SELECT COUNT\\(\\) FROM Widget__c', result: countRows(0) }] }

type Rig = { home: FakeHome; audit: () => Promise<AuditResult> }

function rig(body: (rig: Rig) => Promise<void>, scenario: Record<string, unknown> = QUIET): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario(scenario))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
      await body({ home, audit: () => compareAudit(adapter, contextFor(home, { now: NOW }), RECORD) })
    } finally {
      home.cleanup()
    }
  }
}

function executed(home: FakeHome, at: string, over: Record<string, unknown> = {}): void {
  appendJournal(home.project, { event: 'change.executed', correlationId: 'run-1', projectRoot: home.project, orgId: ORG, mode: 'execute', at, ...over })
}

function plan(home: FakeHome, object = 'Widget__c'): void {
  writeJson(planFile(home.project, 'plan-1'), { planHash: 'x', plan: { kind: 'records', object } })
}

// ── nothing to report ──

test('nothing by this user, and nothing to report', rig(async ({ audit }) => {
  const result = await audit()
  assert.equal(result.state, 'clean')
  assert.equal(result.text, null)
  assert.deepEqual(result.findings, [])
}))

test('it asks about this user only, and leaves the free text out', rig(async ({ audit, home }) => {
  await audit()
  const soql = fakeCalls(home).find(call => (call.soql ?? '').includes('FROM SetupAuditTrail'))?.soql ?? ''
  assert.match(soql, new RegExp(`CreatedById = '${USER_ID}'`))
  assert.equal(soql.includes('Display'), false)
  assert.equal(soql.includes('DelegateUser'), false)
}))

test('it looks back no further than the journal can answer, or the registration', rig(async ({ audit, home }) => {
  await audit()
  const soql = fakeCalls(home).find(call => (call.soql ?? '').includes('FROM SetupAuditTrail'))?.soql ?? ''
  // Registered 2026-06-01, later than the journal's 29 days, so the registration wins.
  assert.match(soql, /CreatedDate >= 2026-06-01T00:00:00/)
}))

// ── setup audit trail ──

test('a setup change by this user that the journal does not hold is reported', rig(async ({ audit }) => {
  const result = await audit()
  assert.equal(result.state, 'found')
  assert.equal(result.findings[0]?.source, 'setup-audit-trail')
  assert.equal(result.findings[0]?.count, 2)
  assert.match(String(result.text), /2 setup changes/)
  assert.match(String(result.text), /Manage Users/)
  assert.match(String(result.text), /journal/)
}, { queries: [trail([{ Action: 'changedProfile', Section: 'Manage Users', CreatedDate: IN_WINDOW }, { Action: 'createdApex', Section: 'Apex Class', CreatedDate: IN_WINDOW }])] }))

test('a setup change the journal holds is not reported', rig(async ({ audit, home }) => {
  executed(home, '2026-06-10T10:05:00.000Z')
  const result = await audit()
  assert.equal(result.state, 'clean')
  assert.equal(result.text, null)
}, { queries: [trail([{ Action: 'changedApex', Section: 'Apex Class', CreatedDate: IN_WINDOW }])] }))

test('a journal line far from the change does not explain it', rig(async ({ audit, home }) => {
  executed(home, '2026-06-09T10:05:00.000Z')
  assert.equal((await audit()).state, 'found')
}, { queries: [trail([{ Action: 'changedApex', Section: 'Apex Class', CreatedDate: IN_WINDOW }])] }))

test('a journal line for another org does not explain it', rig(async ({ audit, home }) => {
  executed(home, '2026-06-10T10:05:00.000Z', { orgId: '00D000000000099AAA' })
  assert.equal((await audit()).state, 'found')
}, { queries: [trail([{ Action: 'changedApex', Section: 'Apex Class', CreatedDate: IN_WINDOW }])] }))

test('a proposal is not a change, so it explains nothing', rig(async ({ audit, home }) => {
  appendJournal(home.project, { event: 'change.proposed', correlationId: 'run-1', projectRoot: home.project, orgId: ORG, mode: 'plan', at: '2026-06-10T10:05:00.000Z' })
  assert.equal((await audit()).state, 'found')
}, { queries: [trail([{ Action: 'changedApex', Section: 'Apex Class', CreatedDate: IN_WINDOW }])] }))

test('org text in the report cannot draw a line or hide', rig(async ({ audit }) => {
  const text = String((await audit()).text)
  assert.equal(/[\n\r\u202e\u200b\u001b]/.test(text), false, text)
}, { queries: [trail([{ Action: 'x', Section: 'Manage\nUsers\u202e\u200b\u001b[31m', CreatedDate: IN_WINDOW }])] }))

// ── LastModifiedById ──

const MODIFIED = { queries: [trail([]), { match: 'SELECT COUNT\\(\\) FROM Widget__c WHERE LastModifiedById', result: countRows(5) }] }

test('records this user changed beyond what the journal holds are reported, by object', rig(async ({ audit, home }) => {
  plan(home)
  executed(home, '2026-06-05T00:00:00.000Z', { object: 'Widget__c', counts: { rows: 3 } })
  const result = await audit()
  assert.equal(result.state, 'found')
  assert.equal(result.findings[0]?.source, 'last-modified')
  assert.equal(result.findings[0]?.count, 2)
  assert.match(String(result.text), /2 Widget__c records/)
}, MODIFIED))

test('records the journal accounts for are not reported', rig(async ({ audit, home }) => {
  plan(home)
  executed(home, '2026-06-05T00:00:00.000Z', { object: 'Widget__c', counts: { rows: 5 } })
  assert.equal((await audit()).state, 'clean')
}, MODIFIED))

test('it asks about the objects this project planned on, and by this user only', rig(async ({ audit, home }) => {
  plan(home)
  const result = await audit()
  assert.deepEqual(result.coverage.objects, ['Widget__c'])
  const soql = fakeCalls(home).find(call => (call.soql ?? '').includes('LastModifiedById'))?.soql ?? ''
  assert.match(soql, new RegExp(`LastModifiedById = '${USER_ID}'`))
  assert.match(soql, /LastModifiedDate >= /)
}, MODIFIED))

test('an object name in a plan file that is not an API name never reaches a query', rig(async ({ audit, home }) => {
  plan(home, "Widget__c WHERE Id != ''")
  await audit()
  assert.equal(fakeCalls(home).some(call => (call.soql ?? '').includes("Id != ''")), false)
}, MODIFIED))

test('with no object planned on, it says what it did not check', rig(async ({ audit }) => {
  const result = await audit()
  assert.deepEqual(result.coverage.objects, [])
  assert.equal(result.coverage.setupAudit, true)
}))

// ── failing to check is never clean ──

for (const [name, scenario] of [
  ['a rate limit', { mode: 'rate-limit', modeOn: 'FROM SetupAuditTrail' }],
  ['output that does not parse', { mode: 'malformed', modeOn: 'FROM SetupAuditTrail' }],
  ['an expired login', { mode: 'expired-auth', modeOn: 'FROM SetupAuditTrail' }],
  ['no permission to read the trail', { mode: 'denied', modeOn: 'FROM SetupAuditTrail' }],
  ['a timeout', { mode: 'timeout', modeOn: 'FROM SetupAuditTrail' }],
  ['no way to find the user', { mode: 'expired-auth', modeOn: 'FROM User' }],
] as const) {
  test(`${name} reads as "couldn't check", never as clean`, rig(async ({ audit }) => {
    const result = await audit()
    assert.equal(result.state, 'could-not-check', JSON.stringify(result))
    assert.match(String(result.text), /couldn't check/)
    assert.ok(result.reasons.length > 0)
  }, { ...QUIET, ...scenario }))
}

test('one object that fails means "couldn\'t check", even with a quiet trail', rig(async ({ audit, home }) => {
  plan(home)
  const result = await audit()
  assert.equal(result.state, 'could-not-check')
  assert.match(String(result.text), /Widget__c/)
}, { queries: [trail([]), { match: 'SELECT COUNT\\(\\) FROM Widget__c', error: { name: 'INVALID_FIELD', message: 'No such column LastModifiedById' } }] }))

test('a journal that cannot be read means "couldn\'t check"', rig(async ({ audit, home }) => {
  mkdirSync(journalDirectory(home.project), { recursive: true })
  writeFileSync(join(journalDirectory(home.project), 'broken.jsonl'), '{"event":\n')
  const result = await audit()
  assert.equal(result.state, 'could-not-check')
  assert.match(String(result.text), /couldn't check/)
}))

const CUT_SHORT = { match: 'FROM SetupAuditTrail', result: { records: [{ attributes: { type: 'SetupAuditTrail' }, Action: 'x', Section: 'y', CreatedDate: IN_WINDOW }], totalSize: 9, done: false }, warnings: ['missing'] }
const FULL_PAGE_TEXT = /200 or more setup changes in this window; not all were compared\./
const CUT_SHORT_TEXT = /The audit trail came back cut short; not all setup changes in this window were compared\./

test('a trail cut short is reported as cut short, for the person to weigh, and is not read as all of it', rig(async ({ audit, home }) => {
  executed(home, '2026-06-10T10:05:00.000Z')
  const result = await audit()
  assert.equal(result.state, 'found')
  assert.match(String(result.text), CUT_SHORT_TEXT)
  assert.doesNotMatch(String(result.text), /200 or more/)
  assert.equal(result.findings.some(item => item.capped === true), true)
}, { queries: [CUT_SHORT] }))

test('200 setup changes in the window read as cut short, and a production write is not refused for it', rig(async ({ audit }) => {
  const result = await audit()
  assert.equal(result.state, 'found')
  assert.match(String(result.text), FULL_PAGE_TEXT)
  assert.doesNotMatch(String(result.text), /More than/)
  const production = { isSandbox: false, username: 'ada@example.com' }
  assert.equal(auditRefusal(result, production, 'nothing was written'), null, 'the audit detects; the person decides, with the typed org name')
  assert.deepEqual(auditFacts(result).audit, result.text, 'the approval screen carries it')
}, { queries: [trail(Array.from({ length: 200 }, (_, index) => ({ Action: 'x', Section: 'y', CreatedDate: `2026-06-10T10:${String(index % 60).padStart(2, '0')}:00.000+0000` })))] }))

test('production is still refused when the audit cannot run at all', rig(async ({ audit }) => {
  const result = await audit()
  assert.equal(result.state, 'could-not-check')
  assert.notEqual(auditRefusal(result, { isSandbox: false, username: 'ada@example.com' }, 'nothing was written'), null)
}, { queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'INSUFFICIENT_ACCESS', message: 'nope' } }] }))

test('the window starts at the last completed check, so a busy admin is not capped by old changes', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  const first = await compareAudit(adapter, contextFor(home, { now: NOW }), RECORD)
  assert.equal(first.state, 'clean')
  await compareAudit(adapter, contextFor(home, { now: NOW + 3_600_000 }), RECORD)
  const soqls = fakeCalls(home).map(call => call.soql ?? '').filter(text => text.includes('FROM SetupAuditTrail'))
  assert.match(soqls[0] ?? '', /CreatedDate >= 2026-06-01T00:00:00/)
  assert.match(soqls[1] ?? '', /CreatedDate >= 2026-06-10T11:58:00/, 'two minutes before the last completed check')
}))

test('the journal is counted over the same window as the org, so writes from before it do not hide a later hand edit', rig(async ({ home }) => {
  plan(home)
  // Topia wrote 500 rows long ago, and a check since then saw them (the org says 500 too).
  executed(home, '2026-06-05T00:00:00.000Z', { object: 'Widget__c', counts: { rows: 500 } })
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  const first = await compareAudit(adapter, contextFor(home, { now: NOW }), RECORD)
  assert.equal(first.state, 'clean')
  // Someone then hand-edits 100 Widgets. The window now starts at the last check, and holds none of Topia's 500.
  const second = await compareAudit(adapter, contextFor(home, { now: NOW + 3_600_000 }), RECORD)
  assert.equal(second.state, 'found', JSON.stringify(second))
  assert.equal(second.findings[0]?.source, 'last-modified')
  assert.equal(second.findings[0]?.count, 100)
}, { queries: [trail([]), { match: 'SELECT COUNT\\(\\) FROM Widget__c', results: [countRows(500), countRows(100)] }] }))

test('inside the window, what Topia wrote is still taken off the org count', rig(async ({ home }) => {
  plan(home)
  executed(home, '2026-06-05T00:00:00.000Z', { object: 'Widget__c', counts: { rows: 500 } })
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  await compareAudit(adapter, contextFor(home, { now: NOW }), RECORD)
  executed(home, '2026-06-10T12:30:00.000Z', { object: 'Widget__c', counts: { rows: 3 } })
  const second = await compareAudit(adapter, contextFor(home, { now: NOW + 3_600_000 }), RECORD)
  assert.equal(second.state, 'clean', JSON.stringify(second))
  executed(home, '2026-06-10T13:30:00.000Z', { object: 'Widget__c', counts: { rows: 2 } })
  const third = await compareAudit(adapter, contextFor(home, { now: NOW + 7_200_000 }), RECORD)
  assert.equal(third.state, 'found', JSON.stringify(third))
  assert.equal(third.findings[0]?.count, 100)
}, { queries: [trail([]), { match: 'SELECT COUNT\\(\\) FROM Widget__c', results: [countRows(500), countRows(3), countRows(102)] }] }))

test('a finding nobody has seen on an approval screen does not move the window', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  const first = await compareAudit(adapter, contextFor(home, { now: NOW }), RECORD)
  assert.equal(first.state, 'found')
  await compareAudit(adapter, contextFor(home, { now: NOW + 3_600_000 }), RECORD)
  const soqls = fakeCalls(home).map(call => call.soql ?? '').filter(text => text.includes('FROM SetupAuditTrail'))
  assert.match(soqls[1] ?? '', /CreatedDate >= 2026-06-01T00:00:00/, 'the session band alone does not count as seen')
}, { queries: [trail([{ Action: 'x', Section: 'Manage Users', CreatedDate: IN_WINDOW }])] }))

test('a failed check does not move the window either', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  assert.equal((await compareAudit(adapter, contextFor(home, { now: NOW }), RECORD)).state, 'could-not-check')
  await compareAudit(adapter, contextFor(home, { now: NOW + 3_600_000 }), RECORD)
  const soqls = fakeCalls(home).map(call => call.soql ?? '').filter(text => text.includes('FROM SetupAuditTrail'))
  assert.match(soqls[1] ?? '', /CreatedDate >= 2026-06-01T00:00:00/)
}, { queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }] }))

test('a check that was cut short does not move the window', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  await compareAudit(adapter, contextFor(home, { now: NOW }), RECORD)
  await compareAudit(adapter, contextFor(home, { now: NOW + 3_600_000 }), RECORD)
  const soqls = fakeCalls(home).map(call => call.soql ?? '').filter(text => text.includes('FROM SetupAuditTrail'))
  assert.match(soqls[1] ?? '', /CreatedDate >= 2026-06-01T00:00:00/)
}, { queries: [CUT_SHORT, { match: 'SELECT COUNT\(\) FROM Widget__c', result: countRows(0) }] }))

test('a finding and a failure are both reported', rig(async ({ audit, home }) => {
  plan(home)
  const result = await audit()
  assert.equal(result.state, 'could-not-check')
  assert.equal(result.findings.length, 1)
  assert.match(String(result.text), /1 setup change/)
  assert.match(String(result.text), /couldn't check/)
}, { queries: [trail([{ Action: 'x', Section: 'y', CreatedDate: IN_WINDOW }]), { match: 'SELECT COUNT\\(\\) FROM Widget__c', error: { name: 'INVALID_FIELD', message: 'No such column' } }] }))

// ── the journal, and the band ──

test('the audit queries are journaled with binds', rig(async ({ audit, home }) => {
  await audit()
  const lines = readJournal(home.project, `audit-${NOW}`)
  assert.ok(lines.length > 0)
  assert.equal(JSON.stringify(lines).includes(USER_ID), false)
  assert.equal(lines.every(line => line.event === 'query.executed'), true)
}))

test('before a write, the result goes through the band', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  const result = await auditBeforeWrite(adapter, contextFor(home, { now: NOW }), ORG)
  assert.equal(result.state, 'found')
  const session = storeGet(home.store, sessionKey(home.project)) as { audit: { state: string; text: string } }
  assert.equal(session.audit.state, 'found')
  assert.match(session.audit.text, /setup change/)
}, { queries: [trail([{ Action: 'x', Section: 'Manage Users', CreatedDate: IN_WINDOW }])] }))

test('before a write, an org that is not registered reads as "couldn\'t check"', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  const result = await auditBeforeWrite(adapter, contextFor(home, { now: NOW }), '00D000000000099AAA')
  assert.equal(result.state, 'could-not-check')
}))

test('a later tool call does not wipe the audit result off the band', rig(async ({ home }) => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 2000, versionTimeoutMs: 8000 })
  await auditBeforeWrite(adapter, contextFor(home, { now: NOW }), ORG)
  const inspected = await callTool(adapter, 'org_inspect', { orgId: ORG }, contextFor(home, { now: NOW }))
  assert.equal(inspected.ok, true)
  const session = storeGet(home.store, sessionKey(home.project)) as { audit?: { state: string } }
  assert.equal(session.audit?.state, 'found')
}, { queries: [trail([{ Action: 'x', Section: 'Manage Users', CreatedDate: IN_WINDOW }])] }))

test('the session-start check runs the comparison too', rig(async ({ home }) => {
  const ran = spawnSync(process.execPath, [join(here, 'runner.js'), 'identity-check'], { input: JSON.stringify({ projectRoot: home.project }), env: home.env, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  const session = storeGet(home.store, sessionKey(home.project)) as { audit?: { state: string; text: string } }
  assert.equal(session.audit?.state, 'found', JSON.stringify(session))
}, { queries: [trail([{ Action: 'x', Section: 'Manage Users', CreatedDate: new Date().toISOString().replace('Z', '+0000') }])] }))

test('the session-start check reports a failed comparison as such', rig(async ({ home }) => {
  const ran = spawnSync(process.execPath, [join(here, 'runner.js'), 'identity-check'], { input: JSON.stringify({ projectRoot: home.project }), env: home.env, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  const session = storeGet(home.store, sessionKey(home.project)) as { audit?: { state: string } }
  assert.equal(session.audit?.state, 'could-not-check')
}, { mode: 'denied', modeOn: 'FROM SetupAuditTrail' }))
