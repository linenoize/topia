import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { briefFileFor, proposeBrief, type BriefInput } from './brief.js'
import { REVERSIBILITY_TEXT } from './contract.js'
import { appendJournal, readJournal } from './journal.js'
import { writeJson } from './json-file.js'
import { journalFile, localDirectory, localFile, orgsFile, planFile } from './paths.js'
import { loadPlan, type RecordsPlan } from './plan-tools.js'
import { PLAN_TTL_MS, canonical, planExpired, planHashOf, reversibilityOf, stripComputedPlanFields } from './plans.js'
import { reviewAllowsRecommendation } from './practice.js'
import { SfCliAdapter } from './sf-adapter.js'
import { baseScenario, contextFor, fakeCalls, fakeHome, ORG, queryRows, registerFake, writeScenario, RECORD, type FakeHome } from './test-support.js'
import { STAMP_KEY } from './stamp.js'
import { callTool, type ToolResult } from './tools.js'

const NOW = Date.parse('2026-06-01T00:00:00.000Z')
const BRIEF: BriefInput = { objective: 'Close the old Widget__c', environment: 'Sandbox Acme Sales', subjects: [{ name: 'Widget__c', status: 'known' }], change: 'Status__c to Closed', blockingQuestions: [] }
const IDS = ['a00000000000001AAA', 'a00000000000002AAA', 'a00000000000003AAA']
const MODSTAMP = '2026-05-01T00:00:00.000+0000'
const NO_REVIEW = 'practice-00000000-0000-0000-0000-000000000000'

function liveRows(over: Record<string, Record<string, unknown>> = {}): Record<string, unknown>[] {
  return IDS.map(id => ({ Id: id, SystemModstamp: MODSTAMP, Status__c: 'New', Name: `Secret name of ${id}`, ...over[id] }))
}

function scenarioWith(rows: Record<string, unknown>[]): Record<string, unknown> {
  return { queries: [{ match: 'SELECT Id, SystemModstamp', result: queryRows(rows) }] }
}

type Rig = {
  home: FakeHome
  briefId: string
  briefHash: string
  call: (name: string, args: Record<string, unknown>, stamp?: Record<string, unknown> | null) => Promise<ToolResult>
  review: (over?: Record<string, unknown>) => Promise<string>
  update: (over?: Record<string, unknown>, stamp?: Record<string, unknown> | null) => Promise<ToolResult>
}

function rig(body: (rig: Rig) => Promise<void>, scenario: Record<string, unknown> = scenarioWith(liveRows())): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario(scenario))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, BRIEF, new Date(NOW).toISOString())
      const planStamp = { mode: 'plan', agentId: null, confirmedBriefHash: briefHash, ack: null }
      const call: Rig['call'] = (name, args, stamp = planStamp) => callTool(adapter, name, stamp === null ? { briefId, ...args } : { briefId, ...args, [STAMP_KEY]: stamp }, contextFor(home, { hookHost: true, now: NOW }))
      const review: Rig['review'] = async (over = {}) => {
        const result = await call('practice_record', { practice: 'flow is fine', experience: 'page still works', security: 'no new access', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['Status__c', 'Name', 'Amount__c', 'Nope__c', 'CreatedDate', 'delete', 'deploy'], ...over })
        assert.equal(result.ok, true, JSON.stringify(result))
        return (result.data as { practiceReviewId: string }).practiceReviewId
      }
      const update: Rig['update'] = async (over = {}, stamp = planStamp) => {
        const practiceReviewId = await review()
        return call('records_plan_update', { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS, businessObjective: 'Tidy up the Secret objective', notes: 'Secret note', ...over }, stamp)
      }
      await body({ home, briefId, briefHash, call, review, update })
    } finally {
      home.cleanup()
    }
  }
}

type PlanData = { planId: string; planHash: string; count: number; stateHash: string; expiresAt: string; reversibility: string; reversibilityText: string; briefConfirmed: boolean; object: string; operation: string; changedFields: string[]; practice: { note: string } }

