import assert from 'node:assert/strict'
import { test } from 'node:test'

import { type AuditResult, auditBeforeWrite } from './audit.js'
import { sessionKey } from './paths.js'
import { readWriter } from './registry.js'
import { prepareRestore } from './restore.js'
import { STAMP_KEY } from './stamp.js'
import { storeGet } from './store.js'
import { DESCRIBE_WIDGET, fakeCalls, fakeWrites, INSTANCE, ORG, queryRows, refused, registerWriterFake, reported, runRunner, USERNAME, widgetIds, WRITER, WRITER_ID, writeRig, writerScenario, type WriteRig, type WriteRigOptions } from './test-support.js'
import { callTool } from './tools.js'

/** Contract sections 1 and 4: production is read by one user and changed by another, whom only a person can log in. */

const PROD_ORG = { IsSandbox: false, Name: 'Acme Production' }
const READER = { isSandbox: false, name: 'Acme Production' }
const CAN_WRITE = { canWrite: 'yes', reasons: ['Modify All Data'] }

function production(body: (rig: WriteRig) => Promise<void>, options: { scenario?: Record<string, unknown>; register?: Record<string, unknown>; writer?: boolean } = {}): () => Promise<void> {
  const rigOptions: WriteRigOptions = { register: { ...READER, ...options.register }, scenario: { org: PROD_ORG, ...writerScenario(), ...options.scenario } }
  return writeRig(async rig => {
    if (options.writer !== false) registerWriterFake(rig.home, { isSandbox: false, name: 'Acme Production' })
    await body(rig)
  }, rigOptions)
}

function logOut(rig: WriteRig, username = WRITER): void {
  rig.rescenario(scenario => ({ ...scenario, loggedOut: [username] }))
}

function targets(rig: WriteRig): Set<unknown> {
  return new Set(fakeCalls(rig.home).filter(call => call.command !== 'version').map(call => call.flags['target-org']))
}

function mark(rig: WriteRig): number {
  return fakeCalls(rig.home).length
}

function sinceTargets(rig: WriteRig, from: number): Set<unknown> {
  return new Set(fakeCalls(rig.home).slice(from).filter(call => call.command !== 'version').map(call => call.flags['target-org']))
}

// ── the write itself ──

test('a production write targets the writer, from the dialog to the last read', production(async rig => {
  const planId = await rig.plan()
  const from = mark(rig)
  const reply = await rig.approve(planId)
  assert.equal(reply.facts.identity.username, WRITER)
  const data = reported(await rig.run(reply.pinned))
  assert.equal(data.status, 'done', JSON.stringify(data))
  assert.equal(fakeWrites(rig.home).length, 3)
  assert.deepEqual([...sinceTargets(rig, from)], [WRITER])
}))

test('reads go to the reader, even with a writer logged in', production(async rig => {
  const from = mark(rig)
  const read = await callTool(rig.adapter, 'org_inspect', { orgId: ORG }, rig.input())
  assert.equal(read.ok, true, JSON.stringify(read))
  assert.deepEqual([...sinceTargets(rig, from)], [USERNAME])
}))

test('the result reminds the person to log the writer out, and the assistant is not asked to', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  const ran = await rig.run(reply.pinned)
  const data = reported(ran)
  assert.match(String(data.afterThis), new RegExp(`sf org logout --target-org ${WRITER}`))
  assert.match(String(data.afterThis), /own terminal/)
  assert.ok((ran as { text: string }).text.includes(`sf org logout --target-org ${WRITER}`))
  assert.equal(fakeCalls(rig.home).some(call => /logout/.test(call.command)), false)
}))

