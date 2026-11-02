import { isAbsolute } from 'node:path'

import { disableProject, enableProject, lockState } from './activation.js'
import type { Failure, WriteAccess } from './adapter.js'
import { plainText, writerNoticeFor, type IssueKind, type OrgRecord, type SfMode } from './contract.js'
import { appendJournal } from './journal.js'
import { defaultStoreRoot, sessionKey } from './paths.js'
import { redactValue } from './redact.js'
import { listOrgRecords, listWriters, readWriter, setWriterLogin } from './registry.js'
import { readStore } from './store.js'

/**
 * What the mod calls through $.process.run: a command in argv, JSON on stdin,
 * JSON on stdout. The mod keeps no copy of the lock, so this is how it reads and
 * changes it. A refusal exits 0 with ok:false. Exit 2 is a bad call. The CLI code
 * loads only for the commands that use it, because `status` runs after every turn.
 */

type Input = Record<string, unknown>

const ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/

function projectRootOf(input: Input): string | null {
  const root = input.projectRoot
  return typeof root === 'string' && root.length > 0 && isAbsolute(root) ? root : null
}

function status(projectRoot: string, storeRoot: string): unknown {
  const lock = lockState(storeRoot, projectRoot)
  if (lock.state !== 'on') return { lock, session: null, registeredOrgs: 0 }
  const data = readStore(storeRoot)
  const writerNotice = writerNoticeFor(listWriters(storeRoot, projectRoot))
  return { lock, session: data[sessionKey(projectRoot)] ?? null, registeredOrgs: listOrgRecords(storeRoot, projectRoot).length, writerNotice, writerCheck: writerNotice !== null }
}

/**
 * Looks at each writer's login. Only a person logs one out, so this only reads, and
 * the band says what it found. Not being able to tell reads as still logged in.
 */
async function writerCheck(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const writers = listWriters(storeRoot, projectRoot)
  if (lockState(storeRoot, projectRoot).state !== 'on' || writers.length === 0) return { ok: true, writers: [] }
  const { isFailure } = await import('./adapter.js')
  const adapter = await adapterFor(projectRoot, input)
  const found: { orgId: string; state: 'logged-in' | 'logged-out' | 'unknown' }[] = []
  for (const writer of writers) {
    const display = await adapter.display(writer.username)
    const state = !isFailure(display) ? 'logged-in' : display.failure === 'expired-auth' ? 'logged-out' : 'unknown'
    setWriterLogin(storeRoot, projectRoot, writer.orgId, { state, checkedAt: new Date(now).toISOString() })
    found.push({ orgId: writer.orgId, state })
    // The band shows the last live check. If that was the writer, it goes back to the reader the same way.
    const session = readStore(storeRoot)[sessionKey(projectRoot)] as { identity?: { user?: unknown } | null } | null | undefined
    if (state === 'logged-out' && session?.identity?.user === writer.username) {
      const { callTool } = await import('./tools.js')
      await callTool(adapter, 'org_inspect', { orgId: writer.orgId }, { projectRoot, storeRoot, correlationId: `writer-check-${now}`, now })
    }
  }
  return { ok: true, writers: found }
}

function changeLock(projectRoot: string, storeRoot: string, change: () => unknown): unknown {
  const before = lockState(storeRoot, projectRoot)
  if (before.state === 'unreadable') return { ok: false, reason: before.message }
  return change()
}

function refusalWhenOff(projectRoot: string, storeRoot: string): string | null {
  const lock = lockState(storeRoot, projectRoot)
  switch (lock.state) {
    case 'on':
      return null
    case 'off':
      return 'Salesforce is not on for this project. /topia:sf:enable turns it on.'
    case 'unreadable':
      return lock.message
    default: {
      const exhaustive: never = lock
      return exhaustive
    }
  }
}

function reasonFor(failure: Failure): string {
  switch (failure.failure) {
    case 'expired-auth':
      return `The Salesforce login has expired or is missing, so a person has to log in with the Salesforce CLI first. ${failure.message}`
    case 'rate-limit':
      return `The org's API rate limit was reached. Nothing was written. ${failure.message}`
    default:
      return failure.message
  }
}

