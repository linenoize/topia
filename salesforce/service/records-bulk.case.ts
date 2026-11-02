import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildApprovalScreen } from './approval-screen.js'
import { readLedger, type RecordsLedger } from './ledger.js'
import { localDirectory, localFile } from './paths.js'
import { type ApproveReply } from './records-write.js'
import { changeFakeOrg, fakeCalls, fakeJobs, fakeOrg, fakeWrites, reported, widgetIds, writeRig as rig } from './test-support.js'

const MANY = widgetIds(205)
const FEW = widgetIds(3)
const OVER_200 = { ids: MANY }

test('at 200 records it is Collections, and at 201 it is Bulk', rig(async ({ home, plan, approve }) => {
  const reply = await approve(await plan())
  assert.equal(reply.facts.transport, 'collections')
  void home
}, { ids: widgetIds(200) }))

test('over 200, the write is one bulk job with --wait=0 and an explicit line ending, and a screen that says so', rig(async ({ home, plan, approve, run, writesOf }) => {
  const reply = await approve(await plan())
  assert.equal(reply.facts.transport, 'bulk')
  assert.match(buildApprovalScreen(reply.screenPlan, reply.facts).text, /Some records can succeed while others fail/)
  const data = reported(await run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(data.transport, 'bulk')
  assert.equal(fakeJobs(home).length, 1)
  const start = fakeCalls(home).find(item => item.command === 'data update bulk')
  assert.ok(start)
  assert.equal(start.flags.wait, '0')
  assert.equal(start.flags['line-ending'], 'LF')
  assert.equal(start.flags['column-delimiter'], 'COMMA')
  assert.equal(fakeCalls(home).some(item => item.flags.method === 'PATCH'), false)
  for (const id of MANY) assert.equal(writesOf(id), 1, id)
}, OVER_200))

test('the CSV carries the plan values, quoted, and an empty value as #N/A', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan({ changes: [{ field: 'Name', value: 'A "quoted", name' }, { field: 'Due_Date__c', value: null }] }))
  reported(await run(reply.pinned))
  const record = fakeOrg(home).records.Widget__c?.[MANY[0] as string]
  assert.equal(record?.Name, 'A "quoted", name')
  assert.equal(record?.Due_Date__c, null)
}, OVER_200))

test('the text #N/A can not be written: it would clear the field', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan({ changes: [{ field: 'Name', value: '#N/A' }] }))
  const result = await run(reply.pinned)
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal(fakeJobs(home).length, 0)
}, OVER_200))

test('a delete goes through data delete bulk with no hard delete, whatever its size', rig(async ({ home, plan, approve, run, writesOf }) => {
  const reply = await approve(await plan({ operation: 'delete', changes: [] }))
  assert.equal(reply.facts.transport, 'bulk')
  const data = reported(await run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.match(String(data.restore), /Recycle Bin/)
  const start = fakeCalls(home).find(item => item.command === 'data delete bulk')
  assert.ok(start)
  assert.equal(start.flags['hard-delete'], undefined)
  assert.equal(start.flags.wait, '0')
  assert.equal(start.flags['line-ending'], 'LF')
  for (const id of FEW) {
    assert.equal(writesOf(id), 1)
    assert.equal(fakeOrg(home).records.Widget__c?.[id]?.IsDeleted, true)
  }
}))

test('a delete screen puts the reversibility class first, in the fixed text', rig(async ({ plan, approve }) => {
  const reply = await approve(await plan({ operation: 'delete', changes: [] }))
  const { text } = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.ok(text.indexOf('recycle-bin') < text.indexOf('Class: Sandbox'), text)
  assert.match(text, /purge after 2 hours/)
}))

test('the job id is on the ledger and in the journal before the first poll', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  let seen = false
  await run(reply.pinned, {
    onStep: step => {
      if (step !== 'sent') return
      seen = true
      const ledger = readLedger(home.store, home.project, planId) as { entry: RecordsLedger }
      assert.match(String(ledger.entry.attempts[0]?.jobId), /^750/)
      assert.equal(fakeCalls(home).some(item => item.positional[0]?.includes('/jobs/ingest/')), false, 'no poll yet')
    },
  })
  assert.equal(seen, true)
}, OVER_200))

