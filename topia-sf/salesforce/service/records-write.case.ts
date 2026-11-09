import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen } from './approval-screen.js'
import { proposeBrief } from './brief.js'
import { readAllJournals, readJournal } from './journal.js'
import { readJson, writeJson } from './json-file.js'
import { readLedger, type RecordsLedger } from './ledger.js'
import { auditBeforeWrite } from './audit.js'
import { journalDirectory, localDirectory, localFile, orgsFile, planFile } from './paths.js'
import { planHashOf, sha256, canonical } from './plans.js'
import { prepareRecordsWrite, type ApproveReply, type PinnedWrite, type StepName, type WriteReply } from './records-write.js'
import { SfCliAdapter } from './sf-adapter.js'
import { parseCollections } from './sf-parse.js'
import { storeDelete } from './store.js'
import { activationKey } from './paths.js'
import { STAMP_KEY } from './stamp.js'
import { baseScenario, changeFakeOrg, contextFor, countRows, DESCRIBE_WIDGET, fakeCalls, fakeHome, fakeOrg, fakeWrites, ORG, queryRows, refused, registerFake, reported, widgetIds, widgetRecords, WIDGET_MODSTAMP, writeRig, writeScenario, LIVE_ORG, LIVE_USER, type FakeHome } from './test-support.js'
import { callTool } from './tools.js'

const IDS = widgetIds(3)
const rig = writeRig
const NEW_MODSTAMP = '2026-05-20T00:00:00.000+0000'

function orgCallsAfterPlan(home: FakeHome, from: number): string[] {
  return fakeCalls(home).slice(from).map(item => `${item.command} ${item.soql ?? ''}`)
}

// ── the happy path, and what it leaves behind ─────────────────────────────

test('a frozen update of up to 200 records goes through Collections, with allOrNone, for exactly those ids', rig(async ({ home, plan, approve, run, writesOf }) => {
  const reply = await approve(await plan())
  const data = reported(await run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(data.counts.done, 3)
  for (const id of IDS) assert.equal(writesOf(id), 1)
  assert.equal(fakeOrg(home).records.Widget__c?.[IDS[0] as string]?.Status__c, 'Closed')
  const write = fakeCalls(home).find(item => item.command === 'api request rest' && item.flags.method === 'PATCH')
  assert.ok(write, 'one PATCH')
  assert.equal(write.positional[0], '/services/data/v66.0/composite/sobjects')
  assert.equal(fakeCalls(home).filter(item => item.flags.method === 'PATCH').length, 1)
  assert.equal(JSON.stringify(write.argv).includes('Closed'), false, 'values stay off the command line')
}))

test('the screen is built from live facts, and its count comes from the ids', rig(async ({ plan, approve }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.approveLabel, 'Update 3 Widget__c in Sandbox')
  assert.match(screen.text, /Class: Sandbox/)
  assert.match(screen.text, /Org: Acme Sales/)
  assert.match(screen.text, /Username: ada@example\.com/)
  assert.match(screen.text, /Exact count: 3/)
  assert.match(screen.text, /Status__c: "Closed" \(6 characters\)/)
  assert.match(screen.text, /Status__c: "New" -> "Closed"/)
  assert.match(screen.text, /0 of 3 differ/)
  assert.match(screen.text, /WidgetGuard/)
  assert.match(screen.text, /Plan_After_Save/)
  assert.match(screen.text, /blind spots/)
  assert.ok(screen.text.indexOf("What can't be undone") < screen.text.indexOf('Class: Sandbox'))
  assert.match(screen.text, /All or nothing/)
}, { scenario: { triggers: ['WidgetGuard'], flows: ['Plan_After_Save'] } }))

test('the result holds counts, codes, and ids, and never a record value', rig(async ({ plan, approve, run }) => {
  const reply = await approve(await plan())
  const result = await run(reply.pinned)
  const text = JSON.stringify(result)
  for (const value of ['grace@example.com', 'A note', 'Widget 001']) assert.equal(text.includes(value), false, value)
}))

test('the write is journaled the way the audit comparison reads it', rig(async ({ home, plan, approve, run, briefHash }) => {
  void briefHash
  const planId = await plan()
  const reply = await approve(planId)
  await run(reply.pinned)
  const lines = readAllJournals(home.project)
  const executed = lines.find(line => line.event === 'change.executed')
  assert.ok(executed, 'change.executed')
  assert.equal(executed.orgId, ORG)
  assert.equal(executed.object, 'Widget__c')
  assert.equal(executed.counts?.rows, 3)
  assert.equal(executed.planId, planId)
  assert.ok(Date.parse(executed.at) > 0)
  assert.ok(lines.some(line => line.event === 'change.approved' && line.planId === planId))
  assert.ok(lines.some(line => line.event === 'change.started' && line.planId === planId))
  assert.ok(lines.some(line => line.event === 'preimage.saved' && line.planId === planId && /^[a-f0-9]{64}$/.test(String(line.hash))))
  assert.equal(JSON.stringify(lines).includes('Closed'), false, 'a value never reaches the journal')
}))

test('after a write the audit comparison has nothing to report', rig(async ({ plan, approve, run, home }) => {
  await run((await approve(await plan())).pinned)
  const audit = await auditBeforeWrite(new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 }), contextFor(home, { now: Date.now() }), ORG)
  assert.equal(audit.state, 'clean', JSON.stringify(audit))
}))

