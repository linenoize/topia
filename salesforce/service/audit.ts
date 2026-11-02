import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { isFailure, type Adapter } from './adapter.js'
import { normalizeRoot, plainText, type OrgRecord } from './contract.js'
import { sameId } from './identity.js'
import { appendJournal, readAllJournals, type JournalLine } from './journal.js'
import { readJson } from './json-file.js'
import { plansDirectory, sessionKey } from './paths.js'
import { redactValue } from './redact.js'
import { findRegistered, readWriter } from './registry.js'
import { storeDelete, storeGet, storeSet, updateStore } from './store.js'
import { MS_PER_DAY, RETENTION_DAYS } from './log-retention.js'
import { escapeSoqlString } from './soql.js'
import type { CallInput } from './tools.js'

/**
 * Contract section 10. Setup Audit Trail and LastModifiedById are the record of
 * truth, and the journal isn't tamper-proof. So at session start and before a write,
 * this compares them, and reports anything by this user the journal doesn't hold.
 * A failure to check reads as "couldn't check", and never as clean.
 *
 * The write path calls `auditBeforeWrite` before a write, and journals
 * `change.executed` with `at`, `orgId`, and, for records, `object` and `counts.rows`.
 * This reads those lines.
 */

const AUDIT_LIMIT = 200
/** A little before the last completed check, so clock skew between this machine and the org can't leave a gap. */
const WINDOW_OVERLAP_MS = 2 * 60 * 1000
const FULL_PAGE_TEXT = `${AUDIT_LIMIT} or more setup changes in this window; not all were compared.`
const CUT_SHORT_TEXT = 'The audit trail came back cut short; not all setup changes in this window were compared.'
const MATCH_WINDOW_MS = 30 * 60 * 1000
const API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/

export type AuditFinding = { source: 'setup-audit-trail' | 'last-modified'; detail: string; count: number; /** The comparison covered only part of the window. A reason for the person to look, not a reason to refuse. */ capped?: true }

export type AuditResult = {
  state: 'clean' | 'found' | 'could-not-check'
  findings: AuditFinding[]
  reasons: string[]
  checkedAt: string
  /** What the band shows. Null only when the check ran and found nothing. */
  text: string | null
  /** What was compared, so "clean" never claims more than this. */
  coverage: { setupAudit: boolean; objects: string[] }
  /** The org said no to Setup Audit Trail, which a person can fix by granting a permission. */
  trailDenied?: boolean
}

/** Salesforce's name for what reading Setup Audit Trail takes. LIVE-CHECKLIST.md has a person confirm it. */
export const AUDIT_PERMISSION = 'View Setup and Configuration'

/**
 * Two decisions. On production a comparison that couldn't run at all refuses, because it's
 * how a change made outside Topia gets found. On a sandbox the person hears that
 * first, and decides. Null means no refusal.
 */
export function auditRefusal(audit: AuditResult, record: Pick<OrgRecord, 'isSandbox' | 'username'>, outcome: string): string | null {
  if (audit.state !== 'could-not-check' || record.isSandbox) return null
  if (audit.trailDenied === true) return `This is production, and ${record.username} can't read Setup Audit Trail, so ${outcome}. Topia reads it before a production change to find anything made outside Topia. Grant ${record.username} the ${AUDIT_PERMISSION} permission, then run this again.`
  return `The org's audit trail couldn't be compared with the journal, so ${outcome}. ${plainText(audit.text ?? audit.reasons.join('; '), 400)}`
}

/** What the screen carries from the comparison. */
export function auditFacts(audit: AuditResult): { audit?: string; auditUnchecked?: string } {
  if (audit.state === 'could-not-check') return { auditUnchecked: plainText(audit.reasons.join('; ') || (audit.text ?? 'the comparison did not run'), 300) }
  return audit.state === 'found' && audit.text !== null ? { audit: audit.text } : {}
}

