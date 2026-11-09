import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fakeOrg, reported, widgetIds, writeRig as rig } from './test-support.js'

/**
 * A write the org accepted has to read as done. The org does not always keep what
 * was sent: it answers with 18 character ids, stores multi-select values in
 * definition order, and stores an empty string as null.
 */

const OWNER_15 = '005000000000001'
const OWNER_18 = '005000000000001AAA'

test('a reference written as a 15 character id reads as done when the org answers with 18', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan({ changes: [{ field: 'OwnerId', value: OWNER_15 }] }))
  const data = reported(await run(reply.pinned))
  assert.equal(fakeOrg(home).records.Widget__c?.[widgetIds(1)[0] as string]?.OwnerId, OWNER_18, 'the fake keeps the 18 character form, as the org does')
  assert.equal(data.status, 'done')
  assert.equal(data.counts.done, 3)
}))

test('a multi-select picklist written out of order reads as done', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan({ changes: [{ field: 'Tags__c', value: 'B;A' }] }))
  const data = reported(await run(reply.pinned))
  assert.equal(fakeOrg(home).records.Widget__c?.[widgetIds(1)[0] as string]?.Tags__c, 'A;B')
  assert.equal(data.status, 'done')
}))

test('an empty string in a text field reads as done when the org stores null', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan({ changes: [{ field: 'Contact_Email__c', value: '' }] }))
  const data = reported(await run(reply.pinned))
  assert.equal(fakeOrg(home).records.Widget__c?.[widgetIds(1)[0] as string]?.Contact_Email__c, null)
  assert.equal(data.status, 'done')
}))

test('a Bulk write of an empty string clears the field, because an empty cell would be ignored', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan({ changes: [{ field: 'Contact_Email__c', value: '' }] }))
  assert.equal(reply.facts.transport, 'bulk')
  const data = reported(await run(reply.pinned))
  assert.equal(fakeOrg(home).records.Widget__c?.[widgetIds(1)[0] as string]?.Contact_Email__c, null, 'cleared, not left as it was')
  assert.equal(data.status, 'done')
}, { ids: widgetIds(205) }))

test('a restore after such a write finds the records at the value that was written, not in conflict', rig(async ({ plan, approve, run, input, adapter, briefHash, briefId }) => {
  const { prepareRestore } = await import('./restore.js')
  const planId = await plan({ changes: [{ field: 'OwnerId', value: OWNER_15 }, { field: 'Tags__c', value: 'B;A' }] })
  const data = reported(await run((await approve(planId)).pinned))
  assert.equal(data.status, 'done')
  const restore = await prepareRestore(adapter, input(), { planId, briefId }, briefHash, 'execute')
  assert.equal(restore.ok, true, JSON.stringify(restore))
  assert.equal((restore as { action?: string }).action, 'approve', JSON.stringify(restore))
}))

test('the looser comparison stays tight where it should: other ids, other members, and untyped text still differ', async () => {
  const { sameValue } = await import('./records-state.js')
  assert.equal(sameValue('005000000000001', '005000000000001AAA', 'reference'), true)
  assert.equal(sameValue('005000000000001', '005000000000002AAA', 'reference'), false)
  assert.equal(sameValue('B;A', 'A;B', 'multipicklist'), true)
  assert.equal(sameValue('A;B', 'A;C', 'multipicklist'), false)
  assert.equal(sameValue('A;B', 'A', 'multipicklist'), false)
  assert.equal(sameValue('b;a', 'a;b', 'string'), false, 'order matters in plain text')
  assert.equal(sameValue('x', '', 'string'), false)
  assert.equal(sameValue('', null, 'string'), true)
  assert.equal(sameValue('a\r\nb', 'a\nb', 'textarea'), true)
  assert.equal(sameValue('a\r\nb', 'a\nb', 'string'), false)
})

test('the loose forms are for the field types that have them: a text field is compared as text', async () => {
  const { sameValue } = await import('./records-state.js')
  // Numbers: only a numeric field reads "007", "1e2" and 7 as numbers.
  for (const type of ['string', 'textarea', 'picklist', 'phone', 'unknown', undefined]) {
    assert.equal(sameValue('007', 7, type), false, `007 vs 7 as ${type}`)
    assert.equal(sameValue('1e2', 100, type), false, `1e2 vs 100 as ${type}`)
    assert.equal(sameValue(' 7', 7, type), false, `' 7' vs 7 as ${type}`)
  }
  for (const type of ['int', 'double', 'currency', 'percent']) {
    assert.equal(sameValue('007', 7, type), true, type)
    assert.equal(sameValue('1e2', 100, type), true, type)
    assert.equal(sameValue('5.00', '5', type), true, type)
    assert.equal(sameValue('', 0, type), false, `an empty cell is not zero as ${type}`)
    assert.equal(sameValue('x', 0, type), false, type)
    assert.equal(sameValue(7, 8, type), false, type)
  }
  // Moments: only a date or date and time field reads two spellings as one instant.
  const zulu = '2026-06-01T10:00:00.000Z'
  const offset = '2026-06-01T10:00:00.000+0000'
  for (const type of ['string', 'textarea', 'unknown', undefined]) assert.equal(sameValue(zulu, offset, type), false, `two spellings of an instant as ${type}`)
  assert.equal(sameValue(zulu, offset, 'datetime'), true)
  assert.equal(sameValue(zulu, '2026-06-01T10:00:01.000Z', 'datetime'), false)
  assert.equal(sameValue(zulu, '2026-06-01T05:00:00.000-0500', 'datetime'), true, 'the same instant in another offset')
  assert.equal(sameValue(zulu, '2026-06-01T10:00:00.000-0500', 'datetime'), false, 'the same clock reading in another offset is another instant')
  // Booleans: only a checkbox reads "True" as true.
  for (const type of ['string', 'unknown', undefined]) assert.equal(sameValue('True', true, type), false, `${type}`)
  assert.equal(sameValue('True', true, 'boolean'), true)
  assert.equal(sameValue('false', 'False', 'boolean'), true)
  assert.equal(sameValue('false', 'true', 'boolean'), false)
})

