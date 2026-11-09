import assert from 'node:assert/strict'
import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { proposeBrief } from './brief.js'
import { appendJournal, bindLiterals, readAllJournals, readJournal } from './journal.js'
import { UnreadableFileError } from './json-file.js'
import { sweepProjectLogs } from './log-retention.js'
import { journalDirectory, localDirectory } from './paths.js'
import { SfCliAdapter } from './sf-adapter.js'
import { baseScenario, contextFor, fakeHome, ORG, registerFake, tempPair, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'

const AT = '2026-06-01T00:00:00.000Z'
const DAY = 24 * 60 * 60 * 1000

function line(over: Record<string, unknown> = {}): Parameters<typeof appendJournal>[1] {
  return { event: 'query.executed', correlationId: 'c1', projectRoot: '/x', orgId: ORG, mode: 'read-only', at: AT, ...over }
}

// ── binds ──

for (const [name, soql, kept] of [
  ['a string', "SELECT Id FROM Widget__c WHERE Name = 'Ada Example'", "SELECT Id FROM Widget__c WHERE Name = :b"],
  ['an escaped quote', "SELECT Id FROM Widget__c WHERE Name = 'O\\'Brien' AND Id != null", 'SELECT Id FROM Widget__c WHERE Name = :b AND Id != null'],
  ['a list', "SELECT Id FROM Widget__c WHERE Id IN ('a', 'b')", 'SELECT Id FROM Widget__c WHERE Id IN (:b, :b)'],
  ['a number', 'SELECT Id FROM Widget__c WHERE Amount__c > 5000', 'SELECT Id FROM Widget__c WHERE Amount__c > :b'],
  ['a negative number', 'SELECT Id FROM Widget__c WHERE Amount__c <= -1.5', 'SELECT Id FROM Widget__c WHERE Amount__c <= :b'],
  ['a date', 'SELECT Id FROM Widget__c WHERE Birthdate__c = 1990-01-01', 'SELECT Id FROM Widget__c WHERE Birthdate__c = :b'],
  ['a date and time', 'SELECT Id FROM Widget__c WHERE CreatedDate >= 2026-01-01T00:00:00Z', 'SELECT Id FROM Widget__c WHERE CreatedDate >= :b'],
  ['a boolean', 'SELECT Id FROM Widget__c WHERE IsDeleted = true', 'SELECT Id FROM Widget__c WHERE IsDeleted = :b'],
] as const) {
  test(`the journal binds ${name}`, () => {
    assert.equal(bindLiterals(soql), kept)
  })
}

test('binds already there, null, and the bound on rows stay', () => {
  const text = 'SELECT COUNT() FROM Widget__c WHERE Status__c = :b0 AND Name != null LIMIT 10'
  assert.equal(bindLiterals(text), text)
})

test('the journal binds literals itself, whatever a caller passes', () => {
  const pair = tempPair()
  try {
    appendJournal(pair.root, line({ projectRoot: pair.root, soql: "SELECT Id FROM Widget__c WHERE Email__c = 'ada@example.com' AND Amount__c > 5" }))
    const [stored] = readJournal(pair.root, 'c1')
    assert.equal(stored?.soql, 'SELECT Id FROM Widget__c WHERE Email__c = :b AND Amount__c > :b')
  } finally {
    pair.cleanup()
  }
})

// ── notes ──

test('a note loses what was quoted in it, and one that looks personal is not kept', () => {
  const pair = tempPair()
  try {
    appendJournal(pair.root, line({ projectRoot: pair.root, note: "That is not a field name: 'Ada Example'." }))
    appendJournal(pair.root, line({ projectRoot: pair.root, note: 'Registered ada@example.com' }))
    const lines = readJournal(pair.root, 'c1')
    assert.equal(JSON.stringify(lines).includes('Ada Example'), false)
    assert.equal(JSON.stringify(lines).includes('ada@example.com'), false)
  } finally {
    pair.cleanup()
  }
})

function rig(body: (home: FakeHome, call: (name: string, args: unknown) => Promise<ToolResult>, briefId: string) => Promise<void>, scenario: Record<string, unknown> = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario(scenario))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId } = proposeBrief(home.store, home.project, { objective: 'x', environment: '', subjects: [], change: '', blockingQuestions: [] }, AT)
      await body(home, (name, args) => callTool(adapter, name, args, contextFor(home)), briefId)
    } finally {
      home.cleanup()
    }
  }
}

