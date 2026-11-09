import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proposeBrief } from './brief.js'
import { to18 } from './identity.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY } from './stamp.js'
import { baseScenario, contextFor, DESCRIBE_WIDGET, fakeCalls, fakeHome, fakeWrites, ORG, registerFake, USER_ID, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'

const NOW = Date.parse('2026-06-01T00:00:00.000Z')
const IDS = ['a00000000000001AAA', 'a00000000000002AAA', 'a00000000000003AAA']
const MODSTAMP = '2026-05-01T00:00:00.000+0000'
const NOT_CHECKED = ['validation-rules', 'triggers', 'flows', 'duplicate-rules', 'assignment-rules', 'restriction-rules', 'sends']

function records(ids: string[] = IDS): Record<string, Record<string, unknown>> {
  return Object.fromEntries(ids.map(id => [id, { Id: id, SystemModstamp: MODSTAMP, Status__c: 'New', Name: `Name of ${id}`, Contact_Email__c: 'grace@example.com' }]))
}

type Preview = {
  checked: string[]
  not_checked: string[]
  automation: string[]
  count: number
  found: number
  missing: string[]
  blockers: string[]
  notes: string[]
  recordAccess: { chunks: number; editable: number; notEditable: string[]; note: string } | null
  fields: { field: string; exists: boolean; updateable: boolean }[]
  objectCrud: { updateable: boolean; deletable: boolean }
}

type Rig = { home: FakeHome; preview: (over?: Record<string, unknown>, stamp?: Record<string, unknown> | null) => Promise<ToolResult>; briefHash: string }

function rig(body: (rig: Rig) => Promise<void>, scenario: Record<string, unknown> = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario({ records: { Widget__c: records() }, ...scenario }))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'Close old Widget__c', environment: 'Sandbox', subjects: [], change: 'Status__c', blockingQuestions: [] }, new Date(NOW).toISOString())
      const stampOf = { mode: 'plan', agentId: null, confirmedBriefHash: briefHash, ack: null }
      const preview: Rig['preview'] = (over = {}, stamp = stampOf) => {
        const args = { orgId: ORG, briefId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS, ...over }
        return callTool(adapter, 'records_preview', stamp === null ? args : { ...args, [STAMP_KEY]: stamp }, contextFor(home, { hookHost: true, now: NOW }))
      }
      await body({ home, preview, briefHash })
    } finally {
      home.cleanup()
    }
  }
}

function dataOf(result: ToolResult): Preview {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data as Preview
}

test('a preview says what it checked and, in its own list, what it did not', rig(async ({ preview, home }) => {
  const data = dataOf(await preview())
  assert.deepEqual(data.checked, ['ids', 'count', 'before-values', 'object-crud', 'field-updateable', 'record-access'])
  assert.deepEqual(data.not_checked, NOT_CHECKED)
  assert.equal(data.count, 3)
  assert.equal(data.found, 3)
  assert.deepEqual(data.blockers, [])
  assert.equal(fakeWrites(home).length, 0)
}))

test('nothing in a preview is named a dry run', rig(async ({ preview }) => {
  const text = JSON.stringify(await preview())
  assert.equal(/dry.?run|test.?run|simulat/i.test(text), false, text)
}))

test('it returns no record values, only that they were read', rig(async ({ preview }) => {
  const text = JSON.stringify(await preview({ changes: [{ field: 'Contact_Email__c', value: 'x@example.com' }] }))
  assert.equal(text.includes('Name of'), false)
  assert.equal(text.includes('grace@example.com'), false)
  assert.equal(text.includes('x@example.com'), false)
}))

test('before-values are really read, so a field this user can not see fails here, and no count of them comes back', rig(async ({ preview, home }) => {
  const result = await preview({ changes: [{ field: 'Contact_Email__c', value: 'grace@example.com' }] })
  const read = fakeCalls(home).find(item => (item.soql ?? '').startsWith('SELECT Id, SystemModstamp'))
  assert.match(read?.soql ?? '', /Contact_Email__c/)
  assert.equal(/already|matching|equal/i.test(JSON.stringify(result.data)), false, 'a count of matches would be an oracle')
}))

