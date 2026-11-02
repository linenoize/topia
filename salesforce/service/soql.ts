import { isFailure, type Failure, type FieldDescribe, type ObjectDescribe } from './adapter.js'
import { REPORT_ROW_CAP } from './contract.js'

/**
 * Contract section 6. A query is built from structured parts and every field is
 * proven against live describe. There is no free-text SOQL anywhere, and a field
 * returns values only when it can be shown to hold nothing personal.
 */

export const WHERE_OPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge', 'like', 'in', 'not_in'] as const
export type WhereOp = (typeof WHERE_OPS)[number]

const OP_TEXT: Record<WhereOp, string> = { eq: '=', ne: '!=', lt: '<', le: '<=', gt: '>', ge: '>=', like: 'LIKE', in: 'IN', not_in: 'NOT IN' }

export type WhereClause = { field: string; op: WhereOp; value: unknown }
export type QuerySpec = {
  object: string
  fields: string[]
  where?: WhereClause[]
  orderBy?: { field: string; direction?: 'asc' | 'desc' }
  limit: number
}

const FIELD_PATH = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/
const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/
const MAX_DEPTH = 5
const MAX_IN = 200
export const MAX_WITHHELD_COUNTS = 10

const STRING_TYPES = new Set(['string', 'picklist', 'multipicklist', 'combobox', 'textarea', 'email', 'phone', 'url', 'encryptedstring'])
const NUMBER_TYPES = new Set(['double', 'currency', 'percent'])
const INTEGER_TYPES = new Set(['int', 'long'])

export function escapeSoqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\u0008/g, '\\b')
    .replace(/\f/g, '\\f')
}