test('a done plan offers restore as a new plan, says automation fires again, and is not offered as undo', rig(async ({ plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.match(String(data.restore), /new plan/)
  assert.match(String(data.restore), /automation fires again/i)
  assert.match(String(data.restore), /topia:sf:restore/)
}))

test('the order on the wire: identity, re-read, then the write, then the re-read, then identity', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  const from = fakeCalls(home).length
  await run(reply.pinned)
  const calls = orgCallsAfterPlan(home, from)
  const at = (shape: RegExp, start = 0) => calls.findIndex((item, index) => index >= start && shape.test(item))
  const identity = at(/FROM Organization/)
  const reread = at(/SELECT Id, SystemModstamp.*FROM Widget__c/)
  const write = at(/^api request rest/)
  const after = at(/SELECT Id, SystemModstamp.*FROM Widget__c/, write)
  const identityAfter = at(/FROM Organization/, write)
  assert.ok(identity >= 0 && identity < reread, calls.join('\n'))
  assert.ok(reread < write, calls.join('\n'))
  assert.ok(write < after, calls.join('\n'))
  assert.ok(after < identityAfter, calls.join('\n'))
}))

test('by the time anything is sent, the pre-image is on disk with its hash journaled, and the ledger says started', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const seen: StepName[] = []
  await run(reply.pinned, {
    onStep: step => {
      seen.push(step)
      if (step !== 'send') return
      const file = localFile(home.store, home.project, 'preimages', planId)
      assert.equal(existsSync(file), true, 'pre-image')
      const text = readFileSync(file, 'utf8')
      const journaled = readJournal(home.project, planId).find(line => line.event === 'preimage.saved')
      assert.equal(journaled?.hash, sha256(text))
      const ledger = readLedger(home.store, home.project, planId)
      assert.equal(ledger.state, 'started')
      assert.equal(fakeWrites(home).length, 0, 'not yet')
    },
  })
  assert.deepEqual(seen, ['identity', 'reread', 'preimage', 'ledger', 'send', 'sent', 'results', 'reconcile', 'identity-after', 'finish'])
}))

test('a pre-image holds old values for the target and captured fields, and stays off the repo', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  await run((await approve(planId)).pinned)
  const image = readJson<{ retainUntil: string; records: { id: string; systemModstamp: string; values: Record<string, unknown> }[]; fields: string[] }>(localFile(home.store, home.project, 'preimages', planId))
  assert.ok(image)
  assert.equal(image.records.length, 3)
  assert.equal(image.records[0]?.values.Status__c, 'New')
  assert.equal(image.records[0]?.values.Amount__c, 5)
  assert.equal(image.records[0]?.systemModstamp, WIDGET_MODSTAMP)
  assert.ok(Date.parse(image.retainUntil) - Date.now() > 29 * 24 * 60 * 60 * 1000)
  assert.equal(JSON.stringify(readdirSync(join(home.project, '.topia'), { recursive: true })).includes('preimage'), false)
}))

// ── a failure at each step before the write stops everything after it ──────

test('a project that is off refuses before it reads anything', rig(async ({ home, plan, prepare, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  storeDelete(home.store, [activationKey(home.project)])
  const from = fakeCalls(home).length
  refused(await prepare(planId), /not on/)
  refused(await run(reply.pinned), /not on/)
  assert.equal(fakeCalls(home).length, from)
  assert.equal(fakeWrites(home).length, 0)
}))

for (const mode of ['read-only', 'plan', 'validate', 'investigate'] as const) {
  test(`mode ${mode} can't write, in the dialog step or the write step`, rig(async ({ home, plan, prepare, approve, run }) => {
    const planId = await plan()
    refused(await prepare(planId, { mode }), /does not run/)
    const reply = await approve(planId)
    refused(await run(reply.pinned, { mode }), /does not run/)
    assert.equal(fakeWrites(home).length, 0)
  }))
}

test('the brief is compared by hash with what the person confirmed, in both steps', rig(async ({ home, plan, prepare, approve, run }) => {
  const planId = await plan()
  refused(await prepare(planId, { brief: null }), /confirm/)
  refused(await prepare(planId, { brief: 'b'.repeat(64) }), /confirm/)
  const reply = await approve(planId)
  refused(await run(reply.pinned, { brief: null }), /confirm/)
  refused(await run(reply.pinned, { brief: 'b'.repeat(64) }), /confirm/)
  assert.equal(fakeWrites(home).length, 0)
}))

test('plan.briefConfirmed is not what decides', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  const file = planFile(home.project, planId)
  const stored = readJson<{ plan: Record<string, unknown>; planHash: string }>(file)
  assert.equal(stored?.plan.briefConfirmed, true)
  refused(await prepare(planId, { brief: null }), /confirm/)
}))

test('a plan that was edited, a plan with edited values, and a missing plan all stop', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  const file = planFile(home.project, planId)
  const stored = readJson<{ plan: Record<string, unknown>; planHash: string }>(file) as { plan: Record<string, unknown>; planHash: string }
  writeJson(file, { ...stored, plan: { ...stored.plan, object: 'Account' } })
  refused(await prepare(planId), /edited/)
  writeJson(file, stored)
  const valuesFile = localFile(home.store, home.project, 'plans', planId)
  const values = readJson<Record<string, unknown>>(valuesFile) as Record<string, unknown>
  writeJson(valuesFile, { ...values, changes: [{ field: 'Status__c', value: 'Open' }] })
  refused(await prepare(planId), /edited/)
  refused(await prepare('plan-00000000-0000-0000-0000-000000000000'), /No plan/)
  assert.equal(fakeWrites(home).length, 0)
}))

test('an expired plan stops', rig(async ({ plan, prepare, now }) => {
  const planId = await plan()
  refused(await prepare(planId, { now: now() + 25 * 60 * 60 * 1000 }), /expired/)
}))

/** The plan tool wouldn't write these, so a test forges them with a matching hash. */
function forge(home: FakeHome, planId: string, change: (plan: Record<string, unknown>) => void): void {
  const file = planFile(home.project, planId)
  const stored = readJson<{ plan: Record<string, unknown> }>(file) as { plan: Record<string, unknown> }
  change(stored.plan)
  writeJson(file, { planHash: planHashOf(stored.plan), plan: stored.plan })
}

