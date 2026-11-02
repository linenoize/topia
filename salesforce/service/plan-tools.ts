import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { isFailure, type Adapter, type FieldDescribe } from './adapter.js'
import { MAX_CHANGED_FIELDS } from './approval-screen.js'
import { readBrief } from './brief.js'
import { REVERSIBILITY_TEXT, valueProblem, type ReversibilityClass } from './contract.js'
import { artifactProblem, hashArtifactAt, placeArtifact, snapshotArtifact, snapshotFile } from './deploy-zip.js'
import { to18 } from './identity.js'
import { issue } from './issues.js'
import { appendJournal, readJournal } from './journal.js'
import { readJson, UnreadableFileError, writeJson } from './json-file.js'
import { localFile, planFile, safeId } from './paths.js'
import { canonical, expiryFrom, overDestructiveCeiling, planExpired, planHashOf, reversibilityOf, sha256, withoutApproval } from './plans.js'
import { measurementsComplete, reviewAllowsRecommendation, type PracticeReport } from './practice.js'
import { effectiveLimits } from './registry.js'
import { formatLiteral } from './soql.js'
import { dataFailure, finishWithIssue, isReady, localResult, okResult, preferWriter, ready, refuse, type CallContext, type Ready, type ToolResult } from './tools.js'

/**
 * Contract section 7. A plan is a structured payload the code checks against the
 * org and completes: count, state hash, expiry, and class. Committed files hold ids,
 * field names, counts, and hashes. Values, before-state, and free text go to the
 * local store, off the repo, and the committed file binds them with `valuesHash`.
 */

type Args = Record<string, unknown>

type PlanBase = {
  version: 1
  id: string
  orgId: string
  count: number
  stateHash: string
  /** Binds what stays in the local store. */
  valuesHash: string
  briefId: string
  briefHash: string
  /** What the stamp said when the plan was written. Execution reads $.state instead, and never this. */
  briefConfirmed: boolean
  practiceReviewId: string
  reversibility: ReversibilityClass
  createdAt: string
  expiresAt: string
}

export type RecordsPlan = PlanBase & {
  kind: 'records'
  object: string
  operation: 'update' | 'delete'
  changedFields: string[]
  frozenRecordIds: string[]
  /** Set by the code on a generated restore plan: the plan whose pre-image this writes back. */
  restoreOf?: string
}

export type DeployPlan = PlanBase & {
  kind: 'deploy'
  artifactHash: string
  destructive: boolean
  /** Only a plan can name this exception, and it's in the hash. */
  ignoreWarnings?: boolean
  /** Set when this deploy puts back the snapshot taken before another plan. */
  rollbackOf?: string
}

export type Plan = RecordsPlan | DeployPlan

/** The modstamp only. The values the org held are read live for the screen, and a stored copy would only be one more place for them to leak from. */
export type RecordBefore = { id: string; systemModstamp: string }

export type PlanValues = {
  user: string
  businessObjective: string
  notes: string
  changes?: { field: string; value: string | number | boolean | null }[]
  /** The describe type of each changed field, so what the org keeps can be compared with what was sent. */
  fieldTypes?: Record<string, string>
  before?: RecordBefore[]
  /** A restore writes each record's own old values, so one value per field won't do. */
  perRecord?: Record<string, Record<string, unknown>>
  restoreOf?: string
  /** Ids a restore left alone, because they changed since. They're listed, never overwritten. */
  restoreConflicts?: string[]
  restoreAlreadyOld?: number
  artifactPath?: string
}

export type LoadedPlan = { ok: true; plan: Plan; values: PlanValues; planHash: string } | { ok: false; reason: string }

const REVIEW_NOTE = 'A practice review ran. This is a quality check. It is not evidence of safety, and it approves nothing.'
const CHUNK = 200
const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/

type StoredReview = PracticeReport & { briefHash: string; createdAt: string; usedBy: string | null }

