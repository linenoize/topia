import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proposeBrief } from './brief.js'
import { LOCAL_WRITE_TOOLS } from './contract.js'
import { readAllJournals } from './journal.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY } from './stamp.js'
import { baseScenario, contextFor, dependencyQueries, fakeCalls, fakeHome, fakeWrites, ORG, queryRows, registerFake, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'

type Report = {
  advisory: boolean
  component: { type: string; name: string }
  usedBy: { type: string; name: string; namespace: string | null }[]
  uses: { type: string; name: string; namespace: string | null }[]
  coverage: { direction: string; state: string; rows: number; detail?: string }[]
  partial: boolean
  blindSpots: string[]
  notes: string[]
}

const CLASS = { componentType: 'ApexClass', componentName: 'WidgetService' }

function rig(body: (home: FakeHome, call: (args?: Record<string, unknown>) => Promise<ToolResult>) => Promise<void>, scenario: Record<string, unknown> = { queries: dependencyQueries() }): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario(scenario))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'What uses WidgetService', environment: 'Sandbox', subjects: [], change: '', blockingQuestions: [] }, '2026-06-01T00:00:00.000Z')
      const stamp = { mode: 'investigate', agentId: null, confirmedBriefHash: briefHash, ack: null }
      await body(home, (args = {}) => callTool(adapter, 'dependency_report', { orgId: ORG, briefId, ...CLASS, ...args, [STAMP_KEY]: stamp }, contextFor(home, { hookHost: true })))
    } finally {
      home.cleanup()
    }
  }
}

function report(result: ToolResult): Report {
  return result.data as Report
}

function dependencyCalls(home: FakeHome) {
  return fakeCalls(home).filter(call => (call.soql ?? '').includes('MetadataComponentDependency'))
}

function assertAdvisory(body: Report): void {
  assert.equal(body.advisory, true)
  assert.ok(body.blindSpots.some(item => /dynamic references/i.test(item)), 'names dynamic references')
  assert.ok(body.blindSpots.some(item => /2,000 rows/.test(item)), 'names the row limit')
  assert.ok(body.notes.some(item => /not a full impact analysis/i.test(item)))
}

test('both directions come through Tooling SOQL, from a closed query, and every result says it is advisory', rig(async (home, call) => {
  const result = await call()
  assert.equal(result.ok, true, JSON.stringify(result))
  const body = report(result)
  assertAdvisory(body)
  assert.deepEqual(body.component, { type: 'ApexClass', name: 'WidgetService' })
  assert.deepEqual(body.usedBy, [{ type: 'ApexTrigger', name: 'WidgetTrigger', namespace: null }])
  assert.deepEqual(body.uses, [{ type: 'CustomObject', name: 'Widget__c', namespace: null }])
  assert.equal(body.partial, false)
  const calls = dependencyCalls(home)
  assert.equal(calls.length, 2)
  for (const item of calls) {
    assert.equal(item.flags['use-tooling-api'], true)
    assert.match(item.soql ?? '', /LIMIT 2000\s*$/)
  }
  assert.match(calls[0]?.soql ?? '', /WHERE RefMetadataComponentType = 'ApexClass' AND RefMetadataComponentName = 'WidgetService'/)
  assert.match(calls[1]?.soql ?? '', /WHERE MetadataComponentType = 'ApexClass' AND MetadataComponentName = 'WidgetService'/)
  assert.equal(result.sideEffect, false)
  assert.equal(fakeWrites(home).length, 0)
}))

test('it asks only for the direction named', rig(async (home, call) => {
  const body = report(await call({ direction: 'used-by' }))
  assert.equal(dependencyCalls(home).length, 1)
  assert.deepEqual(body.coverage.map(item => item.direction), ['used-by'])
  assert.deepEqual(body.uses, [])
}))