for (const operation of ['upsert', 'insert', 'hardDelete', 'merge']) {
  test(`operation ${operation} is off the enum, even with a matching hash`, rig(async ({ home, plan, prepare }) => {
    const planId = await plan()
    forge(home, planId, item => {
      item.operation = operation
    })
    refused(await prepare(planId), /update or delete/)
    assert.equal(fakeWrites(home).length, 0)
  }))
}

test('the count comes from the ids: a plan claiming another count stops', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  forge(home, planId, item => {
    item.count = 1
  })
  refused(await prepare(planId), /count/)
}))

test('a delete over the constant ceiling stops, and orgs.json cannot raise it', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  forge(home, planId, item => {
    item.operation = 'delete'
    item.changedFields = []
    item.frozenRecordIds = widgetIds(101)
    item.count = 101
  })
  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, instanceUrl: 'https://acme.sandbox.example.com', name: 'Acme Sales', verifiedAt: 'x', destructiveCeiling: 5000 }] })
  refused(await prepare(planId), /ceiling/)
}))

test('orgs.json can narrow the ceiling', rig(async ({ home, plan, prepare }) => {
  const planId = await plan({ operation: 'delete', changes: [] })
  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, instanceUrl: 'https://acme.sandbox.example.com', name: 'Acme Sales', verifiedAt: 'x', destructiveCeiling: 2 }] })
  refused(await prepare(planId), /ceiling/)
}))

test('orgs.json can take away writes altogether', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, instanceUrl: 'https://acme.sandbox.example.com', name: 'Acme Sales', verifiedAt: 'x', allowedOperationClasses: ['read', 'plan'] }] })
  refused(await prepare(planId), /limits/)
}))

test('a plan for another org stops', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  forge(home, planId, item => {
    item.orgId = '00D000000000009AAA'
  })
  refused(await prepare(planId), /not registered|another org|registered/)
}))

for (const [name, org, user] of [
  ['the org id', { Id: '00D000000000009AAA' }, undefined],
  ['the sandbox flag', { IsSandbox: false }, undefined],
  ['the user', undefined, { Username: 'grace@example.com' }],
  ['an inactive user', undefined, { IsActive: false }],
] as const) {
  test(`a live identity that differs in ${name} stops the dialog`, async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      writeScenario(home, baseScenario({ records: { Widget__c: widgetRecords(IDS) } }))
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'x', environment: '', subjects: [], change: '', blockingQuestions: [] }, new Date().toISOString())
      const stamp = { mode: 'plan', agentId: null, confirmedBriefHash: briefHash, ack: null }
      const input = () => contextFor(home, { hookHost: true, now: Date.now() })
      const review = await callTool(adapter, 'practice_record', { briefId, practice: 'x', experience: 'x', security: 'x', pii: 'x', vendorImpact: 'x', stopRecommendation: false, confirmedChange: ['Status__c'], [STAMP_KEY]: stamp }, input())
      const made = await callTool(adapter, 'records_plan_update', { orgId: ORG, briefId, practiceReviewId: (review.data as { practiceReviewId: string }).practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS, [STAMP_KEY]: stamp }, input())
      const planId = (made.data as { planId: string }).planId
      writeScenario(home, baseScenario({ records: { Widget__c: widgetRecords(IDS) }, org, user }))
      const before = fakeCalls(home).length
      const reply = await prepareRecordsWrite(adapter, input(), { planId }, briefHash, 'execute')
      assert.equal(reply.ok, false, JSON.stringify(reply))
      assert.equal(orgCallsAfterPlan(home, before).some(item => /FROM Widget__c/.test(item)), false)
    } finally {
      home.cleanup()
    }
  })
}

test('an unknown identity result stops, and is never acknowledgeable', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, mode: 'malformed', modeOn: 'FROM Organization' })
  refused(await prepare(planId), /unknown|identity|could not/i)
}))

const NO_TRAIL = { queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }] }

