import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ObjectDescribe } from './adapter.js'
import { buildRecordsQuery, cellIsSafe, escapeLike, escapeSoqlString, fieldIsValueSafe, formatLiteral, resolveQuery, type QuerySpec, type ResolvedQuery } from './soql.js'
import { failure } from './sf-parse.js'
import { DESCRIBE_CONTACT, DESCRIBE_USER, DESCRIBE_WIDGET } from './test-support.js'

const OBJECTS: Record<string, ObjectDescribe> = { Widget__c: DESCRIBE_WIDGET, User: DESCRIBE_USER, Contact: DESCRIBE_CONTACT }
const describe = async (name: string) => OBJECTS[name] ?? failure('not-found', `No object ${name}`)

async function resolved(spec: Partial<QuerySpec>): Promise<ResolvedQuery> {
  const result = await resolveQuery({ object: 'Widget__c', fields: ['Id'], limit: 10, ...spec }, describe)
  if ('refused' in result) throw new Error(result.refused)
  if ('failure' in result) throw new Error(result.message)
  return result
}

async function refusal(spec: Partial<QuerySpec>): Promise<string> {
  const result = await resolveQuery({ object: 'Widget__c', fields: ['Id'], limit: 10, ...spec } as QuerySpec, describe)
  assert.ok('refused' in result, `Expected a refusal for ${JSON.stringify(spec)}`)
  return result.refused
}

test('string literals escape backslashes, quotes, and control characters', () => {
  assert.equal(escapeSoqlString("O'Brien"), "O\\'Brien")
  assert.equal(escapeSoqlString('back\\slash'), 'back\\\\slash')
  assert.equal(escapeSoqlString('a"b'), 'a\\"b')
  assert.equal(escapeSoqlString('line\nbreak\r\ttab'), 'line\\nbreak\\r\\ttab')
  assert.equal(escapeSoqlString("x' OR Name != '"), "x\\' OR Name != \\'")
})

test('LIKE escapes % and _ in the value too', () => {
  assert.equal(escapeLike('50%_off'), '50\\%\\_off')
  assert.equal(escapeLike("it's"), "it\\'s")
})

test('dates and numbers are type-checked literals, never quoted text', () => {
  const field = (type: string) => ({ name: 'X', type, label: 'X', custom: false, createable: false, updateable: false, filterable: true, sortable: true, groupable: true, nillable: true, relationshipName: null, referenceTo: [], picklistValues: [] })
  assert.equal(formatLiteral(field('date'), '2026-06-01'), '2026-06-01')
  assert.throws(() => formatLiteral(field('date'), "2026-06-01' OR x='"))
  assert.throws(() => formatLiteral(field('date'), '2026-13-40'))
  assert.equal(formatLiteral(field('datetime'), '2026-06-01T00:00:00Z'), '2026-06-01T00:00:00Z')
  assert.throws(() => formatLiteral(field('datetime'), '2026-06-01'))
  assert.equal(formatLiteral(field('double'), 12.5), '12.5')
  assert.equal(formatLiteral(field('int'), 12), '12')
  assert.throws(() => formatLiteral(field('int'), 12.5))
  assert.throws(() => formatLiteral(field('double'), '12'))
  assert.throws(() => formatLiteral(field('double'), Number.POSITIVE_INFINITY))
  assert.throws(() => formatLiteral(field('double'), 1e30))
  assert.equal(formatLiteral(field('boolean'), true), 'true')
  assert.throws(() => formatLiteral(field('boolean'), 'true'))
  assert.equal(formatLiteral(field('id'), 'a00000000000001'), "'a00000000000001'")
  assert.throws(() => formatLiteral(field('id'), "a00' OR Id != '"))
  assert.equal(formatLiteral(field('picklist'), "O'Brien"), "'O\\'Brien'")
  assert.equal(formatLiteral(field('string'), null), 'null')
  assert.throws(() => formatLiteral(field('base64'), 'x'))
})

test('every field has to match the identifier shape', async () => {
  for (const bad of [
    'Id, (SELECT Email FROM Contacts)',
    'FIELDS(ALL)',
    'toLabel(Status__c)',
    'TYPEOF What WHEN Account THEN Name END',
    'Id FOR UPDATE',
    'Id OFFSET 5',
    'COUNT()',
    'Owner..Email',
    '.Id',
    'Id;DROP',
    '',
  ]) {
    assert.match(await refusal({ fields: [bad] }), /field/i, bad)
  }
})

test('fields resolve through live describe, parents included', async () => {
  assert.match(await refusal({ fields: ['Nope__c'] }), /Nope__c/)
  assert.match(await refusal({ fields: ['Owner.Nope__c'] }), /Nope__c/)
  assert.match(await refusal({ fields: ['Nope__r.Id'] }), /Nope__r/)
  const query = await resolved({ fields: ['Owner.IsActive'] })
  assert.deepEqual(query.safe.map(item => item.path), ['Owner.IsActive'])
  // A polymorphic parent has no single describe to prove anything against.
  assert.match(await refusal({ fields: ['What.Id'] }), /polymorphic|more than one/i)
})