test('automation lists active triggers and record-triggered flows on the object', rig(async ({ preview, home }) => {
  const data = dataOf(await preview())
  assert.deepEqual(data.automation, ['trigger WidgetGuard', 'flow Widget_After_Save'])
  const soql = fakeCalls(home).map(item => item.soql ?? '')
  const trigger = fakeCalls(home).find(item => (item.soql ?? '').includes('FROM ApexTrigger'))
  assert.equal(trigger?.flags['use-tooling-api'], true)
  assert.ok(soql.some(item => /FROM ApexTrigger WHERE .*Widget__c.*Active/s.test(item)))
  assert.ok(soql.some(item => /FROM FlowDefinitionView WHERE .*IsActive = true.*Widget__c/s.test(item)))
}, { triggers: ['WidgetGuard'], flows: ['Widget_After_Save'] }))

// On the Tooling API, ApexTrigger.TableEnumOrId holds the object's name for a standard object and its Id for a custom one.
// Asking a custom object by name returns no rows and no error, which would read as "no triggers". LIVE-CHECKLIST.md has a person confirm it.
test('a custom object is asked about by its Id as well as its name, so its trigger is found', rig(async ({ preview, home }) => {
  const data = dataOf(await preview())
  assert.deepEqual(data.automation, ['trigger WidgetGuard', 'flow Widget_After_Save'])
  const soql = fakeCalls(home).map(item => item.soql ?? '')
  assert.ok(soql.some(item => /FROM EntityDefinition WHERE QualifiedApiName = 'Widget__c'/.test(item)))
  assert.ok(soql.some(item => item.includes(`FROM ApexTrigger WHERE TableEnumOrId IN ('Widget__c', '01I000000000001', '${to18('01I000000000001')}')`)))
}, { triggers: ['WidgetGuard'], flows: ['Widget_After_Save'], triggerObjectId: '01I000000000001', entityIds: { Widget__c: '01I000000000001' } }))

test('a custom object whose Id can not be found never reads as having no triggers', rig(async ({ preview }) => {
  const data = dataOf(await preview())
  assert.equal(data.automation.length, 1)
  assert.match(data.automation[0] ?? '', /could not be read/)
}, { triggers: [], entityIds: {} }))

test('automation that cannot be read says so, and never reads as none', rig(async ({ preview }) => {
  const data = dataOf(await preview())
  assert.equal(data.automation.length, 1)
  assert.match(data.automation[0] ?? '', /could not be read/)
  assert.ok(data.not_checked.includes('automation-list'))
}, { queries: [{ match: 'FROM ApexTrigger', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }] }))