test('the 15 and 18 character forms of one id are one id for an id or a reference, and 15 characters of text are not an id', async () => {
  const { sameValue } = await import('./records-state.js')
  const text = 'abcdefghijklmno'
  const suffixed = `${text}AAA`
  for (const type of ['string', 'textarea', 'picklist', 'unknown', undefined]) assert.equal(sameValue(text, suffixed, type), false, `${type}`)
  for (const type of ['id', 'reference']) {
    assert.equal(sameValue('005000000000001', '005000000000001AAA', type), true, type)
    assert.equal(sameValue('005000000000001', '005000000000002AAA', type), false, type)
  }
})

test('SystemModstamp is a moment whatever the plan says, and a text field holding "1e2" is not at "100"', async () => {
  const { classifyRecord } = await import('./records-state.js')
  const plan = { operation: 'update' } as never
  const values = { changes: [{ field: 'Code__c', value: '100' }], fieldTypes: { Code__c: 'string' } } as never
  const row = { Id: '005000000000001AAA', SystemModstamp: '2026-06-01T10:00:00.000+0000', Code__c: '1e2' }
  assert.equal(classifyRecord(plan, values, { systemModstamp: '2026-06-01T10:00:00.000Z' }, row), 'untouched')
  assert.equal(classifyRecord(plan, values, { systemModstamp: '2026-06-01T09:00:00.000Z' }, row), 'changed')
})

test('a Bulk plan of 1,000 records can be prepared, run and judged, because no read carries more ids than a GET can hold', rig(async ({ home, plan, approve, run }) => {
  const reply = await approve(await plan())
  assert.equal(reply.facts.transport, 'bulk')
  const data = reported(await run(reply.pinned))
  assert.equal(data.status, 'done')
  assert.equal(data.counts.done, 1000)
  const { fakeCalls } = await import('./test-support.js')
  const longest = Math.max(...fakeCalls(home).filter(item => item.soql !== null).map(item => item.soql?.length ?? 0))
  assert.ok(encodeURIComponent('x'.repeat(longest)).length < 16384, 'every query fits the 16,384 byte URI limit')
}, { ids: widgetIds(1000) }))

const BAD = { statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'no', fields: [] }

test('a resume that retries a refused record goes through Bulk, so one bad row does not roll the rest back again', rig(async ({ home, plan, approve, run, writesOf }) => {
  const ids = widgetIds(3)
  const planId = await plan()
  assert.equal(reported(await run((await approve(planId)).pinned)).status, 'partial')
  for (const id of ids) assert.equal(writesOf(id), 0, 'allOrNone rolled the first batch back')
  // Nothing was fixed. Through Collections the same row would fail again and take the others with it.
  const again = await approve(planId)
  assert.equal(again.facts.transport, 'bulk')
  assert.deepEqual(again.pinned.expected.ids, ids)
  const resumed = reported(await run(again.pinned))
  assert.equal(writesOf(ids[0] as string), 1)
  assert.equal(writesOf(ids[2] as string), 1)
  assert.equal(writesOf(ids[1] as string), 0, 'the refused row fails by itself')
  assert.equal(resumed.status, 'partial')
  assert.equal(resumed.counts.done, 2)
  assert.equal(resumed.counts.failed, 1)
  void home
}, { scenario: { rowFailures: { [widgetIds(3)[1] as string]: BAD } } }))

test('a resume whose saved old values are gone stops, rather than saving the new values as the old ones', rig(async ({ home, plan, approve, run, writesOf }) => {
  const { readPreImage, preImageFile } = await import('./preimage.js')
  const { rmSync } = await import('node:fs')
  const ids = widgetIds(3)
  const planId = await plan()
  assert.equal(reported(await run((await approve(planId)).pinned)).status, 'partial')
  rmSync(preImageFile(home.store, home.project, planId), { force: true })
  assert.equal(readPreImage(home.store, home.project, planId, Date.now()).state, 'missing')
  const again = await approve(planId)
  const result = await run(again.pinned)
  assert.equal(result.ok, false, 'nothing is sent without the old values')
  assert.match((result as { reason: string }).reason, /old values/)
  assert.equal(readPreImage(home.store, home.project, planId, Date.now()).state, 'missing', 'and nothing was re-captured from post-write rows')
  assert.equal(writesOf(ids[0] as string), 0)
}, { scenario: { rowFailures: { [widgetIds(3)[1] as string]: BAD } } }))