test("on a sandbox, a Setup Audit Trail nobody can read goes on the screen first, and the person decides", rig(async ({ plan, approve, run, writesOf }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.match(screen.text, /^Couldn't check:/)
  assert.equal(screen.requiresTypedOrgName, false)
  const data = reported(await run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(writesOf(widgetIds(3)[0] as string), 1)
}, { scenario: NO_TRAIL }))

test('on production, a Setup Audit Trail nobody can read refuses the write, and names the permission to grant', rig(async ({ home, plan, prepare }) => {
  const reply = await prepare(await plan())
  refused(reply, /View Setup and Configuration/)
  refused(reply, /ada@example\.com/)
  refused(reply, /nothing was written/i)
  assert.equal(fakeWrites(home).length, 0)
}, { register: { isSandbox: false, name: 'Acme Production', singleUserAcceptedAt: '2026-06-01T00:00:00.000Z', writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }, scenario: { org: { IsSandbox: false, Name: 'Acme Production' }, ...NO_TRAIL } }))

test('on production, a comparison that failed some other way refuses too, and names no permission', rig(async ({ home, plan, prepare }) => {
  const reply = await prepare(await plan())
  refused(reply, /audit trail couldn't be compared/i)
  assert.doesNotMatch((reply as { reason: string }).reason, /View Setup and Configuration/)
  assert.equal(fakeWrites(home).length, 0)
}, { register: { isSandbox: false, name: 'Acme Production', singleUserAcceptedAt: '2026-06-01T00:00:00.000Z', writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }, scenario: { org: { IsSandbox: false, Name: 'Acme Production' }, queries: [{ match: 'FROM SetupAuditTrail', error: { name: 'REQUEST_LIMIT_EXCEEDED', message: 'limit' } }] } }))

test('what the audit found shows on the screen, and the person decides', rig(async ({ plan, approve }) => {
  const reply = await approve(await plan())
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.match(screen.text, /setup change/)
}, { scenario: { setupAudit: [{ Action: 'changedApexClass', Section: 'Apex Class', CreatedDate: '2026-10-01T00:00:00.000+0000' }] } }))

const FOUND = { scenario: { setupAudit: [{ Action: 'changedApexClass', Section: 'Apex Class', CreatedDate: '2026-10-01T00:00:00.000+0000' }] } }
const DAY = 24 * 60 * 60 * 1000

/** Where each audit trail query began looking, oldest first. */
function trailWindows(home: FakeHome): number[] {
  return fakeCalls(home).map(item => /FROM SetupAuditTrail WHERE CreatedById = '[^']*' AND CreatedDate >= (\S+)/.exec(item.soql ?? '')?.[1]).filter((since): since is string => since !== undefined).map(since => Date.parse(since))
}

test('a finding on a screen the person declined is still there on the next one, and moves nothing', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  const first = await prepare(planId)
  assert.match(buildApprovalScreen((first as ApproveReply).screenPlan, (first as ApproveReply).facts).text, /setup change/)
  // Declined or dismissed: nothing runs, so the next preparation looks back as far as the first did.
  const second = await prepare(planId)
  assert.match(buildApprovalScreen((second as ApproveReply).screenPlan, (second as ApproveReply).facts).text, /setup change/)
  const windows = trailWindows(home)
  assert.equal(windows.length, 2)
  assert.ok(Math.abs((windows[1] as number) - (windows[0] as number)) < 60_000, `${windows.join(' ')}`)
}, FOUND))

test('a finding on a screen the person accepted is not looked for again, because the write ran', rig(async ({ home, plan, approve, run, adapter, input }) => {
  const planId = await plan()
  const reply = await approve(planId)
  assert.match(buildApprovalScreen(reply.screenPlan, reply.facts).text, /setup change/)
  assert.equal(reported(await run(reply.pinned)).status, 'done')
  await auditBeforeWrite(adapter, input(), ORG)
  const windows = trailWindows(home)
  assert.ok((windows.at(-1) as number) > Date.now() - DAY, `the window moved past the finding: ${new Date(windows.at(-1) as number).toISOString()}`)
}, FOUND))

test('a write that stopped before it started does not count as accepting the finding', rig(async ({ home, plan, approve, run, adapter, input }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const stopped = await run(reply.pinned, { brief: null })
  assert.equal(stopped.ok, false)
  await auditBeforeWrite(adapter, input(), ORG)
  const windows = trailWindows(home)
  assert.ok((windows.at(-1) as number) < Date.now() - 20 * DAY, `${new Date(windows.at(-1) as number).toISOString()}`)
}, FOUND))

test('a frozen record that changed since the plan stops the dialog, by SystemModstamp alone', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  changeFakeOrg(home, org => {
    ;(org.records.Widget__c?.[IDS[1] as string] as Record<string, unknown>).SystemModstamp = NEW_MODSTAMP
  })
  refused(await prepare(planId), /changed since|new plan/i)
  assert.equal(fakeWrites(home).length, 0)
}))

test('a frozen record that is gone stops the dialog', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  changeFakeOrg(home, org => {
    delete org.records.Widget__c?.[IDS[2] as string]
  })
  const reply = await prepare(planId)
  assert.notEqual((reply as { action?: string }).action, 'approve')
  assert.equal(fakeWrites(home).length, 0)
}))

// ── after the dialog ─────────────────────────────────────────────────────────

test('the runner writes the pinned plan, and does not re-read the plan file', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  rmSync(planFile(home.project, planId))
  rmSync(localFile(home.store, home.project, 'plans', planId))
  const data = reported(await run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(fakeOrg(home).records.Widget__c?.[IDS[0] as string]?.Status__c, 'Closed')
}))

test('a plan swapped on disk during the dialog changes nothing about the write', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const valuesFile = localFile(home.store, home.project, 'plans', planId)
  const values = readJson<Record<string, unknown>>(valuesFile) as Record<string, unknown>
  writeJson(valuesFile, { ...values, changes: [{ field: 'Status__c', value: 'Evil' }] })
  reported(await run(reply.pinned))
  assert.equal(fakeOrg(home).records.Widget__c?.[IDS[0] as string]?.Status__c, 'Closed')
}))

test('pinned bytes that do not match their own hash stop', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  const parsed = JSON.parse(reply.pinned.planBytes) as { plan: Record<string, unknown>; values: Record<string, unknown>; planHash: string }
  const swapped: PinnedWrite = { ...reply.pinned, planBytes: JSON.stringify({ ...parsed, plan: { ...parsed.plan, frozenRecordIds: [IDS[0]], count: 1 } }) }
  refused(await run(swapped), /hash|edited/i)
  const values: PinnedWrite = { ...reply.pinned, planBytes: JSON.stringify({ ...parsed, values: { ...parsed.values, changes: [{ field: 'Status__c', value: 'Evil' }] } }) }
  refused(await run(values), /hash|edited/i)
  refused(await run({ ...reply.pinned, planBytes: '{"plan":' }), /read/i)
  assert.equal(fakeWrites(home).length, 0)
}))

test('the identity step in the runner stops the write', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, queries: [{ match: 'FROM Organization', result: queryRows([{ ...LIVE_ORG, Id: '00D000000000009AAA' }], 'Organization') }, ...(scenario.queries as unknown[])] })
  refused(await run(reply.pinned), /org id|registered/i)
  assert.equal(fakeWrites(home).length, 0)
  assert.equal(readLedger(home.store, home.project, planId).state, 'missing')
}))

test('a re-read that fails stops the write', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, queries: [{ match: 'FROM Widget__c', error: { name: 'SomethingNewError', message: 'x' } }, ...(scenario.queries as unknown[])] })
  refused(await run(reply.pinned), /read|unknown/i)
  assert.equal(fakeWrites(home).length, 0)
  assert.equal(readLedger(home.store, home.project, planId).state, 'missing')
}))

