import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { briefFileFor, proposeBrief } from './brief.js'
import { noticeText, showsContinue } from './issues.js'
import { readAllJournals } from './journal.js'
import { sessionKey } from './paths.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY } from './stamp.js'
import { storeGet } from './store.js'
import { baseScenario, contextFor, countRows, fakeCalls, fakeHome, ORG, queryRows, registerFake, USERNAME, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'

const here = dirname(fileURLToPath(import.meta.url))
const AT = '2026-06-01T00:00:00.000Z'
const BRIEF = { objective: 'How many new Widget__c?', environment: 'Sandbox', subjects: [], change: '', blockingQuestions: [] }
const IDENTITY_HASH = `${ORG}|${USERNAME}|sandbox`

function runner(home: FakeHome, command: string, input: Record<string, unknown>): Record<string, any> {
  const ran = spawnSync(process.execPath, [join(here, 'runner.js'), command], { input: JSON.stringify({ projectRoot: home.project, ...input }), env: home.env, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  return JSON.parse(ran.stdout) as Record<string, any>
}

function withHome(body: (home: FakeHome) => void | Promise<void>, options: { register?: boolean; scenario?: Record<string, unknown> } = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      if (options.register !== false) registerFake(home)
      writeScenario(home, baseScenario(options.scenario ?? {}))
      await body(home)
    } finally {
      home.cleanup()
    }
  }
}

// ── reading a brief for the dialog ──

test('brief-read returns the stored brief and a hash computed from the file', withHome(home => {
  const { briefId, briefHash } = proposeBrief(home.store, home.project, BRIEF, AT)
  const reply = runner(home, 'brief-read', { briefId })
  assert.equal(reply.ok, true)
  assert.equal(reply.briefHash, briefHash)
  assert.equal(reply.brief.objective, BRIEF.objective)
  const file = briefFileFor(home.store, home.project, briefId)
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { brief: { change: string } }
  stored.brief.change = 'Delete everything'
  writeFileSync(file, JSON.stringify(stored))
  const edited = runner(home, 'brief-read', { briefId })
  assert.notEqual(edited.briefHash, briefHash, 'what is shown is what gets confirmed')
  assert.equal(edited.brief.change, 'Delete everything')
}))

test('brief-read refuses a bad id, a missing brief, and a project that is off', withHome(home => {
  assert.equal(runner(home, 'brief-read', { briefId: '../../etc/passwd' }).ok, false)
  assert.equal(runner(home, 'brief-read', { briefId: 5 }).ok, false)
  assert.equal(runner(home, 'brief-read', { briefId: 'brief-0000000000000000' }).ok, false)
}))

test('in a project that is off, brief-read refuses before reading anything', withHome(home => {
  const { briefId } = proposeBrief(home.store, home.project, BRIEF, AT)
  const reply = runner(home, 'brief-read', { briefId })
  assert.equal(reply.ok, false)
  assert.match(String(reply.reason), /not on/)
}, { register: false }))

test('the answer is journaled, and free text from the box is not', withHome(home => {
  const { briefId } = proposeBrief(home.store, home.project, BRIEF, AT)
  assert.equal(runner(home, 'brief-answered', { briefId, confirmed: true, answer: 'Ada Example said so' }).ok, true)
  const lines = readAllJournals(home.project)
  assert.equal(lines[0]?.event, 'confirmation.received')
  assert.equal(lines[0]?.status, 'confirmed')
  assert.equal(JSON.stringify(lines).includes('Ada Example'), false)
}))

test('an answer that was not exact is journaled as not confirmed', withHome(home => {
  const { briefId } = proposeBrief(home.store, home.project, BRIEF, AT)
  runner(home, 'brief-answered', { briefId, confirmed: 'yes' })
  assert.equal(readAllJournals(home.project)[0]?.status, 'not-confirmed')
}))

// ── show values, through the runner ──

const VALUES = { queries: [{ match: 'SELECT Id, Contact_Email__c', result: queryRows([{ Id: 'a00000000000001AAA', Contact_Email__c: 'cara@example.com' }]) }] }

test('values-prepare reads no values, and values-run returns them inside the block', withHome(home => {
  const { briefId, briefHash } = proposeBrief(home.store, home.project, BRIEF, AT)
  const prepared = runner(home, 'values-prepare', { confirmedBriefHash: briefHash, request: { orgId: ORG, briefId, object: 'Widget__c', fields: ['Id', 'Contact_Email__c'], limit: 5 } })
  assert.equal(prepared.ok, true, JSON.stringify(prepared))
  assert.equal(JSON.stringify(prepared).includes('cara@example.com'), false)
  assert.equal(fakeCalls(home).some(call => (call.soql ?? '').includes('FROM Widget__c')), false)
  const ran = runner(home, 'values-run', { confirmedBriefHash: briefHash, pinned: prepared.pinned })
  assert.equal(ran.ok, true, JSON.stringify(ran))
  assert.match(ran.text, /cara@example.com/)
  assert.match(ran.text, /<<<SALESFORCE_ORG_TEXT>>>/)
}, { scenario: VALUES }))

test('the runner still needs the confirmed hash, whoever calls it', withHome(home => {
  const { briefId } = proposeBrief(home.store, home.project, BRIEF, AT)
  for (const confirmedBriefHash of [undefined, null, 5, 'a'.repeat(64)]) {
    const reply = runner(home, 'values-prepare', { confirmedBriefHash, request: { orgId: ORG, briefId, object: 'Widget__c', fields: ['Id'], limit: 5 } })
    assert.equal(reply.ok, false, String(confirmedBriefHash))
  }
}, { scenario: VALUES }))

test('in a project that is off, the values commands refuse and run nothing', withHome(home => {
  const reply = runner(home, 'values-prepare', { confirmedBriefHash: null, request: { orgId: ORG, briefId: 'brief-0000000000000000', object: 'Widget__c', fields: ['Id'], limit: 5 } })
  assert.equal(reply.ok, false)
  assert.equal(fakeCalls(home).length, 0)
}, { register: false }))

test('a mode from the caller only labels the journal, and an unknown one reads as read-only', withHome(home => {
  const { briefId, briefHash } = proposeBrief(home.store, home.project, BRIEF, AT)
  const prepared = runner(home, 'values-prepare', { mode: 'admin', confirmedBriefHash: briefHash, request: { orgId: ORG, briefId, object: 'Widget__c', fields: ['Id', 'Contact_Email__c'], limit: 5 } })
  runner(home, 'values-run', { mode: 'admin', confirmedBriefHash: briefHash, pinned: prepared.pinned })
  const executed = readAllJournals(home.project).filter(line => line.event === 'query.executed')
  assert.ok(executed.length > 0)
  for (const line of executed) assert.equal(line.mode, 'read-only')
}, { scenario: VALUES }))

// ── acknowledgements, on the server ──

function stamped(args: Record<string, unknown>, ack: unknown): Record<string, unknown> {
  return { ...args, [STAMP_KEY]: { mode: 'investigate', agentId: null, confirmedBriefHash: null, ack } }
}

const CHANGED_USER = { display: { id: ORG, username: 'someone.else@example.com', instanceUrl: 'https://acme.sandbox.example.com' } }

function ackRig(body: (home: FakeHome, call: (args: unknown, hookHost?: boolean) => Promise<ToolResult>) => Promise<void>, over: Record<string, unknown> = {}): () => Promise<void> {
  return withHome(async home => {
    const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
    await body(home, (args, hookHost = true) => callTool(adapter, 'org_inspect', args, contextFor(home, { hookHost })))
  }, { scenario: { ...CHANGED_USER, ...over } })
}

const GOOD_ACK = { kind: 'user-changed-on-read', orgId: ORG, user: USERNAME, orgIdentityHash: IDENTITY_HASH }

test('a changed user stops a read, and the notice can be acknowledged', ackRig(async (_home, call) => {
  const result = await call(stamped({ orgId: ORG }, null))
  assert.equal(result.ok, false)
  assert.equal(result.issue?.kind, 'user-changed-on-read')
  assert.equal(result.canContinue, true)
}))

test('an acknowledgement from the stamp lets that one read go on', ackRig(async (_home, call) => {
  const result = await call(stamped({ orgId: ORG }, GOOD_ACK))
  assert.equal(result.ok, true, JSON.stringify(result))
}))

test('the next call with no acknowledgement stops again, so it is single use', ackRig(async (_home, call) => {
  assert.equal((await call(stamped({ orgId: ORG }, GOOD_ACK))).ok, true)
  assert.equal((await call(stamped({ orgId: ORG }, null))).ok, false)
}))

for (const [name, ack] of [
  ['another kind', { ...GOOD_ACK, kind: 'stale-verification' }],
  ['another org', { ...GOOD_ACK, orgId: '00D000000000099AAA' }],
  ['another user', { ...GOOD_ACK, user: 'someone.else@example.com' }],
  ['another identity', { ...GOOD_ACK, orgIdentityHash: `${ORG}|${USERNAME}|production` }],
] as const) {
  test(`an acknowledgement for ${name} does not count`, ackRig(async (_home, call) => {
    assert.equal((await call(stamped({ orgId: ORG }, ack))).ok, false)
  }))
}

test('an org id change cannot be acknowledged, even with a matching kind', withHome(async home => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
  const result = await callTool(adapter, 'org_inspect', stamped({ orgId: ORG }, { ...GOOD_ACK, kind: 'org-id-mismatch' }), contextFor(home, { hookHost: true }))
  assert.equal(result.ok, false)
  assert.equal(result.issue?.kind, 'org-id-mismatch')
  assert.equal(result.canContinue, false)
}, { scenario: { org: { Id: '00D000000000099AAA' } } }))