function planned(result: ToolResult): PlanData {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data as PlanData
}

function committed(home: FakeHome, planId: string): { planHash: string; plan: Record<string, unknown> } {
  return JSON.parse(readFileSync(planFile(home.project, planId), 'utf8')) as { planHash: string; plan: Record<string, unknown> }
}

function orgReads(home: FakeHome): number {
  return fakeCalls(home).filter(call => (call.soql ?? '').includes('FROM Widget__c')).length
}

function readdirSafe(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : []
}

// ── the whole-plan hash ──

const SAMPLE: RecordsPlan = {
  version: 1,
  kind: 'records',
  id: 'plan-1',
  orgId: ORG,
  object: 'Widget__c',
  operation: 'update',
  changedFields: ['Status__c'],
  frozenRecordIds: IDS,
  count: 3,
  stateHash: 'state',
  valuesHash: 'values',
  briefId: 'brief-1',
  briefHash: 'brief',
  briefConfirmed: true,
  practiceReviewId: 'practice-1',
  reversibility: 'restorable',
  createdAt: '2026-06-01T00:00:00.000Z',
  expiresAt: '2026-06-02T00:00:00.000Z',
}

test('the hash covers the whole plan, so no field can sit outside it', () => {
  const base = planHashOf(SAMPLE)
  for (const key of Object.keys(SAMPLE)) {
    assert.notEqual(planHashOf({ ...SAMPLE, [key]: 'changed' } as never), base, key)
  }
  assert.notEqual(planHashOf({ ...SAMPLE, addedLater: 1 } as never), base, 'a field nobody listed is covered too')
})

test('the hash leaves out approval, and only approval', () => {
  const base = planHashOf(SAMPLE)
  assert.equal(planHashOf({ ...SAMPLE, approval: { hash: 'x', approver: 'y', at: 'z' } } as never), base)
  assert.notEqual(planHashOf({ ...SAMPLE, approvalRule: 'x' } as never), base)
})

test('the hash does not depend on key order', () => {
  const shuffled = Object.fromEntries(Object.entries(SAMPLE).reverse()) as RecordsPlan
  assert.equal(canonical(shuffled), canonical(SAMPLE))
  assert.equal(planHashOf(shuffled), planHashOf(SAMPLE))
})

test('what the code computes is stripped from what the model sent', () => {
  const stripped = stripComputedPlanFields({ orgId: ORG, approval: { hash: 'x' }, planHash: 'x', count: 1, expectedCount: 1, stateHash: 'x', expiry: 'x', expiresAt: 'x', artifactHash: 'x', reversibility: 'x', briefHash: 'x', briefConfirmed: true, createdAt: 'x', valuesHash: 'x', id: 'x', planId: 'x' })
  assert.deepEqual(stripped, { orgId: ORG })
})

test('an expired plan, or one whose expiry cannot be read, has expired', () => {
  assert.equal(planExpired({ expiresAt: '2026-06-02T00:00:00.000Z' }, Date.parse('2026-06-01T00:00:00.000Z')), false)
  assert.equal(planExpired({ expiresAt: '2026-06-02T00:00:00.000Z' }, Date.parse('2026-06-02T00:00:00.000Z')), true)
  assert.equal(planExpired({ expiresAt: 'whenever' }, 0), true)
  assert.equal(planExpired({ expiresAt: '' }, 0), true)
})

test('the reversibility class comes from the operation, with fixed text from code', () => {
  assert.equal(reversibilityOf({ kind: 'records', operation: 'update' }), 'restorable')
  assert.equal(reversibilityOf({ kind: 'records', operation: 'delete' }), 'recycle-bin')
  assert.equal(reversibilityOf({ kind: 'deploy' }), 'forward-only')
  assert.match(REVERSIBILITY_TEXT['recycle-bin'], /15 days/)
  assert.match(REVERSIBILITY_TEXT['forward-only'], /No undo/)
  assert.match(REVERSIBILITY_TEXT.restorable, /automation fires again/)
})

