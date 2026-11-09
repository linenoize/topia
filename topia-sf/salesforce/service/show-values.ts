import { isFailure, type Adapter, type ObjectDescribe } from './adapter.js'
import type { SfMode } from './contract.js'
import { readBrief } from './brief.js'
import { appendJournal } from './journal.js'
import { UnreadableFileError } from './json-file.js'
import { lockState } from './activation.js'
import { parseReportDescribe, parseReportRun } from './sf-parse.js'
import { buildValuesQuery, resolveQuery, type QuerySpec, type ResolvedQuery } from './soql.js'
import { SHOW_VALUES_SCHEMA, validateArgs } from './tool-schemas.js'
import { dataFailure, formatToolText, isReady, liveCheck, okResult, ready, refuse, reportPath, valueAt, type CallContext, type CallInput, type LiveFacts, type ToolResult } from './tools.js'

/**
 * Contract section 6. Values come back only through this, and only after a person
 * answers the dialog the mod builds from `prepareShowValues`. Preparing reads no
 * values. Running gets the pinned request over stdin, from the hook that showed it.
 */

const TOOL = 'sf_show_values'

export const SHOW_VALUES_MAX_ROWS = 200

export type ValuesAnswer = { ok: true; text: string } | { ok: false; reason: string }

export type Prepared = {
  ok: true
  kind: 'records' | 'report'
  identity: LiveFacts
  object?: string
  reportName?: string
  fields: string[]
  filters: { field: string; op: string; value: unknown }[]
  sort: { field: string; direction: 'ASC' | 'DESC' } | null
  limit: number
  /** What the runner runs. The hook holds it in memory from the dialog to here, and it is what the person saw. */
  pinned: unknown
}

type Request = { orgId: string; briefId: string; object?: string; fields?: string[]; where?: QuerySpec['where']; orderBy?: QuerySpec['orderBy']; reportId?: string; limit: number }

function contextFor(input: CallInput, mode: SfMode): CallContext {
  return { ...input, mode, stamp: null, brief: null }
}

function reasonOf(result: ToolResult): string {
  const message = (result.data as { message?: unknown } | undefined)?.message
  return result.notice ?? (typeof message === 'string' ? message : 'The values could not be read.')
}

function refused(result: ToolResult): ValuesAnswer {
  return { ok: false, reason: reasonOf(result) }
}

/** Everything both steps check, before anything reads the org. */
function checkRequest(ctx: CallContext, raw: unknown, confirmedBriefHash: string | null): { request: Request } | { refusal: ToolResult } {
  const orgId = raw !== null && typeof raw === 'object' && typeof (raw as Request).orgId === 'string' ? (raw as Request).orgId : ''
  const stop = (message: string, note?: string) => ({ refusal: refuse(ctx, TOOL, orgId, '', message, { note }) })
  const lock = lockState(ctx.storeRoot, ctx.projectRoot)
  if (lock.state === 'off') return { refusal: refuse(ctx, TOOL, orgId, '', 'Salesforce is not on for this project. /topia:sf:enable turns it on.', { record: false }) }
  if (lock.state === 'unreadable') return { refusal: refuse(ctx, TOOL, orgId, '', lock.message, { record: false }) }
  const problem = validateArgs(SHOW_VALUES_SCHEMA, raw)
  if (problem !== null) return stop(problem)
  const request = raw as Request
  const isReport = typeof request.reportId === 'string'
  const isRecords = typeof request.object === 'string'
  if (isReport === isRecords) return stop('Name an object and its fields, or a report. Not both, and not neither.')
  if (isRecords && !Array.isArray(request.fields)) return stop('Show-values for records names the exact fields.')
  const stored = readBrief(ctx.storeRoot, ctx.projectRoot, request.briefId)
  if (stored === null || confirmedBriefHash === null || stored.briefHash !== confirmedBriefHash) {
    return stop('sf_show_values needs a brief a person has confirmed. Call sf_brief_confirm first. A chat reply is not confirmation.')
  }
  return { request }
}

function describer(adapter: Adapter, username: string): (object: string) => Promise<ObjectDescribe | import('./adapter.js').Failure> {
  const held = new Map<string, ReturnType<Adapter['describe']>>()
  return object => {
    if (!held.has(object)) held.set(object, adapter.describe(username, object))
    return held.get(object) as ReturnType<Adapter['describe']>
  }
}

function pinnedRecords(request: Request, resolved: ResolvedQuery): Record<string, unknown> {
  const out: Record<string, unknown> = { orgId: request.orgId, briefId: request.briefId, object: resolved.object, fields: resolved.fields.map(item => item.path), limit: resolved.limit }
  if (resolved.where.length > 0) out.where = resolved.where.map(clause => ({ field: clause.field.path, op: clause.op, value: clause.value }))
  if (resolved.orderBy !== null) out.orderBy = { field: resolved.orderBy.field.path, direction: resolved.orderBy.direction === 'ASC' ? 'asc' : 'desc' }
  return out
}