test('a record that changed during the dialog stops the write, per record', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  changeFakeOrg(home, org => {
    ;(org.records.Widget__c?.[IDS[0] as string] as Record<string, unknown>).SystemModstamp = NEW_MODSTAMP
  })
  refused(await run(reply.pinned), /changed/i)
  assert.equal(fakeWrites(home).length, 0)
}))

test('no pre-image, no write', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  mkdirSync(localFile(home.store, home.project, 'preimages', planId), { recursive: true })
  refused(await run(reply.pinned), /pre-image/i)
  assert.equal(fakeWrites(home).length, 0)
  assert.equal(readLedger(home.store, home.project, planId).state, 'missing')
}))

test('no ledger, no write', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const reply = await approve(planId)
  mkdirSync(localFile(home.store, home.project, 'ledger', planId), { recursive: true })
  const result = await run(reply.pinned)
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal(fakeWrites(home).length, 0)
}))

// ── what comes back ──────────────────────────────────────────────────────────

test('a top-level 200 that hides a failed row reads as a failed row: nothing landed, and it says partial', rig(async ({ home, plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.done, 0)
  assert.equal(fakeWrites(home).length, 0)
  const row = (data.failures as { id: string; code: string }[]).find(item => item.id === IDS[1])
  assert.equal(row?.code, 'FIELD_CUSTOM_VALIDATION_EXCEPTION')
  assert.equal(JSON.stringify(data).includes('secret message'), false, 'org messages stay in the local store')
}, { scenario: { rowFailures: { [IDS[1] as string]: { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'secret message', fields: ['Status__c'] } } } }))

test('an answer that does not line up with what was sent is unknown, until the org says otherwise', rig(async ({ plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  // The write landed in the fake, so the re-read can tell. The answer alone could not.
  assert.equal(data.status, 'done')
  assert.match(String(data.note), /could not be read/i)
}, { scenario: { collections: { garble: true } } }))

test('a timeout after the write landed: re-read settles it, and nothing is re-sent', rig(async ({ home, plan, approve, run, writesOf }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'done')
  assert.equal(writesOf(IDS[0] as string), 1)
  assert.equal(fakeCalls(home).filter(item => item.flags.method === 'PATCH').length, 1)
}, { scenario: { collections: { hangAfter: true } } }))

test('a timeout with nothing landed yet is unknown, not stopped', rig(async ({ home, plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'unknown')
  assert.equal(fakeWrites(home).length, 0)
  assert.match(String(data.note), /still|unknown/i)
}, { scenario: { mode: 'timeout', modeOn: 'api request rest' } }))

test('a rate limit on the write says it did not land only because the org was re-read', rig(async ({ plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.done, 0)
  assert.equal(JSON.stringify(data).includes('Nothing was written'), false)
}, { scenario: { collections: { reject: { statusCode: 403, errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'TotalRequests Limit exceeded.' } } } }))

test('target fields must equal what was intended: automation overwriting one reads as changed, not done', rig(async ({ plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.done, 0)
  assert.equal(data.counts.changed, 3)
  assert.equal(data.sideEffects.Status__c, 3)
}, { scenario: { automation: { Widget__c: { Status__c: 'Reopened' } } } }))

test('non-target captured fields are compared, and automation side effects are reported with counts only', rig(async ({ plan, approve, run }) => {
  const data = reported(await run((await approve(await plan())).pinned))
  assert.equal(data.status, 'done')
  assert.deepEqual(data.sideEffects, { Amount__c: 3 })
  assert.equal(JSON.stringify(data).includes('999'), false)
}, { scenario: { automation: { Widget__c: { Amount__c: 999 } } } }))

test('a record changed by someone else after the write reads as changed by someone else', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  const data = reported(await run(reply.pinned, {
    onStep: step => {
      if (step !== 'reconcile') return
      changeFakeOrg(home, org => {
        ;(org.records.Widget__c?.[IDS[2] as string] as Record<string, unknown>).Status__c = 'Someone else'
      })
    },
  }))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.changed, 1)
  assert.deepEqual(data.changed, [IDS[2]])
}))

test('identity after the write that differs says written to the wrong org, with details', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  const data = reported(await run(reply.pinned, {
    onStep: step => {
      if (step !== 'identity-after') return
      const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
      writeScenario(home, { ...scenario, queries: [{ match: 'FROM Organization', result: queryRows([{ ...LIVE_ORG, Id: '00D000000000009AAA', Name: 'Other Org' }], 'Organization') }, ...(scenario.queries as unknown[])] })
    },
  }))
  assert.equal(data.status, 'unknown')
  assert.match(String(data.wrongOrg), /written to the wrong org/i)
  assert.match(String(data.wrongOrg), /00D000000000009AAA/)
}))

test('identity after the write that can not be read is reported, and the result is not called clean', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  const data = reported(await run(reply.pinned, {
    onStep: step => {
      if (step !== 'identity-after') return
      const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
      writeScenario(home, { ...scenario, mode: 'malformed', modeOn: 'FROM Organization' })
    },
  }))
  assert.equal(data.status, 'unknown')
  assert.match(String(data.note), /identity/i)
}))

// ── the ledger ───────────────────────────────────────────────────────────────

test('ledger missing: a first run writes once, and writes the ledger', rig(async ({ home, plan, approve, run, writesOf }) => {
  const planId = await plan()
  assert.equal(readLedger(home.store, home.project, planId).state, 'missing')
  await run((await approve(planId)).pinned)
  assert.equal(readLedger(home.store, home.project, planId).state, 'done')
  assert.equal(writesOf(IDS[0] as string), 1)
}))