async function adapterFor(projectRoot: string, input: Input) {
  const { SfCliAdapter } = await import('./sf-adapter.js')
  const timeoutMs = typeof input.timeoutMs === 'number' ? Math.min(Math.max(input.timeoutMs, 100), 300_000) : undefined
  return new SfCliAdapter({ env: process.env, projectRoot, timeoutMs })
}

/**
 * Everything the dialog shows, read live. The target is used once, to turn an
 * alias into a username. Every later call targets the username, because an alias
 * can be re-pointed between two calls.
 */
async function orgResolve(projectRoot: string, storeRoot: string, input: Input): Promise<unknown> {
  const off = refusalWhenOff(projectRoot, storeRoot)
  if (off !== null) return { ok: false, reason: off }
  const { assertTarget } = await import('./sf-cli.js')
  const { isFailure } = await import('./adapter.js')
  const { classFromLive, hostOf, sameId, to18 } = await import('./identity.js')
  const target = input.target
  if (typeof target !== 'string') return { ok: false, reason: 'Registration needs an alias or a username.' }
  try {
    assertTarget(target)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'That target is refused.' }
  }
  const adapter = await adapterFor(projectRoot, input)
  const display = await adapter.display(target)
  if (isFailure(display)) return { ok: false, reason: reasonFor(display) }
  const live = await adapter.liveOrg(display.username)
  if (isFailure(live)) return { ok: false, reason: reasonFor(live) }
  if (!sameId(display.orgId, live.orgId)) {
    return { ok: false, reason: `The CLI login says org ${display.orgId}, but the org it reaches is ${live.orgId}. They disagree, so this is refused.` }
  }
  const user = await adapter.liveUser(display.username)
  if (isFailure(user)) return { ok: false, reason: reasonFor(user) }
  if (!user.isActive) return { ok: false, reason: `${display.username} is not active in this org.` }
  const writeAccess = await adapter.writeAccess(display.username, user.id)
  const records = listOrgRecords(storeRoot, projectRoot)
  const username = display.username.toLowerCase()
  const previous = records.find(item => sameId(item.orgId, live.orgId)) ?? records.find(item => item.username.toLowerCase() === username) ?? null
  const changed = previous !== null && (!sameId(previous.orgId, live.orgId) || previous.isSandbox !== live.isSandbox)
  const asWriter = input.role === 'writer'
  const reader = records.find(item => sameId(item.orgId, live.orgId)) ?? null
  if (asWriter) {
    if (reader === null) return { ok: false, reason: `Register this org's read-only user first, with /topia:sf:connect. Reads go to that user, and ${display.username} only writes.` }
    if (live.isSandbox) return { ok: false, reason: "A sandbox doesn't need a second user. /topia:sf:connect registers one user for it, and that user reads and writes." }
    if (changed) return { ok: false, reason: 'This org changed class since it was registered. Register it again with /topia:sf:connect first.' }
    if (reader.username.toLowerCase() === username) return { ok: false, reason: `${display.username} is the registered reader. A writer has to be a different user, so log in as that user first.` }
    if (writeAccess.canWrite === 'no') return { ok: false, reason: `Topia found no write permission for ${display.username}, so it can't be the writer. A writer needs permission to make the change.` }
  } else if (readWriter(storeRoot, projectRoot, live.orgId)?.username.toLowerCase() === username) {
    return { ok: false, reason: `${display.username} is registered as the writer for this org. The reader has to be a different user.` }
  }
  return {
    ok: true,
    ...(asWriter ? { role: 'writer', reader: reader?.username } : {}),
    canAcceptSingleUser: !asWriter && !live.isSandbox && writeAccess.canWrite !== 'no',
    live: {
      orgId: to18(live.orgId),
      name: plainText(live.name, 80),
      isSandbox: live.isSandbox,
      class: classFromLive(live.isSandbox),
      organizationType: plainText(live.organizationType, 60),
      instanceUrl: display.instanceUrl,
      instanceHost: hostOf(display.instanceUrl),
      username: display.username,
    },
    writeAccess,
    previous: previous === null ? null : { orgId: previous.orgId, name: plainText(previous.name, 80), isSandbox: previous.isSandbox, instanceHost: hostOf(previous.instanceUrl), username: previous.username },
    others: records.filter(item => item !== previous).map(item => ({ orgId: item.orgId, name: plainText(item.name, 80), isSandbox: item.isSandbox })),
    requiresTypedName: changed,
  }
}

