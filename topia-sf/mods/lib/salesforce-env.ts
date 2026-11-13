import { SALESFORCE_PROMISE, SINGLE_USER_LABEL, UNKNOWN_WRITE_WARNING, WRITE_WARNING, classLabel, modeLabel, pathsMatch, plainText, writerLogoutCommand } from '../../salesforce/service/contract.ts'
import { noticeText, showsContinue } from '../../salesforce/service/issues.ts'
import { ACK_ISSUE_SCHEMA, BRIEF_CONFIRM_SCHEMA, DEPLOYMENT_EXECUTE_SCHEMA, RECORDS_EXECUTE_SCHEMA, RESTORE_EXECUTE_SCHEMA, SHOW_VALUES_SCHEMA, TESTS_RUN_SCHEMA, VALIDATE_RUN_SCHEMA } from '../../salesforce/service/tool-schemas.ts'
import type { ApprovalFacts, ApprovalPlan } from '../../salesforce/service/approval-screen.ts'
import type {
  SalesforceAck,
  SalesforceBand,
  SalesforceBriefRead,
  SalesforceIdentity,
  SalesforceIssue,
  SalesforceLockState,
  SalesforceMode,
  SalesforcePart,
  SalesforcePrepared,
  SalesforceResolved,
  SalesforceSession,
} from '../types'

// The logic the service also needs lives in salesforce/service/, and the mod
// imports it, so there is one copy. This file holds what only the band draws.

export { noticeText, pathsMatch, showsContinue }

export const SALESFORCE_RUNNER = 'salesforce/service/bin/runner.js'
export const SALESFORCE_STORE_FILE = '.claude/plugins/store/topia-salesforce.json'
export const SALESFORCE_REGISTER_SPEC = {
  name: 'sf_org_register',
  description:
    'Register a Salesforce org for this project from an alias or a username. A person approves it in a dialog built from a live check of the org. You cannot answer that dialog, and nothing is written without its exact answer. Never pass the default org. With role writer, it registers a second user for production writes, after the read-only user.',
  inputSchema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'The CLI alias or username to resolve. Never the word default.' },
      role: { type: 'string', enum: ['reader', 'writer'], description: 'reader is the default. writer is the second user on a production org, which a person logs in only for a change.' },
    },
    required: ['target'],
    additionalProperties: false,
  },
}

/** Everything a person answers. Only in a project that is on, so every other project lists none of them. */
export const SALESFORCE_TOOL_SPECS = [
  SALESFORCE_REGISTER_SPEC,
  {
    name: 'sf_brief_confirm',
    description: 'Show a person the stored brief and ask them to confirm it. They see what brief_propose stored, rendered by code, and you cannot answer. Investigation and plan tools refuse until this returns. A chat reply is not confirmation.',
    inputSchema: BRIEF_CONFIRM_SCHEMA,
  },
  {
    name: 'sf_show_values',
    description: "Ask a person to show you values the tools withhold: exact fields on a bounded set of records, or a report's rows. It is also the only way to filter or sort by a withheld field. The dialog says the values go to the model provider and stay in local transcripts. You cannot answer it.",
    inputSchema: SHOW_VALUES_SCHEMA,
  },
  {
    name: 'sf_ack_issue',
    description: "Ask a person to acknowledge a live notice, by the id in the result that raised it. Only some notices can be. An org id change or an unknown result never can. It applies to one later call, and it doesn't approve a change.",
    inputSchema: ACK_ISSUE_SCHEMA,
  },
  {
    name: 'sf_records_execute',
    description: "Run an approved record plan. A person approves the exact change in a dialog built from a fresh live check, and you cannot answer it. It writes once. Partial is reported as partial, a timeout as unknown, and nothing is re-sent: asking again reconciles, and any resume is a new dialog over what's left.",
    inputSchema: RECORDS_EXECUTE_SCHEMA,
  },
  {
    name: 'sf_deployment_execute',
    description: 'Apply a deploy plan that has a current validation. A person approves in a dialog that reads the zip itself, and you cannot answer it. It stops if the org changed since it was validated. A refused validation means validate again, and nothing falls back to a full deploy. A deploy that may have landed is queried, never retried. Pass cancel to ask to cancel one that is running, which takes its own dialog.',
    inputSchema: DEPLOYMENT_EXECUTE_SCHEMA,
  },
  {
    name: 'sf_restore_plan_execute',
    description: "Restore what a record plan changed. It generates a new plan from the saved old values, for records still holding what was written, and a person approves it in a dialog. Records changed since are listed, and never overwritten. For a soft delete or a deploy, it reads the org and gives guidance for a person, because no tool undoes those.",
    inputSchema: RESTORE_EXECUTE_SCHEMA,
  },
  {
    name: 'sf_deployment_validate',
    description: 'Validate a deploy plan whose zip holds Apex. That runs the Apex and every local test in the org, so a person approves in a dialog that says so, and you cannot answer it. Nothing ships. A validation already started is read with no dialog: pass the same planId. Pass revalidate for a new one. A zip with no Apex is validated by deployment_validate instead.',
    inputSchema: VALIDATE_RUN_SCHEMA,
  },
  {
    name: 'sf_tests_run',
    description: "Run Apex tests. A person approves in a dialog, because tests run code in the org. It returns a run id right away. Pass runId to read a run's result, which needs no dialog. Results go to the project's 30-day log.",
    inputSchema: TESTS_RUN_SCHEMA,
  },
]