/** Stores the measurements and writes the event under an id only this call can produce, so one review can't stand in for another plan's. */
export async function practiceRecord(args: Args, ctx: CallContext): Promise<ToolResult> {
  const report = args as unknown as PracticeReport
  if (!measurementsComplete(report)) return refuse(ctx, 'practice_record', '', '', 'A practice review reports practice, experience, security, PII, and vendor impact.')
  if (ctx.brief === null) return refuse(ctx, 'practice_record', '', '', 'A practice review needs a brief.')
  const practiceReviewId = `practice-${randomUUID()}`
  const at = new Date(ctx.now).toISOString()
  const stored: StoredReview = { practice: report.practice, experience: report.experience, security: report.security, pii: report.pii, vendorImpact: report.vendorImpact, stopRecommendation: report.stopRecommendation, confirmedChange: report.confirmedChange, briefHash: ctx.brief.hash, createdAt: at, usedBy: null }
  writeJson(localFile(ctx.storeRoot, ctx.projectRoot, 'practice', practiceReviewId), stored)
  appendJournal(ctx.projectRoot, { event: 'practice-review', correlationId: practiceReviewId, projectRoot: ctx.projectRoot, orgId: '', mode: ctx.mode, at, status: report.stopRecommendation ? 'stopped' : 'recorded', note: `For brief ${ctx.brief.hash.slice(0, 12)}. The measurements stay in the local store.` })
  return localResult(ctx, 'practice_record', { practiceReviewId, stopRecommendation: report.stopRecommendation, note: REVIEW_NOTE })
}

function reviewProblem(ctx: CallContext, practiceReviewId: unknown, proposed: string[]): string | null {
  if (typeof practiceReviewId !== 'string') return 'A plan needs a practiceReviewId. Run the sf-practice-review agent, then record it with practice_record.'
  const stored = readJson<StoredReview>(localFile(ctx.storeRoot, ctx.projectRoot, 'practice', practiceReviewId))
  if (stored === null) return 'No practice review has that id. Record one with practice_record.'
  if (!readJournal(ctx.projectRoot, practiceReviewId).some(line => line.event === 'practice-review')) return 'That practice review has no journal event, so it does not count. Record a new one with practice_record.'
  if (stored.briefHash !== ctx.brief?.hash) return 'That practice review was for another brief. Record a new one for this brief.'
  if (stored.usedBy !== null) return `That practice review already served ${stored.usedBy}. Each review serves one plan, so record a new one.`
  const allowed = reviewAllowsRecommendation(stored, proposed)
  if (!allowed.ok) return allowed.reason
  return null
}

function markReviewUsed(ctx: CallContext, practiceReviewId: string, planId: string): void {
  const file = localFile(ctx.storeRoot, ctx.projectRoot, 'practice', practiceReviewId)
  const stored = readJson<StoredReview>(file)
  if (stored !== null) writeJson(file, { ...stored, usedBy: planId })
}

/** The committed half, then the local half. The hash in the file covers everything, values included, through `valuesHash`. */
export function writePlan(ctx: { storeRoot: string; projectRoot: string }, plan: Plan, values: PlanValues): string {
  const planHash = planHashOf(plan)
  writeJson(localFile(ctx.storeRoot, ctx.projectRoot, 'plans', plan.id), values)
  writeJson(planFile(ctx.projectRoot, plan.id), { planHash, plan })
  return planHash
}

function proposedLine(ctx: CallContext, plan: Plan, planHash: string): void {
  appendJournal(ctx.projectRoot, {
    event: 'change.proposed',
    correlationId: ctx.correlationId,
    projectRoot: ctx.projectRoot,
    orgId: plan.orgId,
    mode: ctx.mode,
    at: plan.createdAt,
    status: 'proposed',
    counts: { rows: plan.count },
    ...(plan.kind === 'records' ? { object: plan.object } : {}),
    note: `Plan ${plan.id}, hash ${planHash.slice(0, 12)}, brief ${plan.briefHash.slice(0, 12)}.`,
  })
}

function planResult(ctx: CallContext, tool: string, proven: Ready, plan: Plan, planHash: string): ToolResult {
  return okResult(ctx, tool, proven, {
    planId: plan.id,
    planHash,
    kind: plan.kind,
    ...(plan.kind === 'records' ? { object: plan.object, operation: plan.operation, changedFields: plan.changedFields } : { destructive: plan.destructive }),
    count: plan.count,
    stateHash: plan.stateHash,
    expiresAt: plan.expiresAt,
    reversibility: plan.reversibility,
    reversibilityText: REVERSIBILITY_TEXT[plan.reversibility],
    briefConfirmed: plan.briefConfirmed,
    practice: { note: REVIEW_NOTE },
    next: 'Stop here. Nothing changed in the org. Execution is a separate tool, and a person approves it in a dialog built from a fresh live check.',
  })
}