// ── a records plan ──

test('a plan is computed by the code', rig(async ({ update, home, briefHash }) => {
  const data = planned(await update())
  assert.match(data.planId, /^plan-[a-f0-9-]+$/)
  assert.match(data.planHash, /^[a-f0-9]{64}$/)
  assert.equal(data.count, 3)
  assert.match(data.stateHash, /^[a-f0-9]{64}$/)
  assert.equal(data.expiresAt, new Date(NOW + PLAN_TTL_MS).toISOString())
  assert.equal(data.reversibility, 'restorable')
  assert.equal(data.reversibilityText, REVERSIBILITY_TEXT.restorable)
  const file = committed(home, data.planId)
  assert.equal(file.planHash, data.planHash)
  assert.equal(file.plan.briefHash, briefHash)
  assert.equal(file.plan.count, 3)
}))

for (const [name, sent] of [
  ['count', { count: 1 }],
  ['expectedCount', { expectedCount: 1 }],
  ['stateHash', { stateHash: 'forged' }],
  ['expiry', { expiry: '2099-01-01T00:00:00.000Z' }],
  ['expiresAt', { expiresAt: '2099-01-01T00:00:00.000Z' }],
  ['planHash', { planHash: 'forged' }],
  ['reversibility', { reversibility: 'irreversible' }],
  ['briefConfirmed', { briefConfirmed: true }],
  ['briefHash', { briefHash: 'forged' }],
] as const) {
  test(`what the model sends for ${name} is ignored`, rig(async ({ update, home }) => {
    const clean = planned(await update())
    const forged = planned(await update(sent))
    assert.equal(forged.count, clean.count)
    assert.equal(forged.stateHash, clean.stateHash)
    assert.equal(forged.expiresAt, clean.expiresAt)
    assert.equal(forged.reversibility, clean.reversibility)
    assert.equal(JSON.stringify(committed(home, forged.planId)).includes('forged'), false)
    assert.equal(JSON.stringify(committed(home, forged.planId)).includes('2099-'), false)
  }))
}

test('a forged approval is stripped, and never reaches a plan file', rig(async ({ update, home }) => {
  const data = planned(await update({ approval: { hash: 'forged', approver: 'ada', at: '2026-06-01T00:00:00.000Z' } }))
  const file = committed(home, data.planId)
  assert.equal('approval' in file.plan, false)
  assert.equal(JSON.stringify(file).includes('forged'), false)
  const local = readFileSync(localFile(home.store, home.project, 'plans', data.planId), 'utf8')
  assert.equal(local.includes('forged'), false)
}))

for (const operation of ['upsert', 'insert', 'merge', 'Delete', 'DELETE', 'Update', 'undelete', 'hard_delete', '', 5]) {
  test(`the operation enum refuses ${JSON.stringify(operation)}`, rig(async ({ update, home }) => {
    const result = await update({ operation })
    assert.equal(result.ok, false)
    assert.equal(orgReads(home), 0)
  }))
}

for (const [name, extra] of [
  ['rerunQuery', { rerunQuery: 'SELECT Id FROM Widget__c' }],
  ['a rerun kind', { kind: 'rerun-query' }],
  ['before and after text', { before: 'old', after: 'new' }],
  ['recovery text', { recovery: { cannotUndo: [] } }],
] as const) {
  test(`a plan does not take ${name}`, rig(async ({ update, home }) => {
    const result = await update(extra)
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result.data), /not accepted/)
    assert.equal(orgReads(home), 0)
  }))
}