/** What each person-gated write tool asks of the runner, and the only arguments it passes along. */
export const SALESFORCE_WRITE_TOOLS = {
  sf_records_execute: { prepare: 'records-prepare', run: 'records-run', fields: ['planId'] },
  sf_deployment_execute: { prepare: 'deploy-prepare', run: 'deploy-run', fields: ['planId', 'cancel'] },
  sf_restore_plan_execute: { prepare: 'restore-prepare', run: 'records-run', fields: ['planId', 'briefId'] },
  sf_deployment_validate: { prepare: 'validate-prepare', run: 'validate-run', fields: ['planId', 'revalidate'] },
  sf_tests_run: { prepare: 'tests-prepare', run: 'tests-run', fields: ['orgId', 'briefId', 'level', 'classNames', 'runId'] },
} as const

export type SalesforceWriteTool = keyof typeof SALESFORCE_WRITE_TOOLS

/** Only the fields this tool takes, whatever else the model sent. Hashes, modes, and pins come from elsewhere. */
export function writeRequest(tool: SalesforceWriteTool, input: Record<string, unknown>): Record<string, unknown> {
  const request: Record<string, unknown> = {}
  for (const field of SALESFORCE_WRITE_TOOLS[tool].fields) if (input[field] !== undefined) request[field] = input[field]
  return request
}

/** After a person approved, a silent runner can't mean nothing happened. */
export const SALESFORCE_WRITE_UNKNOWN = "The runner didn't answer after a person approved this, so the result is unknown. It isn't stopped: anything it started in the org may still be running. Nothing is re-sent. /topia-sf:verify reads it."

export const SALESFORCE_STDIO_PREFIX = 'mcp__plugin_topia-sf_topia-salesforce__'
export const SALESFORCE_ACK_LABEL = 'Acknowledge this notice'

const STALE_MS = 24 * 60 * 60 * 1000

export const SALESFORCE_ABOUT = {
  class: 'From the live IsSandbox flag, read from the org. Never the CLI default org, and never a file.',
  org: 'The org name from the live check.',
  id: 'The org id from the live check, compared with the registry.',
  user: 'The Salesforce user the CLI targets, by username.',
  mode: 'What the last command you ran allows, this turn only: read-only, explain, investigate, plan, validate, execute, or review. It is an accident guard, not the boundary, and it goes back to read-only when the turn ends.',
  continue: 'Acknowledges this notice for this issue, org, user, and operation. It is not a production-write grant.',
  enable: 'Turns Salesforce on for this project path only. No other project is included. /topia-sf:disable turns it off.',
  disable: 'Turns Salesforce off for this project path only, and removes its lock. Other projects stay as they are.',
} as const