test('with the writer logged out, a production write refuses with the steps, and leaves the band alone', production(async rig => {
  const planId = await rig.plan()
  logOut(rig)
  const reply = await rig.prepare(planId)
  refused(reply, new RegExp(`sf org login web --instance-url ${INSTANCE}`))
  refused(reply, new RegExp(`sign in as ${WRITER}`))
  refused(reply, /MFA/)
  refused(reply, /own terminal/)
  assert.equal(fakeWrites(rig.home).length, 0)
  // A writer logged out is how it should be. It's no notice about the org.
  assert.equal((storeGet(rig.home.store, sessionKey(rig.home.project)) as { issue: unknown } | undefined)?.issue ?? null, null)
}))

test('a writer logged out between the dialog and the write stops it', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  logOut(rig)
  refused(await rig.run(reply.pinned), /sf org login web/)
  assert.equal(fakeWrites(rig.home).length, 0)
}))

test('no writer and a read-only reader refuses, and says how to register one', production(async rig => {
  const reply = await rig.prepare(await rig.plan())
  refused(reply, /no writer is registered/i)
  refused(reply, /role writer/)
  assert.doesNotMatch((reply as { reason: string }).reason, /accept/i)
  assert.equal(fakeWrites(rig.home).length, 0)
}, { writer: false }))

test('a reader that can write, and nobody accepted that, still refuses', production(async rig => {
  const reply = await rig.prepare(await rig.plan())
  refused(reply, /no writer is registered/i)
  refused(reply, /accept/i)
  assert.equal(fakeWrites(rig.home).length, 0)
}, { writer: false, register: { writeAccess: CAN_WRITE } }))

test('one user, accepted at registration, writes as itself and gets no logout reminder', production(async rig => {
  const planId = await rig.plan()
  const from = mark(rig)
  const reply = await rig.approve(planId)
  assert.equal(reply.facts.identity.username, USERNAME)
  const data = reported(await rig.run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(data.afterThis, undefined)
  assert.deepEqual([...sinceTargets(rig, from)], [USERNAME])
}, { writer: false, register: { writeAccess: CAN_WRITE, singleUserAcceptedAt: '2026-06-01T00:00:00.000Z' } }))

test('a writer outranks an old acceptance', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  assert.equal(reply.facts.identity.username, WRITER)
}, { register: { writeAccess: CAN_WRITE, singleUserAcceptedAt: '2026-06-01T00:00:00.000Z' } }))