/** Reads no values. What this returns is what the dialog shows, and it pins what will run. */
export async function prepareShowValues(adapter: Adapter, input: CallInput, raw: unknown, confirmedBriefHash: string | null, mode: SfMode = 'read-only'): Promise<Prepared | ValuesAnswer> {
  const ctx = contextFor(input, mode)
  try {
    const checked = checkRequest(ctx, raw, confirmedBriefHash)
    if ('refusal' in checked) return refused(checked.refusal)
    const { request } = checked
    const live = await liveCheck(adapter, ctx, TOOL, request.orgId)
    if ('ok' in live) return refused(live)
    const base = { ok: true as const, identity: live.facts, filters: [], sort: null, limit: request.limit }
    if (typeof request.reportId === 'string') {
      const answer = await adapter.apiGet(live.ready.record.username, reportPath(request.reportId, '/describe'))
      if (isFailure(answer)) return refused(dataFailure(ctx, TOOL, live.ready, answer))
      const described = parseReportDescribe(answer)
      if (isFailure(described)) return refused(dataFailure(ctx, TOOL, live.ready, described))
      return { ...base, kind: 'report', reportName: described.name, fields: described.columns.map(column => column.name), pinned: { orgId: request.orgId, briefId: request.briefId, reportId: request.reportId, limit: request.limit } }
    }
    const resolved = await resolveQuery(request as unknown as QuerySpec, describer(adapter, live.ready.record.username), { personApproved: true })
    if (isFailure(resolved)) return refused(dataFailure(ctx, TOOL, live.ready, resolved))
    if ('refused' in resolved) return refused(refuse(ctx, TOOL, request.orgId, live.ready.record.username, resolved.refused, { note: 'A show-values request did not pass the field and filter checks.' }))
    return {
      ...base,
      kind: 'records',
      object: resolved.object,
      fields: resolved.fields.map(item => item.path),
      filters: resolved.where.map(clause => ({ field: clause.field.path, op: clause.op, value: clause.value })),
      sort: resolved.orderBy === null ? null : { field: resolved.orderBy.field.path, direction: resolved.orderBy.direction },
      limit: resolved.limit,
      pinned: pinnedRecords(request, resolved),
    }
  } catch (error) {
    return { ok: false, reason: error instanceof UnreadableFileError ? error.message : 'The values could not be prepared.' }
  }
}

/** After the person's exact answer. A dialog can stay open a long time, so the org is proven again first. */
export async function runShowValues(adapter: Adapter, input: CallInput, pinned: unknown, confirmedBriefHash: string | null, mode: SfMode = 'read-only'): Promise<ValuesAnswer> {
  const ctx = contextFor(input, mode)
  try {
    const checked = checkRequest(ctx, pinned, confirmedBriefHash)
    if ('refusal' in checked) return refused(checked.refusal)
    const { request } = checked
    const proven = await ready(adapter, ctx, TOOL, request.orgId)
    if (!isReady(proven)) return refused(proven)
    const { username, orgId } = proven.record
    const at = new Date(ctx.now).toISOString()
    const record = (line: { soql?: string; rows: number; note: string }) => appendJournal(ctx.projectRoot, { event: 'query.executed', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId, mode: ctx.mode, at, soql: line.soql, counts: { rows: line.rows }, note: line.note })

    if (typeof request.reportId === 'string') {
      const answer = await adapter.apiGet(username, reportPath(request.reportId, '?includeDetails=true'))
      if (isFailure(answer)) return refused(dataFailure(ctx, TOOL, proven, answer))
      const run = parseReportRun(answer)
      const shown = run.malformed ? [] : run.rows.slice(0, request.limit)
      const rows = shown.map(cells => Object.fromEntries(run.columns.map((column, index) => [column.name, cells[index] ?? null])))
      record({ rows: rows.length, note: `Report rows shown after a person approved them: ${run.columns.length} columns.` })
      const partial = run.malformed || run.allData !== true || run.rows.length > request.limit
      return { ok: true, text: formatToolText(okResult(ctx, TOOL, proven, { approvedByPerson: true, reportId: request.reportId, columns: run.columns.map(column => column.name), rows, rowCount: run.rowCount ?? run.rows.length, partial, malformed: run.malformed })) }
    }

    const resolved = await resolveQuery(request as unknown as QuerySpec, describer(adapter, username), { personApproved: true })
    if (isFailure(resolved)) return refused(dataFailure(ctx, TOOL, proven, resolved))
    if ('refused' in resolved) return refused(refuse(ctx, TOOL, orgId, username, resolved.refused, { note: 'A show-values request did not pass the field and filter checks.' }))
    const built = buildValuesQuery(resolved)
    const fetched = await adapter.query(username, built.soql)
    if (isFailure(fetched)) return refused(dataFailure(ctx, TOOL, proven, fetched))
    const rows = fetched.records.slice(0, resolved.limit).map(row => Object.fromEntries(resolved.fields.map(field => [field.path, valueAt(row, field.path)])))
    record({ soql: built.bound, rows: rows.length, note: `Values shown after a person approved them: ${resolved.fields.map(field => field.path).join(', ')}.` })
    return { ok: true, text: formatToolText(okResult(ctx, TOOL, proven, { approvedByPerson: true, object: resolved.object, fields: resolved.fields.map(field => field.path), rows, partial: fetched.truncated })) }
  } catch (error) {
    return { ok: false, reason: error instanceof UnreadableFileError ? error.message : 'The values could not be read.' }
  }
}