const BRIEF_ID = /^brief-[a-f0-9]{16}$/
const PLAN_ID = /^plan-[a-f0-9-]{36}$/

/** The dialog renders what this returns, and records this hash. The hash is recomputed from the file, so what is shown is what is confirmed. */
async function briefRead(projectRoot: string, storeRoot: string, input: Input): Promise<unknown> {
  const off = refusalWhenOff(projectRoot, storeRoot)
  if (off !== null) return { ok: false, reason: off }
  const { readBrief } = await import('./brief.js')
  if (typeof input.briefId !== 'string' || !BRIEF_ID.test(input.briefId)) return { ok: false, reason: 'That is not a brief id. Call brief_propose first.' }
  const stored = readBrief(storeRoot, projectRoot, input.briefId)
  if (stored === null) return { ok: false, reason: `No brief has the id ${input.briefId}. Call brief_propose first.` }
  return { ok: true, briefId: stored.briefId, briefHash: stored.briefHash, brief: stored.brief }
}

/** No free text: the Other box can hold anything, so only whether it confirmed is kept. */
function briefAnswered(projectRoot: string, storeRoot: string, input: Input, now: number): unknown {
  const off = refusalWhenOff(projectRoot, storeRoot)
  if (off !== null) return { ok: false, reason: off }
  const briefId = typeof input.briefId === 'string' && BRIEF_ID.test(input.briefId) ? input.briefId : 'unknown'
  appendJournal(projectRoot, { event: 'confirmation.received', correlationId: `brief-answer-${now}`, projectRoot, orgId: '', mode: 'read-only', at: new Date(now).toISOString(), status: input.confirmed === true ? 'confirmed' : 'not-confirmed', note: `Brief ${briefId}.` })
  return { ok: true }
}

function modeOf(input: Input): SfMode {
  const { mode } = input
  return typeof mode === 'string' && (['read-only', 'explain', 'investigate', 'plan', 'validate', 'execute', 'review'] as const).includes(mode as SfMode) ? (mode as SfMode) : 'read-only'
}

function confirmedHash(input: Input): string | null {
  return typeof input.confirmedBriefHash === 'string' ? input.confirmedBriefHash : null
}

/** Reads no values. It returns what the dialog must show, and what the hook pins. */
async function valuesPrepare(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { prepareShowValues } = await import('./show-values.js')
  const adapter = await adapterFor(projectRoot, input)
  return prepareShowValues(adapter, { projectRoot, storeRoot, correlationId: `show-values-${now}`, now }, input.request, confirmedHash(input), modeOf(input))
}

/** Runs only what the hook pinned, after a person's exact answer. */
async function valuesRun(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { runShowValues } = await import('./show-values.js')
  const adapter = await adapterFor(projectRoot, input)
  return runShowValues(adapter, { projectRoot, storeRoot, correlationId: `show-values-${now}`, now }, input.pinned, confirmedHash(input), modeOf(input))
}

/** A dialog must not offer to acknowledge a notice when the org has since moved. The stored notice is not enough. */
async function ackCheck(projectRoot: string, storeRoot: string, input: Input): Promise<unknown> {
  const off = refusalWhenOff(projectRoot, storeRoot)
  if (off !== null) return { ok: false, reason: off }
  const { showsContinue } = await import('./issues.js')
  const { isFailure } = await import('./adapter.js')
  const { compareLive } = await import('./identity.js')
  const { findRegistered } = await import('./registry.js')
  const { orgId, kind } = input
  if (typeof orgId !== 'string' || typeof kind !== 'string' || !showsContinue(kind as IssueKind)) return { ok: false, reason: 'That notice cannot be acknowledged.' }
  const found = findRegistered(storeRoot, projectRoot, orgId)
  if ('missing' in found) return { ok: false, reason: found.missing }
  const adapter = await adapterFor(projectRoot, input)
  const live = await adapter.liveOrg(found.record.username)
  if (isFailure(live)) return kind === 'expired-auth' && live.failure === 'expired-auth' ? { ok: true } : { ok: false, reason: reasonFor(live) }
  const compared = compareLive(found.record, live)
  return !compared.ok && !showsContinue(compared.kind) ? { ok: false, reason: compared.message } : { ok: true }
}