test('ledger done: asking again writes nothing and opens no dialog', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  await run((await approve(planId)).pinned)
  const data = reported(await prepare(planId))
  assert.equal(data.status, 'done')
  assert.equal(writesOf(IDS[0] as string), 1)
  void home
}))

test('F5 PoC, truncated ledger: stop, reconcile, no re-send', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  await run((await approve(planId)).pinned)
  const file = localFile(home.store, home.project, 'ledger', planId)
  const damaged = readFileSync(file, 'utf8').slice(0, 40)
  writeFileSync(file, damaged)
  assert.equal(readLedger(home.store, home.project, planId).state, 'unreadable')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const data = reported(await prepare(planId))
    assert.equal(data.status, 'unreadable')
    assert.equal(data.counts.done, 3)
    assert.match(String(data.next), /new plan/i)
  }
  assert.equal(writesOf(IDS[0] as string), 1)
  assert.equal(readFileSync(file, 'utf8'), damaged, 'the evidence is kept')
}))

test('F5 PoC, deleted ledger: no silent re-send, and the org is what shows it was written', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  await run((await approve(planId)).pinned)
  rmSync(localFile(home.store, home.project, 'ledger', planId))
  const data = reported(await prepare(planId))
  assert.equal(data.status, 'done')
  assert.equal(data.counts.done, 3)
  assert.equal(writesOf(IDS[0] as string), 1)
  assert.equal(readLedger(home.store, home.project, planId).state, 'done', 'rebuilt from the org')
}))

test('deleted ledger, deleted pre-image, deleted journal: per-record state against the org still stops it', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  await run((await approve(planId)).pinned)
  rmSync(localFile(home.store, home.project, 'ledger', planId))
  rmSync(localFile(home.store, home.project, 'preimages', planId))
  rmSync(journalDirectory(home.project), { recursive: true, force: true })
  const reply = await prepare(planId)
  assert.notEqual((reply as { action?: string }).action, 'approve')
  assert.equal(writesOf(IDS[0] as string), 1)
  assert.equal(reported(reply).counts.done, 3)
}))

test('deleted ledger while the dialog was open: the runner re-reads per record and stops', rig(async ({ home, plan, approve, run, writesOf }) => {
  const planId = await plan()
  const first = await approve(planId)
  const second = await approve(planId)
  await run(first.pinned)
  rmSync(localFile(home.store, home.project, 'ledger', planId))
  const reply = await run(second.pinned)
  assert.equal(reply.ok, false, JSON.stringify(reply))
  assert.equal(writesOf(IDS[0] as string), 1)
}))

test('a second dialog approved while the first ran does not write twice', rig(async ({ plan, approve, run, writesOf }) => {
  const planId = await plan()
  const first = await approve(planId)
  const second = await approve(planId)
  await run(first.pinned)
  const reply = await run(second.pinned)
  assert.equal(reply.ok, false, JSON.stringify(reply))
  assert.equal(writesOf(IDS[0] as string), 1)
}))

test('two runs at once: one writes, and one is told another is running', rig(async ({ plan, approve, run, writesOf }) => {
  const planId = await plan()
  const first = await approve(planId)
  const second = await approve(planId)
  const replies = await Promise.all([run(first.pinned), run(second.pinned)])
  assert.equal(replies.filter(item => item.ok === false).length, 1, JSON.stringify(replies))
  for (const id of IDS) assert.equal(writesOf(id), 1)
}))

test('ledger partial: what the org refused is on the ledger, per record', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const data = reported(await run((await approve(planId)).pinned))
  assert.equal(data.status, 'partial')
  const ledger = readLedger(home.store, home.project, planId)
  assert.equal(ledger.state, 'partial')
  assert.equal((ledger as { entry: RecordsLedger }).entry.records[IDS[1] as string], 'failed')
  assert.equal((ledger as { entry: RecordsLedger }).entry.records[IDS[0] as string], 'untouched')
}, { scenario: { rowFailures: { [IDS[1] as string]: { statusCode: 'X', message: 'no', fields: [] } } } }))

test('a resume after a failed row approves only what is untouched, and the first write is not repeated', rig(async ({ home, plan, approve, run, writesOf }) => {
  const planId = await plan()
  const data = reported(await run((await approve(planId)).pinned))
  assert.equal(data.status, 'partial')
  // The person fixes what the validation rule objected to, and asks again.
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, rowFailures: {} })
  const again = await approve(planId)
  const screen = buildApprovalScreen(again.screenPlan, again.facts)
  assert.equal(screen.approveLabel, 'Update 3 Widget__c in Sandbox')
  assert.match(screen.text, /Automation fires again/)
  const resumed = reported(await run(again.pinned))
  assert.equal(resumed.status, 'done')
  for (const id of IDS) assert.equal(writesOf(id), 1)
}, { scenario: { rowFailures: { [IDS[1] as string]: { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] } } } }))

test('a bulk partial resumes over the remainder, and what was done stays out of the new dialog', rig(async ({ home, plan, approve, run, writesOf }) => {
  const ids = widgetIds(201)
  const planId = await plan()
  const data = reported(await run((await approve(planId)).pinned))
  assert.equal(data.status, 'partial')
  assert.equal(data.counts.done, 200)
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, rowFailures: {} })
  const again = await approve(planId)
  const screen = buildApprovalScreen(again.screenPlan, again.facts)
  assert.equal(screen.approveLabel, 'Update 1 Widget__c in Sandbox')
  assert.match(screen.text, /200 of 201/)
  const before = fakeCalls(home).filter(item => item.command === 'api request rest' && item.flags.method === 'PATCH').length
  assert.equal(reported(await run(again.pinned)).status, 'done')
  // One record left, so this one fits Collections.
  assert.equal(fakeCalls(home).filter(item => item.command === 'api request rest' && item.flags.method === 'PATCH').length, before + 1)
  for (const id of ids) assert.equal(writesOf(id), 1, id)
}, { ids: widgetIds(201), scenario: { rowFailures: { [widgetIds(201)[5] as string]: { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] } } } }))