test('an unknown result cannot be acknowledged, even with a matching kind', withHome(async home => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
  const result = await callTool(adapter, 'org_inspect', stamped({ orgId: ORG }, { ...GOOD_ACK, kind: 'unknown' }), contextFor(home, { hookHost: true }))
  assert.equal(result.ok, false)
  assert.equal(result.issue?.kind, 'unknown')
  assert.equal(result.canContinue, false)
}, { scenario: { user: { IsActive: false } } }))

test('on a host with no hooks an acknowledgement is one more forged stamp', ackRig(async (_home, call) => {
  const result = await call(stamped({ orgId: ORG }, GOOD_ACK), false)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /host with no hooks/)
}))

test('an acknowledgement in the arguments is not accepted', ackRig(async (_home, call) => {
  const result = await call({ orgId: ORG, ack: GOOD_ACK, acknowledgement: GOOD_ACK }, false)
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /not accepted/)
}))

test('nothing in the store grants one', ackRig(async (home, call) => {
  const { storeSet } = await import('./store.js')
  storeSet(home.store, sessionKey(home.project), { identity: null, issue: null, orgIdentityHash: IDENTITY_HASH, checkedAt: AT, writeWarning: null, ack: GOOD_ACK, acknowledged: true })
  assert.equal((await call(stamped({ orgId: ORG }, null))).ok, false)
}))