function isWriteAccess(value: unknown): value is WriteAccess {
  if (value === null || typeof value !== 'object') return false
  const access = value as Partial<WriteAccess>
  return (access.canWrite === 'yes' || access.canWrite === 'no' || access.canWrite === 'unknown') && Array.isArray(access.reasons)
}

/**
 * The hook has a person's exact answer by now and passes what it showed, pinned.
 * This checks the org once more, because a dialog can stay open a long time, and
 * only then writes. It is the only writer of orgs.json.
 */
async function orgRegister(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const off = refusalWhenOff(projectRoot, storeRoot)
  if (off !== null) return { ok: false, reason: off }
  const { assertTarget } = await import('./sf-cli.js')
  const { isFailure } = await import('./adapter.js')
  const { classFromLive, sameId, to18 } = await import('./identity.js')
  const { registerOrg, registerWriter, removeOrg, writeWarningFor } = await import('./registry.js')
  const { updateStore } = await import('./store.js')
  const { username, instanceUrl, writeAccess, replaces } = input
  const expect = input.expect as { orgId?: unknown; isSandbox?: unknown } | null | undefined
  const bad = (what: string) => ({ ok: false, reason: `Registration refused: ${what}.` })
  if (typeof username !== 'string' || username.length === 0) return bad('no username')
  try {
    assertTarget(username)
  } catch {
    return bad('that username is refused')
  }
  if (expect === null || typeof expect !== 'object' || typeof expect.orgId !== 'string' || !ID.test(expect.orgId) || typeof expect.isSandbox !== 'boolean') return bad('no expected org')
  if (typeof instanceUrl !== 'string' || !instanceUrl.startsWith('https://')) return bad('no https instance URL')
  if (!isWriteAccess(writeAccess)) return bad('no write-permission result')
  if (replaces !== undefined && (typeof replaces !== 'string' || !ID.test(replaces))) return bad('a bad replaced org id')

  const adapter = await adapterFor(projectRoot, input)
  const live = await adapter.liveOrg(username)
  if (isFailure(live)) return { ok: false, reason: reasonFor(live) }
  if (!sameId(live.orgId, expect.orgId) || live.isSandbox !== expect.isSandbox) {
    return { ok: false, reason: 'The org changed since the dialog was shown, so nothing was written. Run /topia:sf:connect again.' }
  }
  const at = new Date(now).toISOString()
  const correlationId = `registration-${now}`
  if (input.role === 'writer') {
    const reader = listOrgRecords(storeRoot, projectRoot).find(item => sameId(item.orgId, live.orgId))
    if (reader === undefined) return bad('this org has no registered reader')
    if (live.isSandbox) return bad('a sandbox does not take a writer')
    if (writeAccess.canWrite === 'no') return bad('that user has no write permission')
    const writer: OrgRecord = { orgId: to18(live.orgId), username, instanceUrl, isSandbox: live.isSandbox, name: plainText(live.name, 80), registeredAt: at, writeAccess, role: 'writer', login: { state: 'logged-in', checkedAt: at } }
    registerWriter(storeRoot, projectRoot, writer)
    appendJournal(projectRoot, { event: 'org.registered', correlationId, projectRoot, orgId: writer.orgId, mode: 'read-only', at, note: `Registered a second user for writes on production. Write permission: ${writeAccess.canWrite}.` })
    return { ok: true, orgId: writer.orgId, correlationId }
  }
  const singleUser = input.singleUser === true
  if (singleUser && (live.isSandbox || writeAccess.canWrite === 'no')) return bad('only a production user that can write can be accepted as the one user')
  const record: OrgRecord = { orgId: to18(live.orgId), username, instanceUrl, isSandbox: live.isSandbox, name: plainText(live.name, 80), registeredAt: at, writeAccess, ...(singleUser ? { singleUserAcceptedAt: at } : {}) }
  if (typeof replaces === 'string' && !sameId(replaces, record.orgId)) removeOrg(storeRoot, projectRoot, replaces)
  registerOrg(storeRoot, projectRoot, record, at)
  const identity = { classification: classFromLive(live.isSandbox), orgName: record.name, orgId: record.orgId, user: username, mode: 'read-only' as const }
  updateStore(storeRoot, data => {
    data[sessionKey(projectRoot)] = {
      identity,
      issue: null,
      orgIdentityHash: `${record.orgId}|${username}|${identity.classification}`,
      checkedAt: at,
      writeWarning: writeWarningFor(record),
    }
  })
  appendJournal(projectRoot, { event: 'org.registered', correlationId, projectRoot, orgId: record.orgId, mode: 'read-only', at, note: `Registered a ${identity.classification} org. Write permission: ${writeAccess.canWrite}.${singleUser ? ' A person accepted one user for reads and writes.' : ''}` })
  return { ok: true, orgId: record.orgId, correlationId }
}