function trackedObjects(projectRoot: string, lines: JournalLine[], reasons: string[]): string[] {
  const objects = new Set<string>()
  for (const line of lines) if (line.event === 'change.executed' && typeof line.object === 'string') objects.add(line.object)
  let names: string[] = []
  try {
    names = readdirSync(plansDirectory(projectRoot))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') reasons.push('the plan folder could not be read')
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const file = readJson<{ plan?: { object?: unknown } }>(join(plansDirectory(projectRoot), name))
      if (typeof file?.plan?.object === 'string') objects.add(file.plan.object)
    } catch {
      reasons.push(`the plan ${plainText(name, 60)} could not be read`)
    }
  }
  return [...objects].filter(object => API_NAME.test(object))
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`
}

function reportText(findings: AuditFinding[], reasons: string[]): string | null {
  const parts: string[] = []
  const unexplained = findings.filter(item => item.capped !== true)
  if (unexplained.length > 0) parts.push(`Salesforce: ${unexplained.map(item => item.detail).join(' ')} Topia's journal doesn't hold these. If you made them yourself, nothing is wrong. Setup Audit Trail is the record.`)
  const capped = findings.filter(item => item.capped === true)
  if (capped.length > 0) parts.push(`Salesforce: ${capped.map(item => item.detail).join(' ')} The comparison is a check, not a boundary, so the decision is yours.`)
  if (reasons.length > 0) parts.push(`Salesforce: couldn't check the org's audit trail against the journal, so this isn't a clean result: ${reasons.map(item => plainText(item, 160)).join('; ')}.`)
  return parts.length > 0 ? parts.join(' ') : null
}

function outcome(findings: AuditFinding[], reasons: string[], checkedAt: string, coverage: AuditResult['coverage'], trailDenied = false): AuditResult {
  const state = reasons.length > 0 ? 'could-not-check' : findings.length > 0 ? 'found' : 'clean'
  return { state, findings, reasons, checkedAt, text: reportText(findings, reasons), coverage, ...(trailDenied ? { trailDenied } : {}) }
}

/** The id of a user this login isn't, read through this login. */
async function userIdOf(adapter: Adapter, login: string, username: string): Promise<{ id: string } | string> {
  const rows = await adapter.query(login, `SELECT Id FROM User WHERE Username = '${escapeSoqlString(username)}' LIMIT 1`)
  if (isFailure(rows)) return rows.message
  const id = rows.records[0]?.Id
  return typeof id === 'string' ? { id } : 'no such user came back'
}

/**
 * One comparison, through `record`'s login. `about` is whose changes it looks for, when
 * that's someone else: a writer is logged out by the next session, and the reader can
 * still ask about it. It changes nothing but the journal, and it never throws.
 */