export function bandText(identity: SalesforceIdentity): string {
  return ['Salesforce', `${classLabel(identity.classification)} — ${identity.orgName}`, identity.orgId, identity.user, modeLabel(identity.mode)].join('  ')
}

export function bandParts(identity: SalesforceIdentity): SalesforcePart[] {
  return [
    { key: 'sf-class', text: `${classLabel(identity.classification)} — ${identity.orgName}`, about: SALESFORCE_ABOUT.class },
    { key: 'sf-org', text: identity.orgId, about: SALESFORCE_ABOUT.id },
    { key: 'sf-user', text: identity.user, about: SALESFORCE_ABOUT.user },
    { key: 'sf-mode', text: modeLabel(identity.mode), about: SALESFORCE_ABOUT.mode },
  ]
}

export function confirmShownPath(shownPath: string | null, currentPath: string): { ok: true } | { ok: false; reason: string } {
  if (shownPath === null || !pathsMatch(shownPath, currentPath)) {
    return { ok: false, reason: 'Okay to continue applies only to the project path that was shown.' }
  }
  return { ok: true }
}

export function acknowledgementApplies(
  ack: SalesforceAck | null,
  item: SalesforceIssue,
  hashes: { payloadHash: string; recordSetHash: string; orgIdentityHash: string },
): boolean {
  if (ack === null) return false
  return (
    ack.issueId === item.id &&
    ack.orgId === item.orgId &&
    ack.user === item.user &&
    ack.operationClass === item.operationClass &&
    ack.payloadHash === hashes.payloadHash &&
    ack.recordSetHash === hashes.recordSetHash &&
    ack.orgIdentityHash === hashes.orgIdentityHash
  )
}

export function acknowledgementGrantsProductionWrite(): false {
  return false
}

function plainIssue(kind: SalesforceIssue['kind'], orgName: string, message: string): SalesforceIssue {
  return { id: kind, kind, orgId: '', orgName, user: '', operationClass: 'read', message }
}

function issueBand(issue: SalesforceIssue, warning?: string): SalesforceBand {
  const text = noticeText(issue)
  return showsContinue(issue.kind)
    ? { kind: 'notice', text, canContinue: true, issue, warning }
    : { kind: 'stop', text, canContinue: false, issue, warning }
}

/**
 * What the row draws. Identity shows only from a live check. A lock or an
 * identity that cannot be read says so; it never reads as off or as fine.
 */
export function viewBand(input: {
  lock: SalesforceLockState
  session: SalesforceSession | null
  ack: SalesforceAck | null
  registeredOrgs: number
  now: number
  /** What this session holds. A snapshot in the store can't say what mode a turn is in. */
  mode?: SalesforceMode
  /** A writer a person logged in, and hasn't logged out. The runner works this out, and the band says it in every state. */
  writerNotice?: string | null
}): SalesforceBand | null {
  switch (input.lock.state) {
    case 'off':
      return null
    case 'unreadable':
      return issueBand(plainIssue('unknown', 'lock', input.lock.message))
    case 'on':
      break
    default: {
      const exhaustive: never = input.lock
      return exhaustive
    }
  }
  const session = input.session
  if (session === null) {
    const message = input.registeredOrgs === 0 ? 'No org is registered. /topia-sf:connect registers one.' : 'Identity has not been checked yet this session.'
    return { kind: 'notice', text: `Salesforce: ${message}`, canContinue: false, ...(input.writerNotice ? { warning: input.writerNotice } : {}) }
  }
  const warning = [session.writeWarning, input.writerNotice, session.audit?.text].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ') || undefined
  // A stop has no acknowledgement. An old one for the same id must not clear it.
  if (session.issue !== null && (!showsContinue(session.issue.kind) || !acknowledgementApplies(input.ack, session.issue, hashesOf(session)))) {
    return issueBand(session.issue, warning)
  }
  if (session.identity === null) {
    return { kind: 'notice', text: 'Salesforce: Identity has not been checked yet this session.', canContinue: false, warning }
  }
  const checked = Date.parse(session.checkedAt)
  if (Number.isNaN(checked) || input.now - checked > STALE_MS) {
    const stale = {
      ...plainIssue('stale-verification', session.identity.orgName, 'The last live check is stale. /topia-sf:context runs a fresh one.'),
      orgId: session.identity.orgId,
      user: session.identity.user,
    }
    if (!acknowledgementApplies(input.ack, stale, hashesOf(session))) return issueBand(stale, warning)
  }
  const identity = input.mode === undefined ? session.identity : { ...session.identity, mode: input.mode }
  return { kind: 'quiet', text: bandText(identity), parts: bandParts(identity), warning }
}