function requestOf(input: Input): Record<string, unknown> {
  const { request } = input
  return request !== null && typeof request === 'object' && !Array.isArray(request) ? (request as Record<string, unknown>) : {}
}

/** Reads and reconciles, and builds what the dialog shows. A plan that isn't ready for a dialog gets a report, and nothing is sent. */
async function recordsPrepare(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { prepareRecordsWrite } = await import('./records-write.js')
  const adapter = await adapterFor(projectRoot, input)
  const planId = requestOf(input).planId
  if (typeof planId !== 'string' || !PLAN_ID.test(planId)) return { ok: false, reason: 'That is not a plan id. records_plan_update returns one.' }
  return prepareRecordsWrite(adapter, { projectRoot, storeRoot, correlationId: `records-prepare-${now}`, now }, { planId }, confirmedHash(input), modeOf(input))
}

/** After a person's exact answer. It gets the plan bytes the hook held, and never reads the plan file. */
async function recordsRun(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { runRecordsWrite } = await import('./records-write.js')
  const adapter = await adapterFor(projectRoot, input)
  const pinned = input.pinned as { planBytes?: unknown; expected?: { attempts?: unknown; ids?: unknown } } | undefined
  if (typeof pinned?.planBytes !== 'string' || !Array.isArray(pinned.expected?.ids) || typeof pinned.expected?.attempts !== 'number') return { ok: false, reason: 'The runner did not get a pinned plan, so nothing was written.' }
  return runRecordsWrite(adapter, { projectRoot, storeRoot, correlationId: `records-run-${now}`, now }, pinned as never, confirmedHash(input), modeOf(input), { pollBudgetMs: typeof input.pollBudgetMs === 'number' ? input.pollBudgetMs : undefined, pollIntervalMs: typeof input.pollIntervalMs === 'number' ? input.pollIntervalMs : undefined })
}

/** A restore is a new plan through the same gate, or a read and guidance, depending on what it restores. */
async function restorePrepare(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { prepareRestore } = await import('./restore.js')
  const adapter = await adapterFor(projectRoot, input)
  const { planId, briefId } = requestOf(input)
  if (typeof planId !== 'string' || !PLAN_ID.test(planId)) return { ok: false, reason: 'A restore names the plan it restores, by planId.' }
  if (typeof briefId !== 'string' || !BRIEF_ID.test(briefId)) return { ok: false, reason: 'A restore needs a briefId. Call brief_propose, then sf_brief_confirm.' }
  return prepareRestore(adapter, { projectRoot, storeRoot, correlationId: `restore-prepare-${now}`, now }, { planId, briefId }, confirmedHash(input), modeOf(input))
}

async function deployPrepare(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { prepareDeployWrite } = await import('./deploy-run.js')
  const adapter = await adapterFor(projectRoot, input)
  const { planId, cancel } = requestOf(input)
  if (typeof planId !== 'string' || !PLAN_ID.test(planId)) return { ok: false, reason: 'That is not a plan id. deployment_plan returns one.' }
  return prepareDeployWrite(adapter, { projectRoot, storeRoot, correlationId: `deploy-prepare-${now}`, now }, { planId, cancel: cancel === true }, confirmedHash(input), modeOf(input))
}