test('a parent field is judged by the parent describe, so Owner.Email stays withheld', async () => {
  const query = await resolved({ fields: ['Id', 'Owner.Email'] })
  assert.deepEqual(query.safe.map(item => item.path), ['Id'])
  assert.deepEqual(query.withheld.map(item => item.path), ['Owner.Email'])
})

test('only id, boolean, picklist, and date-only system fields are proven safe', () => {
  const by = (name: string) => {
    const found = DESCRIBE_WIDGET.fields.find(field => field.name === name)
    assert.ok(found, name)
    return found
  }
  for (const safe of ['Id', 'OwnerId', 'IsDeleted', 'Status__c', 'LastActivityDate']) assert.equal(fieldIsValueSafe(by(safe)), true, safe)
  for (const held of ['Name', 'Notes__c', 'Contact_Email__c', 'Amount__c', 'Due_Date__c', 'CreatedDate', 'Tags__c', 'Secret__c']) assert.equal(fieldIsValueSafe(by(held)), false, held)
  const contact = DESCRIBE_CONTACT.fields.find(field => field.name === 'Birthdate')
  assert.ok(contact)
  assert.equal(fieldIsValueSafe(contact), false, 'Birthdate is a date, and a person can edit it')
})

test('a safe field still has to hold a safe value', () => {
  const status = DESCRIBE_WIDGET.fields.find(field => field.name === 'Status__c')
  const id = DESCRIBE_WIDGET.fields.find(field => field.name === 'Id')
  const when = DESCRIBE_WIDGET.fields.find(field => field.name === 'LastActivityDate')
  const flag = DESCRIBE_WIDGET.fields.find(field => field.name === 'IsDeleted')
  assert.ok(status && id && when && flag)
  assert.equal(cellIsSafe(status, 'New'), true)
  assert.equal(cellIsSafe(status, 'ada@example.com'), false, 'an unrestricted picklist can hold typed text')
  assert.equal(cellIsSafe(id, 'a00000000000001AAA'), true)
  assert.equal(cellIsSafe(id, 'not an id'), false)
  assert.equal(cellIsSafe(when, '2026-06-01'), true)
  assert.equal(cellIsSafe(when, 'soon'), false)
  assert.equal(cellIsSafe(flag, true), true)
  assert.equal(cellIsSafe(flag, 'true'), false)
  assert.equal(cellIsSafe(status, null), true)
})

test('a withheld field cannot appear in where or orderBy, which closes the count oracle', async () => {
  assert.match(await refusal({ where: [{ field: 'Contact_Email__c', op: 'like', value: 'a' }] }), /withheld/i)
  assert.match(await refusal({ where: [{ field: 'Owner.Email', op: 'eq', value: 'ada@example.com' }] }), /withheld/i)
  assert.match(await refusal({ where: [{ field: 'Name', op: 'ne', value: null }] }), /withheld/i)
  assert.match(await refusal({ orderBy: { field: 'Secret__c' } }), /withheld/i)
})

test('where is AND only, with op from an enum, and nothing free text gets through', async () => {
  const query = buildRecordsQuery(await resolved({ where: [{ field: 'Status__c', op: 'eq', value: "O'Brien" }, { field: 'IsDeleted', op: 'eq', value: false }] }))
  assert.equal(query.rows?.soql, "SELECT Id FROM Widget__c WHERE Status__c = 'O\\'Brien' AND IsDeleted = false LIMIT 10")
  assert.match(await refusal({ where: [{ field: 'Status__c', op: 'eq', value: "New' OR Id != '" }] }), /lists/)
  assert.match(await refusal({ where: [{ field: 'Status__c', op: 'or' as never, value: 'x' }] }), /operator/i)
  assert.match(await refusal({ where: [{ field: 'Id IN (SELECT Id FROM Widget__c)', op: 'eq', value: 'x' }] }), /field/i)
  assert.match(await refusal({ where: [{ field: 'IsDeleted', op: 'lt', value: true }] }), /operator/i)
  assert.match(await refusal({ where: [{ field: 'IsDeleted', op: 'like', value: 'x' }] }), /operator|like/i)
  assert.match(await refusal({ where: [{ field: 'Status__c', op: 'in', value: 'New' }] }), /list/i)
  assert.match(await refusal({ where: [{ field: 'Status__c', op: 'in', value: [] }] }), /list/i)
})

test('LIKE and IN build the right clauses', async () => {
  const like = buildRecordsQuery(await resolved({ where: [{ field: 'Status__c', op: 'like', value: '50%_off' }] }))
  assert.equal(like.rows?.soql, "SELECT Id FROM Widget__c WHERE Status__c LIKE '50\\%\\_off' LIMIT 10")
  const within = buildRecordsQuery(await resolved({ where: [{ field: 'Status__c', op: 'not_in', value: ['New', 'Closed'] }] }))
  assert.equal(within.rows?.soql, "SELECT Id FROM Widget__c WHERE Status__c NOT IN ('New', 'Closed') LIMIT 10")
})

