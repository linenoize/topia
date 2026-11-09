import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen, type ApprovalFacts, type ApprovalPlan } from './approval-screen.js'
import { readAllJournals } from './journal.js'
import { logDirectory } from './paths.js'
import { prepareTestsRun, runTestsRun, type PinnedTests, type TestsReply } from './tests-run.js'
import { fakeCalls, fakeWrites, ORG, registerWriterFake, WRITER, writeRig as rig, writerScenario, type WriteRig } from './test-support.js'

const TEST_RUN = '707000000000001AAA'

function prepare(rigged: WriteRig, over: Record<string, unknown> = {}, gate: { brief?: string | null; mode?: 'validate' | 'read-only' | 'execute' } = {}): Promise<TestsReply> {
  return prepareTestsRun(rigged.adapter, rigged.input(), { orgId: ORG, briefId: rigged.briefId, ...over }, gate.brief === undefined ? rigged.briefHash : gate.brief, gate.mode ?? 'validate')
}

function run(rigged: WriteRig, pinned: PinnedTests, gate: { brief?: string | null; mode?: 'validate' | 'read-only' } = {}): Promise<TestsReply> {
  return runTestsRun(rigged.adapter, rigged.input(), pinned, gate.brief === undefined ? rigged.briefHash : gate.brief, gate.mode ?? 'validate')
}

type Approve = { ok: true; action: 'approve'; screenPlan: ApprovalPlan; facts: ApprovalFacts; pinned: PinnedTests }

function approved(reply: TestsReply): Approve {
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal((reply as Approve).action, 'approve', JSON.stringify(reply))
  return reply as Approve
}

function reportOf(reply: TestsReply): Record<string, any> {
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal((reply as { action: string }).action, 'report', JSON.stringify(reply))
  return (reply as { data: Record<string, any> }).data
}

test('a test run opens a dialog from a live check, and runs nothing until it is answered', rig(async rigged => {
  const before = fakeCalls(rigged.home).filter(item => item.command === 'apex run test').length
  const reply = approved(await prepare(rigged, { level: 'RunLocalTests' }))
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.approveLabel, 'Run Apex tests in Sandbox')
  assert.match(screen.text, /runs code in the org/i)
  assert.match(screen.text, /Class: Sandbox/)
  assert.match(screen.text, /Test level: RunLocalTests/)
  assert.equal(fakeCalls(rigged.home).filter(item => item.command === 'apex run test').length, before)
}))

test('it is async by default, returns a run id, and passes only the closed argv', rig(async rigged => {
  const data = reportOf(await run(rigged, approved(await prepare(rigged, { level: 'RunSpecifiedTests', classNames: ['WidgetTest'] })).pinned))
  assert.equal(data.runId, TEST_RUN)
  assert.equal(data.status, 'started')
  const [call] = fakeCalls(rigged.home).filter(item => item.command === 'apex run test')
  assert.ok(call)
  assert.equal(call.flags['test-level'], 'RunSpecifiedTests')
  assert.equal(call.flags['class-names'], 'WidgetTest')
  assert.equal(call.flags.wait, undefined)
  assert.equal(call.flags.synchronous, undefined)
  assert.equal(call.flags['target-org'], 'ada@example.com')
  assert.equal(fakeWrites(rigged.home).length, 0)
  assert.ok(readAllJournals(rigged.home.project).some(line => line.event === 'tests.started' && line.jobId === TEST_RUN))
}))

test('the default is the local tests', rig(async rigged => {
  reportOf(await run(rigged, approved(await prepare(rigged)).pinned))
  assert.equal(fakeCalls(rigged.home).find(item => item.command === 'apex run test')?.flags['test-level'], 'RunLocalTests')
}))

test('picking up a run reads it, with no dialog, and writes the result to the 30-day log', rig(async rigged => {
  const data = reportOf(await prepare(rigged, { runId: TEST_RUN }))
  assert.equal(data.outcome, 'Passed')
  assert.equal(data.passing, 3)
  assert.equal(data.failing, 0)
  assert.equal(data.orgWideCoverage, '81%')
  const dir = logDirectory(rigged.home.store, rigged.home.project, 'sf-test-runs')
  const [file] = readdirSync(dir)
  assert.ok(file)
  assert.ok(readFileSync(join(dir, file), 'utf8').includes(TEST_RUN))
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'apex run test'), false)
}))

test('a failing run reports which tests failed, and reads as failed. M6: no message and no stack trace come back', rig(async rigged => {
  const data = reportOf(await prepare(rigged, { runId: TEST_RUN }))
  assert.equal(data.outcome, 'Failed')
  assert.equal(data.failing, 1)
  assert.equal(data.failed[0].name, 'WidgetTest.closes')
  assert.deepEqual(Object.keys(data.failed[0]), ['name'])
  assert.equal(JSON.stringify(data).includes('Expected Closed'), false)
  assert.equal(JSON.stringify(data).includes('line 9'), false)
  assert.match(String(data.failureMessagesWithheld), /Setup/)
}, { scenario: { apex: { failing: 1 } } }))