test('nothing found says that is not proof of nothing, and stays advisory', rig(async (_home, call) => {
  const body = report(await call())
  assertAdvisory(body)
  assert.deepEqual(body.usedBy, [])
  assert.ok(body.notes.some(item => /empty list isn't proof/i.test(item)))
}, { queries: [{ match: 'FROM MetadataComponentDependency', tooling: true, result: queryRows([], 'MetadataComponentDependency') }] }))

test('a list that reached the row limit is partial, and the issue says so', rig(async (_home, call) => {
  const result = await call()
  const body = report(result)
  assert.equal(body.partial, true)
  assert.equal(body.coverage.find(item => item.direction === 'used-by')?.state, 'cut-at-limit')
  assert.equal(result.issue?.kind, 'partial-dependency-coverage')
  assertAdvisory(body)
}, { queries: dependencyQueries({ usedByRows: 2000 }) }))

test('a result the org cut short is partial', rig(async (_home, call) => {
  const body = report(await call())
  assert.equal(body.partial, true)
  assert.equal(body.coverage.find(item => item.direction === 'uses')?.state, 'cut-at-limit')
}, { queries: [{ match: 'FROM MetadataComponentDependency WHERE MetadataComponent', tooling: true, result: { records: [], totalSize: 5, done: false }, warnings: ['more'] }, ...dependencyQueries()] }))

test('one direction denied stays partial, keeps the other, and names which', rig(async (_home, call) => {
  const result = await call()
  const body = report(result)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(body.partial, true)
  assert.equal(result.issue?.kind, 'partial-dependency-coverage')
  assert.equal(body.coverage.find(item => item.direction === 'uses')?.state, 'failed')
  assert.equal(body.coverage.find(item => item.direction === 'used-by')?.state, 'read')
  assert.equal(body.usedBy.length, 1)
  assert.ok(body.blindSpots.some(item => /what it uses/i.test(item)))
}, { queries: [{ match: 'FROM MetadataComponentDependency WHERE MetadataComponent', tooling: true, error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }, ...dependencyQueries()] }))

test('both denied is a refusal from the org, never an empty result', rig(async (_home, call) => {
  const result = await call()
  assert.equal(result.ok, false)
  assert.equal((result.data as { access?: string }).access, 'denied')
}, { queries: [{ match: 'FROM MetadataComponentDependency', tooling: true, error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }] }))

test('output that does not parse is never read as nothing found', rig(async (_home, call) => {
  const result = await call()
  assert.equal(result.ok, false)
  assert.equal(result.issue?.kind, 'unknown')
}, { queries: dependencyQueries(), mode: 'malformed', modeOn: 'FROM MetadataComponentDependency' }))

test('a row in a shape nobody expected makes the list partial, and is not shown as a blank', rig(async (_home, call) => {
  const body = report(await call())
  assert.equal(body.partial, true)
  assert.equal(body.coverage.find(item => item.direction === 'used-by')?.state, 'unreadable-rows')
  assert.equal(body.usedBy.length, 0)
}, { queries: [{ match: 'FROM MetadataComponentDependency WHERE RefMetadataComponent', tooling: true, result: queryRows([{ MetadataComponentName: 42 }], 'MetadataComponentDependency') }, ...dependencyQueries()] }))

test('the path is closed: no free text, and nothing that could leave a literal', rig(async (home, call) => {
  for (const bad of [{ componentName: "x' OR Name != '" }, { componentName: 'a b' }, { componentType: "ApexClass'" }, { componentType: 'Apex Class' }, { soql: 'SELECT Id FROM User' }, { where: [] }, { direction: 'sideways' }, { limit: 1 }]) {
    const result = await call(bad)
    assert.equal(result.ok, false, JSON.stringify(bad))
  }
  assert.equal(dependencyCalls(home).length, 0)
}))

test('a long list is cut for the result, and says how many it held', rig(async (_home, call) => {
  const result = await call()
  const body = report(result) as Report & { listedAtMost: number; usedByTotal: number }
  assert.equal(body.usedBy.length, body.listedAtMost)
  assert.equal(body.usedByTotal, 500)
  assert.equal(body.partial, false, 'every row was read, and only the list in this result is shorter')
}, { queries: dependencyQueries({ usedByRows: 500 }) }))

test('a query is journaled with binds, and no literal', rig(async (home, call) => {
  await call()
  const soql = readAllJournals(home.project).filter(line => line.event === 'query.executed').map(line => line.soql ?? '')
  assert.ok(soql.some(item => item.includes('MetadataComponentDependency')))
  assert.equal(soql.some(item => item.includes('WidgetService')), false)
}))

test('it reads only: it is not on the list of tools that write locally, and it needs a brief', rig(async (_home, call) => {
  assert.equal(LOCAL_WRITE_TOOLS.includes('dependency_report'), false)
  const refused = await call({ briefId: undefined })
  assert.equal(refused.ok, false)
  assert.match(JSON.stringify(refused.data), /briefId/)
}))