function modelText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
  return out
}

/** The ids, as the code will hold them. */
function frozenIds(raw: unknown): string[] | { refused: string } {
  const given = raw as string[]
  if (given.some(id => !ID.test(id))) return { refused: 'A frozen id has to be a 15 or 18 character record id.' }
  const ids = given.map(to18)
  if (new Set(ids).size !== ids.length) return { refused: 'The frozen ids hold a duplicate, so the count would be wrong.' }
  if (new Set(ids.map(id => id.slice(0, 3))).size > 1) return { refused: 'The frozen ids are from more than one object.' }
  return ids
}

function checkChanges(operation: 'update' | 'delete', raw: Args['changes'], fields: FieldDescribe[], judged: boolean): { field: string; value: string | number | boolean | null }[] | { refused: string } {
  const changes = raw as { field: string; value: string | number | boolean | null }[]
  if (operation === 'delete') return changes.length === 0 ? [] : { refused: 'A delete takes no changes.' }
  if (changes.length === 0) return { refused: 'An update names at least one field and its new value.' }
  if (changes.length > MAX_CHANGED_FIELDS) return { refused: `One plan changes at most ${MAX_CHANGED_FIELDS} fields, because a person reads every value on one screen. Split it into more than one plan.` }
  const seen = new Set<string>()
  const out: { field: string; value: string | number | boolean | null }[] = []
  for (const change of changes) {
    const field = fields.find(item => item.name.toLowerCase() === change.field.toLowerCase())
    if (field === undefined) return { refused: `The object has no field ${change.field}.` }
    if (judged && !field.updateable) return { refused: `${field.name} cannot be updated.` }
    if (seen.has(field.name)) return { refused: `${field.name} is named twice.` }
    seen.add(field.name)
    // What a person approves has to be what is written, so a value that can't be shown whole is refused, not trimmed.
    if (typeof change.value === 'string') {
      const problem = valueProblem(change.value)
      if (problem !== null) return { refused: `The new value for ${field.name} ${problem}, so a person could not see what they approve. Nothing was planned.` }
    }
    try {
      formatLiteral(field, change.value)
    } catch (error) {
      return { refused: error instanceof Error ? error.message : `That value does not fit ${field.name}.` }
    }
    // The org answers with 18 character ids, so the plan holds that form and every later comparison agrees.
    const value = (field.type === 'id' || field.type === 'reference') && typeof change.value === 'string' ? to18(change.value) : change.value
    out.push({ field: field.name, value })
  }
  return out
}

/** Reads the frozen ids as the org holds them now. The per-record state goes to the local store, and only its hash is committed. */
async function readBefore(adapter: Adapter, ctx: CallContext, proven: Ready, object: string, ids: string[], fields: string[]): Promise<RecordBefore[] | { refused: string } | ToolResult> {
  const select = ['Id', 'SystemModstamp', ...fields].join(', ')
  const before = new Map<string, RecordBefore>()
  let rows = 0
  for (const part of chunks(ids, CHUNK)) {
    const read = await adapter.query(proven.record.username, `SELECT ${select} FROM ${object} WHERE Id IN (${part.map(id => `'${id}'`).join(', ')})`)
    if (isFailure(read)) return dataFailure(ctx, 'records_plan_update', proven, read)
    if (read.truncated) return { refused: 'The org returned only part of these records, so nothing was planned.' }
    rows += read.records.length
    for (const record of read.records) {
      const id = to18(String(record.Id))
      before.set(id, { id, systemModstamp: String(record.SystemModstamp) })
    }
  }
  appendJournal(ctx.projectRoot, { event: 'query.executed', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, orgId: proven.record.orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), soql: `SELECT ${select} FROM ${object} WHERE Id IN (:ids)`, counts: { rows } })
  const missing = ids.filter(id => !before.has(id))
  if (missing.length > 0) return { refused: `The org returned ${ids.length - missing.length} of ${ids.length} frozen ids, so nothing was planned.` }
  return ids.map(id => before.get(id) as RecordBefore)
}

