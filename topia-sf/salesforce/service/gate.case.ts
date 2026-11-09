import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { proposeBrief, readBrief, briefFileFor, type BriefInput } from './brief.js'
import { readJournal } from './journal.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY, stampInput, takeStamp, withoutStamp } from './stamp.js'
import { baseScenario, contextFor, countRows, fakeCalls, fakeHome, ORG, queryRows, registerFake, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'

const BRIEF: BriefInput = { objective: 'How many Widget__c are new?', environment: 'Sandbox Acme Sales', subjects: [{ name: 'Widget__c', status: 'known' }], change: '', blockingQuestions: [] }
const QUERY = { orgId: ORG, object: 'Widget__c', fields: ['Id'], limit: 5 }
const SCENARIO = {
  queries: [
    { match: 'SELECT COUNT', result: countRows(1) },
    { match: 'SELECT Id FROM Widget__c', result: queryRows([{ Id: 'a00000000000001AAA' }]) },
    { match: 'FROM User WHERE Name', result: queryRows([{ Id: '00500000000000AAAA', Name: 'Ada Example', Username: 'ada@example.com', IsActive: true, Profile: null }], 'User') },
    { match: 'FROM EntityDefinition', result: queryRows([{ QualifiedApiName: 'Widget__c', Label: 'Widget' }], 'EntityDefinition') },
  ],
}
const NOW = '2026-06-01T00:00:00.000Z'

type Call = (name: string, args: unknown, options?: { hookHost?: boolean }) => Promise<ToolResult>

function rig(body: (home: FakeHome, call: Call, brief: { briefId: string; briefHash: string }) => Promise<void>): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario(SCENARIO))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const brief = proposeBrief(home.store, home.project, BRIEF, NOW)
      await body(home, (name, args, options) => callTool(adapter, name, args, contextFor(home, { hookHost: options?.hookHost ?? true })), brief)
    } finally {
      home.cleanup()
    }
  }
}

function stamped(args: Record<string, unknown>, over: { mode?: unknown; agentId?: unknown; confirmedBriefHash?: unknown } = {}): Record<string, unknown> {
  return { ...args, [STAMP_KEY]: { mode: 'investigate', agentId: null, confirmedBriefHash: null, ack: null, ...over } }
}

function orgCalls(home: FakeHome): number {
  return fakeCalls(home).filter(item => item.command !== 'version').length
}

// ── brief_propose ──

test('a proposed brief comes back with an id and a hash the code computed', rig(async (_home, call) => {
  const result = await call('brief_propose', BRIEF)
  assert.equal(result.ok, true, JSON.stringify(result))
  const data = result.data as { briefId: string; briefHash: string; confirmed: boolean }
  assert.match(data.briefId, /^brief-[a-f0-9]{16}$/)
  assert.match(data.briefHash, /^[a-f0-9]{64}$/)
  assert.equal(data.confirmed, false)
}))

for (const field of ['briefHash', 'hash', 'status', 'approver', 'confirmed', 'briefId_']) {
  test(`the model cannot set ${field} on a brief`, rig(async (home, call) => {
    const result = await call('brief_propose', { ...BRIEF, [field]: 'x' })
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result.data), /not accepted/)
    assert.equal(orgCalls(home), 0)
  }))
}

test('canonical: the same brief, spaced differently, has the same hash', rig(async home => {
  const one = proposeBrief(home.store, home.project, BRIEF, NOW)
  const two = proposeBrief(home.store, home.project, { ...BRIEF, objective: `  ${BRIEF.objective}\n ` }, '2026-06-02T00:00:00.000Z')
  assert.equal(one.briefHash, two.briefHash)
  assert.equal(one.briefId, two.briefId)
  assert.notEqual(proposeBrief(home.store, home.project, { ...BRIEF, objective: 'Something else' }, NOW).briefHash, one.briefHash)
}))

test('a brief lives off the repo, in the local store', rig(async (home, call) => {
  await call('brief_propose', { ...BRIEF, objective: 'Find what Ada Example changed' })
  const dir = join(home.project, '.topia')
  const everything = existsSync(dir) ? JSON.stringify(readdirSync(dir, { recursive: true })) : ''
  assert.equal(everything.includes('brief-'), false)
  for (const name of existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }) : []) {
    if (name.isFile()) assert.equal(readFileSync(join(name.parentPath, name.name), 'utf8').includes('Ada Example'), false, name.name)
  }
}))

test('reading a brief recomputes its hash from what is on disk', rig(async (home, _call, brief) => {
  assert.equal(readBrief(home.store, home.project, brief.briefId)?.briefHash, brief.briefHash)
  const file = briefFileFor(home.store, home.project, brief.briefId)
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { brief: BriefInput }
  stored.brief.objective = 'Delete every Widget__c'
  writeFileSync(file, JSON.stringify(stored))
  assert.notEqual(readBrief(home.store, home.project, brief.briefId)?.briefHash, brief.briefHash)
}))