test('a run still going says so, and is not read as passed', rig(async rigged => {
  const data = reportOf(await prepare(rigged, { runId: TEST_RUN }))
  assert.equal(data.outcome, 'Processing')
  assert.match(String(data.next), /still running|again/i)
}, { scenario: { apex: { outcome: 'Processing', testsRan: 0, passing: 0 } } }))

test('it needs a confirmed brief and the validate mode, in both steps', rig(async rigged => {
  const reply = approved(await prepare(rigged))
  assert.equal((await prepare(rigged, {}, { brief: null })).ok, false)
  assert.equal((await prepare(rigged, {}, { mode: 'execute' })).ok, false)
  assert.equal((await run(rigged, reply.pinned, { brief: null })).ok, false)
  assert.equal((await run(rigged, reply.pinned, { mode: 'read-only' })).ok, false)
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'apex run test'), false)
}))

test('a level or a name off the closed list is refused before anything runs', rig(async rigged => {
  for (const over of [{ level: 'NoTestRun' }, { level: 'RunSpecifiedTests' }, { level: 'RunLocalTests', classNames: ['WidgetTest'] }, { level: 'RunSpecifiedTests', classNames: ['--wait=5'] }, { runId: '--use-most-recent' }]) {
    assert.equal((await prepare(rigged, over)).ok, false, JSON.stringify(over))
  }
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'apex run test' || item.command === 'apex get test'), false)
}))

test('pinned input that was changed after the dialog stops the run', rig(async rigged => {
  const reply = approved(await prepare(rigged, { level: 'RunLocalTests' }))
  const swapped: PinnedTests = { ...reply.pinned, level: 'RunAllTestsInOrg' }
  assert.equal((await run(rigged, swapped)).ok, false)
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'apex run test'), false)
}))

test('an identity that moved stops the run', rig(async rigged => {
  const reply = approved(await prepare(rigged))
  rigged.rescenario(scenario => ({ ...scenario, queries: [{ match: 'FROM Organization', result: { records: [{ Id: '00D000000000009AAA', Name: 'Other', IsSandbox: true, OrganizationType: 'x', InstanceName: 'y' }], totalSize: 1, done: true } }, ...(scenario.queries as unknown[])] }))
  assert.equal((await run(rigged, reply.pinned)).ok, false)
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'apex run test'), false)
}))

test('production needs the typed org name', rig(async rigged => {
  const reply = approved(await prepare(rigged))
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.requiresTypedOrgName, true)
  assert.equal(approvalAccepted(screen, screen.approveLabel), false)
  assert.equal(approvalAccepted(screen, 'Acme Production'), true)
}, { register: { isSandbox: false, name: 'Acme Production', singleUserAcceptedAt: '2026-06-01T00:00:00.000Z', writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }, scenario: { org: { IsSandbox: false, Name: 'Acme Production' } } }))

test('a timeout starting the run is unknown, and is not called stopped', rig(async rigged => {
  const reply = approved(await prepare(rigged))
  rigged.rescenario(scenario => ({ ...scenario, mode: 'not-json', modeOn: 'apex run test' }))
  const data = reportOf(await run(rigged, reply.pinned))
  assert.equal(data.status, 'unknown')
  assert.equal(fakeCalls(rigged.home).filter(item => item.command === 'apex run test').length, 1)
}))

// ── production, with a writer ──

const PRODUCTION_ORG = { org: { IsSandbox: false, Name: 'Acme Production' } }

test('production runs tests as the writer, because they run code', rig(async rigged => {
  registerWriterFake(rigged.home, { isSandbox: false, name: 'Acme Production' })
  const reply = approved(await prepare(rigged))
  assert.equal(reply.facts.identity.username, WRITER)
  reportOf(await run(rigged, reply.pinned))
  assert.equal(fakeCalls(rigged.home).find(item => item.command === 'apex run test')?.flags['target-org'], WRITER)
}, { register: { isSandbox: false, name: 'Acme Production' }, scenario: { ...PRODUCTION_ORG, ...writerScenario() } }))

test('production with the writer logged out refuses a test run with the steps, and starts nothing', rig(async rigged => {
  registerWriterFake(rigged.home, { isSandbox: false, name: 'Acme Production' })
  rigged.rescenario(scenario => ({ ...scenario, loggedOut: [WRITER] }))
  const reply = await prepare(rigged)
  assert.equal(reply.ok, false)
  assert.match((reply as { reason: string }).reason, /sf org login web/)
  assert.equal(fakeCalls(rigged.home).some(item => item.command === 'apex run test'), false)
}, { register: { isSandbox: false, name: 'Acme Production' }, scenario: { ...PRODUCTION_ORG, ...writerScenario() } }))