export function hashesOf(session: SalesforceSession | null): { payloadHash: string; recordSetHash: string; orgIdentityHash: string } {
  return {
    payloadHash: session?.payloadHash ?? '',
    recordSetHash: session?.recordSetHash ?? '',
    orgIdentityHash: session?.orgIdentityHash ?? '',
  }
}

export function isResolved(reply: unknown): reply is SalesforceResolved {
  if (reply === null || typeof reply !== 'object') return false
  const resolved = reply as Partial<SalesforceResolved>
  const live = resolved.live
  return (
    resolved.ok === true &&
    live !== null &&
    typeof live === 'object' &&
    typeof live.orgId === 'string' &&
    typeof live.name === 'string' &&
    typeof live.isSandbox === 'boolean' &&
    typeof live.username === 'string' &&
    typeof live.instanceUrl === 'string' &&
    typeof live.instanceHost === 'string' &&
    resolved.writeAccess !== null &&
    typeof resolved.writeAccess === 'object'
  )
}

export type RegistrationScreen = {
  question: string
  options: string[]
  approveLabel: string | null
  /** A second answer that registers, and accepts one user for reads and writes on production. */
  acceptLabel?: string
  typedName: string | null
  /** What the runner writes. It comes from the live check, never from the model's arguments. */
  pinned: Record<string, unknown>
}

function liveClass(isSandbox: boolean): string {
  return classLabel(isSandbox ? 'sandbox' : 'production')
}

function writeLine(resolved: SalesforceResolved): string {
  switch (resolved.writeAccess.canWrite) {
    case 'no':
      return 'Write access: none found for this user.'
    case 'yes':
      return `Write access: ${resolved.writeAccess.reasons.map(reason => plainText(reason, 80)).join(', ')}. ${WRITE_WARNING}`
    default:
      return `Write access: not confirmed. ${UNKNOWN_WRITE_WARNING}`
  }
}

/**
 * Built from a live check, line by line, by code. Nothing here comes from the
 * model. A new org id or class for something already registered can't be approved
 * by a button: the person types the org name under Other.
 */