test('a missing brief is null and an unreadable one throws', rig(async (home, _call, brief) => {
  assert.equal(readBrief(home.store, home.project, 'brief-0000000000000000'), null)
  writeFileSync(briefFileFor(home.store, home.project, brief.briefId), '{"brief":')
  assert.throws(() => readBrief(home.store, home.project, brief.briefId), /Cannot read/)
}))

// ── with a stamp ──

test('with a stamp, an unconfirmed brief is refused, journaled, and reaches no org', rig(async (home, call, brief) => {
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }))
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /sf_brief_confirm/)
  assert.equal(orgCalls(home), 0)
  const lines = readJournal(home.project, 'corr-1')
  assert.deepEqual(lines.map(line => line.event), ['refusal'])
  assert.match(String(lines[0]?.note), /not confirmed|isn't confirmed/)
}))

test('with a stamp, a confirmed brief runs and says so', rig(async (home, call, brief) => {
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { confirmedBriefHash: brief.briefHash }))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.briefConfirmed, true)
  assert.ok(orgCalls(home) > 0)
}))

test('a confirmation for another brief does not count', rig(async (home, call, brief) => {
  const other = proposeBrief(home.store, home.project, { ...BRIEF, objective: 'Something else' }, NOW)
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { confirmedBriefHash: other.briefHash }))
  assert.equal(result.ok, false)
  assert.equal(orgCalls(home), 0)
}))

test('editing a confirmed brief voids it', rig(async (home, call, brief) => {
  const file = briefFileFor(home.store, home.project, brief.briefId)
  const stored = JSON.parse(readFileSync(file, 'utf8')) as { brief: BriefInput }
  stored.brief.change = 'Delete every Widget__c'
  writeFileSync(file, JSON.stringify(stored))
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { confirmedBriefHash: brief.briefHash }))
  assert.equal(result.ok, false)
  assert.equal(orgCalls(home), 0)
}))

test('with a stamp and no briefId, the call is refused', rig(async (home, call) => {
  const result = await call('records_query', stamped(QUERY))
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /brief_propose/)
  assert.equal(orgCalls(home), 0)
}))

test('a brief that does not exist is refused', rig(async (home, call) => {
  const result = await call('records_query', stamped({ ...QUERY, briefId: 'brief-0000000000000000' }, { confirmedBriefHash: 'a'.repeat(64) }))
  assert.equal(result.ok, false)
  assert.equal(orgCalls(home), 0)
}))

test('an unreadable brief is refused', rig(async (home, call, brief) => {
  writeFileSync(briefFileFor(home.store, home.project, brief.briefId), '{"brief":')
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { confirmedBriefHash: brief.briefHash }))
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /Cannot read/)
  assert.equal(orgCalls(home), 0)
}))

test('a candidate lookup runs before confirmation, and returns a list', rig(async (_home, call) => {
  const users = await call('users_resolve', stamped({ orgId: ORG, text: 'Ada' }))
  assert.equal(users.ok, true, JSON.stringify(users))
  assert.equal((users.data as { picked: unknown }).picked, null)
  const objects = await call('schema_describe', stamped({ orgId: ORG, purpose: 'candidate', text: 'Widget' }))
  assert.equal(objects.ok, true, JSON.stringify(objects))
  assert.equal((objects.data as { picked: unknown }).picked, null)
}))

test('schema_describe past a candidate lookup is an investigation, and needs the brief', rig(async (home, call) => {
  const result = await call('schema_describe', stamped({ orgId: ORG, object: 'Widget__c' }))
  assert.equal(result.ok, false)
  assert.equal(fakeCalls(home).filter(item => item.command === 'sobject describe').length, 0)
}))

test('the identity check needs no brief', rig(async (_home, call) => {
  const result = await call('org_inspect', stamped({ orgId: ORG }))
  assert.equal(result.ok, true, JSON.stringify(result))
}))

// ── with no stamp ──

test('with no stamp the call runs read-only and says the brief is not confirmed', rig(async (_home, call, brief) => {
  const result = await call('records_query', { ...QUERY, briefId: brief.briefId }, { hookHost: false })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.briefConfirmed, false)
  assert.equal(result.mode, 'read-only')
}))

test('with no stamp a brief is still required, so the request gets clarified', rig(async (home, call) => {
  const result = await call('records_query', QUERY, { hookHost: false })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /brief_propose/)
  assert.equal(orgCalls(home), 0)
}))

test('a hook host that skipped the stamp gets the same read-only answer, and nothing more', rig(async (_home, call, brief) => {
  const result = await call('records_query', { ...QUERY, briefId: brief.briefId }, { hookHost: true })
  assert.equal(result.ok, true)
  assert.equal(result.briefConfirmed, false)
  assert.equal(result.mode, 'read-only')
}))

// ── forged stamps ──

test('a host with no hooks has no stamps, so any stamp there is forged, refused, and journaled', rig(async (home, call, brief) => {
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { mode: 'execute', confirmedBriefHash: brief.briefHash }), { hookHost: false })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /stamp/)
  assert.equal(orgCalls(home), 0)
  assert.deepEqual(readJournal(home.project, 'corr-1').map(line => line.event), ['refusal'])
}))