async function deployRun(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { runDeployWrite } = await import('./deploy-run.js')
  const adapter = await adapterFor(projectRoot, input)
  const pinned = input.pinned as { planBytes?: unknown; expected?: unknown } | undefined
  if (typeof pinned?.planBytes !== 'string' || pinned.expected === null || typeof pinned.expected !== 'object') return { ok: false, reason: 'The runner did not get a pinned plan, so nothing shipped.' }
  return runDeployWrite(adapter, { projectRoot, storeRoot, correlationId: `deploy-run-${now}`, now }, pinned as never, confirmedHash(input), modeOf(input), { pollBudgetMs: typeof input.pollBudgetMs === 'number' ? input.pollBudgetMs : undefined, pollIntervalMs: typeof input.pollIntervalMs === 'number' ? input.pollIntervalMs : undefined })
}

async function validatePrepare(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { prepareValidate } = await import('./validate-run.js')
  const adapter = await adapterFor(projectRoot, input)
  return prepareValidate(adapter, { projectRoot, storeRoot, correlationId: `validate-prepare-${now}`, now, pollBudgetMs: typeof input.pollBudgetMs === 'number' ? input.pollBudgetMs : undefined, pollIntervalMs: typeof input.pollIntervalMs === 'number' ? input.pollIntervalMs : undefined }, requestOf(input), confirmedHash(input), modeOf(input))
}

async function validateRun(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { runValidate } = await import('./validate-run.js')
  const adapter = await adapterFor(projectRoot, input)
  const pinned = input.pinned as { planId?: unknown; planHash?: unknown } | undefined
  if (typeof pinned?.planId !== 'string' || typeof pinned.planHash !== 'string') return { ok: false, reason: 'The runner did not get a pinned validation, so nothing ran.' }
  return runValidate(adapter, { projectRoot, storeRoot, correlationId: `validate-run-${now}`, now, pollBudgetMs: typeof input.pollBudgetMs === 'number' ? input.pollBudgetMs : undefined, pollIntervalMs: typeof input.pollIntervalMs === 'number' ? input.pollIntervalMs : undefined }, pinned as never, confirmedHash(input), modeOf(input))
}

async function testsPrepare(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { prepareTestsRun } = await import('./tests-run.js')
  const adapter = await adapterFor(projectRoot, input)
  return prepareTestsRun(adapter, { projectRoot, storeRoot, correlationId: `tests-prepare-${now}`, now }, requestOf(input), confirmedHash(input), modeOf(input))
}

async function testsRun(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  const { runTestsRun } = await import('./tests-run.js')
  const adapter = await adapterFor(projectRoot, input)
  const pinned = input.pinned as { hash?: unknown } | undefined
  if (typeof pinned?.hash !== 'string') return { ok: false, reason: 'The runner did not get a pinned test run, so nothing ran.' }
  return runTestsRun(adapter, { projectRoot, storeRoot, correlationId: `tests-run-${now}`, now }, pinned as never, confirmedHash(input), modeOf(input))
}

/** One live check for the band at session start. Picks the org in use, or the only one, and never guesses between several. */
async function identityCheck(projectRoot: string, storeRoot: string, input: Input, now: number): Promise<unknown> {
  if (lockState(storeRoot, projectRoot).state !== 'on') return { ok: true, checked: false }
  await writerCheck(projectRoot, storeRoot, input, now)
  const records = listOrgRecords(storeRoot, projectRoot)
  const session = readStore(storeRoot)[sessionKey(projectRoot)] as { identity?: { orgId?: unknown } | null } | null | undefined
  const inUse = session?.identity?.orgId
  const orgId = typeof inUse === 'string' && records.some(item => item.orgId === inUse) ? inUse : records.length === 1 ? records[0]?.orgId : undefined
  if (orgId === undefined) return { ok: true, checked: false }
  const { callTool } = await import('./tools.js')
  const adapter = await adapterFor(projectRoot, input)
  const context = { projectRoot, storeRoot, correlationId: `session-check-${now}`, now }
  const result = await callTool(adapter, 'org_inspect', { orgId }, context)
  const { auditBeforeWrite } = await import('./audit.js')
  const audit = await auditBeforeWrite(adapter, context, orgId)
  return { ok: true, checked: true, confirmed: result.ok, audit: audit.state }
}

/**
 * The reply goes to the mod, which shows some of it to a person and pins the rest. What a person is shown
 * and what is pinned are never redacted: a redacted copy would not be the value that gets written, and the
 * approval would be of something else. The model never sees either.
 */
