import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen } from './approval-screen.js'
import { auditBeforeWrite } from './audit.js'
import { proposeBrief } from './brief.js'
import { packageXml } from './deploy-zip.js'
import { readJournal } from './journal.js'
import { readLedger } from './ledger.js'
import { localFile } from './paths.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY } from './stamp.js'
import { baseScenario, changeFakeOrg, contextFor, fakeCalls, fakeDeploys, fakeHome, fakeJobs, fakeOrg, fakeWrites, ORG, registerFake, registerWriterFake, runRunner, widgetIds, widgetRecords, WRITER, writerScenario, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'

/**
 * The whole path, end to end, as a session walks it. Plans and reads go through the
 * stdio tools. Everything a hook would ask of the runner goes to the real runner as a
 * real process, against the fake CLI. A person is the only thing played by the test,
 * and all it does is answer the screen the mod would have drawn, exactly.
 */

const IDS = widgetIds(3)
const OLD = { 'classes/Widget.cls': 'public class Widget { /* old */ }', 'classes/Widget.cls-meta.xml': '<ApexClass/>' }
const NEW = { 'classes/Widget.cls': 'public class Widget { /* new */ }', 'classes/Widget.cls-meta.xml': '<ApexClass/>' }

type Session = {
  home: FakeHome
  briefId: string
  briefHash: string
  stdio: (name: string, args: Record<string, unknown>, mode: string) => Promise<ToolResult>
  /** Asks the runner, as the mod does, with the person's answer in between. */
  approveAndRun: (prepare: string, run: string, request: Record<string, unknown>, mode?: string) => Record<string, any>
  ask: (command: string, input: Record<string, unknown>, mode?: string) => Record<string, any>
  writesOf: (id: string) => number
}

function session(body: (s: Session) => Promise<void>, options: { scenario?: Record<string, unknown>; ids?: string[]; production?: boolean } = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      const production = options.production === true
      registerFake(home, { isSandbox: !production, name: production ? 'Acme Production' : 'Acme Sales' })
      // Production as the guide sets it up: a read-only reader, and a writer a person logged in for this change.
      if (production) registerWriterFake(home, { isSandbox: false, name: 'Acme Production' })
      writeScenario(home, baseScenario({ org: { IsSandbox: !production, Name: production ? 'Acme Production' : 'Acme Sales' }, records: { Widget__c: widgetRecords(options.ids ?? IDS) }, metadata: { 'ApexClass:Widget': OLD }, ...(production ? writerScenario() : {}), ...options.scenario }))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'Close the old Widget__c', environment: 'Acme', subjects: [], change: 'Status__c', blockingQuestions: [] }, new Date().toISOString())
      const stdio: Session['stdio'] = (name, args, mode) => callTool(adapter, name, { ...args, [STAMP_KEY]: { mode, agentId: null, confirmedBriefHash: briefHash, ack: null } }, contextFor(home, { hookHost: true, now: Date.now(), correlationId: `corr-${Date.now()}`, pollBudgetMs: 2000, pollIntervalMs: 10 }))
      const ask: Session['ask'] = (command, input, mode = 'execute') => {
        const ran = runRunner(home, command, { ...input, confirmedBriefHash: briefHash, mode, pollBudgetMs: 3000, pollIntervalMs: 10 })
        assert.ok(ran.reply, `${command} gave no reply: ${JSON.stringify(ran)}`)
        return ran.reply
      }
      const approveAndRun: Session['approveAndRun'] = (prepare, run, request, mode = 'execute') => {
        const reply = ask(prepare, { request }, mode)
        assert.equal(reply.ok, true, JSON.stringify(reply))
        assert.equal(reply.action, 'approve', JSON.stringify(reply))
        const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
        const answer = screen.requiresTypedOrgName ? (screen.typedOrgName as string) : screen.approveLabel
        assert.equal(approvalAccepted(screen, answer), true)
        return ask(run, { pinned: reply.pinned }, mode)
      }
      const writesOf: Session['writesOf'] = id => fakeWrites(home).filter(item => item.id === id).length
      await body({ home, briefId, briefHash, stdio, ask, approveAndRun, writesOf })
    } finally {
      home.cleanup()
    }
  }
}