test("a sandbox needs none of this: its one user writes, with no reminder", writeRig(async rig => {
  const reply = await rig.approve(await rig.plan())
  const data = reported(await rig.run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(data.afterThis, undefined)
  assert.deepEqual([...targets(rig)], [USERNAME])
}))

test('a restore goes through the same gate', production(async rig => {
  const planId = await rig.plan()
  const reply = await rig.approve(planId)
  assert.equal(reported(await rig.run(reply.pinned)).status, 'done')
  logOut(rig)
  const restore = await prepareRestore(rig.adapter, rig.input(), { planId, briefId: rig.briefId }, rig.briefHash, 'execute')
  refused(restore, /sf org login web/)
}))

test('Topia never runs the login itself', production(async rig => {
  const planId = await rig.plan()
  logOut(rig)
  refused(await rig.prepare(planId), /sf org login web/)
  assert.equal(fakeCalls(rig.home).some(call => call.command.startsWith('org login')), false)
}))

// ── what a read-only user can't judge ──

const READER_DESCRIBE = { ...DESCRIBE_WIDGET, updateable: false, deletable: false, fields: DESCRIBE_WIDGET.fields.map(field => ({ ...field, updateable: false, createable: false })) }
const AS_READER = { describeFor: { [USERNAME]: { Widget__c: READER_DESCRIBE } }, access: { [widgetIds(3)[0] as string]: { HasEditAccess: false } } }

test('with the writer logged out, a preview says what it could not judge, and invents no blockers', production(async rig => {
  logOut(rig)
  const planStamp = { mode: 'plan', agentId: null, confirmedBriefHash: rig.briefHash, ack: null }
  const result = await callTool(rig.adapter, 'records_preview', { orgId: ORG, briefId: rig.briefId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: widgetIds(3), [STAMP_KEY]: planStamp }, rig.input())
  assert.equal(result.ok, true, JSON.stringify(result))
  const data = result.data as { blockers: string[]; checked: string[]; not_checked: string[]; notes: string[]; recordAccess: unknown }
  assert.deepEqual(data.blockers, [])
  for (const name of ['object-crud', 'field-updateable', 'record-access']) {
    assert.equal(data.checked.includes(name), false, name)
    assert.ok(data.not_checked.includes(name), name)
  }
  assert.equal(data.recordAccess, null)
  assert.ok(data.notes.some(note => /writer/.test(note)))
}, { scenario: AS_READER }))

test('with the writer logged in, a preview asks about the writer', production(async rig => {
  const planStamp = { mode: 'plan', agentId: null, confirmedBriefHash: rig.briefHash, ack: null }
  const from = mark(rig)
  const result = await callTool(rig.adapter, 'records_preview', { orgId: ORG, briefId: rig.briefId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: widgetIds(3), [STAMP_KEY]: planStamp }, rig.input())
  const data = result.data as { blockers: string[]; checked: string[] }
  assert.deepEqual(data.blockers, [`This user can't edit 1 of 3 records.`])
  assert.ok(data.checked.includes('record-access'))
  assert.ok(sinceTargets(rig, from).has(WRITER))
}, { scenario: { describeFor: { [USERNAME]: { Widget__c: READER_DESCRIBE } }, access: { [widgetIds(3)[0] as string]: { HasEditAccess: false } } } }))

test('a plan can be written while the writer is logged out, on a field the reader can not edit', production(async rig => {
  logOut(rig)
  const planId = await rig.plan()
  assert.match(planId, /^plan-/)
}, { scenario: { describeFor: { [USERNAME]: { Widget__c: READER_DESCRIBE } } } }))

test('on a sandbox a field this user can not edit still refuses the plan', writeRig(async rig => {
  await assert.rejects(rig.plan(), /cannot be updated/)
}, { scenario: { describeFor: { [USERNAME]: { Widget__c: READER_DESCRIBE } } } }))

// ── the audit trail ──

function trailQueries(rig: WriteRig): string[] {
  return fakeCalls(rig.home).filter(call => (call.soql ?? '').includes('FROM SetupAuditTrail')).map(call => call.soql as string)
}

test('before a production write, the comparison is about the writer, read as the writer', production(async rig => {
  const planId = await rig.plan()
  await rig.prepare(planId)
  const trail = fakeCalls(rig.home).filter(call => (call.soql ?? '').includes('FROM SetupAuditTrail'))
  assert.ok(trail.length > 0)
  assert.ok(trail.every(call => call.flags['target-org'] === WRITER))
  assert.ok(trailQueries(rig).every(soql => soql.includes(WRITER_ID)))
}))

test('at session start, the writer is compared too, through the reader, because it is logged out by then', production(async rig => {
  logOut(rig)
  const result: AuditResult = await auditBeforeWrite(rig.adapter, rig.input(), ORG)
  assert.equal(result.state, 'found', JSON.stringify(result))
  assert.match(result.text ?? '', /the writer/)
  assert.ok(fakeCalls(rig.home).filter(call => (call.soql ?? '').includes('FROM SetupAuditTrail')).every(call => call.flags['target-org'] === USERNAME))
  assert.ok(trailQueries(rig).some(soql => soql.includes(WRITER_ID)))
}, {
  scenario: {
    queries: [
      ...(writerScenario().queries as unknown[]),
      { match: `SELECT Id FROM User WHERE Username = '${WRITER}'`, result: queryRows([{ Id: WRITER_ID }], 'User') },
      { match: `FROM SetupAuditTrail WHERE CreatedById = '${WRITER_ID}'`, result: queryRows([{ Action: 'changedApexClass', Section: 'Apex Class', CreatedDate: new Date().toISOString() }], 'SetupAuditTrail') },
    ],
  },
}))

test('a writer that can not be looked up reads as could not check, never as clean', production(async rig => {
  logOut(rig)
  const result = await auditBeforeWrite(rig.adapter, rig.input(), ORG)
  assert.equal(result.state, 'could-not-check')
  assert.match(result.reasons.join(' '), /writer/)
}, { scenario: { queries: [{ match: `SELECT Id FROM User WHERE Username = '${WRITER}'`, result: queryRows([], 'User') }] } }))

// ── the login on record ──

test('a write records that the writer is logged in', production(async rig => {
  await rig.approve(await rig.plan())
  assert.equal(readWriter(rig.home.store, rig.home.project, ORG)?.login?.state, 'logged-in')
}))

// ── the band, while the writer is logged in ──

const ask = (rig: WriteRig, command: string) => {
  const ran = runRunner(rig.home, command, {})
  assert.ok(ran.reply, JSON.stringify(ran))
  return ran.reply as Record<string, any>
}

test('after a production write, the band says the writer is still logged in, and the runner knows to look again', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  await rig.run(reply.pinned)
  const status = ask(rig, 'status')
  assert.match(status.writerNotice, /[Ww]riter still logged in/)
  assert.match(status.writerNotice, new RegExp(`sf org logout --target-org ${WRITER}`))
  assert.equal(status.writerCheck, true)
}))

