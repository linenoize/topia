import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen } from './approval-screen.js'
import { readJson } from './json-file.js'
import { sweepProjectLogs } from './log-retention.js'
import { localFile, planFile } from './paths.js'
import { loadPlan, type RecordsPlan } from './plan-tools.js'
import { prepareRestore } from './restore.js'
import { type ApproveReply, type WriteReply } from './records-write.js'
import { changeFakeOrg, contextFor, fakeCalls, fakeOrg, fakeWrites, refused, reported, widgetIds, writeRig as rig, type WriteRig } from './test-support.js'

const IDS = widgetIds(3)
const DAY = 24 * 60 * 60 * 1000

type Restored = { reply: WriteReply; approve: () => ApproveReply }

async function ask(rigged: WriteRig, sourcePlanId: string, over: { brief?: string | null; mode?: 'execute' | 'validate' | 'read-only'; now?: number; briefId?: string } = {}): Promise<Restored> {
  const reply = await prepareRestore(rigged.adapter, rigged.input(over.now), { planId: sourcePlanId, briefId: over.briefId ?? rigged.briefId }, over.brief === undefined ? rigged.briefHash : over.brief, over.mode ?? 'execute')
  return {
    reply,
    approve: () => {
      assert.equal(reply.ok, true, JSON.stringify(reply))
      assert.equal((reply as ApproveReply).action, 'approve', JSON.stringify(reply))
      const screen = buildApprovalScreen((reply as ApproveReply).screenPlan, (reply as ApproveReply).facts)
      assert.equal(approvalAccepted(screen, screen.approveLabel), true)
      return reply as ApproveReply
    },
  }
}

async function written(rigged: WriteRig, over: Record<string, unknown> = {}): Promise<string> {
  const planId = await rigged.plan(over)
  reported(await rigged.run((await rigged.approve(planId)).pinned))
  return planId
}

const record = (rigged: WriteRig, id: string) => fakeOrg(rigged.home).records.Widget__c?.[id] as Record<string, unknown>

test('a restore is a new plan through the same gate, and the screen says so', rig(async rigged => {
  const source = await written(rigged)
  const reply = (await ask(rigged, source)).approve()
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.approveLabel, 'Update 3 Widget__c in Sandbox')
  assert.match(screen.text, /This restores plan/)
  assert.match(screen.text, /Automation fires again/)
  assert.match(screen.text, /Reversibility: restorable/)
  assert.match(screen.text, /Class: Sandbox/)
  const newPlanId = (JSON.parse(reply.pinned.planBytes) as { plan: RecordsPlan }).plan.id
  assert.notEqual(newPlanId, source)
  const loaded = loadPlan(rigged.home.store, rigged.home.project, newPlanId, Date.now())
  assert.equal(loaded.ok, true, JSON.stringify(loaded))
  assert.equal((loaded as { plan: RecordsPlan }).plan.restoreOf, source)
}))

test('it writes each record its own old value, and the org ends where it began', rig(async rigged => {
  const source = await written(rigged, { changes: [{ field: 'Name', value: 'Renamed' }] })
  assert.equal(record(rigged, IDS[0] as string).Name, 'Renamed')
  const data = reported(await rigged.run((await ask(rigged, source)).approve().pinned))
  assert.equal(data.status, 'done')
  assert.equal(record(rigged, IDS[0] as string).Name, 'Widget 001')
  assert.equal(record(rigged, IDS[1] as string).Name, 'Widget 002')
  assert.equal(record(rigged, IDS[2] as string).Name, 'Widget 003')
  assert.equal(fakeWrites(rigged.home).length, 6)
}))

test('only ids still holding the written value are targeted, and the rest are conflicts, never overwritten', rig(async rigged => {
  const source = await written(rigged)
  changeFakeOrg(rigged.home, org => {
    ;(org.records.Widget__c?.[IDS[1] as string] as Record<string, unknown>).Status__c = 'Someone else'
  })
  const reply = (await ask(rigged, source)).approve()
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.approveLabel, 'Update 2 Widget__c in Sandbox')
  assert.match(screen.text, /1 changed since/)
  assert.deepEqual(reply.pinned.expected.ids, [IDS[0], IDS[2]])
  const data = reported(await rigged.run(reply.pinned))
  assert.deepEqual(data.conflicts, [IDS[1]])
  assert.equal(record(rigged, IDS[1] as string).Status__c, 'Someone else')
  assert.equal(record(rigged, IDS[0] as string).Status__c, 'New')
}))