export function registrationScreen(resolved: SalesforceResolved): RegistrationScreen {
  const { live, previous } = resolved
  const name = plainText(live.name, 80)
  const facts = [`Class: ${liveClass(live.isSandbox)}, from the live org`, `Org: ${name}`, `Org id: ${plainText(live.orgId, 24)}`, `Instance: ${plainText(live.instanceHost, 120)}`, `Username: ${plainText(live.username, 120)}`, writeLine(resolved)]
  const lines: string[] = []
  const replacing = resolved.requiresTypedName && previous !== null
  if (replacing && previous !== null) {
    lines.push(`This replaces a registered org. Before: ${liveClass(previous.isSandbox)}, ${plainText(previous.name, 80)}, ${plainText(previous.orgId, 24)}, ${plainText(previous.instanceHost, 120)}.`, 'Now:')
  }
  lines.push(...facts)
  const others = (resolved.others ?? []).map(item => `${liveClass(item.isSandbox)} ${plainText(item.name, 80)}`)
  if (others.length > 0) lines.push(`Also registered here: ${others.join(', ')}.`)
  const pinned: Record<string, unknown> = {
    username: live.username,
    expect: { orgId: live.orgId, isSandbox: live.isSandbox },
    instanceUrl: live.instanceUrl,
    writeAccess: resolved.writeAccess,
    ...(replacing && previous !== null ? { replaces: previous.orgId } : {}),
  }
  if (resolved.role === 'writer') {
    const username = plainText(live.username, 120)
    lines.push(`Role: writer. Writes on this org target ${username}, and reads stay with ${plainText(resolved.reader ?? 'the registered reader', 120)}.`, `While ${username} is logged in, a shell command can write as it too. When the change is done, run this in your own terminal: ${writerLogoutCommand(live.username)}`)
    const label = plainText(`Register writer for ${name}`, 60)
    return { question: `${lines.join('\n')}\n\nRegister this user as the writer?`, options: ['Stop', label], approveLabel: label, typedName: null, pinned: { ...pinned, role: 'writer' } }
  }
  if (replacing) {
    lines.push(`To confirm, choose Other and type the org name exactly: ${name}`)
    return { question: `${lines.join('\n')}\n\nRegister this org in its place?`, options: ['Stop', 'Not this org'], approveLabel: null, typedName: name, pinned }
  }
  const label = plainText(`Register ${liveClass(live.isSandbox)} ${name}`, 60)
  if (resolved.canAcceptSingleUser === true) {
    lines.push(`This is production, and this user can write. "${label}" keeps it for reads, and writes stay refused until a second user is registered as the writer.`, `If this org has only one user that can write, "${SINGLE_USER_LABEL}" lets that user do both, and the band keeps saying so. This is what you'd be accepting:`, SALESFORCE_PROMISE)
    return { question: `${lines.join('\n')}\n\nRegister this org for this project?`, options: ['Stop', label, SINGLE_USER_LABEL], approveLabel: label, acceptLabel: SINGLE_USER_LABEL, typedName: null, pinned }
  }
  if (!live.isSandbox) lines.push('A write on production takes a second user: /topia-sf:connect, with role writer, after a person logs that user in.')
  return { question: `${lines.join('\n')}\n\nRegister this org for this project?`, options: ['Stop', label], approveLabel: label, typedName: null, pinned }
}

/** What the runner gets. The acceptance comes only from its own exact answer. */
export function registrationPinned(screen: RegistrationScreen, answer: string): Record<string, unknown> {
  return screen.acceptLabel !== undefined && answer === screen.acceptLabel ? { ...screen.pinned, singleUser: true } : screen.pinned
}

// Stop comes first in every dialog, so a stray Enter can't approve.
export const BRIEF_OPTIONS = ['Stop', 'Change it', 'Confirm']

export function isBriefRead(reply: unknown): reply is SalesforceBriefRead {
  if (reply === null || typeof reply !== 'object') return false
  const read = reply as Partial<SalesforceBriefRead>
  return read.ok === true && typeof read.briefId === 'string' && typeof read.briefHash === 'string' && read.brief !== null && typeof read.brief === 'object'
}

/**
 * Rendered by code from what the service stored, and never from the arguments of
 * the call. Each part sits on one line, with everything that could hide or draw
 * text removed.
 */
export function briefQuestion(read: SalesforceBriefRead): string {
  const { brief } = read
  const subjects = brief.subjects.map(item => `${plainText(item.name, 120)} (${plainText(item.status, 12)})`).join(', ')
  const questions = brief.blockingQuestions.map(item => plainText(item, 240)).join(' ')
  return [
    "The assistant wrote this brief. Topia has only cleaned it up, and it hasn't been checked against the org.",
    `Objective: ${plainText(brief.objective, 800)}`,
    `Environment: ${plainText(brief.environment, 200) || 'Not named'}`,
    `Subjects: ${subjects || 'None named'}`,
    `What would change: ${plainText(brief.change, 800) || 'Nothing. This is a question.'}`,
    ...(questions.length > 0 ? [`Still open: ${questions}`] : []),
    '',
    'Is this what you want?',
  ].join('\n')
}