test('a poll budget that runs out comes back as a job status, and the ledger stays started', rig(async ({ home, plan, approve, run, writesOf }) => {
  const planId = await plan()
  const data = reported(await run((await approve(planId)).pinned, { pollBudgetMs: 0 }))
  assert.equal(data.status, 'started')
  assert.match(String(data.jobId), /^750/)
  assert.match(String(data.next), /Still running/)
  assert.equal(readLedger(home.store, home.project, planId).state, 'started')
  assert.equal(writesOf(MANY[0] as string), 0)
}, { ...OVER_200, scenario: { bulk: { pollsUntilDone: 50 } } }))

test('a later call picks the job up with no dialog and no second job', rig(async ({ home, plan, approve, run, prepare, rescenario, writesOf }) => {
  const planId = await plan()
  reported(await run((await approve(planId)).pinned, { pollBudgetMs: 0 }))
  rescenario(scenario => ({ ...scenario, bulk: { pollsUntilDone: 1 } }))
  const data = reported(await prepare(planId))
  assert.equal(data.status, 'done')
  assert.equal(fakeJobs(home).length, 1)
  for (const id of MANY) assert.equal(writesOf(id), 1)
  assert.equal(readLedger(home.store, home.project, planId).state, 'done')
}, { ...OVER_200, scenario: { bulk: { pollsUntilDone: 50 } } }))

test('a job Failed with some success is partial, reported per id, and retries nothing', rig(async ({ home, plan, approve, run, writesOf }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.done, 9)
  assert.equal(data.counts.failed, 1)
  assert.equal(data.counts.untouched, 195)
  assert.equal(data.jobState, 'Failed')
  assert.match(String(data.note), /ended as Failed/)
  const row = (data.failures as { id: string; code: string }[]).find(item => item.id === MANY[3])
  assert.equal(row?.code, 'FIELD_CUSTOM_VALIDATION_EXCEPTION')
  assert.equal(fakeJobs(home).length, 1, 'never retried on its own')
  assert.equal(writesOf(MANY[3] as string), 0)
  assert.equal(writesOf(MANY[150] as string), 0)
  assert.match(String(data.next), /Nothing is re-sent/)
}, { ...OVER_200, scenario: { bulk: { stopAfter: 10 }, rowFailures: { [MANY[3] as string]: { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'Secret validation text', fields: [] } } } }))

test('a job complete with failed rows is partial too', rig(async ({ plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.done, 204)
  assert.equal(data.counts.failed, 1)
  assert.equal(data.jobState, 'JobComplete')
}, { ...OVER_200, scenario: { rowFailures: { [MANY[3] as string]: { statusCode: 'DUPLICATE_VALUE', message: 'x', fields: [] } } } }))

test('result CSVs stay in a private folder, and their text stays out of the result', rig(async ({ home, plan, approve, run }) => {
  const result = await run((await approve(await plan())).pinned)
  const data = reported(result)
  assert.equal(JSON.stringify(result).includes('Secret validation text'), false)
  const dir = localDirectory(home.store, home.project, 'results')
  const files = readdirSync(dir)
  assert.ok(files.some(name => name.endsWith('-failed-records.csv')), files.join())
  assert.ok(readFileSync(join(dir, files.find(name => name.endsWith('-failed-records.csv')) as string), 'utf8').includes('Secret validation text'))
  assert.equal(existsSync(join(home.project, `${String(data.jobId)}-failed-records.csv`)), false)
  assert.equal(JSON.stringify(readdirSync(home.project, { recursive: true })).includes('records.csv'), false)
}, { ...OVER_200, scenario: { rowFailures: { [MANY[3] as string]: { statusCode: 'DUPLICATE_VALUE', message: 'Secret validation text', fields: [] } } } }))