for (const [name, stamp] of [
  ['a string', 'execute'],
  ['a list', []],
  ['an unknown mode', { mode: 'admin', agentId: null, confirmedBriefHash: null, ack: null }],
  ['a short hash', { mode: 'plan', agentId: null, confirmedBriefHash: 'abc', ack: null }],
  ['a numeric agent', { mode: 'plan', agentId: 5, confirmedBriefHash: null, ack: null }],
  ['an extra field', { mode: 'plan', agentId: null, confirmedBriefHash: null, ack: null, approved: true }],
] as const) {
  test(`a malformed stamp is refused, never read as no stamp: ${name}`, rig(async (home, call, brief) => {
    const result = await call('records_query', { ...QUERY, briefId: brief.briefId, [STAMP_KEY]: stamp })
    assert.equal(result.ok, false)
    assert.match(JSON.stringify(result.data), /stamp/)
    assert.equal(orgCalls(home), 0)
  }))
}

test('fields the model sends at the top level get it nowhere', rig(async (home, call, brief) => {
  for (const extra of [{ mode: 'execute' }, { confirmedBriefHash: brief.briefHash }, { briefConfirmed: true }, { agentId: null }]) {
    const result = await call('records_query', { ...QUERY, briefId: brief.briefId, ...extra }, { hookHost: false })
    assert.equal(result.ok, false, JSON.stringify(extra))
    assert.match(JSON.stringify(result.data), /not accepted/)
  }
  assert.equal(orgCalls(home), 0)
}))

// ── what the hook does to the input ──

test('the stamp overwrites anything the model sent', () => {
  const sent = { tool: 'x', orgId: ORG, mode: 'execute', confirmedBriefHash: 'forged', briefConfirmed: true, ack: { kind: 'unknown' }, [STAMP_KEY]: { mode: 'execute', agentId: null, confirmedBriefHash: 'forged', ack: null } }
  const out = stampInput(sent, { mode: 'read-only', agentId: null, confirmedBriefHash: null, ack: null })
  assert.deepEqual(out[STAMP_KEY], { mode: 'read-only', agentId: null, confirmedBriefHash: null, ack: null })
  assert.equal('mode' in out, false)
  assert.equal('confirmedBriefHash' in out, false)
  assert.equal('briefConfirmed' in out, false)
  assert.equal('ack' in out, false)
  assert.equal(out.orgId, ORG)
  assert.equal(out.tool, 'x')
})

test('a headless session sends no stamp at all, and what the model sent is dropped', () => {
  const out = withoutStamp({ tool: 'x', orgId: ORG, mode: 'execute', [STAMP_KEY]: { mode: 'execute' } })
  assert.equal(STAMP_KEY in out, false)
  assert.equal('mode' in out, false)
  assert.equal(out.orgId, ORG)
})

test('takeStamp splits the stamp from the arguments', () => {
  const stamp = { mode: 'plan', agentId: null, confirmedBriefHash: null, ack: null }
  const taken = takeStamp({ orgId: ORG, [STAMP_KEY]: stamp }, true)
  assert.deepEqual(taken.stamp, stamp)
  assert.deepEqual(taken.args, { orgId: ORG })
  assert.equal(taken.problem, null)
  assert.deepEqual(takeStamp({ orgId: ORG }, true), { stamp: null, args: { orgId: ORG }, problem: null })
  assert.equal(takeStamp({ orgId: ORG }, false).stamp, null)
  assert.match(String(takeStamp({ [STAMP_KEY]: stamp }, false).problem), /stamp/)
  assert.equal(takeStamp({ [STAMP_KEY]: stamp }, false).stamp, null)
})

test('a stamp with no mode is read-only, not an error', () => {
  const taken = takeStamp({ [STAMP_KEY]: { agentId: null, confirmedBriefHash: null, ack: null } }, true)
  assert.equal(taken.problem, null)
  assert.equal(taken.stamp?.mode, 'read-only')
})

// ── mode on the server ──

test('the stamped mode is what the result and the journal say', rig(async (home, call, brief) => {
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { mode: 'plan', confirmedBriefHash: brief.briefHash }))
  assert.equal(result.mode, 'plan')
  const lines = readJournal(home.project, 'corr-1')
  assert.ok(lines.length > 0)
  for (const line of lines) assert.equal(line.mode, 'plan')
}))

test('a subagent is read-only, whatever mode came with it', rig(async (_home, call, brief) => {
  const result = await call('records_query', stamped({ ...QUERY, briefId: brief.briefId }, { mode: 'plan', agentId: 'agent-1', confirmedBriefHash: brief.briefHash }))
  assert.equal(result.mode, 'read-only')
}))

test('the read-only row still reaches the identity check', rig(async (_home, call) => {
  const result = await call('org_inspect', stamped({ orgId: ORG }, { mode: 'read-only' }))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.mode, 'read-only')
}))