export function isPrepared(reply: unknown): reply is SalesforcePrepared {
  if (reply === null || typeof reply !== 'object') return false
  const prepared = reply as Partial<SalesforcePrepared>
  return prepared.ok === true && Array.isArray(prepared.fields) && typeof prepared.limit === 'number' && prepared.identity !== null && typeof prepared.identity === 'object' && prepared.pinned !== undefined
}

/** A live identity line, exactly which fields, the row bound, and where the values go. Built from what the service prepared, which holds no values. */
export function valuesScreen(prepared: SalesforcePrepared): { question: string; options: string[]; approveLabel: string } {
  const { identity, fields, limit } = prepared
  const where = plainText(`${liveClass(identity.isSandbox)} ${identity.orgName}, ${identity.orgId}, ${identity.instanceHost}, ${identity.username}`, 300)
  const names = fields.map(field => plainText(field, 120)).join(', ')
  const isReport = prepared.kind === 'report'
  const noun = isReport ? 'columns' : 'fields'
  const filters = prepared.filters.map(item => plainText(`${item.field} ${item.op} ${JSON.stringify(item.value)?.replace(/^"|"$/g, '')}`, 200))
  const lines = [
    'Approved values go to the model provider and stay in local transcripts.',
    `Org: ${where}`,
    isReport ? `Report: ${plainText(prepared.reportName ?? '', 120)}` : `Object: ${plainText(prepared.object ?? '', 120)}`,
    `Exactly these ${noun}: ${names}`,
    ...(filters.length > 0 ? [`Only rows where: ${filters.join(' and ')}`] : []),
    ...(prepared.sort !== null ? [`Sorted by: ${plainText(prepared.sort.field, 120)}`] : []),
    `At most ${limit} rows.`,
    '',
    'Show these values to the assistant?',
  ]
  const approveLabel = plainText(isReport ? `Show ${fields.length} columns on up to ${limit} report rows` : `Show ${fields.length} fields on up to ${limit} ${(prepared.object ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)} rows`, 80)
  return { question: lines.join('\n'), options: ['Stop', approveLabel], approveLabel }
}

export type SalesforceWriteReply =
  | { ok: false; reason: string }
  | { ok: true; action: 'report'; text: string }
  | { ok: true; action: 'approve'; screenPlan: ApprovalPlan; facts: ApprovalFacts; pinned: unknown }

/** Null when it isn't something the runner would say, which reads as no answer at all. */
export function asWriteReply(reply: unknown): SalesforceWriteReply | null {
  if (reply === null || typeof reply !== 'object') return null
  const value = reply as { ok?: unknown; action?: unknown; reason?: unknown; text?: unknown; screenPlan?: unknown; facts?: unknown; pinned?: unknown }
  if (value.ok === false) return typeof value.reason === 'string' ? { ok: false, reason: value.reason } : null
  if (value.ok !== true) return null
  if (value.action === 'report') return typeof value.text === 'string' ? { ok: true, action: 'report', text: value.text } : null
  if (value.action !== 'approve' || value.screenPlan === null || typeof value.screenPlan !== 'object' || value.facts === null || typeof value.facts !== 'object' || value.pinned === undefined) return null
  return { ok: true, action: 'approve', screenPlan: value.screenPlan as ApprovalPlan, facts: value.facts as ApprovalFacts, pinned: value.pinned }
}

export function ackQuestion(item: SalesforceIssue): string {
  return [`Org: ${plainText(item.orgName, 80)}, ${plainText(item.orgId, 24)}`, `Notice: ${plainText(item.message, 600)}`, "Acknowledging lets one later call go on. It doesn't approve a change, and it doesn't make a partial result complete.", '', 'Acknowledge this notice?'].join('\n')
}

/** Exact, always. The Other box returns free text, so nothing close counts. */
export function registrationApproved(screen: RegistrationScreen, answer: string): boolean {
  if (screen.typedName !== null) return answer === screen.typedName && !screen.options.includes(answer)
  return answer === screen.approveLabel || (screen.acceptLabel !== undefined && answer === screen.acceptLabel)
}