test('when everything is a conflict there is no dialog and no write', rig(async rigged => {
  const source = await written(rigged)
  changeFakeOrg(rigged.home, org => {
    for (const id of IDS) (org.records.Widget__c?.[id] as Record<string, unknown>).Status__c = 'Someone else'
  })
  const before = fakeWrites(rigged.home).length
  const { reply } = await ask(rigged, source)
  const data = reported(reply)
  assert.deepEqual(data.conflicts, IDS)
  assert.equal(fakeWrites(rigged.home).length, before)
}))

test('restored twice, the second time has nothing to do', rig(async rigged => {
  const source = await written(rigged)
  reported(await rigged.run((await ask(rigged, source)).approve().pinned))
  const before = fakeWrites(rigged.home).length
  const data = reported((await ask(rigged, source)).reply)
  assert.equal(data.counts.alreadyOld, 3)
  assert.equal(fakeWrites(rigged.home).length, before)
}))

test('a restore saves its own pre-image, so it can be undone the same way', rig(async rigged => {
  const source = await written(rigged)
  const reply = (await ask(rigged, source)).approve()
  const newPlanId = (JSON.parse(reply.pinned.planBytes) as { plan: RecordsPlan }).plan.id
  reported(await rigged.run(reply.pinned))
  assert.equal(existsSync(localFile(rigged.home.store, rigged.home.project, 'preimages', newPlanId)), true)
}))

test('a restore plan in the repo holds ids, field names, counts, and hashes, and no value', rig(async rigged => {
  const source = await written(rigged)
  const reply = (await ask(rigged, source)).approve()
  const newPlanId = (JSON.parse(reply.pinned.planBytes) as { plan: RecordsPlan }).plan.id
  const text = readFileSync(planFile(rigged.home.project, newPlanId), 'utf8')
  for (const value of ['New', 'Closed', 'Widget 001']) assert.equal(text.includes(`"${value}"`), false, value)
}))

test('the dialog step reads the org and writes nothing', rig(async rigged => {
  const source = await written(rigged)
  const before = fakeWrites(rigged.home).length
  ;(await ask(rigged, source)).approve()
  assert.equal(fakeWrites(rigged.home).length, before)
}))

// ── what stops it ────────────────────────────────────────────────────────────

test('it needs a confirmed brief, and the execute mode', rig(async rigged => {
  const source = await written(rigged)
  const before = fakeCalls(rigged.home).length
  refused((await ask(rigged, source, { brief: null })).reply, /confirm/)
  refused((await ask(rigged, source, { brief: 'b'.repeat(64) })).reply, /confirm/)
  refused((await ask(rigged, source, { mode: 'validate' })).reply, /does not run/)
  assert.equal(fakeCalls(rigged.home).length, before)
}))

test('a brief that is not the confirmed one stops it, whatever hash came with it', rig(async rigged => {
  const source = await written(rigged)
  refused((await ask(rigged, source, { briefId: 'brief-0000000000000000' })).reply, /brief/i)
}))

test('a pre-image that has gone stops it', rig(async rigged => {
  const source = await written(rigged)
  rmSync(localFile(rigged.home.store, rigged.home.project, 'preimages', source))
  refused((await ask(rigged, source)).reply, /pre-image/i)
}))

test('a pre-image past its date stops it, even if it is still on disk', rig(async rigged => {
  const source = await written(rigged)
  refused((await ask(rigged, source, { now: Date.now() + 31 * DAY })).reply, /expired|30 days/i)
}))