// ── ack-check ──

test('ack-check passes when the org is what was registered', withHome(home => {
  assert.equal(runner(home, 'ack-check', { orgId: ORG, kind: 'report-row-cap' }).ok, true)
}))

for (const kind of ['unknown', 'org-id-mismatch', 'plan-bound-to-different-org', 'nonsense', 5]) {
  test(`ack-check refuses ${String(kind)} before it reads anything`, withHome(home => {
    assert.equal(runner(home, 'ack-check', { orgId: ORG, kind }).ok, false)
    assert.equal(fakeCalls(home).length, 0)
  }))
}

test('a notice stored as continuable is refused when the org has since moved', withHome(home => {
  const reply = runner(home, 'ack-check', { orgId: ORG, kind: 'report-row-cap' })
  assert.equal(reply.ok, false)
  assert.match(String(reply.reason), /org id/)
}, { scenario: { org: { Id: '00D000000000099AAA' } } }))

test('an unexplained failure is not a pass', withHome(home => {
  assert.equal(runner(home, 'ack-check', { orgId: ORG, kind: 'report-row-cap' }).ok, false)
}, { scenario: { mode: 'unexplained' } }))

test('an expired login can acknowledge only an expired-login notice', withHome(home => {
  assert.equal(runner(home, 'ack-check', { orgId: ORG, kind: 'expired-auth' }).ok, true)
  assert.equal(runner(home, 'ack-check', { orgId: ORG, kind: 'report-row-cap' }).ok, false)
}, { scenario: { mode: 'expired-auth' } }))