test('record access is checked in chunks of 200 ids', rig(async ({ preview, home }) => {
  const many = Array.from({ length: 450 }, (_, index) => `a0000000000${String(index).padStart(4, '0')}AAA`)
  const data = dataOf(await preview({ frozenRecordIds: many }))
  const asked = fakeCalls(home).filter(item => (item.soql ?? '').includes('FROM UserRecordAccess'))
  assert.equal(asked.length, 3)
  for (const call of asked) {
    assert.ok([...(call.soql ?? '').matchAll(/'a0/g)].length <= 200)
    assert.ok((call.soql ?? '').includes(`UserId = '${USER_ID}'`), call.soql ?? '')
  }
  assert.equal(data.recordAccess?.chunks, 3)
}, { records: { Widget__c: records(Array.from({ length: 450 }, (_, index) => `a0000000000${String(index).padStart(4, '0')}AAA`)) } }))

test('the restriction-rule gap is stated next to the access check', rig(async ({ preview }) => {
  const data = dataOf(await preview())
  assert.match(data.recordAccess?.note ?? '', /restriction rules/i)
  assert.ok(data.not_checked.includes('restriction-rules'))
}))

test('whether describe reflects field security is stated as unconfirmed', rig(async ({ preview }) => {
  assert.ok(dataOf(await preview()).notes.some(note => /field.level security/i.test(note) && /not confirmed|unconfirmed/i.test(note)))
}))

test('a record the user cannot edit is a blocker, and it says which', rig(async ({ preview }) => {
  const data = dataOf(await preview())
  assert.deepEqual(data.recordAccess?.notEditable, [IDS[1]])
  assert.ok(data.blockers.some(item => /1 of 3/.test(item)))
}, { access: { [IDS[1] as string]: { HasEditAccess: false } } }))

test('a delete asks about delete access, not edit access', rig(async ({ preview }) => {
  const data = dataOf(await preview({ operation: 'delete', changes: [] }))
  assert.deepEqual(data.recordAccess?.notEditable, [IDS[0]])
}, { access: { [IDS[0] as string]: { HasDeleteAccess: false }, [IDS[1] as string]: { HasEditAccess: false } } }))

test('access that cannot be read moves to not_checked, and is not claimed', rig(async ({ preview }) => {
  const data = dataOf(await preview())
  assert.equal(data.checked.includes('record-access'), false)
  assert.ok(data.not_checked.includes('record-access'))
  assert.equal(data.recordAccess, null)
}, { queries: [{ match: 'FROM UserRecordAccess', error: { name: 'INSUFFICIENT_ACCESS', message: 'no' } }] }))

test('a field that cannot be updated is a blocker', rig(async ({ preview }) => {
  const data = dataOf(await preview({ changes: [{ field: 'CreatedDate', value: '2026-01-01T00:00:00Z' }] }))
  assert.deepEqual(data.fields, [{ field: 'CreatedDate', exists: true, updateable: false }])
  assert.ok(data.blockers.some(item => /CreatedDate/.test(item)))
}))

test('a field the object does not have is a blocker', rig(async ({ preview }) => {
  const data = dataOf(await preview({ changes: [{ field: 'Nope__c', value: 'x' }] }))
  assert.deepEqual(data.fields, [{ field: 'Nope__c', exists: false, updateable: false }])
  assert.ok(data.blockers.some(item => /Nope__c/.test(item)))
}))

test('object-level CRUD comes from describe', rig(async ({ preview }) => {
  const data = dataOf(await preview({ operation: 'delete', changes: [] }))
  assert.deepEqual(data.objectCrud, { updateable: true, deletable: false })
  assert.ok(data.blockers.some(item => /delete/i.test(item)))
}, { describe: { Widget__c: { ...DESCRIBE_WIDGET, deletable: false } } }))

test('ids the org did not return are named, and the count stays exact', rig(async ({ preview }) => {
  const data = dataOf(await preview())
  assert.equal(data.count, 3)
  assert.equal(data.found, 2)
  assert.deepEqual(data.missing, [IDS[2]])
  assert.ok(data.blockers.some(item => /2 of 3/.test(item)))
}, { records: { Widget__c: records([IDS[0] as string, IDS[1] as string]) } }))

test('a preview needs a brief a person confirmed, and with no stamp it says so', rig(async ({ preview, home }) => {
  const refused = await preview({}, { mode: 'plan', agentId: null, confirmedBriefHash: null, ack: null })
  assert.equal(refused.ok, false)
  assert.match(JSON.stringify(refused.data), /sf_brief_confirm/)
  assert.equal(fakeCalls(home).length, 0)
  const unstamped = await preview({}, null)
  assert.equal(unstamped.ok, true, JSON.stringify(unstamped))
  assert.equal(unstamped.briefConfirmed, false)
}))

test('a preview changes nothing: no write of any kind reaches the CLI', rig(async ({ preview, home }) => {
  await preview()
  await preview({ operation: 'delete', changes: [] })
  assert.equal(fakeWrites(home).length, 0)
  for (const call of fakeCalls(home)) assert.ok(['version', 'data query', 'sobject describe', 'org display'].includes(call.command), call.command)
}))

test('a stale or wrong identity stops it before any read', rig(async ({ preview, home }) => {
  const result = await preview()
  assert.equal(result.ok, false)
  assert.equal(fakeCalls(home).some(item => (item.soql ?? '').includes('Widget__c')), false)
}, { org: { Id: '00D000000000009AAA' } }))