export async function compareAudit(adapter: Adapter, input: CallInput, record: OrgRecord, about: OrgRecord = record): Promise<AuditResult> {
  const checkedAt = new Date(input.now).toISOString()
  const coverage: AuditResult['coverage'] = { setupAudit: false, objects: [] }
  const findings: AuditFinding[] = []
  const reasons: string[] = []
  let trailDenied = false
  try {
    const who = about === record ? 'this user' : 'the writer'
    const user = about === record ? await adapter.liveUser(record.username) : await userIdOf(adapter, record.username, about.username)
    if (typeof user === 'string') return outcome(findings, [`the writer could not be looked up: ${user}`], checkedAt, coverage)
    if (isFailure(user)) return outcome(findings, [`the current user could not be read: ${user.message}`], checkedAt, coverage)
    let lines: JournalLine[]
    try {
      lines = readAllJournals(input.projectRoot).filter(line => sameId(line.orgId, record.orgId) || line.orgId === '')
    } catch {
      return outcome(findings, ['the journal could not be read'], checkedAt, coverage)
    }

    // The journal goes back 29 days at most, and nothing before the registration is this project's.
    // Past the first check, only what happened since the last completed one: a busy admin isn't capped by changes already seen.
    const earliest = Math.max(input.now - (RETENTION_DAYS - 1) * MS_PER_DAY, Date.parse(about.registeredAt) || 0, (lastCompleted(input, record, about) ?? 0) - WINDOW_OVERLAP_MS)
    const since = new Date(earliest).toISOString()
    const id = escapeSoqlString(user.id)
    const journalQuery = (soql: string, rows: number) => {
      appendJournal(input.projectRoot, { event: 'query.executed', correlationId: `audit-${input.now}`, projectRoot: input.projectRoot, orgId: record.orgId, mode: 'read-only', at: checkedAt, soql, counts: { rows } })
    }

    const trail = await adapter.query(record.username, `SELECT Action, Section, CreatedDate FROM SetupAuditTrail WHERE CreatedById = '${id}' AND CreatedDate >= ${since} ORDER BY CreatedDate DESC LIMIT ${AUDIT_LIMIT}`)
    if (isFailure(trail)) {
      reasons.push(`Setup Audit Trail could not be read: ${trail.message}`)
      trailDenied = trail.failure === 'denied'
    } else {
      coverage.setupAudit = true
      journalQuery(`SELECT Action, Section, CreatedDate FROM SetupAuditTrail WHERE CreatedById = '${id}' AND CreatedDate >= ${since} ORDER BY CreatedDate DESC LIMIT ${AUDIT_LIMIT}`, trail.records.length)
      // A full page can hide more. It goes to the person as a finding, because the audit detects and does not decide.
      if (trail.records.length >= AUDIT_LIMIT) findings.push({ source: 'setup-audit-trail', count: trail.records.length, detail: FULL_PAGE_TEXT, capped: true })
      else if (trail.truncated) findings.push({ source: 'setup-audit-trail', count: trail.records.length, detail: CUT_SHORT_TEXT, capped: true })
      const executed = lines.filter(line => line.event === 'change.executed').map(line => Date.parse(line.at))
      const unexplained = trail.records.filter(row => {
        const at = Date.parse(String(row.CreatedDate))
        return Number.isNaN(at) || !executed.some(when => Math.abs(when - at) <= MATCH_WINDOW_MS)
      })
      if (unexplained.length > 0) {
        const sections = [...new Set(unexplained.map(row => plainText(String(row.Section), 60)))].slice(0, 3).join(', ')
        findings.push({ source: 'setup-audit-trail', count: unexplained.length, detail: `${plural(unexplained.length, 'setup change')} by ${who} (${sections}).` })
      }
    }

    coverage.objects = trackedObjects(input.projectRoot, lines, reasons)
    for (const object of coverage.objects) {
      const soql = `SELECT COUNT() FROM ${object} WHERE LastModifiedById = '${id}' AND LastModifiedDate >= ${since}`
      const counted = await adapter.count(record.username, soql)
      if (isFailure(counted)) {
        reasons.push(`${object} could not be counted: ${counted.message}`)
        continue
      }
      journalQuery(soql, counted.count)
      // Only what the org count covers. Older rows were compared by a check that has finished.
      const journaled = lines.filter(line => line.event === 'change.executed' && line.object === object && Date.parse(line.at) >= earliest).reduce((sum, line) => sum + (line.counts?.rows ?? 0), 0)
      const extra = counted.count - journaled
      if (extra > 0) findings.push({ source: 'last-modified', count: extra, detail: `${extra} ${object} ${extra === 1 ? 'record' : 'records'} last changed by ${who}.` })
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'the comparison failed')
  }
  const result = outcome(findings, reasons, checkedAt, coverage, trailDenied)
  // Only a clean check moves the window. A finding moves it once a person has seen it on an approval screen and approved: see `acceptAudit`.
  if (result.state === 'clean') markCompleted(input, record, about, input.now)
  return result
}

function markKey(input: CallInput, record: OrgRecord, about: OrgRecord): string {
  return `sf:audit-mark:${normalizeRoot(input.projectRoot)}:${record.orgId}:${about.username}`
}

