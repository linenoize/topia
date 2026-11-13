import { isFailure, type Adapter, type DeployChecks as OrgChecks, type DeployStatus, type Failure, type LiveUser } from './adapter.js'
import { plainText, REDEPLOY_CANNOT_RESTORE } from './contract.js'
import { acceptValidation, baselineOf, buildZip, differencesFromZip, driftBetween, packageXml, readStoredZip, snapshotFile, zipFile, type Baseline, type BuiltZip, type Manifest } from './deploy-zip.js'
import { sameId } from './identity.js'
import { appendJournal, readJournal } from './journal.js'
import { readJson, readJsonFile, writeFileAtomic, writeJson } from './json-file.js'
import { acquireRun, readLedger, writeLedger, type DeployChecks, type DeployLedger } from './ledger.js'
import { localFile } from './paths.js'
import { loadPlan, type DeployPlan, type RecordsPlan } from './plan-tools.js'
import { reconcileData, reconcileRecords } from './records-state.js'
import { readPreImage } from './preimage.js'
import { effectiveLimits } from './registry.js'
import { dataFailure, isReady, okResult, preferWriter, ready, refuse, writeCheck, type CallContext, type ToolResult } from './tools.js'

/**
 * Contract section 8, the check-only half, which the stdio server can reach: it
 * validates and verifies, and nothing here can apply a deploy. deploy-run.ts is the
 * half only the runner loads.
 */

export type Checker = Adapter & OrgChecks

export type ValidationState = 'in-progress' | 'passed' | 'failed'

export type ValidationRecord = {
  version: 1
  planId: string
  planHash: string
  orgId: string
  /** The path this org takes, from the live flag at the time. */
  path: 'validate' | 'dry-run'
  /** A local note of a job. It's checked against the org before anyone relies on it. */
  jobId: string
  zipHash: string
  startedAt: string
  baseline: Baseline
  state: ValidationState
  problems: string[]
}

const VALIDATE_BUDGET_MS = 45_000
const POLL_INTERVAL_MS = 5000
const RUNNING = new Set(['Pending', 'InProgress', 'Canceling', 'Finalizing', 'Queued'])

/** The Apex a zip holds, as `ApexClass:Name`. A zip with any runs model-written code when it is validated. */
export function apexIn(manifest: Manifest): string[] {
  return manifest.members.filter(member => /^(?:ApexClass|ApexTrigger):/.test(member))
}

export const APEX_NEEDS_PERSON = 'This zip holds Apex, and validating it runs that code in the org with every local test. Under stdio there is no person to approve that. A person runs /topia-sf:validate and the assistant calls sf_deployment_validate, which opens a dialog that says so.'
export const VALIDATE_NEEDS_HOOKS = "Deployment validation needs a host where Topia's hooks run, and this call carries no stamp from one. Hosts without hooks are read-only, so nothing was validated."

export function isRunning(status: string): boolean {
  return RUNNING.has(status)
}

export function validationFile(storeRoot: string, projectRoot: string, planId: string): string {
  return localFile(storeRoot, projectRoot, 'validations', planId)
}