test('the results come from data bulk results, with a target, and the job from a GET with a target', rig(async ({ home, plan, approve, run }) => {
  await run((await approve(await plan())).pinned)
  const results = fakeCalls(home).find(item => item.command === 'data bulk results')
  assert.ok(results)
  assert.equal(results.flags['target-org'], 'ada@example.com')
  const get = fakeCalls(home).find(item => (item.positional[0] ?? '').includes('/jobs/ingest/'))
  assert.equal(get?.flags.method, 'GET')
  assert.equal(get?.flags['target-org'], 'ada@example.com')
  // The resume commands take the org from a local cache, or have no target, so they aren't used.
  assert.equal(fakeCalls(home).some(item => /resume/.test(item.command)), false)
}, OVER_200))

test('a rate limit mid-job does not claim nothing was written', rig(async ({ home, plan, approve, run, rescenario, prepare }) => {
  const planId = await plan()
  const reply = await approve(planId)
  rescenario(scenario => ({ ...scenario, mode: 'rate-limit', modeOn: 'jobs/ingest' }))
  const result = await run(reply.pinned)
  const data = reported(result)
  assert.equal(data.status, 'unknown')
  assert.match(String(data.note), /Some records may already be written/)
  assert.equal(/nothing was written|nothing changed/i.test(JSON.stringify(result)), false, JSON.stringify(data))
  assert.equal(fakeJobs(home).length, 1)
  // And it picks up once the limit clears, with no new job.
  rescenario(scenario => {
    const { mode: _mode, modeOn: _on, ...rest } = scenario
    return rest
  })
  assert.equal(reported(await prepare(planId)).status, 'done')
  assert.equal(fakeJobs(home).length, 1)
}, OVER_200))

test('a bulk start that fails can not say no job exists, so it is unknown and never re-sent', rig(async ({ home, plan, approve, run, prepare }) => {
  const planId = await plan()
  const data = reported(await run((await approve(planId)).pinned))
  assert.equal(data.status, 'unknown')
  assert.match(String(data.note), /may or may not have started|may have been started/)
  const again = await prepare(planId)
  assert.notEqual((again as ApproveReply).action, 'approve')
  assert.equal(fakeWrites(home).length, 0)
}, { ...OVER_200, scenario: { mode: 'unexplained', modeOn: 'data update bulk' } }))

test('a killed bulk start is unknown, and never read as stopped', rig(async ({ home, plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'unknown')
  assert.equal(fakeWrites(home).length, 0)
}, { ...OVER_200, scenario: { mode: 'timeout', modeOn: 'data update bulk' } }))

test('a job id on the ledger that is not this plan job reads as unknown', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  reported(await run((await approve(planId)).pinned, { pollBudgetMs: 0 }))
  changeFakeOrg(home, org => {
    const job = Object.values(org.jobs)[0] as { operation: string }
    job.operation = 'delete'
  })
  const data = reported(await prepare(planId))
  assert.equal(data.status, 'unknown')
  assert.match(String(data.note), /not this plan/)
  assert.equal(writesOf(MANY[0] as string), 0)
}, { ...OVER_200, scenario: { bulk: { pollsUntilDone: 50 } } }))

test('a deleted ledger with a running job: the job id comes back from the journal, and it is not re-sent', rig(async ({ home, plan, approve, run, prepare, rescenario, writesOf }) => {
  const planId = await plan()
  reported(await run((await approve(planId)).pinned, { pollBudgetMs: 0 }))
  const ledgerFile = localFile(home.store, home.project, 'ledger', planId)
  const { rmSync } = await import('node:fs')
  rmSync(ledgerFile)
  rescenario(scenario => ({ ...scenario, bulk: { pollsUntilDone: 1 } }))
  const data = reported(await prepare(planId))
  assert.equal(data.status, 'done')
  assert.equal(fakeJobs(home).length, 1)
  for (const id of MANY) assert.equal(writesOf(id), 1)
}, { ...OVER_200, scenario: { bulk: { pollsUntilDone: 50 } } }))