export async function recordsPlanUpdate(adapter: Adapter, args: Args, ctx: CallContext): Promise<ToolResult> {
  const tool = 'records_plan_update'
  const orgId = args.orgId as string
  // A read-only user's describe says nothing about what the writer can edit.
  const who = await preferWriter(adapter, ctx, orgId)
  const proven = await ready(adapter, ctx, tool, orgId, undefined, who.as)
  if (!isReady(proven)) return proven
  const { username } = proven.record
  const operation = args.operation as 'update' | 'delete'
  const stop = (message: string) => refuse(ctx, tool, orgId, username, message)
  if (ctx.brief === null) return stop('A plan needs a brief.')
  const limits = effectiveLimits(proven.entry)
  if (!limits.allowedOperationClasses.includes('plan')) return stop("This org's limits in orgs.json don't allow plan.")

  const ids = frozenIds(args.frozenRecordIds)
  if ('refused' in ids) return stop(ids.refused)
  const count = ids.length
  if (overDestructiveCeiling({ operation, count }, limits.destructiveCeiling)) {
    const message = `Deleting ${count} records is over this org's ceiling of ${limits.destructiveCeiling}.`
    return finishWithIssue(ctx, tool, proven, issue({ kind: 'destructive-over-ceiling', orgId, orgName: proven.record.name, user: username, operationClass: 'write', message }), message)
  }

  const described = await adapter.describe(username, args.object as string)
  if (isFailure(described)) return dataFailure(ctx, tool, proven, described)
  const changes = checkChanges(operation, args.changes, described.fields, who.judged)
  if ('refused' in changes) return stop(changes.refused)
  const changedFields = changes.map(change => change.field)
  const review = reviewProblem(ctx, args.practiceReviewId, operation === 'delete' ? ['delete'] : changedFields)
  if (review !== null) return stop(review)

  const before = await readBefore(adapter, ctx, proven, described.name, ids, changedFields)
  if ('ok' in before) return before
  if ('refused' in before) return stop(before.refused)

  const values: PlanValues = { user: username, businessObjective: modelText(args.businessObjective), notes: modelText(args.notes), changes, fieldTypes: Object.fromEntries(changedFields.map(name => [name, described.fields.find(item => item.name === name)?.type ?? 'unknown'])), before }
  const createdAt = new Date(ctx.now).toISOString()
  const plan: RecordsPlan = {
    version: 1,
    kind: 'records',
    id: `plan-${randomUUID()}`,
    orgId: proven.record.orgId,
    object: described.name,
    operation,
    changedFields,
    frozenRecordIds: ids,
    count,
    stateHash: sha256(canonical(before.map(item => ({ id: item.id, systemModstamp: item.systemModstamp })).sort((left, right) => left.id.localeCompare(right.id)))),
    valuesHash: sha256(canonical(values)),
    briefId: args.briefId as string,
    briefHash: ctx.brief.hash,
    briefConfirmed: ctx.brief.confirmed,
    practiceReviewId: args.practiceReviewId as string,
    reversibility: reversibilityOf({ kind: 'records', operation }),
    createdAt,
    expiresAt: expiryFrom(ctx.now),
  }
  const planHash = writePlan(ctx, plan, values)
  markReviewUsed(ctx, plan.practiceReviewId, plan.id)
  proposedLine(ctx, plan, planHash)
  return planResult(ctx, tool, proven, plan, planHash)
}