function redactForMod(reply: unknown): unknown {
  if (reply === null || typeof reply !== 'object' || Array.isArray(reply)) return redactValue(reply)
  const { pinned, screenPlan, ...rest } = reply as Record<string, unknown>
  return { ...(redactValue(rest) as Record<string, unknown>), ...(pinned === undefined ? {} : { pinned }), ...(screenPlan === undefined ? {} : { screenPlan }) }
}

export async function runCommand(command: string, input: Input, storeRoot: string, now: number): Promise<{ code: number; reply: unknown }> {
  const projectRoot = projectRootOf(input)
  if (projectRoot === null) return { code: 0, reply: { ok: false, reason: 'The project path has to be absolute.' } }
  const at = new Date(now).toISOString()
  switch (command) {
    case 'status':
      return { code: 0, reply: status(projectRoot, storeRoot) }
    case 'enable':
      return {
        code: 0,
        reply: changeLock(projectRoot, storeRoot, () => {
          const user = typeof input.user === 'string' ? input.user : 'unknown'
          return { ok: true, lock: enableProject(storeRoot, projectRoot, user, at) }
        }),
      }
    case 'disable':
      return {
        code: 0,
        reply: changeLock(projectRoot, storeRoot, () => ({ ok: true, correlationId: disableProject(projectRoot, storeRoot, at) })),
      }
    case 'org-resolve':
      return { code: 0, reply: await orgResolve(projectRoot, storeRoot, input) }
    case 'org-register':
      return { code: 0, reply: await orgRegister(projectRoot, storeRoot, input, now) }
    case 'identity-check':
      return { code: 0, reply: await identityCheck(projectRoot, storeRoot, input, now) }
    case 'writer-check':
      return { code: 0, reply: await writerCheck(projectRoot, storeRoot, input, now) }
    case 'brief-read':
      return { code: 0, reply: await briefRead(projectRoot, storeRoot, input) }
    case 'brief-answered':
      return { code: 0, reply: briefAnswered(projectRoot, storeRoot, input, now) }
    case 'values-prepare':
      return { code: 0, reply: await valuesPrepare(projectRoot, storeRoot, input, now) }
    case 'values-run':
      return { code: 0, reply: await valuesRun(projectRoot, storeRoot, input, now) }
    case 'ack-check':
      return { code: 0, reply: await ackCheck(projectRoot, storeRoot, input) }
    case 'records-prepare':
      return { code: 0, reply: await recordsPrepare(projectRoot, storeRoot, input, now) }
    case 'records-run':
      return { code: 0, reply: await recordsRun(projectRoot, storeRoot, input, now) }
    case 'restore-prepare':
      return { code: 0, reply: await restorePrepare(projectRoot, storeRoot, input, now) }
    case 'deploy-prepare':
      return { code: 0, reply: await deployPrepare(projectRoot, storeRoot, input, now) }
    case 'deploy-run':
      return { code: 0, reply: await deployRun(projectRoot, storeRoot, input, now) }
    case 'validate-prepare':
      return { code: 0, reply: await validatePrepare(projectRoot, storeRoot, input, now) }
    case 'validate-run':
      return { code: 0, reply: await validateRun(projectRoot, storeRoot, input, now) }
    case 'tests-prepare':
      return { code: 0, reply: await testsPrepare(projectRoot, storeRoot, input, now) }
    case 'tests-run':
      return { code: 0, reply: await testsRun(projectRoot, storeRoot, input, now) }
    default:
      return { code: 2, reply: { ok: false, reason: `Unknown command ${command}.` } }
  }
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ''
  for await (const chunk of stream) text += String(chunk)
  return text
}

async function main(): Promise<void> {
  let input: Input = {}
  try {
    const text = await readAll(process.stdin)
    input = text.trim().length > 0 ? (JSON.parse(text) as Input) : {}
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: 'The input was not JSON.' })}\n`)
    process.exitCode = 2
    return
  }
  try {
    const { code, reply } = await runCommand(process.argv[2] ?? '', input, defaultStoreRoot(), Date.now())
    process.stdout.write(`${JSON.stringify(redactForMod(reply))}\n`)
    process.exitCode = code
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The runner failed.'
    process.stdout.write(`${JSON.stringify(redactValue({ ok: false, reason }))}\n`)
    process.exitCode = 1
  }
}

await main()