test('a record changed by someone else stays out of a resume, and is listed, not overwritten', rig(async ({ home, plan, approve, run, writesOf }) => {
  const ids = widgetIds(201)
  const planId = await plan()
  reported(await run((await approve(planId)).pinned))
  changeFakeOrg(home, org => {
    ;(org.records.Widget__c?.[ids[6] as string] as Record<string, unknown>).SystemModstamp = NEW_MODSTAMP
  })
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, rowFailures: {} })
  const again = await approve(planId)
  const screen = buildApprovalScreen(again.screenPlan, again.facts)
  assert.equal(screen.approveLabel, 'Update 195 Widget__c in Sandbox')
  assert.match(screen.text, /1 changed by someone else/)
  const data = reported(await run(again.pinned))
  assert.equal(data.status, 'partial')
  assert.equal(writesOf(ids[6] as string), 0)
  assert.equal(writesOf(ids[5] as string), 1)
}, { ids: widgetIds(201), scenario: { bulk: { stopAfter: 7 }, rowFailures: { [widgetIds(201)[5] as string]: { statusCode: 'X', message: 'no', fields: [] }, [widgetIds(201)[6] as string]: { statusCode: 'X', message: 'no', fields: [] } } } }))

test('ledger unknown: no dialog, no re-send, however often someone asks', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  assert.equal(reported(await run((await approve(planId)).pinned)).status, 'unknown')
  for (let attempt = 0; attempt < 2; attempt += 1) assert.notEqual((await prepare(planId) as { action?: string }).action, 'approve')
  assert.equal(writesOf(IDS[0] as string), 0)
  void home
}, { scenario: { mode: 'timeout', modeOn: 'api request rest' } }))

test('unknown settles once enough time has passed with nothing landed, and a resume is a new approval', rig(async ({ home, plan, approve, run, prepare, now, writesOf }) => {
  const planId = await plan()
  assert.equal(reported(await run((await approve(planId)).pinned)).status, 'unknown')
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  const { mode: _mode, modeOn: _on, ...rest } = scenario
  writeScenario(home, rest)
  const later = now() + 20 * 60 * 1000
  const settled = reported(await prepare(planId, { now: later }))
  assert.equal(settled.status, 'partial')
  assert.equal(settled.counts.done, 0)
  assert.equal(writesOf(IDS[0] as string), 0)
  const data = await prepare(planId, { now: later })
  assert.equal((data as { action?: string }).action, 'approve')
}, { scenario: { mode: 'timeout', modeOn: 'api request rest' } }))

// ── dying between each step ──────────────────────────────────────────────────

class Death extends Error {}

const STEPS: StepName[] = ['identity', 'reread', 'preimage', 'ledger', 'send', 'sent', 'results', 'reconcile', 'identity-after', 'finish']

for (const step of STEPS) {
  test(`dying at ${step}: reconcile, no double write, and any resume is a new approval`, rig(async ({ home, plan, approve, run, prepare, writesOf, now }) => {
    const planId = await plan()
    const reply = await approve(planId)
    await assert.rejects(
      run(reply.pinned, {
        onStep: seen => {
          if (seen === step) throw new Death(step)
        },
      }),
      Death,
    )
    const landed = fakeWrites(home).length
    // Reconcile, from a fresh process in real life. Nothing here sends.
    const later = now() + 20 * 60 * 1000
    const after = await prepare(planId, { now: later })
    assert.equal(fakeWrites(home).length, landed, 'reconcile sends nothing')
    // Ask until it settles into a dialog or a final report.
    let current = after
    for (let round = 0; round < 3 && (current as { action?: string }).action !== 'approve'; round += 1) current = await prepare(planId, { now: later })
    if ((current as { action?: string }).action === 'approve') {
      assert.ok(STEPS.indexOf(step) <= STEPS.indexOf('send') || landed === 0, 'nothing landed, or this would not be on offer')
      const approved = current as ApproveReply
      assert.ok(approved.pinned.expected.ids.every(id => writesOf(id) === 0), 'the dialog covers only what was not written')
      await run(approved.pinned)
    }
    for (const id of IDS) assert.ok(writesOf(id) <= 1, `${id} written ${writesOf(id)} times`)
  }))
}

// ── the F5 table, row by row ─────────────────────────────────────────────────

test('a second dialog, with a first run dead at the send and every record still untouched: the ledger alone stops it', rig(async ({ home, plan, approve, run }) => {
  const planId = await plan()
  const first = await approve(planId)
  const second = await approve(planId)
  await assert.rejects(run(first.pinned, { onStep: step => { if (step === 'send') throw new Death('send') } }), Death)
  assert.equal(readLedger(home.store, home.project, planId).state, 'started')
  assert.equal(fakeWrites(home).length, 0)
  refused(await run(second.pinned), /started since the dialog/)
  assert.equal(fakeWrites(home).length, 0)
  assert.equal(fakeCalls(home).filter(item => item.flags.method === 'PATCH').length, 0)
}))