test('a refused query is recorded, without the text the model sent', rig(async (home, call, briefId) => {
  const result = await call('records_query', { orgId: ORG, briefId, object: 'Widget__c', fields: ['Ada Example, born 1990'], limit: 5 })
  assert.equal(result.ok, false)
  assert.match(JSON.stringify(result.data), /not a field name/)
  const lines = readJournal(home.project, 'corr-1')
  assert.deepEqual(lines.map(item => item.event), ['refusal'])
  assert.equal(JSON.stringify(lines).includes('Ada Example'), false)
  assert.equal(JSON.stringify(lines).includes('1990'), false)
}))

test('a refused filter is recorded, without its value', rig(async (home, call, briefId) => {
  await call('records_query', { orgId: ORG, briefId, object: 'Widget__c', fields: ['Id'], where: [{ field: 'Contact_Email__c', op: 'eq', value: 'cara@example.com' }], limit: 5 })
  const text = JSON.stringify(readJournal(home.project, 'corr-1'))
  assert.equal(text.includes('cara'), false)
  assert.match(text, /refusal/)
}))

test('a refusal from an unforeseen error is recorded with no detail', rig(async (home, call, briefId) => {
  writeFileSync(join(home.project, 'x'), '')
  const original = JSON.stringify(readJournal(home.project, 'corr-1'))
  assert.equal(original, '[]')
  await call('metadata_diff', { orgId: ORG, briefId, members: ['ApexClass:Ada Example'], otherOrgId: ORG })
  assert.equal(JSON.stringify(readJournal(home.project, 'corr-1')).includes('Ada Example'), false)
}))

test('schema_describe records nothing it was asked to look up', rig(async (home, call) => {
  await call('schema_describe', { orgId: ORG, purpose: 'candidate', text: 'Ada Example' })
  assert.equal(JSON.stringify(readJournal(home.project, 'corr-1')).includes('Ada Example'), false)
}, { queries: [{ match: 'FROM EntityDefinition', result: { records: [], totalSize: 0, done: true } }] }))

// ── reading it all ──

test('reading every journal returns every line, and an unreadable file throws', () => {
  const pair = tempPair()
  try {
    assert.deepEqual(readAllJournals(pair.root), [])
    appendJournal(pair.root, line({ projectRoot: pair.root, correlationId: 'c1' }))
    appendJournal(pair.root, line({ projectRoot: pair.root, correlationId: 'c2' }))
    assert.equal(readAllJournals(pair.root).length, 2)
    writeFileSync(join(journalDirectory(pair.root), 'c3.jsonl'), '{"event":\n')
    assert.throws(() => readAllJournals(pair.root), UnreadableFileError)
  } finally {
    pair.cleanup()
  }
})

// ── retention ──

test('journal files and the local store get the 30-day sweep', () => {
  const pair = tempPair()
  try {
    const now = Date.parse(AT)
    const dirs = [journalDirectory(pair.root), localDirectory(pair.store, pair.root, 'briefs'), localDirectory(pair.store, pair.root, 'plans'), localDirectory(pair.store, pair.root, 'practice')]
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true })
      for (const [name, age] of [['old.json', 31], ['young.json', 29]] as const) {
        writeFileSync(join(dir, name), '{}\n')
        utimesSync(join(dir, name), new Date(now - age * DAY), new Date(now - age * DAY))
      }
    }
    sweepProjectLogs(pair.store, pair.root, now)
    for (const dir of dirs) {
      assert.equal(existsSync(join(dir, 'old.json')), false, dir)
      assert.equal(existsSync(join(dir, 'young.json')), true, dir)
    }
  } finally {
    pair.cleanup()
  }
})