async function recordsPlan(s: Session, over: Record<string, unknown> = {}, ids: string[] = IDS): Promise<string> {
  const review = await s.stdio('practice_record', { briefId: s.briefId, practice: 'fine', experience: 'fine', security: 'fine', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['Status__c'] }, 'plan')
  assert.equal(review.ok, true, JSON.stringify(review))
  const made = await s.stdio('records_plan_update', { orgId: ORG, briefId: s.briefId, practiceReviewId: (review.data as { practiceReviewId: string }).practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: ids, ...over }, 'plan')
  assert.equal(made.ok, true, JSON.stringify(made))
  return (made.data as { planId: string }).planId
}

async function deployPlan(s: Session): Promise<string> {
  for (const [path, text] of Object.entries({ 'package.xml': packageXml(['ApexClass:Widget']), ...NEW })) {
    const file = join(s.home.project, 'deploy', path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  const review = await s.stdio('practice_record', { briefId: s.briefId, practice: 'fine', experience: 'fine', security: 'fine', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['deploy'] }, 'plan')
  const made = await s.stdio('deployment_plan', { orgId: ORG, briefId: s.briefId, practiceReviewId: (review.data as { practiceReviewId: string }).practiceReviewId, artifactPath: 'deploy', destructive: false }, 'plan')
  assert.equal(made.ok, true, JSON.stringify(made))
  return (made.data as { planId: string }).planId
}

test('end to end: plan, approval, frozen update, verify, restore', session(async s => {
  const planId = await recordsPlan(s)
  assert.equal(fakeWrites(s.home).length, 0, 'a plan changes nothing')

  const preview = await s.stdio('records_preview', { orgId: ORG, briefId: s.briefId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, 'plan')
  assert.equal((preview.data as { blockers: string[] }).blockers.length, 0)

  const wrote = s.approveAndRun('records-prepare', 'records-run', { planId })
  assert.equal(wrote.ok, true, JSON.stringify(wrote))
  assert.equal(wrote.data.status, 'done')
  assert.match(wrote.text, /Written|status/)
  for (const id of IDS) assert.equal(fakeOrg(s.home).records.Widget__c?.[id]?.Status__c, 'Closed')

  const verified = await s.stdio('deployment_verify', { orgId: ORG, briefId: s.briefId, planId }, 'validate')
  assert.equal(verified.ok, true, JSON.stringify(verified))
  assert.equal((verified.data as { status: string }).status, 'done')
  assert.equal(verified.sideEffect, false)
  assert.equal(fakeWrites(s.home).length, 3, 'verify wrote nothing')

  const restored = s.approveAndRun('restore-prepare', 'records-run', { planId, briefId: s.briefId })
  assert.equal(restored.data.status, 'done', JSON.stringify(restored))
  for (const id of IDS) {
    assert.equal(fakeOrg(s.home).records.Widget__c?.[id]?.Status__c, 'New')
    assert.equal(s.writesOf(id), 2, 'once by the plan, once by the restore')
  }
  const audit = await auditBeforeWrite(new SfCliAdapter({ env: s.home.env, projectRoot: s.home.project, timeoutMs: 8000, versionTimeoutMs: 8000 }), contextFor(s.home, { now: Date.now() }), ORG)
  assert.equal(audit.state, 'clean', JSON.stringify(audit))
}))

test('end to end: a partial bulk reports partial, per id, and does not retry', session(async s => {
  const ids = widgetIds(205)
  const planId = await recordsPlan(s, {}, ids)
  const wrote = s.approveAndRun('records-prepare', 'records-run', { planId })
  assert.equal(wrote.data.status, 'partial', JSON.stringify(wrote.data))
  assert.equal(wrote.data.counts.done, 9)
  assert.equal(wrote.data.counts.failed, 1)
  assert.equal(wrote.data.counts.untouched, 195)
  assert.equal(wrote.data.jobState, 'Failed')
  assert.equal(wrote.data.failures[0].code, 'FIELD_CUSTOM_VALIDATION_EXCEPTION')
  assert.equal(fakeJobs(s.home).length, 1)
  assert.equal(readLedger(s.home.store, s.home.project, planId).state, 'partial')
  const verified = await s.stdio('deployment_verify', { orgId: ORG, briefId: s.briefId, planId }, 'validate')
  assert.equal((verified.data as { status: string }).status, 'partial')
  assert.equal(fakeJobs(s.home).length, 1, 'verify started nothing')
}, { ids: widgetIds(205), scenario: { bulk: { stopAfter: 10 }, rowFailures: { [widgetIds(205)[3] as string]: { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'A rule', fields: [] } } } }))

test('end to end: a crash, then reconcile, with no double write', session(async s => {
  const planId = await recordsPlan(s)
  const reply = s.ask('records-prepare', { request: { planId } })
  assert.equal(reply.action, 'approve')
  const scenarioFile = join(s.home.env.HOME as string, '.fake-sf', 'scenario.json')
  const { readFileSync } = await import('node:fs')
  const scenario = JSON.parse(readFileSync(scenarioFile, 'utf8')) as Record<string, unknown>
  writeScenario(s.home, { ...scenario, killParent: { on: 'composite/sobjects', when: 'after', nth: 1 } })
  const died = runRunner(s.home, 'records-run', { pinned: reply.pinned, confirmedBriefHash: s.briefHash, mode: 'execute' })
  assert.equal(died.reply, null, 'the runner died before it could say anything')
  writeScenario(s.home, scenario)
  assert.equal(readLedger(s.home.store, s.home.project, planId).state, 'started')
  const reconciled = s.ask('records-prepare', { request: { planId } })
  assert.equal(reconciled.action, 'report')
  assert.equal(reconciled.data.status, 'done')
  for (const id of IDS) assert.equal(s.writesOf(id), 1)
  assert.equal(readLedger(s.home.store, s.home.project, planId).state, 'done')
}))

test('end to end: a deleted ledger, with no double write', session(async s => {
  const planId = await recordsPlan(s)
  assert.equal(s.approveAndRun('records-prepare', 'records-run', { planId }).data.status, 'done')
  rmSync(localFile(s.home.store, s.home.project, 'ledger', planId))
  const asked = s.ask('records-prepare', { request: { planId } })
  assert.equal(asked.action, 'report', JSON.stringify(asked))
  assert.equal(asked.data.counts.done, 3)
  for (const id of IDS) assert.equal(s.writesOf(id), 1)
  // The same with the journal gone too: the org is what shows it.
  rmSync(localFile(s.home.store, s.home.project, 'ledger', planId))
  rmSync(join(s.home.project, '.topia', 'salesforce', 'journal'), { recursive: true, force: true })
  const again = s.ask('records-prepare', { request: { planId } })
  assert.notEqual(again.action, 'approve', JSON.stringify(again))
  for (const id of IDS) assert.equal(s.writesOf(id), 1)
}))

test('end to end: a sandbox deploy, validated with a dry run and shipped with the same zip', session(async s => {
  const planId = await deployPlan(s)
  const validated = s.approveAndRun('validate-prepare', 'validate-run', { planId }, 'validate')
  assert.equal(validated.data.state, 'passed', JSON.stringify(validated))
  const shipped = s.approveAndRun('deploy-prepare', 'deploy-run', { planId })
  assert.equal(shipped.data.status, 'done', JSON.stringify(shipped.data))
  const [dryRun, real] = fakeDeploys(s.home)
  assert.equal(dryRun?.checkOnly, true)
  assert.equal(real?.checkOnly, false)
  assert.equal(dryRun?.zipSha, real?.zipSha)
  assert.equal(fakeOrg(s.home).metadata['ApexClass:Widget']?.['classes/Widget.cls'], NEW['classes/Widget.cls'])
  const verified = await s.stdio('deployment_verify', { orgId: ORG, briefId: s.briefId, planId }, 'validate')
  assert.equal((verified.data as { status: string }).status, 'done')
  assert.ok(readJournal(s.home.project, planId).some(line => line.event === 'change.executed'))
}))

test('end to end: a sandbox deploy with drift stops, and nothing ships', session(async s => {
  const planId = await deployPlan(s)
  s.approveAndRun('validate-prepare', 'validate-run', { planId }, 'validate')
  const reply = s.ask('deploy-prepare', { request: { planId } })
  assert.equal(reply.action, 'approve')
  changeFakeOrg(s.home, org => {
    ;(org.metadata['ApexClass:Widget'] as Record<string, string>)['classes/Widget.cls'] = 'public class Widget { /* someone in Setup */ }'
  })
  const ran = s.ask('deploy-run', { pinned: reply.pinned })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.match(ran.reason, /drift/)
  assert.equal(fakeWrites(s.home).filter(item => item.kind === 'deploy').length, 0)
}))

test('end to end: production validates, then quick-deploys that job, with the typed name', session(async s => {
  const planId = await deployPlan(s)
  const validated = s.approveAndRun('validate-prepare', 'validate-run', { planId }, 'validate')
  assert.equal((validated.data as { state: string; path: string }).path, 'validate')
  assert.equal(validated.data.state, 'passed', JSON.stringify(validated))
  const reply = s.ask('deploy-prepare', { request: { planId } })
  const screen = buildApprovalScreen(reply.screenPlan, reply.facts)
  assert.equal(screen.requiresTypedOrgName, true)
  assert.equal(approvalAccepted(screen, screen.approveLabel), false)
  assert.equal(approvalAccepted(screen, 'Acme Production'), true)
  const shipped = s.ask('deploy-run', { pinned: reply.pinned })
  assert.equal(shipped.data.status, 'done', JSON.stringify(shipped.data))
  assert.equal(fakeCalls(s.home).filter(item => item.command === 'project deploy start').length, 0, 'never a full deploy')
  assert.equal(fakeCalls(s.home).filter(item => item.command === 'project deploy quick').length, 1)
  assert.equal(fakeDeploys(s.home)[1]?.quickOf, fakeDeploys(s.home)[0]?.id)
  assert.equal(fakeCalls(s.home).find(item => item.command === 'project deploy quick')?.flags['target-org'], WRITER)
  assert.match(shipped.data.afterThis, /sf org logout --target-org/)
}, { production: true }))

test('end to end: a production record write runs as the writer, and a read afterward as the reader', session(async s => {
  const review = await s.stdio('practice_record', { briefId: s.briefId, practice: 'fine', experience: 'fine', security: 'fine', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['Status__c'] }, 'plan')
  const made = await s.stdio('records_plan_update', { orgId: ORG, briefId: s.briefId, practiceReviewId: (review.data as { practiceReviewId: string }).practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS }, 'plan')
  assert.equal(made.ok, true, JSON.stringify(made))
  const done = s.approveAndRun('records-prepare', 'records-run', { planId: (made.data as { planId: string }).planId })
  assert.equal(done.data.status, 'done', JSON.stringify(done.data))
  assert.match(done.data.afterThis, /sf org logout --target-org/)
  const patch = fakeCalls(s.home).find(item => item.command === 'api request rest' && item.flags.method === 'PATCH')
  assert.equal(patch?.flags['target-org'], WRITER)
  const read = await s.stdio('org_inspect', { orgId: ORG, briefId: s.briefId }, 'investigate')
  assert.equal(read.user, 'ada@example.com')
}, { production: true }))

test('end to end: production with drift stops before the quick deploy', session(async s => {
  const planId = await deployPlan(s)
  s.approveAndRun('validate-prepare', 'validate-run', { planId }, 'validate')
  const reply = s.ask('deploy-prepare', { request: { planId } })
  changeFakeOrg(s.home, org => {
    ;(org.metadata['ApexClass:Widget'] as Record<string, string>)['classes/Widget.cls'] = 'public class Widget { /* someone in Setup */ }'
  })
  const ran = s.ask('deploy-run', { pinned: reply.pinned })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.match(ran.reason, /drift/)
  assert.equal(fakeCalls(s.home).filter(item => item.command === 'project deploy quick').length, 0)
  assert.equal(fakeWrites(s.home).length, 0)
}, { production: true }))

test('end to end: a test run through the dialog, and its result by run id', session(async s => {
  const started = s.approveAndRun('tests-prepare', 'tests-run', { orgId: ORG, briefId: s.briefId, level: 'RunLocalTests' }, 'validate')
  assert.equal(started.data.status, 'started')
  const result = s.ask('tests-prepare', { request: { orgId: ORG, briefId: s.briefId, runId: started.data.runId } }, 'validate')
  assert.equal(result.action, 'report')
  assert.equal(result.data.outcome, 'Passed')
}))