for (const [name, over] of [
  ['an update with no changes', { changes: [] }],
  ['a delete with changes', { operation: 'delete' }],
  ['a field that does not exist', { changes: [{ field: 'Nope__c', value: 'x' }] }],
  ['a field that cannot be updated', { changes: [{ field: 'CreatedDate', value: '2026-01-01T00:00:00Z' }] }],
  ['a parent field', { changes: [{ field: 'Owner.Email', value: 'x@example.com' }] }],
  ['the same field twice', { changes: [{ field: 'Status__c', value: 'Closed' }, { field: 'Status__c', value: 'New' }] }],
  ['a value of the wrong type', { changes: [{ field: 'Amount__c', value: 'lots' }] }],
  ['no ids', { frozenRecordIds: [] }],
  ['a bad id', { frozenRecordIds: ["a00000000000001AAA' OR Id != '"] }],
  ['a duplicate id', { frozenRecordIds: [IDS[0], IDS[0]] }],
  ['ids from two objects', { frozenRecordIds: [IDS[0], '00100000000000XAAA'] }],
] as const) {
  test(`a plan is refused: ${name}`, rig(async ({ update, home }) => {
    const result = await update(over)
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.equal(readdirSafe(join(home.project, '.topia', 'salesforce', 'plans')).length, 0)
  }))
}

test('a delete takes no changes, and its class is recycle-bin', rig(async ({ update }) => {
  const data = planned(await update({ operation: 'delete', changes: [] }))
  assert.equal(data.reversibility, 'recycle-bin')
  assert.equal(data.operation, 'delete')
}))

test('an id the org does not return is refused, so the count is real', rig(async ({ update, home }) => {
  const result = await update()
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /2 of 3/)
  assert.equal(readdirSafe(join(home.project, '.topia', 'salesforce', 'plans')).length, 0)
}, scenarioWith(liveRows().slice(0, 2))))

test('a partial read is refused', rig(async ({ update }) => {
  const result = await update()
  assert.equal(result.ok, false)
}, { queries: [{ match: 'SELECT Id, SystemModstamp', result: { records: [], totalSize: 3, done: false }, warnings: ['missing'] }] }))