test('once the person logs the writer out, the next look clears the band', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  await rig.run(reply.pinned)
  logOut(rig)
  assert.deepEqual(ask(rig, 'writer-check').writers, [{ orgId: ORG, state: 'logged-out' }])
  const status = ask(rig, 'status')
  assert.equal(status.writerNotice, null)
  assert.equal(status.writerCheck, false)
}))

test('once the writer is gone, the band goes back to the reader, from a live check', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  await rig.run(reply.pinned)
  const before = ask(rig, 'status').session as { identity: { user: string }; writeWarning: string | null }
  assert.equal(before.identity.user, WRITER)
  assert.notEqual(before.writeWarning, null)
  logOut(rig)
  ask(rig, 'writer-check')
  const after = ask(rig, 'status').session as { identity: { user: string }; writeWarning: string | null }
  assert.equal(after.identity.user, USERNAME)
  assert.equal(after.writeWarning, null)
}))

test('a look that can not tell keeps the band up, and says it could not check', production(async rig => {
  const reply = await rig.approve(await rig.plan())
  await rig.run(reply.pinned)
  rig.rescenario(scenario => ({ ...scenario, mode: 'malformed', modeOn: 'org display' }))
  assert.deepEqual(ask(rig, 'writer-check').writers, [{ orgId: ORG, state: 'unknown' }])
  const status = ask(rig, 'status')
  assert.match(status.writerNotice, /couldn't check/)
  assert.equal(status.writerCheck, true)
}))

test('a session that starts with the writer still logged in says so', production(async rig => {
  registerWriterFake(rig.home, { isSandbox: false, name: 'Acme Production', login: { state: 'logged-out', checkedAt: '2026-06-01T00:00:00.000Z' } })
  assert.equal(ask(rig, 'status').writerNotice, null)
  assert.equal(ask(rig, 'identity-check').ok, true)
  assert.match(ask(rig, 'status').writerNotice, /[Ww]riter still logged in/)
}))

test('with no writer the status spawns nothing, and says nothing about one', writeRig(async rig => {
  const from = mark(rig)
  const status = ask(rig, 'status')
  assert.equal(status.writerNotice, null)
  assert.equal(status.writerCheck, false)
  assert.equal(fakeCalls(rig.home).length, from)
}))

test('with a writer the status still spawns nothing: only the look does', production(async rig => {
  const from = mark(rig)
  ask(rig, 'status')
  assert.equal(fakeCalls(rig.home).length, from)
}))