export function readValidation(storeRoot: string, projectRoot: string, planId: string): ValidationRecord | null {
  const read = readJson<ValidationRecord>(validationFile(storeRoot, projectRoot, planId))
  if (read === null) return null
  if (typeof read !== 'object' || read.version !== 1 || read.planId !== planId || typeof read.jobId !== 'string') throw new Error('That validation record is not one.')
  return read
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** The members a retrieve has to name to see what this deploy would touch. */
export function retrieveManifest(manifest: Manifest): string {
  return packageXml([...manifest.members, ...manifest.destructive])
}

function expectedFor(plan: DeployPlan, built: BuiltZip, user: LiveUser, now: number, production: boolean) {
  return { userId: user.id, members: built.manifest.members, destructive: built.manifest.destructive, ignoreWarnings: plan.ignoreWarnings === true, now, production }
}

function validationData(record: ValidationRecord, job: DeployStatus | null): Record<string, unknown> {
  const stateNext: Record<ValidationState, string> = {
    'in-progress': 'Still running in the org. Call deployment_validate again with this planId to pick it up. It starts nothing new.',
    passed: 'It counts for now. Any later deployment, by anyone, voids it, and so do 10 days from when it started. The next step is /topia-sf:deploy, where a person approves.',
    failed: 'It does not count. Fix what it names, then call deployment_validate with revalidate. Nothing falls back to a full deploy.',
  }
  return {
    planId: record.planId,
    state: record.state,
    path: record.path,
    jobId: record.jobId,
    startedAt: record.startedAt,
    problems: record.problems,
    ...(job === null ? {} : { status: job.status, checkOnly: job.checkOnly, success: job.success, runTestsEnabled: job.runTestsEnabled, numberTestsCompleted: job.numberTestsCompleted, numberTestErrors: job.numberTestErrors, numberComponentErrors: job.numberComponentErrors, exit: job.exit }),
    doesNotProve: ['how existing records behave against a new rule or required field', 'flow behaviour', 'newer changes in the org: a validate overwrites them with no conflict check'],
    next: stateNext[record.state],
  }
}

export async function deploymentValidate(adapter: Checker, args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> {
  const tool = 'deployment_validate'
  const orgId = args.orgId as string
  const planId = args.planId as string
  // Check-only, but it has to run as the user who'd ship it: a quick deploy needs the same user, and a read-only one can't start a job.
  const live = await writeCheck(adapter, ctx, tool, orgId)
  if ('ok' in live) return live
  const proven = live.ready
  const { username } = proven.record
  const stop = (message: string) => refuse(ctx, tool, orgId, username, message)
  // The runner sets apexApproved after a person answered. Nothing on stdio can.
  if (ctx.apexApproved !== true && ctx.stamp === null) return stop(VALIDATE_NEEDS_HOOKS)
  if (!effectiveLimits(proven.entry).allowedOperationClasses.includes('validate')) return stop("This org's limits in orgs.json don't allow validate.")
  const loaded = loadPlan(ctx.storeRoot, ctx.projectRoot, planId, ctx.now)
  if (!loaded.ok) return stop(loaded.reason)
  if (loaded.plan.kind !== 'deploy') return stop('That plan is not a deploy plan.')
  const plan = loaded.plan
  if (!sameId(plan.orgId, proven.record.orgId)) return stop('That plan is for another org.')
  if (ctx.apexApproved !== true && ctx.stamp !== null && ctx.stamp.confirmedBriefHash !== plan.briefHash) return stop('That plan chains to a brief a person has not confirmed. Call sf_brief_confirm first.')
  const ledger = readLedger(ctx.storeRoot, ctx.projectRoot, plan.id)
  if (ledger.state === 'unreadable') return stop('The ledger for this plan can not be read, so nothing was validated.')
  if (ledger.state !== 'missing' && !(ledger.entry.kind === 'deploy' && ledger.entry.refused)) return stop('A deploy under this plan has already started, so validating it again means nothing. /topia-sf:verify reads it.')

  const held = readJsonFile<ValidationRecord>(validationFile(ctx.storeRoot, ctx.projectRoot, plan.id))
  if (held.state === 'unreadable') return stop('The validation record for this plan can not be read. Pass revalidate to start again.')
  let record: ValidationRecord
  let built: BuiltZip
  if (held.state === 'ok' && args.revalidate !== true && held.value.planHash === loaded.planHash) {
    record = held.value
    const stored = readStoredZip(ctx.storeRoot, ctx.projectRoot, plan.id, plan.artifactHash, record.zipHash)
    if ('problem' in stored) return stop(stored.problem)
    built = stored
    if (ctx.apexApproved !== true && apexIn(built.manifest).length > 0) return stop(APEX_NEEDS_PERSON)
  } else {
    const fresh = buildZip(ctx.storeRoot, ctx.projectRoot, loaded.values.artifactPath ?? '', plan.artifactHash)
    if ('problem' in fresh) return stop(fresh.problem)
    built = fresh
    if (ctx.apexApproved !== true && apexIn(built.manifest).length > 0) return stop(APEX_NEEDS_PERSON)
    const baseline = await adapter.retrieveManifest(username, retrieveManifest(built.manifest))
    if (isFailure(baseline)) return dataFailure(ctx, tool, proven, baseline)
    if (!baseline.success) return stop('The baseline retrieve did not succeed, so nothing was validated.')
    const file = zipFile(ctx.storeRoot, ctx.projectRoot, plan.id)
    writeFileAtomic(file, built.bytes)
    const path = live.facts.isSandbox ? 'dry-run' : 'validate'
    const started = await adapter.deployCheck(username, path === 'validate' ? 'deploy.validate' : 'deploy.dry-run', file, { ignoreWarnings: plan.ignoreWarnings === true })
    if (isFailure(started)) return dataFailure(ctx, tool, proven, started)
    // On disk before anything polls, so a later call can pick the job up.
    record = { version: 1, planId: plan.id, planHash: loaded.planHash, orgId: plan.orgId, path, jobId: started.id, zipHash: built.hash, startedAt: new Date(ctx.now).toISOString(), baseline: baselineOf(baseline), state: 'in-progress', problems: [] }
    writeJson(validationFile(ctx.storeRoot, ctx.projectRoot, plan.id), record)
    appendJournal(ctx.projectRoot, { event: 'deploy.validated', correlationId: plan.id, planId: plan.id, jobId: started.id, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at: record.startedAt, status: 'started', note: `A ${path} job started, check only.` })
  }

  const deadline = Date.now() + (ctx.pollBudgetMs ?? VALIDATE_BUDGET_MS)
  for (;;) {
    const job = await adapter.deployReport(username, record.jobId)
    if (isFailure(job)) return dataFailure(ctx, tool, proven, job)
    if (!job.done && isRunning(job.status)) {
      if (Date.now() >= deadline) return okResult(ctx, tool, proven, validationData({ ...record, state: 'in-progress' }, job))
      await wait(ctx.pollIntervalMs ?? POLL_INTERVAL_MS)
      continue
    }
    const problems = acceptValidation(job, expectedFor(plan, built, live.user, ctx.now, !live.facts.isSandbox))
    const decided: ValidationRecord = { ...record, state: problems.length === 0 ? 'passed' : 'failed', problems }
    writeJson(validationFile(ctx.storeRoot, ctx.projectRoot, plan.id), decided)
    appendJournal(ctx.projectRoot, { event: 'deploy.validated', correlationId: plan.id, planId: plan.id, jobId: record.jobId, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), status: decided.state })
    return okResult(ctx, tool, proven, validationData(decided, job), { ok: problems.length === 0 })
  }
}

// ── reading a deploy back ───────────────────────────────────────────────────

export function noChecks(): DeployChecks {
  return { components: 'not-run', retrieve: 'not-run', audit: 'not-run', identity: 'not-run' }
}

/** A failed check stays failed, whatever a later read says. */
export function mergeChecks(before: DeployChecks, next: DeployChecks): DeployChecks {
  return {
    components: before.components === 'failed' ? 'failed' : next.components,
    retrieve: before.retrieve === 'failed' ? 'failed' : next.retrieve,
    audit: next.audit,
    identity: before.identity === 'failed' ? 'failed' : next.identity,
  }
}

export type DeployOutcome = { status: 'done' | 'partial' | 'unknown' | 'started' | 'refused' | 'unreadable' | 'missing'; entry: DeployLedger | null; note: string | null }

const NEXT: Record<DeployOutcome['status'], string> = {
  done: 'It shipped. The component, retrieve, and identity checks passed. Setup Audit Trail was read, not judged: the deploy explains its own rows, so that check says only that the trail could be read.',
  partial: 'A post-deploy check failed, or the job did not fully succeed. That stays failed, and this plan does not run again. A fix is a new plan.',
  unknown: 'Unknown. It may have landed, and it is never retried. /topia-sf:verify queries it, and the Deployment Status page in Setup shows it too.',
  started: 'Still running in the org. Nothing was sent again. A deploy that may have landed is queried, never retried, so call this again to read it.',
  refused: 'Salesforce refused that validation, so nothing shipped, and never a full deploy instead. Call deployment_validate with revalidate, then come back for a new approval.',
  unreadable: "The ledger can't be read, so this plan stops here, and nothing was sent again. A fix is a new plan.",
  missing: 'Nothing has shipped under this plan, as far as this machine knows.',
}

export function rollbackOffer(planId: string, hasSnapshot: boolean): string {
  const first = `What a redeploy can't restore: ${REDEPLOY_CANNOT_RESTORE.join(', ')}. Components this deploy added stay, because the snapshot only holds what was there before.`
  return hasSnapshot ? `${first} Putting the snapshot back is a new plan: deployment_plan with rollbackOf ${planId}, then its own validation and dialog. It voids other validations.` : `${first} No snapshot of the org from before this deploy is on this machine.`
}

export function deployData(planId: string, outcome: DeployOutcome, options: { snapshot: boolean }): Record<string, unknown> {
  const entry = outcome.entry
  const landed = entry?.canceled !== true && (outcome.status === 'done' || (outcome.status === 'partial' && entry?.jobStatus !== 'Failed'))
  const cancelNote = entry?.jobStatus === 'Canceling' ? " It is Canceling, which means it isn't stopped yet." : ''
  return {
    planId,
    status: outcome.status,
    deployId: entry?.deployId ?? null,
    validationJobId: entry?.validationJobId ?? null,
    path: entry?.path ?? null,
    jobStatus: entry?.jobStatus ?? null,
    checks: entry?.checks ?? noChecks(),
    failedChecks: entry?.failedChecks ?? [],
    canceled: entry?.canceled ?? false,
    note: outcome.note ?? entry?.note ?? null,
    wrongOrg: entry?.wrongOrg ?? null,
    ...(landed ? { rollback: rollbackOffer(planId, options.snapshot) } : {}),
    next: `${NEXT[outcome.status]}${cancelNote}`,
  }
}

/** What the org shows for this deploy, with everything it can compare. Read-only, so any step may call it. */
async function runChecks(adapter: Checker, ctx: { now: number }, proven: { record: { username: string; orgId: string; name: string } }, plan: DeployPlan, built: BuiltZip | null, job: DeployStatus, user: LiveUser | null, startedAt: string): Promise<{ checks: DeployChecks; failed: string[]; wrongOrg: string | null }> {
  const { username, orgId, name } = proven.record
  const failed: string[] = []
  const checks = noChecks()
  if (built !== null) {
    const seen = new Map(job.successes.map(item => [`${item.type}:${item.fullName}`, item]))
    const flat = built.manifest.members.filter(member => {
      const row = seen.get(member)
      return row === undefined || (!row.changed && !row.created)
    })
    const stayed = built.manifest.destructive.filter(member => seen.get(member)?.deleted !== true)
    checks.components = flat.length === 0 && stayed.length === 0 ? 'passed' : 'failed'
    for (const member of flat) failed.push(`${member} showed neither changed nor created.`)
    for (const member of stayed) failed.push(`${member} did not show as deleted.`)
    const read = await adapter.retrieveManifest(username, retrieveManifest(built.manifest))
    if (isFailure(read)) checks.retrieve = 'could-not-check'
    else {
      const differs = differencesFromZip(built, read)
      checks.retrieve = differs.length === 0 ? 'passed' : 'failed'
      for (const path of differs.slice(0, 20)) failed.push(`${path} reads back different from what shipped.`)
    }
  } else checks.retrieve = 'could-not-check'
  if (user === null) checks.audit = 'could-not-check'
  else {
    const trail = await adapter.query(username, `SELECT Action, Section, CreatedDate FROM SetupAuditTrail WHERE CreatedById = '${user.id}' AND CreatedDate >= ${new Date(Date.parse(startedAt) - 60_000).toISOString()} ORDER BY CreatedDate DESC LIMIT 200`)
    // Passed means the trail could be read. Its rows are the deploy's own, so there is nothing to compare them with.
    checks.audit = isFailure(trail) ? 'could-not-check' : 'passed'
  }
  const live = await adapter.liveOrg(username)
  let wrongOrg: string | null = null
  if (isFailure(live)) checks.identity = 'could-not-check'
  else if (sameId(live.orgId, orgId)) checks.identity = 'passed'
  else {
    checks.identity = 'failed'
    wrongOrg = `Written to the wrong org. This was approved for ${plainText(name, 80)} (${orgId}), and the login now reaches ${plainText(live.name, 80)} (${live.orgId}).`
  }
  void ctx
  void plan
  return { checks, failed, wrongOrg }
}

/** A cancel is verified against the snapshot: the org should still be what it was. */
async function checkCancel(adapter: Checker, username: string, built: BuiltZip | null, snapshot: Baseline | null): Promise<DeployChecks['retrieve']> {
  if (built === null || snapshot === null) return 'could-not-check'
  const read = await adapter.retrieveManifest(username, retrieveManifest(built.manifest))
  if (isFailure(read)) return 'could-not-check'
  return driftBetween(snapshot, baselineOf(read)).length === 0 ? 'passed' : 'failed'
}

export type SettleInput = {
  adapter: Checker
  ctx: { storeRoot: string; projectRoot: string; now: number; mode: string }
  proven: { record: { username: string; orgId: string; name: string } }
  plan: DeployPlan
  user: LiveUser | null
  entry: DeployLedger
  /** The ledger can't be read: this reports, and it must not write over the evidence. */
  readOnly?: boolean
}

function journalExecuted(ctx: SettleInput['ctx'], plan: DeployPlan, components: number, status: string): void {
  appendJournal(ctx.projectRoot, { event: 'change.executed', correlationId: plan.id, planId: plan.id, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at: new Date(ctx.now).toISOString(), status, counts: { rows: components } })
}

/** Asks the org about the deploy on the ledger. It never sends anything. */
export async function settleDeploy(input: SettleInput): Promise<DeployOutcome> {
  const { adapter, ctx, proven, plan, entry, user } = input
  const save = (next: DeployLedger) => {
    if (input.readOnly !== true) writeLedger(ctx.storeRoot, ctx.projectRoot, next)
  }
  const at = new Date(ctx.now).toISOString()
  if (entry.deployId === null) {
    const next: DeployLedger = { ...entry, state: 'unknown', updatedAt: at, note: entry.note ?? 'The deploy may have started, and no deploy id came back. It is never retried. The Deployment Status page in Setup shows what happened.' }
    save(next)
    return { status: 'unknown', entry: next, note: next.note ?? null }
  }
  const job = await adapter.deployReport(proven.record.username, entry.deployId)
  if (isFailure(job)) {
    const note = failureNote(job)
    const next: DeployLedger = { ...entry, state: entry.state === 'done' ? 'done' : entry.state === 'started' ? 'started' : 'unknown', note, updatedAt: at }
    save(next)
    return { status: next.state, entry: next, note }
  }
  if (!job.done && isRunning(job.status)) {
    const next: DeployLedger = { ...entry, state: 'started', jobStatus: job.status, updatedAt: at }
    save(next)
    return { status: 'started', entry: next, note: null }
  }
  const validation = readValidation(ctx.storeRoot, ctx.projectRoot, plan.id)
  const stored = validation === null ? null : readStoredZip(ctx.storeRoot, ctx.projectRoot, plan.id, plan.artifactHash, validation.zipHash)
  const built = stored === null || 'problem' in stored ? null : stored

  if (job.status === 'Canceled') {
    const retrieve = await checkCancel(adapter, proven.record.username, built, validation?.baseline ?? null)
    const checks = { ...noChecks(), retrieve }
    const next: DeployLedger = { ...entry, state: retrieve === 'passed' ? 'partial' : 'unknown', jobStatus: job.status, canceled: true, checks, updatedAt: at, note: retrieve === 'passed' ? 'Canceled, and the org still reads as it did before.' : "Canceled, and the org couldn't be confirmed to read as it did before. Parts of it may have been committed." }
    save(next)
    appendJournal(ctx.projectRoot, { event: 'deploy.canceled', correlationId: plan.id, planId: plan.id, jobId: entry.deployId, projectRoot: ctx.projectRoot, orgId: plan.orgId, mode: ctx.mode, at, status: next.state })
    return { status: next.state as DeployOutcome['status'], entry: next, note: next.note ?? null }
  }

  if (job.status === 'Failed') {
    const failedChecks = [...new Set([...entry.failedChecks, `The job ended as Failed. ${job.numberComponentErrors} component and ${job.numberTestErrors} test errors.`])]
    const next: DeployLedger = { ...entry, state: 'partial', jobStatus: job.status, failedChecks, updatedAt: at, note: 'The job failed and it rolls back on error, so nothing should have landed. It is not retried.' }
    save(next)
    return { status: 'partial', entry: next, note: next.note ?? null }
  }

  if (job.status !== 'Succeeded' && job.status !== 'SucceededPartial') {
    const next: DeployLedger = { ...entry, state: 'unknown', jobStatus: job.status, updatedAt: at, note: `The job is in a state this version doesn't recognize: ${plainText(job.status, 40)}.` }
    save(next)
    return { status: 'unknown', entry: next, note: next.note ?? null }
  }

  const ran = await runChecks(adapter, ctx, proven, plan, built, job, user, entry.startedAt)
  const checks = mergeChecks(entry.checks, ran.checks)
  const failedChecks = [...new Set([...entry.failedChecks, ...ran.failed, ...(job.status === 'SucceededPartial' ? ['The job ended as SucceededPartial: part of it landed.'] : [])])]
  const wrongOrg = entry.wrongOrg ?? ran.wrongOrg ?? undefined
  const clean = failedChecks.length === 0 && Object.values(checks).every(item => item === 'passed')
  const state = wrongOrg !== undefined ? 'unknown' : clean ? 'done' : 'partial'
  const next: DeployLedger = { ...entry, state, jobStatus: job.status, checks, failedChecks, updatedAt: at, ...(wrongOrg !== undefined ? { wrongOrg } : {}) }
  save(next)
  const firstLanding = entry.jobStatus !== 'Succeeded' && entry.jobStatus !== 'SucceededPartial'
  if (firstLanding && input.readOnly !== true) journalExecuted(ctx, plan, (built?.manifest.members.length ?? 0) + (built?.manifest.destructive.length ?? 0), state)
  return { status: state, entry: next, note: null }
}

function failureNote(failure: Failure): string {
  if (failure.failure === 'rate-limit') return "The org's API rate limit was reached, so the deploy couldn't be read. It may have landed, and it keeps running either way."
  return `The deploy couldn't be read, so this isn't settled: ${plainText(failure.message, 200)}`
}

/** A ledger that vanished: the journal is the other place the deploy id is written. */
export function recoverDeployEntry(projectRoot: string, plan: DeployPlan, planHash: string, at: string): DeployLedger | null {
  let lines: ReturnType<typeof readJournal>
  try {
    lines = readJournal(projectRoot, plan.id)
  } catch {
    return null
  }
  const started = lines.filter(line => line.event === 'change.started')
  const first = started[0]
  if (first === undefined) return null
  const deployId = started.map(line => line.jobId).filter((id): id is string => typeof id === 'string').pop() ?? null
  return { version: 1, kind: 'deploy', planId: plan.id, planHash, orgId: plan.orgId, state: 'unknown', deployId, validationJobId: null, path: first.note === 'quick' ? 'quick' : 'start', startedAt: first.at, jobStatus: null, checks: noChecks(), refused: false, failedChecks: [], canceled: false, updatedAt: at, note: 'The ledger for this plan was gone, and this came back from the journal.' }
}

export function hasSnapshot(storeRoot: string, projectRoot: string, planId: string): boolean {
  const read = readJsonFile(snapshotFile(storeRoot, projectRoot, planId))
  return read.state !== 'missing'
}

// ── deployment_verify ───────────────────────────────────────────────────────

/** Read-only in the org. It can write the local ledger, because that's where what it found lives. */
export async function deploymentVerify(adapter: Checker, args: Record<string, unknown>, ctx: CallContext): Promise<ToolResult> {
  const tool = 'deployment_verify'
  const orgId = args.orgId as string
  const planId = args.planId as string
  const proven = await ready(adapter, ctx, tool, orgId, undefined, (await preferWriter(adapter, ctx, orgId)).as)
  if (!isReady(proven)) return proven
  const { username } = proven.record
  const stop = (message: string) => refuse(ctx, tool, orgId, username, message)
  const loaded = loadPlan(ctx.storeRoot, ctx.projectRoot, planId, ctx.now, { allowExpired: true })
  if (!loaded.ok) return stop(loaded.reason)
  if (!sameId(loaded.plan.orgId, proven.record.orgId)) return stop('That plan is for another org.')
  if (ctx.stamp !== null && ctx.stamp.confirmedBriefHash !== loaded.plan.briefHash) return stop('That plan chains to a brief a person has not confirmed. Call sf_brief_confirm first.')
  const held = acquireRun(ctx.storeRoot, ctx.projectRoot, planId)
  if (held === null) return stop('A run for this plan is going on this machine. Read it again when that finishes.')
  try {
    const ledger = readLedger(ctx.storeRoot, ctx.projectRoot, planId)
    if (loaded.plan.kind === 'records') {
      const plan = loaded.plan as RecordsPlan
      const rec = await reconcileRecords(adapter, { projectRoot: ctx.projectRoot, storeRoot: ctx.storeRoot, now: ctx.now, mode: ctx.mode, correlationId: plan.id }, username, plan, loaded.values, loaded.planHash, ledger)
      const preimage = readPreImage(ctx.storeRoot, ctx.projectRoot, plan.id, ctx.now)
      return okResult(ctx, tool, proven, { ...reconcileData(plan, rec), preImage: preimage.state, reconciled: true, checked: ['ledger', 'each frozen record against the org', 'fields beyond the target, when a pre-image is here'], not_checked: ['what automation sent', 'callouts'] })
    }
    const plan = loaded.plan
    const user = await adapter.liveUser(username)
    const snapshot = hasSnapshot(ctx.storeRoot, ctx.projectRoot, plan.id)
    if (ledger.state === 'unreadable') {
      const recovered = recoverDeployEntry(ctx.projectRoot, plan, loaded.planHash, new Date(ctx.now).toISOString())
      if (recovered === null) return okResult(ctx, tool, proven, deployData(plan.id, { status: 'unreadable', entry: null, note: "The ledger can't be read, and the journal holds no deploy id. The Deployment Status page in Setup shows what happened." }, { snapshot }))
      const read = await settleDeploy({ adapter, ctx, proven, plan, user: isFailure(user) ? null : user, entry: recovered, readOnly: true })
      return okResult(ctx, tool, proven, deployData(plan.id, { ...read, status: 'unreadable' }, { snapshot }))
    }
    const entry = ledger.state === 'missing' ? recoverDeployEntry(ctx.projectRoot, plan, loaded.planHash, new Date(ctx.now).toISOString()) : (ledger.entry as DeployLedger)
    if (entry === null) return okResult(ctx, tool, proven, deployData(plan.id, { status: 'missing', entry: null, note: null }, { snapshot }))
    if (entry.refused) return okResult(ctx, tool, proven, deployData(plan.id, { status: 'refused', entry, note: null }, { snapshot }))
    const outcome = await settleDeploy({ adapter, ctx, proven, plan, user: isFailure(user) ? null : user, entry })
    return okResult(ctx, tool, proven, deployData(plan.id, outcome, { snapshot }))
  } finally {
    held.release()
  }
}