export function escapeLike(value: string): string {
  return escapeSoqlString(value).replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/

/** A literal is checked against the field's type. Throws when the value does not fit. */
export function formatLiteral(field: FieldDescribe, value: unknown): string {
  if (value === null) return 'null'
  const refuse = (): never => {
    throw new Error(`That value does not fit ${field.name}, which is ${field.type}.`)
  }
  if (field.type === 'id' || field.type === 'reference') {
    return typeof value === 'string' && ID.test(value) ? `'${value}'` : refuse()
  }
  if (field.type === 'boolean') return typeof value === 'boolean' ? String(value) : refuse()
  if (field.type === 'date') return typeof value === 'string' && isRealDate(value) ? value : refuse()
  if (field.type === 'datetime') {
    const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && isRealDate(value.slice(0, 10))
    return ok ? (value as string) : refuse()
  }
  if (NUMBER_TYPES.has(field.type) || INTEGER_TYPES.has(field.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return refuse()
    if (INTEGER_TYPES.has(field.type) && !Number.isInteger(value)) return refuse()
    const text = String(value)
    return /^-?\d+(\.\d+)?$/.test(text) ? text : refuse()
  }
  if (STRING_TYPES.has(field.type)) return typeof value === 'string' ? `'${escapeSoqlString(value)}'` : refuse()
  return refuse()
}

/** Objects that hold facts about people. A picklist or a checkbox there can say who someone is. */
const PERSON_OBJECTS = new Set(['contact', 'lead', 'user', 'account', 'individual', 'campaignmember', 'personaccount', 'case', 'opportunitycontactrole'])
/** The few standard picklists and checkboxes on those objects that say nothing about a person. */
const PERSON_OBJECT_SAFE_FIELDS = new Set(['isdeleted', 'isactive', 'isconverted', 'isemailbounced', 'donotcall', 'hasoptedoutofemail', 'hasoptedoutoffax', 'isunreadbyowner', 'status', 'leadsource', 'rating', 'industry', 'type', 'usertype', 'priority', 'origin', 'isclosed', 'isescalated'])
/** Names and labels that point at what a person would not want read out. A custom field with one of these is withheld on any object. */
const SENSITIVE_WORDS = /gender|pronoun|sex|race|racial|ethnic|religio|orientation|health|diagnos|medic|disab|hiv|pregnan|marital|citizen|nationalit|immigra|salary|income|wage|ssn|passport|politic|union|criminal|arrest|veteran|allerg|treatment|therapy|consent/i

function holdsAboutAPerson(field: FieldDescribe, object: string): boolean {
  if (SENSITIVE_WORDS.test(field.name) || SENSITIVE_WORDS.test(field.label)) return true
  if (!PERSON_OBJECTS.has(object.toLowerCase())) return false
  return field.custom || !PERSON_OBJECT_SAFE_FIELDS.has(field.name.toLowerCase())
}

/**
 * Withheld unless proven safe: ids, booleans, picklists, and date-only fields the
 * system sets. A person can edit Birthdate, so it stays out, and a multi-select
 * picklist is not on the list.
 */
export function fieldIsValueSafe(field: FieldDescribe, object = ''): boolean {
  switch (field.type) {
    case 'id':
    case 'reference':
      return true
    case 'boolean':
    case 'picklist':
      return !holdsAboutAPerson(field, object)
    case 'date':
      return !field.custom && !field.createable && !field.updateable
    default:
      return false
  }
}

/** The field type is not enough. An unrestricted picklist can hold typed text, so the value is checked as well. */
export function cellIsSafe(field: FieldDescribe, value: unknown): boolean {
  if (value === null || value === undefined) return true
  switch (field.type) {
    case 'id':
    case 'reference':
      return typeof value === 'string' && ID.test(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'picklist':
      return typeof value === 'string' && field.picklistValues.some(item => item.value === value)
    case 'date':
      return typeof value === 'string' && isRealDate(value)
    default:
      return false
  }
}

export type ResolvedField = { path: string; field: FieldDescribe; safe: boolean }

export type ResolvedQuery = {
  object: string
  /** In the order they were asked for. */
  fields: ResolvedField[]
  safe: ResolvedField[]
  withheld: ResolvedField[]
  where: { field: ResolvedField; op: WhereOp; value: unknown }[]
  orderBy: { field: ResolvedField; direction: 'ASC' | 'DESC' } | null
  limit: number
}

export type Describer = (object: string) => Promise<ObjectDescribe | Failure>

type Refusal = { refused: string }

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/** Walks a dotted path through live describes, parents included. */
async function resolveField(path: unknown, root: ObjectDescribe, describe: Describer): Promise<ResolvedField | Refusal | Failure> {
  if (typeof path !== 'string' || !FIELD_PATH.test(path)) return { refused: `That is not a field name: ${String(path).slice(0, 60)}. Functions, subqueries, and expressions are not allowed.` }
  const segments = path.split('.')
  if (segments.length > MAX_DEPTH) return { refused: `${path} goes further up than ${MAX_DEPTH} levels.` }
  let current = root
  const canonical: string[] = []
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      const field = current.fields.find(item => same(item.name, segment))
      if (!field) return { refused: `${current.name} has no field ${segment}.` }
      canonical.push(field.name)
      return { path: canonical.join('.'), field, safe: fieldIsValueSafe(field, current.name) }
    }
    const link = current.fields.find(item => item.relationshipName !== null && same(item.relationshipName, segment))
    if (!link) return { refused: `${current.name} has no relationship ${segment}.` }
    if (link.referenceTo.length !== 1) return { refused: `${segment} is polymorphic: it points at more than one object, so its fields cannot be proven.` }
    const parent = await describe(link.referenceTo[0] as string)
    if (isFailure(parent)) return parent
    canonical.push(link.relationshipName as string)
    current = parent
  }
  return { refused: `That is not a field name: ${path}.` }
}

const WITHHELD = 'is withheld, so it cannot be used in a filter or a sort. That would read its values one guess at a time. Only sf_show_values can do this, because a person approves it there.'

/** `personApproved` is sf_show_values, after its dialog is built. Nothing else sets it. */
export async function resolveQuery(spec: QuerySpec, describe: Describer, options: { personApproved?: boolean } = {}): Promise<ResolvedQuery | Refusal | Failure> {
  const personApproved = options.personApproved === true
  if (typeof spec.object !== 'string' || !OBJECT_NAME.test(spec.object)) return { refused: 'That is not an object API name.' }
  if (typeof spec.limit !== 'number' || !Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > REPORT_ROW_CAP) return { refused: 'A query needs a whole-number bound from 1 to 2,000.' }
  if (!Array.isArray(spec.fields) || spec.fields.length === 0) return { refused: 'A query needs explicit fields.' }
  const root = await describe(spec.object)
  if (isFailure(root)) return root
  const seen = new Map<string, ResolvedField>()
  for (const path of spec.fields) {
    const resolved = await resolveField(path, root, describe)
    if (isFailure(resolved) || 'refused' in resolved) return resolved
    if (!seen.has(resolved.path)) seen.set(resolved.path, resolved)
  }
  const fields = [...seen.values()]
  if (!personApproved && fields.filter(item => !item.safe).length > MAX_WITHHELD_COUNTS) return { refused: `A query can count at most ${MAX_WITHHELD_COUNTS} withheld fields.` }
  const where: ResolvedQuery['where'] = []
  for (const clause of spec.where ?? []) {
    const resolved = await resolveField(clause?.field, root, describe)
    if (isFailure(resolved) || 'refused' in resolved) return resolved
    if (!resolved.safe && !personApproved) return { refused: `${resolved.path} ${WITHHELD}` }
    const checked = checkOperator(resolved, clause, personApproved)
    if (checked !== null) return { refused: checked }
    where.push({ field: resolved, op: clause.op, value: clause.value })
  }
  let orderBy: ResolvedQuery['orderBy'] = null
  if (spec.orderBy !== undefined) {
    const direction = spec.orderBy.direction ?? 'asc'
    if (direction !== 'asc' && direction !== 'desc') return { refused: 'A sort direction is asc or desc.' }
    const resolved = await resolveField(spec.orderBy.field, root, describe)
    if (isFailure(resolved) || 'refused' in resolved) return resolved
    if (!resolved.safe && !personApproved) return { refused: `${resolved.path} ${WITHHELD}` }
    if (!resolved.field.sortable) return { refused: `${resolved.path} cannot be sorted.` }
    orderBy = { field: resolved, direction: direction === 'asc' ? 'ASC' : 'DESC' }
  }
  return { object: root.name, fields, safe: fields.filter(item => item.safe), withheld: fields.filter(item => !item.safe), where, orderBy, limit: spec.limit }
}

/**
 * A picklist can hold typed text the describe doesn't list, and that text is
 * withheld. A range or an off-list literal would read it one guess at a time, so
 * a filter here takes only values on the list.
 */
function picklistProblem(field: ResolvedField, clause: WhereClause): string | null {
  if (field.field.type !== 'picklist') return null
  if (clause.op === 'lt' || clause.op === 'le' || clause.op === 'gt' || clause.op === 'ge') return `${field.path} can't take a range. It could read typed text one guess at a time. Filter on listed values, or use sf_show_values.`
  const values = Array.isArray(clause.value) ? clause.value : [clause.value]
  const listed = values.every(value => value === null || field.field.picklistValues.some(item => item.value === value))
  return listed ? null : `${field.path} can only be filtered on values its describe lists. Anything else could read typed text one guess at a time. sf_show_values can do this with a person.`
}

function checkOperator(field: ResolvedField, clause: WhereClause, personApproved: boolean): string | null {
  if (!WHERE_OPS.includes(clause.op)) return 'That is not a filter operator.'
  if (!field.field.filterable) return `${field.path} cannot be filtered.`
  if (!personApproved) {
    const problem = picklistProblem(field, clause)
    if (problem !== null) return problem
  }
  const type = field.field.type
  if ((clause.op === 'like' && !STRING_TYPES.has(type)) || (type === 'boolean' && clause.op !== 'eq' && clause.op !== 'ne')) {
    return `The operator ${clause.op} does not apply to ${type}.`
  }
  if (clause.op === 'in' || clause.op === 'not_in') {
    if (!Array.isArray(clause.value) || clause.value.length === 0 || clause.value.length > MAX_IN) return `${clause.op} needs a list of 1 to ${MAX_IN} values.`
    return literalProblem(field, clause.value)
  }
  if (clause.op === 'like' && typeof clause.value !== 'string') return 'like needs text.'
  return literalProblem(field, [clause.value])
}

function literalProblem(field: ResolvedField, values: unknown[]): string | null {
  try {
    for (const value of values) formatLiteral(field.field, value)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'That value does not fit.'
  }
}

/** The SOQL the CLI runs, and a copy for the journal with every literal replaced by a bind. */
export type BuiltStatement = { soql: string; bound: string }

export type BuiltQuery = {
  count: BuiltStatement
  rows: BuiltStatement | null
  withheld: { field: ResolvedField; soql: string | null; bound: string | null }[]
}

function renderWhere(query: ResolvedQuery, literal: (value: string) => string): string[] {
  return query.where.map(clause => {
    const value = clause.value
    const render = (item: unknown): string => {
      if (clause.op === 'like') return literal(`'${escapeLike(item as string)}'`)
      return literal(formatLiteral(clause.field.field, item))
    }
    const text = Array.isArray(value) ? `(${value.map(render).join(', ')})` : render(value)
    return `${clause.field.path} ${OP_TEXT[clause.op]} ${text}`
  })
}

function statement(head: string, query: ResolvedQuery, extra: string[], tail: string): BuiltStatement {
  const build = (literal: (value: string) => string): string => {
    const conditions = [...renderWhere(query, literal), ...extra]
    return `${head}${conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''}${tail}`
  }
  let index = 0
  return { soql: build(value => value), bound: build(() => `:b${index++}`) }
}

/** The one query sf_show_values runs, after a person approved exactly these fields and this bound. */
export function buildValuesQuery(query: ResolvedQuery): BuiltStatement {
  const order = query.orderBy === null ? '' : ` ORDER BY ${query.orderBy.field.path} ${query.orderBy.direction}`
  return statement(`SELECT ${query.fields.map(item => item.path).join(', ')} FROM ${query.object}`, query, [], `${order} LIMIT ${query.limit}`)
}

export function buildRecordsQuery(query: ResolvedQuery): BuiltQuery {
  const limit = ` LIMIT ${query.limit}`
  const countHead = `SELECT COUNT() FROM ${query.object}`
  const order = query.orderBy === null ? '' : ` ORDER BY ${query.orderBy.field.path} ${query.orderBy.direction}`
  return {
    count: statement(countHead, query, [], limit),
    rows: query.safe.length === 0 ? null : statement(`SELECT ${query.safe.map(item => item.path).join(', ')} FROM ${query.object}`, query, [], `${order}${limit}`),
    withheld: query.withheld.map(field => {
      // A field that cannot be filtered is reported as not countable. Reading it here would bring its values into this process.
      if (!field.field.filterable) return { field, soql: null, bound: null }
      const built = statement(countHead, query, [`${field.path} != null`], limit)
      return { field, soql: built.soql, bound: built.bound }
    }),
  }
}

/** The describe fields a caller may see. Picklist labels are org text and are wrapped with the rest. */
export function describeForModel(described: ObjectDescribe): unknown {
  return {
    name: described.name,
    label: described.label,
    custom: described.custom,
    queryable: described.queryable,
    fields: described.fields.map(field => ({
      name: field.name,
      label: field.label,
      type: field.type,
      custom: field.custom,
      filterable: field.filterable,
      sortable: field.sortable,
      relationshipName: field.relationshipName,
      referenceTo: field.referenceTo,
      valuesReturned: fieldIsValueSafe(field, described.name),
      ...(field.picklistValues.length > 0 ? { picklistValues: field.picklistValues.map(item => ({ value: item.value, label: item.label, active: item.active })) } : {}),
    })),
  }
}