test('ids read in chunks of 200', rig(async ({ update, home }) => {
  const many = Array.from({ length: 401 }, (_, index) => `a00000000000${String(index).padStart(3, '0')}AAA`)
  writeScenario(home, baseScenario({ queries: [{ match: 'SELECT Id, SystemModstamp', result: queryRows(many.slice(0, 200).map(id => ({ Id: id, SystemModstamp: MODSTAMP, Status__c: 'New' }))) }] }))
  const result = await update({ frozenRecordIds: many })
  assert.equal(result.ok, false, 'the fake answers only 200, so the count does not match')
  const sent = fakeCalls(home).filter(call => (call.soql ?? '').includes('SELECT Id, SystemModstamp'))
  assert.equal(sent.length, 3)
  assert.ok(sent.every(call => ((call.soql ?? '').match(/'a0/g) ?? []).length <= 200))
}))

test('the state hash follows the org, not the model, and not the order of the ids', rig(async ({ update, home }) => {
  const first = planned(await update())
  const reordered = planned(await update({ frozenRecordIds: [...IDS].reverse() }))
  assert.equal(reordered.stateHash, first.stateHash)
  writeScenario(home, baseScenario(scenarioWith(liveRows({ [IDS[0] as string]: { SystemModstamp: '2026-05-02T00:00:00.000+0000' } }))))
  const changed = planned(await update())
  assert.notEqual(changed.stateHash, first.stateHash)
}))

// ── what gets committed ──

test('a committed plan holds ids, field names, counts, and hashes, and nothing else', rig(async ({ update, home }) => {
  const data = planned(await update({ changes: [{ field: 'Status__c', value: 'Closed' }, { field: 'Name', value: 'Ada Example' }] }))
  const text = readFileSync(planFile(home.project, data.planId), 'utf8')
  for (const secret of ['Closed', 'Ada Example', 'Secret objective', 'Secret note', 'Secret name', 'ada@example.com', '"New"']) assert.equal(text.includes(secret), false, secret)
  assert.ok(text.includes(IDS[0] as string))
  assert.ok(text.includes('Status__c'))
  const plan = committed(home, data.planId).plan
  assert.deepEqual(plan.changedFields, ['Status__c', 'Name'])
  assert.equal('changes' in plan, false)
  assert.equal('businessObjective' in plan, false)
}))

test('values and free text go to the local store, off the repo', rig(async ({ update, home }) => {
  const data = planned(await update({ changes: [{ field: 'Name', value: 'Ada Example' }] }))
  const file = localFile(home.store, home.project, 'plans', data.planId)
  assert.equal(file.startsWith(home.project), false)
  const text = readFileSync(file, 'utf8')
  for (const part of ['Ada Example', 'Secret objective', 'Secret note']) assert.ok(text.includes(part), part)
  // H4: what the org held is not kept. The screen reads it live and the pins hold the modstamps, so a stored copy only helps whoever searches the store.
  for (const part of ['Secret name', '"New"']) assert.equal(text.includes(part), false, part)
}))

test('a result shows no record values, because the model did not supply them', rig(async ({ update }) => {
  const result = await update({ changes: [{ field: 'Name', value: 'Ada Example' }] })
  assert.equal(JSON.stringify(result).includes('Secret name'), false)
}))

test('the journal records the proposal with no value, no free text, and no query literal', rig(async ({ update, home }) => {
  const result = await update()
  const lines = readJournal(home.project, 'corr-1')
  const proposed = lines.find(line => line.event === 'change.proposed')
  assert.equal(proposed?.counts?.rows, 3)
  const text = JSON.stringify(lines)
  for (const secret of ['Closed', 'Secret objective', 'Secret note', 'Secret name', "'a00000000000001AAA'", 'rerunQuery']) assert.equal(text.includes(secret), false, secret)
  assert.ok(text.includes((result.data as PlanData).planId))
}))

// ── the chain ──

test('a plan chains to the brief, and an edit to the brief voids it', rig(async ({ update, home, briefId }) => {
  const data = planned(await update())
  assert.equal(loadPlan(home.store, home.project, data.planId, NOW).ok, true)
  const file = briefFileFor(home.store, home.project, briefId)
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { brief: BriefInput }
  stored.brief.change = 'Delete everything'
  writeFileSync(file, JSON.stringify(stored))
  const loaded = loadPlan(home.store, home.project, data.planId, NOW)
  assert.equal(loaded.ok, false)
  assert.match((loaded as { reason: string }).reason, /brief/i)
}))

test('an edit to the committed plan voids it', rig(async ({ update, home }) => {
  const data = planned(await update())
  const file = committed(home, data.planId)
  writeFileSync(planFile(home.project, data.planId), JSON.stringify({ ...file, plan: { ...file.plan, frozenRecordIds: [IDS[0]] } }))
  const loaded = loadPlan(home.store, home.project, data.planId, NOW)
  assert.equal(loaded.ok, false)
  assert.match((loaded as { reason: string }).reason, /hash|edited/i)
}))

test('an edit to the local values voids it', rig(async ({ update, home }) => {
  const data = planned(await update())
  const file = localFile(home.store, home.project, 'plans', data.planId)
  const values = JSON.parse(readFileSync(file, 'utf8')) as { changes: { field: string; value: unknown }[] }
  ;(values.changes[0] as { value: unknown }).value = 'Purged'
  writeFileSync(file, JSON.stringify(values))
  const loaded = loadPlan(home.store, home.project, data.planId, NOW)
  assert.equal(loaded.ok, false)
  assert.match((loaded as { reason: string }).reason, /values/i)
}))

test('an approval written into a plan file means nothing', rig(async ({ update, home }) => {
  const data = planned(await update())
  const file = committed(home, data.planId)
  writeFileSync(planFile(home.project, data.planId), JSON.stringify({ ...file, plan: { ...file.plan, approval: { hash: file.planHash, approver: 'ada', at: 'now' } } }))
  const loaded = loadPlan(home.store, home.project, data.planId, NOW)
  assert.equal(loaded.ok, true, 'it is stripped, and the hash still holds')
  assert.equal('approval' in (loaded as { plan: object }).plan, false)
}))

test('an expired plan does not load', rig(async ({ update, home }) => {
  const data = planned(await update())
  assert.equal(loadPlan(home.store, home.project, data.planId, NOW + PLAN_TTL_MS - 1).ok, true)
  const loaded = loadPlan(home.store, home.project, data.planId, NOW + PLAN_TTL_MS)
  assert.equal(loaded.ok, false)
  assert.match((loaded as { reason: string }).reason, /expired/i)
}))

test('a teammate\'s plan from git, with no local values here, does not load', rig(async ({ update, home }) => {
  const data = planned(await update())
  writeFileSync(localFile(home.store, home.project, 'plans', data.planId), '')
  assert.equal(loadPlan(home.store, home.project, data.planId, NOW).ok, false)
}))

test('a plan that is not there, or a bad id, does not load', rig(async ({ home }) => {
  assert.equal(loadPlan(home.store, home.project, 'plan-nope', NOW).ok, false)
  assert.equal(loadPlan(home.store, home.project, '../../etc/passwd', NOW).ok, false)
}))

// ── the practice review ──

test('a plan without a practice review is refused', rig(async ({ call, home }) => {
  const result = await call('records_plan_update', { orgId: ORG, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /practice/i)
  assert.equal(orgReads(home), 0)
}))

test('a practice review needs all four measurements', rig(async ({ call }) => {
  for (const missing of ['practice', 'experience', 'security', 'pii', 'vendorImpact']) {
    const result = await call('practice_record', { practice: 'a', experience: 'b', security: 'c', pii: 'd', vendorImpact: 'none', stopRecommendation: false, confirmedChange: [], [missing]: '' })
    assert.equal(result.ok, false, missing)
  }
}))

test('a review writes the practice-review event under its own id, which the model does not choose', rig(async ({ call, home }) => {
  const result = await call('practice_record', { practice: 'a', experience: 'b', security: 'c', pii: 'Ada Example has an email', vendorImpact: 'none', stopRecommendation: false, confirmedChange: [], correlationId: 'call' })
  const id = (result.data as { practiceReviewId: string }).practiceReviewId
  assert.notEqual(id, 'call')
  assert.match(id, /^practice-[a-f0-9-]{36}$/)
  const lines = readJournal(home.project, id)
  assert.deepEqual(lines.map(line => line.event), ['practice-review'])
  assert.equal(JSON.stringify(lines).includes('Ada Example'), false, 'the measurements stay in the local store')
  assert.ok(readFileSync(localFile(home.store, home.project, 'practice', id), 'utf8').includes('Ada Example'))
}))

test('two reviews never share an id', rig(async ({ review }) => {
  const seen = new Set<string>()
  for (let index = 0; index < 5; index += 1) seen.add(await review())
  assert.equal(seen.size, 5)
}))

test('a practice-review line under some other id does not satisfy a plan', rig(async ({ home, call }) => {
  appendJournal(home.project, { event: 'practice-review', correlationId: NO_REVIEW, projectRoot: home.project, orgId: ORG, mode: 'plan', at: new Date(NOW).toISOString() })
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId: NO_REVIEW, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /practice/i)
}))

test('a review cannot serve a second plan', rig(async ({ call, review }) => {
  const practiceReviewId = await review()
  const args = { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }
  assert.equal((await call('records_plan_update', args)).ok, true)
  const second = await call('records_plan_update', args)
  assert.equal(second.ok, false)
  assert.match(JSON.stringify(second.data), /already/)
}))

test('a review for another brief does not count', rig(async ({ call, review, home }) => {
  const practiceReviewId = await review()
  const other = proposeBrief(home.store, home.project, { ...BRIEF, objective: 'Something else' }, new Date(NOW).toISOString())
  const result = await call('records_plan_update', { briefId: other.briefId, orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, { mode: 'plan', agentId: null, confirmedBriefHash: other.briefHash, ack: null })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /brief/i)
}))

test('a deleted journal line voids the review', rig(async ({ call, review, home }) => {
  const practiceReviewId = await review()
  writeFileSync(journalFile(home.project, practiceReviewId), '')
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS })
  assert.equal(result.ok, false)
}))

test('a review can stop a plan', rig(async ({ call, review }) => {
  const practiceReviewId = await review({ stopRecommendation: true })
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /stopped/)
}))

test('a review cannot widen the confirmed change', rig(async ({ call, review }) => {
  const practiceReviewId = await review({ confirmedChange: ['Status__c'] })
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }, { field: 'Name', value: 'x' }], frozenRecordIds: IDS })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /widen/)
  const widened = reviewAllowsRecommendation({ practice: 'flow', experience: 'path still works', security: 'no new access', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['page'] }, ['page', 'profile'])
  assert.equal(widened.ok, false)
}))