test('the existing sweep removes a pre-image after 30 days, and keeps one at 29', rig(async rigged => {
  const source = await written(rigged)
  const file = localFile(rigged.home.store, rigged.home.project, 'preimages', source)
  const at = Date.now()
  const old = new Date(at - 29 * DAY)
  utimesSync(file, old, old)
  assert.deepEqual(sweepProjectLogs(rigged.home.store, rigged.home.project, at).preimages.removed, [])
  const older = new Date(at - 31 * DAY)
  utimesSync(file, older, older)
  assert.deepEqual(sweepProjectLogs(rigged.home.store, rigged.home.project, at).preimages.removed, [`${source}.json`])
  assert.equal(existsSync(file), false)
}))

test('a pre-image that does not match its journaled hash stops it', rig(async rigged => {
  const source = await written(rigged)
  const file = localFile(rigged.home.store, rigged.home.project, 'preimages', source)
  const image = readJson<Record<string, unknown>>(file) as { records: { values: Record<string, unknown> }[] }
  ;(image.records[0] as { values: Record<string, unknown> }).values.Status__c = 'Evil'
  writeFileSync(file, JSON.stringify(image))
  refused((await ask(rigged, source)).reply, /hash|journal/i)
}))

test('a damaged pre-image stops it', rig(async rigged => {
  const source = await written(rigged)
  writeFileSync(localFile(rigged.home.store, rigged.home.project, 'preimages', source), '{"records":')
  refused((await ask(rigged, source)).reply, /pre-image/i)
}))

test('a source plan still running stops it', rig(async rigged => {
  const source = await rigged.plan()
  reported(await rigged.run((await rigged.approve(source)).pinned, { pollBudgetMs: 0 }))
  refused((await ask(rigged, source)).reply, /still|running|settle/i)
}, { ids: widgetIds(205), scenario: { bulk: { pollsUntilDone: 50 } } }))

test('a bulk job nothing can read stops it too, because it may still be writing', rig(async rigged => {
  const source = await rigged.plan()
  assert.equal(reported(await rigged.run((await rigged.approve(source)).pinned)).status, 'unknown')
  refused((await ask(rigged, source)).reply, /still|running|settle/i)
}, { ids: widgetIds(205), scenario: { mode: 'unexplained', modeOn: 'data update bulk' } }))

test('an identity that moved stops it before any record is read', rig(async rigged => {
  const source = await written(rigged)
  rigged.rescenario(scenario => ({ ...scenario, queries: [{ match: 'FROM Organization', result: { records: [{ Id: '00D000000000009AAA', Name: 'Other', IsSandbox: true, OrganizationType: 'Developer Edition', InstanceName: 'CS1' }], totalSize: 1, done: true } }, ...(scenario.queries as unknown[])] }))
  const before = fakeCalls(rigged.home).length
  const { reply } = await ask(rigged, source)
  assert.equal(reply.ok, false)
  assert.equal(fakeCalls(rigged.home).slice(before).some(item => (item.soql ?? '').includes('FROM Widget__c')), false)
}))

test('a plan that does not exist stops it', rig(async rigged => {
  refused((await ask(rigged, 'plan-00000000-0000-0000-0000-000000000000')).reply, /No plan/)
}))

// ── what is not a restore tool ───────────────────────────────────────────────

test('a soft delete has no tool: it checks with --all-rows and gives a person guidance', rig(async rigged => {
  const source = await written(rigged, { operation: 'delete', changes: [] })
  changeFakeOrg(rigged.home, org => {
    delete org.records.Widget__c?.[IDS[2] as string]
  })
  const before = fakeWrites(rigged.home).length
  const { reply } = await ask(rigged, source)
  const data = reported(reply)
  assert.equal(data.class, 'recycle-bin')
  assert.equal(data.inBin, 2)
  assert.equal(data.purged, 1)
  assert.match(String(data.guidance), /person restores from Setup/)
  assert.match(String(data.guidance), /no CLI undelete|There's no CLI undelete/i)
  assert.match(String(data.guidance), /automation/i)
  assert.equal(fakeWrites(rigged.home).length, before)
  const read = fakeCalls(rigged.home).filter(item => item.flags['all-rows'] === true)
  assert.equal(read.length, 1)
  assert.equal(fakeCalls(rigged.home).some(item => /undelete/i.test(item.argv.join(' '))), false)
}))

void contextFor
void join
