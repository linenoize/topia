import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen } from './approval-screen.js'
import { readLedger, type RecordsLedger } from './ledger.js'
import { localFile } from './paths.js'
import { fakeJobs, fakeWrites, runRunner, widgetIds, writeRig as rig, type FakeHome, type WriteRig } from './test-support.js'

/**
 * The real runner, as a real process, killed by the fake while it holds a CLI call
 * open. Nothing in the runner knows this can happen: there's no test hook in it. The
 * ledger is whatever that moment left, and the next call has to cope.
 */

const IDS = widgetIds(3)
const MANY = widgetIds(205)

function ask(home: FakeHome, rigged: WriteRig, planId: string): Record<string, any> {
  const ran = runRunner(home, 'records-prepare', { request: { planId }, confirmedBriefHash: rigged.briefHash, mode: 'execute' })
  assert.ok(ran.reply, `The prepare step gave no reply: ${JSON.stringify(ran)}`)
  return ran.reply
}

function write(home: FakeHome, rigged: WriteRig, reply: Record<string, any>): ReturnType<typeof runRunner> {
  return runRunner(home, 'records-run', { pinned: reply.pinned, confirmedBriefHash: rigged.briefHash, mode: 'execute', pollBudgetMs: 2000, pollIntervalMs: 10 })
}

function mayBeWritten(home: FakeHome, ids: string[]): void {
  for (const id of ids) assert.ok(fakeWrites(home).filter(item => item.id === id).length <= 1, `${id} was written twice`)
}

/** Ages the attempt, as if the request had long since had time to land. */
function settle(home: FakeHome, planId: string): void {
  const file = localFile(home.store, home.project, 'ledger', planId)
  const entry = JSON.parse(readFileSync(file, 'utf8')) as RecordsLedger
  writeFileSync(file, JSON.stringify({ ...entry, attempts: entry.attempts.map(item => ({ ...item, startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() })) }))
}

const KILLS: { name: string; on: string; when: 'before' | 'after'; nth: number; landed: boolean }[] = [
  { name: 'the first identity read', on: 'org display', when: 'before', nth: 1, landed: false },
  { name: 'the org query', on: 'FROM Organization', when: 'before', nth: 1, landed: false },
  { name: 'the describe', on: 'sobject describe', when: 'before', nth: 1, landed: false },
  { name: 'the re-read of the frozen ids', on: 'SELECT Id, SystemModstamp', when: 'before', nth: 1, landed: false },
  { name: 'the write, before it leaves', on: 'composite/sobjects', when: 'before', nth: 1, landed: false },
  { name: 'the write, after it lands', on: 'composite/sobjects', when: 'after', nth: 1, landed: true },
  { name: 'the re-read after the write', on: 'SELECT Id, SystemModstamp', when: 'before', nth: 2, landed: true },
  { name: 'the identity check after the write', on: 'FROM Organization', when: 'before', nth: 2, landed: true },
]

for (const kill of KILLS) {
  test(`killed during ${kill.name}: no double write`, rig(async rigged => {
    const { home, plan, rescenario } = rigged
    const planId = await plan()
    const approved = ask(home, rigged, planId)
    assert.equal(approved.action, 'approve', JSON.stringify(approved))
    const screen = buildApprovalScreen(approved.screenPlan, approved.facts)
    assert.equal(approvalAccepted(screen, screen.approveLabel), true)
    rescenario(scenario => ({ ...scenario, killParent: { on: kill.on, when: kill.when, nth: kill.nth } }))
    const died = write(home, rigged, approved)
    assert.notEqual(died.status, 0, `the runner lived: ${JSON.stringify(died)}`)
    assert.equal(died.reply, null, 'nothing could have been said')
    rescenario(({ killParent: _gone, ...rest }) => rest)

    assert.equal(fakeWrites(home).length, kill.landed ? 3 : 0)
    // The next call reconciles. Whatever it says, it sends nothing.
    const landed = fakeWrites(home).length
    const next = ask(home, rigged, planId)
    assert.equal(fakeWrites(home).length, landed, 'reconcile sends nothing')
    if (kill.landed) {
      assert.equal(next.action, 'report', JSON.stringify(next))
      assert.equal(next.data.status, 'done')
      assert.equal(readLedger(home.store, home.project, planId).state, 'done')
    }
    mayBeWritten(home, IDS)

    // And if there's a remainder, it takes a new dialog, over only that.
    if (!kill.landed && readLedger(home.store, home.project, planId).state !== 'missing') {
      assert.notEqual(next.action, 'approve', 'a run that started does not go straight to a new dialog')
      settle(home, planId)
      const settled = ask(home, rigged, planId)
      assert.equal(settled.data?.status, 'partial', JSON.stringify(settled))
    }
    const again = ask(home, rigged, planId)
    if (again.action === 'approve') {
      assert.equal(kill.landed, false, 'what landed is not on offer again')
      const result = write(home, rigged, again)
      assert.equal(result.reply?.data?.status, 'done', JSON.stringify(result))
    }
    mayBeWritten(home, IDS)
    if (!kill.landed) for (const id of IDS) assert.equal(fakeWrites(home).filter(item => item.id === id).length, 1, 'the new approval wrote it, once')
  }))
}