test('a review is never offered as evidence of safety', rig(async ({ call, update }) => {
  const reviewed = await call('practice_record', { practice: 'a', experience: 'b', security: 'c', pii: 'd', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['Status__c'] })
  assert.match(JSON.stringify(reviewed.data), /not evidence of safety/)
  const data = planned(await update())
  assert.match(data.practice.note, /not evidence of safety/)
  assert.equal(/approved|safe to|is safe/i.test(data.practice.note.replace('not evidence of safety', '')), false)
}))

// ── gates on the tool ──

test('an unconfirmed brief cannot plan on a stamped host', rig(async ({ review, call, home }) => {
  const practiceReviewId = await review()
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, { mode: 'plan', agentId: null, confirmedBriefHash: null, ack: null })
  assert.equal(result.ok, false)
  assert.equal(orgReads(home), 0)
}))

for (const mode of ['read-only', 'explain', 'investigate', 'validate', 'execute', 'review']) {
  test(`the plan tools do not run in ${mode} mode`, rig(async ({ call, home, briefHash }) => {
    const stamp = { mode, agentId: null, confirmedBriefHash: briefHash, ack: null }
    const result = await call('records_plan_update', { orgId: ORG, practiceReviewId: NO_REVIEW, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, stamp)
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result.data), /mode/)
    assert.equal((await call('practice_record', { practice: 'a', experience: 'b', security: 'c', pii: 'd', vendorImpact: 'none', stopRecommendation: false, confirmedChange: [] }, stamp)).ok, false)
    assert.equal(orgReads(home), 0)
  }))
}