// ── retrieve is read whole ────────────────────────────────────────────────

test('a retrieve of more than 2,000 files is read in full, so a change in the last of them is seen', async () => {
  const { fakeHome, registerFake, writeScenario, baseScenario, USERNAME } = await import('./test-support.js')
  const { SfCliAdapter } = await import('./sf-adapter.js')
  const home = fakeHome()
  try {
    registerFake(home)
    const files: Record<string, string> = {}
    for (let index = 0; index < 2100; index += 1) files[`classes/C${String(index).padStart(4, '0')}.cls`] = `// ${index}`
    writeScenario(home, baseScenario({ metadata: { 'ApexClass:Big': files } }))
    const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 20000, versionTimeoutMs: 8000 })
    const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>Big</members><name>ApexClass</name></types><version>66.0</version></Package>\n'
    const raw = await adapter.retrieveManifest(USERNAME, manifest)
    assert.equal('failure' in raw, false, JSON.stringify(raw))
    const kept = raw as { files: { path: string }[] }
    assert.ok(kept.files.some(file => file.path.endsWith('C2099.cls')), 'the last file is there')
    assert.equal(kept.files.filter(file => file.path.endsWith('.cls')).length, 2100)
  } finally {
    home.cleanup()
  }
})

test('a retrieve that would pass the file limit fails instead of being cut short', async () => {
  const { walk } = await import('./sf-adapter.js')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'sf-walk-'))
  try {
    for (let index = 0; index < 5; index += 1) writeFileSync(join(dir, `f${index}.txt`), 'x')
    const all: string[] = []
    assert.equal(walk(dir, all, 5), true)
    assert.equal(all.length, 5)
    const cut: string[] = []
    assert.equal(walk(dir, cut, 4), false, 'it says it stopped')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing authorization names the keychain and certificates as a cause, not only an expired login', async () => {
  const { readEnvelope } = await import('./sf-parse.js')
  const answer = readEnvelope({ outcome: 'exited', code: 1, stderr: '', stdout: JSON.stringify({ status: 1, name: 'NamedOrgNotFoundError', message: 'No authorization information found for ada@example.com.', exitCode: 1 }) } as never)
  assert.equal('failure' in answer && answer.failure, 'expired-auth')
  assert.match((answer as { message: string }).message, /works in your own terminal/)
})

// ── an all-or-none failure may come back as HTTP 400 with the per-row results ──

test('a 400 that carries one result per record is read row by row, so the real error is kept', async () => {
  const { parseCollections } = await import('./sf-parse.js')
  const sent = ['001000000000001AAA', '001000000000002AAA']
  const body = [
    { success: false, errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'bad', fields: [] }] },
    { id: sent[1], success: false, errors: [{ statusCode: 'ALL_OR_NONE_OPERATION_ROLLED_BACK', message: 'x', fields: [] }] },
  ]
  const run = { outcome: 'exited', code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { statusCode: 400, headers: {}, body }, warnings: [] }) } as never
  const answer = parseCollections(run, sent)
  assert.equal(answer.kind, 'answered')
  const rows = (answer as { rows: { success: boolean; errors: { statusCode: string }[] }[] }).rows
  assert.equal(rows[0]?.errors[0]?.statusCode, 'FIELD_CUSTOM_VALIDATION_EXCEPTION')
  assert.equal(rows.some(row => row.success), false)
})

test('a 400 that is a plain error list is still a rejection of the whole write', async () => {
  const { parseCollections } = await import('./sf-parse.js')
  const run = { outcome: 'exited', code: 1, stderr: '', stdout: JSON.stringify({ status: 1, result: { statusCode: 400, headers: {}, body: [{ errorCode: 'JSON_PARSER_ERROR', message: 'x' }] }, warnings: [] }) } as never
  assert.equal(parseCollections(run, ['001000000000001AAA']).kind, 'rejected')
})

test('a restore waits while an unanswered Collections write may still land', rig(async ({ plan, approve, run, input, adapter, briefHash, briefId }) => {
  const { prepareRestore } = await import('./restore.js')
  const planId = await plan()
  assert.equal(reported(await run((await approve(planId)).pinned)).status, 'unknown')
  const restore = await prepareRestore(adapter, input(), { planId, briefId }, briefHash, 'execute')
  assert.equal(restore.ok, false, JSON.stringify(restore))
  assert.match((restore as { reason: string }).reason, /may still be running/)
}, { scenario: { mode: 'timeout', modeOn: 'api request rest' } }))