// Node on Windows puts the children it spawns in a job that ends with it, so a call can't outlive a killed runner there.
// On Linux and macOS it can, and the Linux failure of the "before it leaves" case came from exactly that: the CLI went on and wrote.
const SURVIVES = process.platform === 'win32' ? 'a child process ends with its parent on Windows, so there is no call left to land' : false

test('killed with the write on the wire, and it lands after the runner is gone: nothing is offered or sent meanwhile, and it ends done', { skip: SURVIVES }, rig(async rigged => {
  const { home, plan, rescenario } = rigged
  const release = join(home.env.HOME as string, '.fake-sf', 'release')
  const planId = await plan()
  const approved = ask(home, rigged, planId)
  rescenario(scenario => ({ ...scenario, killParent: { on: 'composite/sobjects', when: 'before', nth: 1, survive: true } }))
  try {
    const died = write(home, rigged, approved)
    assert.notEqual(died.status, 0, `the runner lived: ${JSON.stringify(died)}`)
    assert.equal(died.reply, null)
    rescenario(({ killParent: _gone, ...rest }) => rest)

    // The request has left the runner and not landed. A call now sees a run that may still be going.
    assert.equal(fakeWrites(home).length, 0)
    const waiting = ask(home, rigged, planId)
    assert.notEqual(waiting.action, 'approve', 'a write that may be on the wire is not offered again')
    assert.equal(fakeWrites(home).length, 0, 'asking sends nothing')

    writeFileSync(release, '')
    // It lands whenever it lands. Whichever side of the landing a call falls on, nothing is written twice.
    let last: Record<string, any> = waiting
    for (let round = 0; round < 60 && last.data?.status !== 'done'; round += 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
      last = ask(home, rigged, planId)
      mayBeWritten(home, IDS)
      assert.notEqual(last.action, 'approve', JSON.stringify(last))
    }
    assert.equal(last.data?.status, 'done', JSON.stringify(last))
    assert.equal(fakeWrites(home).length, 3)
    assert.equal(readLedger(home.store, home.project, planId).state, 'done')
    mayBeWritten(home, IDS)
  } finally {
    writeFileSync(release, '')
  }
}))

test('killed right after the bulk job started, with the id never saved: unknown, and no second job, ever', rig(async rigged => {
  const { home, plan, rescenario } = rigged
  const planId = await plan()
  const approved = ask(home, rigged, planId)
  rescenario(scenario => ({ ...scenario, killParent: { on: 'data update bulk', when: 'after', nth: 1 } }))
  assert.equal(write(home, rigged, approved).reply, null)
  rescenario(({ killParent: _gone, ...rest }) => rest)
  assert.equal(fakeJobs(home).length, 1)
  const entry = readLedger(home.store, home.project, planId) as { state: string; entry: RecordsLedger }
  assert.equal(entry.state, 'started')
  assert.equal(entry.entry.attempts[0]?.jobId, null)
  for (let round = 0; round < 2; round += 1) {
    const next = ask(home, rigged, planId)
    assert.equal(next.data?.status, 'unknown', JSON.stringify(next))
    settle(home, planId)
  }
  assert.equal(fakeJobs(home).length, 1)
}, { ids: MANY }))

test('killed while polling, with the id saved: the next call reads the same job', rig(async rigged => {
  const { home, plan, rescenario } = rigged
  const planId = await plan()
  const approved = ask(home, rigged, planId)
  rescenario(scenario => ({ ...scenario, killParent: { on: 'jobs/ingest', when: 'before', nth: 1 } }))
  assert.equal(write(home, rigged, approved).reply, null)
  rescenario(({ killParent: _gone, ...rest }) => rest)
  const next = ask(home, rigged, planId)
  assert.equal(next.data?.status, 'done', JSON.stringify(next))
  assert.equal(fakeJobs(home).length, 1)
  mayBeWritten(home, MANY)
}, { ids: MANY }))

test('a lock left by a dead runner frees itself, and a run from this process would have waited', rig(async rigged => {
  const { home, plan, rescenario } = rigged
  const planId = await plan()
  const approved = ask(home, rigged, planId)
  rescenario(scenario => ({ ...scenario, killParent: { on: 'composite/sobjects', when: 'after', nth: 1 } }))
  assert.equal(write(home, rigged, approved).reply, null)
  rescenario(({ killParent: _gone, ...rest }) => rest)
  const next = ask(home, rigged, planId)
  assert.equal(next.data?.status, 'done', 'it was able to take the lock and write the ledger')
}))