test('a subagent cannot plan', rig(async ({ call, briefHash }) => {
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId: NO_REVIEW, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, { mode: 'plan', agentId: 'agent-1', confirmedBriefHash: briefHash, ack: null })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /mode/)
}))

test('a host with no hooks can plan, and the plan says the brief was not confirmed', rig(async ({ call, home }) => {
  const reviewed = await call('practice_record', { practice: 'a', experience: 'b', security: 'c', pii: 'd', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['Status__c'] }, null)
  const { practiceReviewId } = reviewed.data as { practiceReviewId: string }
  const result = await call('records_plan_update', { orgId: ORG, practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, null)
  const data = planned(result)
  assert.equal(data.briefConfirmed, false)
  assert.equal(result.briefConfirmed, false)
  assert.equal(committed(home, data.planId).plan.briefConfirmed, false)
}))

test('a delete over the ceiling is refused, and it cannot be continued past', rig(async ({ update, home }) => {
  const many = Array.from({ length: 101 }, (_, index) => `a00000000000${String(index).padStart(3, '0')}AAA`)
  const result = await update({ operation: 'delete', changes: [], frozenRecordIds: many })
  assert.equal(result.ok, false)
  assert.equal(result.issue?.kind, 'destructive-over-ceiling')
  assert.equal(result.canContinue, false)
  assert.equal(orgReads(home), 0)
}))

test('a ceiling of 0 means no delete at all, and is not read as unset', rig(async ({ update, home }) => {
  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, instanceUrl: RECORD.instanceUrl, name: RECORD.name, verifiedAt: RECORD.registeredAt, destructiveCeiling: 0 }] })
  const result = await update({ operation: 'delete', changes: [] })
  assert.equal(result.ok, false)
  assert.equal(result.issue?.kind, 'destructive-over-ceiling')
}))