test('in a project that is off, ack-check refuses', withHome(home => {
  assert.equal(runner(home, 'ack-check', { orgId: ORG, kind: 'report-row-cap' }).ok, false)
}, { register: false }))

// ── a notice on a good result ──

const REPORT = '00O000000000001AAA'
const PARTIAL_REPORT = {
  rest: {
    [`/services/data/v66.0/analytics/reports/${REPORT}?includeDetails=true`]: {
      body: {
        allData: false,
        factMap: { 'T!T': { rows: [{ dataCells: [{ value: 'a00000000000001AAA' }] }], aggregates: [{ value: 1 }] } },
        reportMetadata: { id: REPORT, name: 'Widgets', detailColumns: ['Widget__c.Id'], aggregates: ['RowCount'] },
        reportExtendedMetadata: { detailColumnInfo: { 'Widget__c.Id': { label: 'Id', dataType: 'id' } } },
      },
    },
  },
  queries: [{ match: 'SELECT COUNT', result: countRows(1) }],
}

test('a notice on a good result reaches the band, with an id for this occurrence', withHome(async home => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
  const { briefId } = proposeBrief(home.store, home.project, BRIEF, AT)
  const result = await callTool(adapter, 'reports_run', { orgId: ORG, reportId: REPORT, briefId }, contextFor(home))
  assert.equal(result.ok, true)
  assert.equal(result.issue?.kind, 'report-row-cap')
  assert.notEqual(result.issue?.id, 'report-row-cap', 'one notice of a kind is not every notice of that kind')
  const session = storeGet(home.store, sessionKey(home.project)) as { issue: { id: string } | null; identity: unknown }
  assert.equal(session.issue?.id, result.issue?.id)
  assert.notEqual(session.identity, null, 'the identity on the band is still the live one')
  assert.equal(showsContinue('report-row-cap'), true)
  assert.match(noticeText(result.issue as never), /part of this report/i)
}, { scenario: PARTIAL_REPORT }))

test('the next clean read clears the notice off the band', withHome(async home => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
  const { briefId } = proposeBrief(home.store, home.project, BRIEF, AT)
  await callTool(adapter, 'reports_run', { orgId: ORG, reportId: REPORT, briefId }, contextFor(home))
  await callTool(adapter, 'org_inspect', { orgId: ORG }, contextFor(home))
  assert.equal((storeGet(home.store, sessionKey(home.project)) as { issue: unknown }).issue, null)
}, { scenario: PARTIAL_REPORT }))

test('org text behind a blocked result is marked as org text', withHome(async home => {
  const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
  const result = await callTool(adapter, 'org_inspect', { orgId: ORG }, contextFor(home))
  assert.equal(result.ok, false)
  assert.equal(result.untrusted, true)
}, { scenario: { mode: 'unexplained' } }))