export async function deploymentPlan(adapter: Adapter, args: Args, ctx: CallContext): Promise<ToolResult> {
  const tool = 'deployment_plan'
  const orgId = args.orgId as string
  const proven = await ready(adapter, ctx, tool, orgId)
  if (!isReady(proven)) return proven
  const { username } = proven.record
  const stop = (message: string) => refuse(ctx, tool, orgId, username, message)
  if (ctx.brief === null) return stop('A plan needs a brief.')
  if (!effectiveLimits(proven.entry).allowedOperationClasses.includes('plan')) return stop("This org's limits in orgs.json don't allow plan.")
  const review = reviewProblem(ctx, args.practiceReviewId, ['deploy'])
  if (review !== null) return stop(review)
  const rollbackOf = typeof args.rollbackOf === 'string' ? args.rollbackOf : undefined
  if ((rollbackOf === undefined) === (typeof args.artifactPath !== 'string')) return stop('A deploy plan names an artifact, or a plan whose snapshot it puts back. One of them.')
  let artifact: { hash: string; files: number }
  let artifactPath: string
  if (rollbackOf !== undefined) {
    let bytes: Buffer
    try {
      bytes = readFileSync(snapshotFile(ctx.storeRoot, ctx.projectRoot, rollbackOf))
    } catch {
      return stop('No rollback snapshot of that plan is on this machine.')
    }
    artifact = { hash: sha256(bytes), files: 1 }
    artifactPath = snapshotArtifact(rollbackOf)
  } else {
    const placed = placeArtifact(ctx.projectRoot, args.artifactPath as string)
    if ('problem' in placed) return stop(placed.problem)
    const unreadable = artifactProblem(placed.real)
    if (unreadable !== null) return stop(unreadable)
    artifact = hashArtifactAt(placed.real)
    artifactPath = args.artifactPath as string
  }
  const values: PlanValues = { user: username, businessObjective: modelText(args.businessObjective), notes: modelText(args.notes), artifactPath }
  const plan: DeployPlan = {
    version: 1,
    kind: 'deploy',
    id: `plan-${randomUUID()}`,
    orgId: proven.record.orgId,
    artifactHash: artifact.hash,
    destructive: args.destructive as boolean,
    ...(args.ignoreWarnings === true ? { ignoreWarnings: true } : {}),
    ...(rollbackOf !== undefined ? { rollbackOf } : {}),
    count: artifact.files,
    stateHash: sha256(canonical({ orgId: proven.record.orgId, artifactHash: artifact.hash, files: artifact.files })),
    valuesHash: sha256(canonical(values)),
    briefId: args.briefId as string,
    briefHash: ctx.brief.hash,
    briefConfirmed: ctx.brief.confirmed,
    practiceReviewId: args.practiceReviewId as string,
    reversibility: reversibilityOf({ kind: 'deploy' }),
    createdAt: new Date(ctx.now).toISOString(),
    expiresAt: expiryFrom(ctx.now),
  }
  const planHash = writePlan(ctx, plan, values)
  markReviewUsed(ctx, plan.practiceReviewId, plan.id)
  proposedLine(ctx, plan, planHash)
  return planResult(ctx, tool, proven, plan, planHash)
}

function isPlanShape(value: unknown): value is Plan {
  if (value === null || typeof value !== 'object') return false
  const plan = value as Partial<Plan>
  return (plan.kind === 'records' || plan.kind === 'deploy') && typeof plan.id === 'string' && typeof plan.briefId === 'string' && typeof plan.briefHash === 'string' && typeof plan.valuesHash === 'string' && typeof plan.expiresAt === 'string'
}

/**
 * The one way to read a plan back, for execution and reconcile. Any edit voids it: to the
 * committed file, to the local values, or to the brief it chains to. It does not say
 * the brief was confirmed. Execution compares `plan.briefHash` with $.state.
 */
export function loadPlan(storeRoot: string, projectRoot: string, planId: string, now: number, options: { allowExpired?: boolean } = {}): LoadedPlan {
  try {
    safeId(planId)
    const file = readJson<{ planHash?: unknown; plan?: unknown }>(planFile(projectRoot, planId))
    if (file === null) return { ok: false, reason: `No plan has the id ${planId}.` }
    if (!isPlanShape(file.plan)) return { ok: false, reason: 'That plan file is not a plan.' }
    const plan = withoutApproval(file.plan) as Plan
    const planHash = planHashOf(plan)
    if (planHash !== file.planHash) return { ok: false, reason: 'That plan was edited after it was written: its hash no longer matches. Write a new plan.' }
    const values = readJson<PlanValues>(localFile(storeRoot, projectRoot, 'plans', planId))
    if (values === null) return { ok: false, reason: "That plan's values aren't on this machine. A teammate's plan is written again here." }
    if (sha256(canonical(values)) !== plan.valuesHash) return { ok: false, reason: "That plan's local values were edited after it was written. Write a new plan." }
    // Reading back what already happened needs the plan after it expired. Writing doesn't get this.
    if (options.allowExpired !== true && planExpired(plan, now)) return { ok: false, reason: `That plan expired at ${plan.expiresAt}. Write a new plan.` }
    const brief = readBrief(storeRoot, projectRoot, plan.briefId)
    if (brief === null) return { ok: false, reason: "That plan's brief isn't on this machine. Propose it again and write a new plan." }
    if (brief.briefHash !== plan.briefHash) return { ok: false, reason: 'The brief this plan chains to was edited, so the plan is void. Write a new plan.' }
    return { ok: true, plan, values, planHash }
  } catch (error) {
    return { ok: false, reason: error instanceof UnreadableFileError ? error.message : 'That plan could not be read.' }
  }
}