test('orgs.json can narrow the ceiling, and cannot raise it', rig(async ({ update, home }) => {
  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, instanceUrl: RECORD.instanceUrl, name: RECORD.name, verifiedAt: RECORD.registeredAt, destructiveCeiling: 100000 }] })
  const many = Array.from({ length: 101 }, (_, index) => `a00000000000${String(index).padStart(3, '0')}AAA`)
  const result = await update({ operation: 'delete', changes: [], frozenRecordIds: many })
  assert.equal(result.issue?.kind, 'destructive-over-ceiling')
}))

test('an org that does not allow planning refuses', rig(async ({ update, home }) => {
  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, instanceUrl: RECORD.instanceUrl, name: RECORD.name, verifiedAt: RECORD.registeredAt, allowedOperationClasses: ['read'] }] })
  const result = await update()
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /plan/)
  assert.equal(orgReads(home), 0)
}))

test('a rate limit stops the plan and writes nothing', rig(async ({ update, home }) => {
  writeScenario(home, baseScenario({ mode: 'rate-limit', modeOn: 'FROM Widget__c' }))
  const result = await update()
  assert.equal(result.ok, false)
  assert.equal((result.data as { rateLimit: boolean }).rateLimit, true)
  assert.equal(readdirSafe(join(home.project, '.topia', 'salesforce', 'plans')).length, 0)
}))

// ── a deployment plan ──

function artifact(home: FakeHome, text = 'zip bytes'): string {
  const dir = join(home.project, 'build')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Secret-client-name.zip'), text)
  return 'build/Secret-client-name.zip'
}

test('a deployment plan hashes the artifact itself, and ignores a hash the model sends', rig(async ({ call, review, home }) => {
  const practiceReviewId = await review()
  const artifactPath = artifact(home)
  const result = await call('deployment_plan', { orgId: ORG, practiceReviewId, artifactPath, destructive: false, artifactHash: 'forged', businessObjective: 'Secret objective' })
  const data = planned(result)
  assert.equal(data.reversibility, 'forward-only')
  const plan = committed(home, data.planId).plan
  assert.match(String(plan.artifactHash), /^[a-f0-9]{64}$/)
  assert.equal(plan.destructive, false)
  assert.equal(JSON.stringify(committed(home, data.planId)).includes('forged'), false)
  assert.equal(JSON.stringify(committed(home, data.planId)).includes('Secret'), false, 'the path and the text stay local')
  assert.equal(loadPlan(home.store, home.project, data.planId, NOW).ok, true)
}))

test('changing the artifact changes the hash', rig(async ({ call, review, home }) => {
  const practiceReviewId = await review()
  const artifactPath = artifact(home, 'one')
  const first = planned(await call('deployment_plan', { orgId: ORG, practiceReviewId, artifactPath, destructive: false }))
  artifact(home, 'two')
  const second = planned(await call('deployment_plan', { orgId: ORG, practiceReviewId: await review(), artifactPath, destructive: false }))
  assert.notEqual(committed(home, first.planId).plan.artifactHash, committed(home, second.planId).plan.artifactHash)
}))

for (const [name, artifactPath] of [
  ['a path outside the project', '../outside.zip'],
  ['an absolute path outside the project', '/etc/hosts'],
  ['a path that does not exist', 'build/nothing.zip'],
] as const) {
  test(`a deployment plan is refused: ${name}`, rig(async ({ call, review }) => {
    const result = await call('deployment_plan', { orgId: ORG, practiceReviewId: await review(), artifactPath, destructive: false })
    assert.equal(result.ok, false)
  }))
}

test('a deployment plan needs a practice review too', rig(async ({ call, home }) => {
  const result = await call('deployment_plan', { orgId: ORG, artifactPath: artifact(home), destructive: false })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /practice/i)
}))

test('local plan values are swept with the rest', rig(async ({ update, home }) => {
  planned(await update())
  assert.ok(existsSync(localDirectory(home.store, home.project, 'plans')))
}))