test('the limit is required and capped at 2,000, and the object is resolved', async () => {
  assert.match(await refusal({ limit: 0 }), /2,?000/)
  assert.match(await refusal({ limit: 2001 }), /2,?000/)
  assert.match(await refusal({ limit: 1.5 }), /2,?000/)
  assert.match(await refusal({ limit: undefined as never }), /2,?000/)
  assert.match(await refusal({ object: 'Widget__c; DROP' }), /object/i)
  const missing = await resolveQuery({ object: 'Nope__c', fields: ['Id'], limit: 1 }, describe)
  assert.ok('failure' in missing)
})

test('the journal copy of the query holds binds, never literals', async () => {
  const query = buildRecordsQuery(await resolved({ fields: ['Id'], where: [{ field: 'Status__c', op: 'eq', value: 'New' }, { field: 'OwnerId', op: 'eq', value: '00500000000000AAAA' }, { field: 'IsDeleted', op: 'eq', value: false }] }))
  assert.equal(query.count.bound, 'SELECT COUNT() FROM Widget__c WHERE Status__c = :b0 AND OwnerId = :b1 AND IsDeleted = :b2 LIMIT 10')
  assert.equal(query.rows?.bound.includes('New'), false)
  assert.equal(query.rows?.bound.includes('00500000000000AAAA'), false)
})

test('withheld fields are counted with no value leaving the org', async () => {
  const query = buildRecordsQuery(await resolved({ fields: ['Id', 'Contact_Email__c', 'Notes__c'], where: [{ field: 'Status__c', op: 'eq', value: 'New' }] }))
  assert.equal(query.rows?.soql, "SELECT Id FROM Widget__c WHERE Status__c = 'New' LIMIT 10")
  assert.equal(query.withheld[0]?.soql, "SELECT COUNT() FROM Widget__c WHERE Status__c = 'New' AND Contact_Email__c != null LIMIT 10")
  assert.equal(query.withheld[0]?.field.path, 'Contact_Email__c')
  // A long text field cannot be filtered, so it is reported as not countable rather than read.
  assert.equal(query.withheld[1]?.soql, null)
})

test('with only withheld fields there is no row query at all', async () => {
  const query = buildRecordsQuery(await resolved({ fields: ['Contact_Email__c'] }))
  assert.equal(query.rows, null)
})

test('orderBy takes a direction and a safe, sortable field', async () => {
  const query = buildRecordsQuery(await resolved({ orderBy: { field: 'LastActivityDate', direction: 'desc' } }))
  assert.equal(query.rows?.soql, 'SELECT Id FROM Widget__c ORDER BY LastActivityDate DESC LIMIT 10')
  assert.match(await refusal({ orderBy: { field: 'Status__c', direction: 'sideways' as never } }), /direction/i)
})

test('duplicate fields collapse, and field case follows describe', async () => {
  const query = await resolved({ fields: ['id', 'ID', 'owner.isactive'] })
  assert.deepEqual(query.safe.map(item => item.path), ['Id', 'Owner.IsActive'])
})

// ── review M5: sensitive picklists and checkboxes ──

test('M5: on an object that holds people, a custom or sensitive picklist or checkbox is withheld', () => {
  const field = (name: string, type: string, custom: boolean, label = name) => ({ name, type, label, custom, createable: true, updateable: true, filterable: true, sortable: true, groupable: true, nillable: true, relationshipName: null, referenceTo: [], picklistValues: [] })
  for (const [name, type, custom] of [['GenderIdentity', 'picklist', false], ['Pronouns', 'picklist', false], ['Salutation', 'picklist', false], ['Diagnosis__c', 'picklist', true], ['HIV_Positive__c', 'boolean', true], ['Preferred_Size__c', 'picklist', true]] as const) {
    assert.equal(fieldIsValueSafe(field(name, type, custom), 'Contact'), false, name)
  }
  for (const [name, type, custom] of [['IsDeleted', 'boolean', false], ['Status', 'picklist', false], ['LeadSource', 'picklist', false], ['IsActive', 'boolean', false]] as const) {
    assert.equal(fieldIsValueSafe(field(name, type, custom), name === 'Status' || name === 'LeadSource' ? 'Lead' : 'Contact'), true, name)
  }
})

test('M5: a sensitive name is withheld on any object, and an ordinary custom object is unchanged', () => {
  const field = (name: string, label: string) => ({ name, type: 'picklist', label, custom: true, createable: true, updateable: true, filterable: true, sortable: true, groupable: true, nillable: true, relationshipName: null, referenceTo: [], picklistValues: [] })
  assert.equal(fieldIsValueSafe(field('Diagnosis__c', 'Diagnosis'), 'Patient__c'), false)
  assert.equal(fieldIsValueSafe(field('X__c', 'Marital status'), 'Widget__c'), false)
  assert.equal(fieldIsValueSafe(field('Status__c', 'Status'), 'Widget__c'), true)
})