function lastCompleted(input: CallInput, record: OrgRecord, about: OrgRecord): number | null {
  try {
    const value = storeGet(input.storeRoot, markKey(input, record, about))
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function markCompleted(input: CallInput, record: OrgRecord, about: OrgRecord, at: number): void {
  try {
    const held = lastCompleted(input, record, about)
    storeSet(input.storeRoot, markKey(input, record, about), held === null ? at : Math.max(held, at))
  } catch {
    // The next check looks back further. That is slower, never less.
  }
}

function seenKey(input: CallInput, record: OrgRecord, planId: string): string {
  return `sf:audit-seen:${normalizeRoot(input.projectRoot)}:${record.orgId}:${record.username}:${planId}`
}

/**
 * A finding is on its way to a person's approval screen for this plan. It's remembered by plan
 * and kept apart from the window: the window moves only if the person goes on to approve it.
 * A check with nothing to show forgets any earlier one, because what was shown has since gone.
 */
function offerFinding(input: CallInput, record: OrgRecord, planId: string, result: AuditResult): void {
  try {
    if (result.state === 'found' && !result.findings.some(item => item.capped === true)) storeSet(input.storeRoot, seenKey(input, record, planId), input.now)
    else storeDelete(input.storeRoot, [seenKey(input, record, planId)])
  } catch {
    // The finding is still on the screen. The next check looks back further, which is slower and never less.
  }
}

/**
 * Called by the write path once a person's approval has been acted on: the plan's screen carried
 * the finding, and they accepted it, so the next check may start after it. A screen that was
 * declined or dismissed never gets here, and neither does session start, whose band line can be missed.
 */
export function acceptAudit(input: CallInput, record: OrgRecord, planId: string): void {
  try {
    const shown = storeGet(input.storeRoot, seenKey(input, record, planId))
    if (typeof shown === 'number' && Number.isFinite(shown)) markCompleted(input, record, record, shown)
    storeDelete(input.storeRoot, [seenKey(input, record, planId)])
  } catch {
    // Unmoved is the safe direction.
  }
}

function writeAudit(input: CallInput, result: AuditResult): void {
  updateStore(input.storeRoot, data => {
    const key = sessionKey(input.projectRoot)
    const current = (data[key] ?? { identity: null, issue: null, orgIdentityHash: '', checkedAt: result.checkedAt, writeWarning: null }) as Record<string, unknown>
    data[key] = redactValue({ ...current, audit: { state: result.state, text: result.text, checkedAt: result.checkedAt } })
  })
}

function merged(left: AuditResult, right: AuditResult, checkedAt: string): AuditResult {
  const coverage = { setupAudit: left.coverage.setupAudit && right.coverage.setupAudit, objects: [...new Set([...left.coverage.objects, ...right.coverage.objects])] }
  return outcome([...left.findings, ...right.findings], [...new Set([...left.reasons, ...right.reasons])], checkedAt, coverage, left.trailDenied === true || right.trailDenied === true)
}

/**
 * Runs the comparison and puts it on the band. The write path names who is about to
 * write. Session start names nobody, and covers the reader and any writer.
 */
export async function auditBeforeWrite(adapter: Adapter, input: CallInput, orgId: string, target?: OrgRecord, planId?: string): Promise<AuditResult> {
  const checkedAt = new Date(input.now).toISOString()
  let result: AuditResult
  try {
    const found = findRegistered(input.storeRoot, input.projectRoot, orgId)
    if ('missing' in found) result = outcome([], [found.missing], checkedAt, { setupAudit: false, objects: [] })
    else if (target !== undefined) {
      result = await compareAudit(adapter, input, target)
      if (planId !== undefined) offerFinding(input, target, planId, result)
    }
    else {
      const writer = readWriter(input.storeRoot, input.projectRoot, orgId)
      const own = await compareAudit(adapter, input, found.record)
      result = writer === null ? own : merged(own, await compareAudit(adapter, input, found.record, writer), checkedAt)
    }
  } catch (error) {
    result = outcome([], [error instanceof Error ? error.message : 'the registry could not be read'], checkedAt, { setupAudit: false, objects: [] })
  }
  try {
    writeAudit(input, result)
  } catch {
    // The caller still has the result. The band keeps what it last drew.
  }
  return result
}