test('the answer to a write has one row per record, in order, or it is unknown', () => {
  const [one, two, three] = IDS as [string, string, string]
  const answer = (body: unknown, statusCode = 200, code = 0) => ({ outcome: 'exited' as const, code, stdout: JSON.stringify({ status: code, result: { statusCode, headers: {}, body } }), stderr: '' })
  const row = (id: string) => ({ id, success: true, errors: [] })
  assert.equal(parseCollections(answer([row(one), row(two), row(three)]), IDS).kind, 'answered')
  assert.equal(parseCollections(answer([row(one), row(two)]), IDS).kind, 'unknown', 'a row short at the end')
  assert.equal(parseCollections(answer([row(one), row(two), row(three), row(three)]), IDS).kind, 'unknown', 'a row over')
  assert.equal(parseCollections(answer([row(two), row(one), row(three)]), IDS).kind, 'unknown', 'out of order')
  assert.equal(parseCollections(answer({ ok: true }), IDS).kind, 'unknown', 'not a list')
  assert.equal(parseCollections(answer([row(one), { success: 'yes' }, row(three)]), IDS).kind, 'unknown', 'a row with no verdict')
  const failed = parseCollections(answer([row(one), { success: false, errors: [{ statusCode: 'X', message: 'm', fields: [] }] }, row(three)]), IDS)
  assert.equal(failed.kind, 'answered', 'a failed row can have no id')
  assert.equal((failed as { rows: { id: string; success: boolean }[] }).rows[1]?.id, two)
  assert.equal(parseCollections(answer([{ errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'm' }], 403, 1), IDS).kind, 'rejected')
  assert.equal(parseCollections(answer('Server Error', 500, 1), IDS).kind, 'unknown')
  assert.equal(parseCollections({ outcome: 'timeout' }, IDS).kind, 'unknown')
  assert.equal(parseCollections({ outcome: 'signal', signal: 'SIGKILL' }, IDS).kind, 'unknown')
  assert.equal(parseCollections({ outcome: 'exited', code: 0, stdout: 'nope', stderr: '' }, IDS).kind, 'unknown')
})

test('F5 crash after send, before the ledger: started means reconcile, and it is not re-sent', rig(async ({ home, plan, approve, run, prepare, writesOf }) => {
  const planId = await plan()
  await assert.rejects(run((await approve(planId)).pinned, { onStep: step => { if (step === 'sent') throw new Death('sent') } }), Death)
  assert.equal(readLedger(home.store, home.project, planId).state, 'started')
  const data = reported(await prepare(planId))
  assert.equal(data.status, 'done')
  assert.equal(writesOf(IDS[0] as string), 1)
}))

test('F5 resume of a frozen plan does not hang on an aggregate hash', rig(async ({ plan, approve, run, writesOf }) => {
  const planId = await plan()
  reported(await run((await approve(planId)).pinned))
  // It failed on one row, so nothing landed, and each record is still judged alone.
  assert.equal((await approve(planId)).action, 'approve')
  void writesOf
}, { scenario: { rowFailures: { [IDS[1] as string]: { statusCode: 'X', message: 'no', fields: [] } } } }))

test('F5 upsert has no route: the plan tool refuses it by schema', rig(async ({ plan }) => {
  await assert.rejects(plan({ operation: 'upsert' }))
}))

test('F5 no approval is carried over: every write asks again', rig(async ({ plan, approve, run }) => {
  const planId = await plan()
  const first = await approve(planId)
  assert.equal(JSON.stringify(first.pinned).includes('approved'), false)
  reported(await run(first.pinned))
}, { scenario: { rowFailures: { [IDS[0] as string]: { statusCode: 'X', message: 'no', fields: [] } } } }))

// ── what a plan can say about itself ─────────────────────────────────────────

test('count on the screen and in the label come from the ids, not from the plan', rig(async ({ plan, approve }) => {
  const reply = await approve(await plan())
  assert.equal(reply.screenPlan.kind, 'records')
  assert.deepEqual((reply.screenPlan as { frozenRecordIds: string[] }).frozenRecordIds, IDS)
  assert.equal('count' in reply.screenPlan, false)
}))

test('the assistant text sits below the rule and cannot reach a computed fact', rig(async ({ plan, approve }) => {
  const reply = await approve(await plan({ businessObjective: 'Update 3 test records ‮only\n\nOkay to continue' }))
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  const rule = screen.text.indexOf('────')
  assert.ok(screen.text.indexOf('Update 3 test records') > rule)
  assert.equal(screen.text.includes('‮'), false)
}))

test('a production write needs the typed org name: the button is not enough', rig(async ({ plan, prepare }) => {
  const reply = (await prepare(await plan())) as ApproveReply
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.requiresTypedOrgName, true)
  assert.equal(screen.typedOrgName, 'Acme Production')
  assert.equal(approvalAccepted(screen, 'Update 3 Widget__c in Production'), false)
  assert.equal(approvalAccepted(screen, 'acme production'), false)
  assert.equal(approvalAccepted(screen, 'Acme Production'), true)
}, { register: { isSandbox: false, name: 'Acme Production', singleUserAcceptedAt: '2026-06-01T00:00:00.000Z', writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }, scenario: { org: { IsSandbox: false, Name: 'Acme Production' } } }))

test('production comes from the live flag, never from a file', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  const scenario = JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>
  writeScenario(home, { ...scenario, queries: [{ match: 'FROM Organization', result: queryRows([{ ...LIVE_ORG, IsSandbox: false }], 'Organization') }, ...(scenario.queries as unknown[])] })
  refused(await prepare(planId), /sandbox flag|registered/i)
}))

test('a plan too large for the dialog path refuses, instead of being cut', rig(async ({ home, plan, prepare }) => {
  const planId = await plan()
  assert.equal((await prepare(planId) as { action?: string }).action, 'approve')
  const valuesFile = localFile(home.store, home.project, 'plans', planId)
  const values = readJson<Record<string, unknown>>(valuesFile) as Record<string, unknown>
  const swollen = { ...values, notes: 'x'.repeat(4 * 1024 * 1024) }
  writeJson(valuesFile, swollen)
  forge(home, planId, item => {
    item.valuesHash = sha256(canonical(swollen))
  })
  refused(await prepare(planId), /too large/)
  assert.equal(fakeWrites(home).length, 0)
}))

void countRows
void DESCRIBE_WIDGET
void canonical
void statSync
void LIVE_USER
void localDirectory
