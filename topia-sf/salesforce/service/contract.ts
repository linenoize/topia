/** No imports in this file: the mod loads it directly, so it holds the one copy of what both sides share. */

/** Same shape as the mods' project keys: slashes, no trailing slash, lower case. */
export function normalizeRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function pathsMatch(left: string, right: string): boolean {
  return normalizeRoot(left) === normalizeRoot(right)
}

export type OrgClass = 'production' | 'sandbox' | 'scratch' | 'other'

/** Absent means `read-only`. It is an accident guard, not the boundary. */
export type SfMode = 'read-only' | 'explain' | 'investigate' | 'plan' | 'validate' | 'execute' | 'review'

export type SfCommandName =
  | 'ask'
  | 'capture'
  | 'connect'
  | 'context'
  | 'deploy'
  | 'diagnose'
  | 'diff'
  | 'disable'
  | 'document'
  | 'enable'
  | 'enhance'
  | 'execute'
  | 'explain'
  | 'inspect'
  | 'plan'
  | 'query'
  | 'report'
  | 'restore'
  | 'review-access'
  | 'review-flow'
  | 'test'
  | 'validate'
  | 'verify'
  | 'document'
  | 'vendor'

export type IssueKind =
  | 'stale-verification'
  | 'user-changed-on-read'
  | 'expired-auth'
  | 'uncommitted-before-retrieve'
  | 'report-row-cap'
  | 'partial-dependency-coverage'
  | 'vendor-version-drift'
  | 'org-id-mismatch'
  | 'plan-bound-to-different-org'
  | 'production-write-without-elevation'
  | 'missing-approval'
  | 'approval-hash-mismatch'
  | 'destructive-over-ceiling'
  | 'unknown'

/** Served by the stdio MCP server. Reads with no personal values, and plan tools. Nothing here changes an org. */
export const TOOL_NAMES = [
  'org_inspect',
  'schema_describe',
  'records_query',
  'users_resolve',
  'audit_query',
  'reports_describe',
  'reports_run',
  'metadata_retrieve',
  'metadata_diff',
  'brief_propose',
  'practice_record',
  'records_plan_update',
  'deployment_plan',
  'records_preview',
  'deployment_validate',
  'deployment_verify',
  'dependency_report',
  'packages_inventory',
  'vendor_findings_list',
  'vendor_fingerprint',
  'vendor_finding_add',
  'vendor_finding_reverify',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/** These write notes under docs/salesforce/vendors/ in the project. They never change an org, and they never hold a username. */
export const PROJECT_WRITE_TOOLS = ['vendor_fingerprint', 'vendor_finding_add', 'vendor_finding_reverify'] as const

/** Stdio tools that write on this machine, never to an org. A check-only job and a reconcile write only to the local store. */
export const LOCAL_WRITE_TOOLS: readonly string[] = ['brief_propose', 'practice_record', 'records_plan_update', 'deployment_plan', 'deployment_validate', 'deployment_verify', ...PROJECT_WRITE_TOOLS]

/** A person must answer. These exist only as mod tools, so a host without hooks has none of them. */
export const MOD_ONLY_TOOLS = ['sf_brief_confirm', 'sf_show_values', 'sf_ack_issue', 'sf_org_register', 'sf_records_execute', 'sf_deployment_execute', 'sf_deployment_validate', 'sf_tests_run', 'sf_restore_plan_execute'] as const

export const WRITE_TOOLS = ['sf_records_execute', 'sf_deployment_execute', 'sf_deployment_validate', 'sf_tests_run', 'sf_restore_plan_execute', 'sf_org_register'] as const

export type JournalEventName =
  | 'request.received'
  | 'request.enhanced'
  | 'confirmation.asked'
  | 'confirmation.received'
  | 'query.planned'
  | 'query.executed'
  | 'finding'
  | 'practice-review'
  | 'change.proposed'
  | 'change.approved'
  | 'change.started'
  | 'preimage.saved'
  | 'change.executed'
  | 'change.reconciled'
  | 'deploy.validated'
  | 'deploy.canceled'
  | 'tests.started'
  | 'activation.disabled'
  | 'org.registered'
  | 'refusal'

export type ActivationLock = {
  projectRoot: string
  timestamp: string
  user: string
}

/** One entry of the committed orgs.json. No username: that stays in the service store. */
export type OrgEntry = {
  orgId: string
  instanceUrl: string
  name: string
  verifiedAt: string
  repo?: string
  branch?: string
  /** May only narrow the constants below. It can never raise them. */
  allowedOperationClasses?: string[]
  destructiveCeiling?: number
}

/** What registration stores in the service store. Targets go by this username, never by an alias. */
export type OrgRecord = {
  orgId: string
  username: string
  instanceUrl: string
  isSandbox: boolean
  name: string
  registeredAt: string
  writeAccess: { canWrite: 'yes' | 'no' | 'unknown'; reasons: string[] }
  /** Absent means the reader. A writer is a second user on the same org, for production writes. It stays in the service store. */
  role?: 'reader' | 'writer'
  /** Production only: a person accepted, at registration, that this one user both reads and writes. */
  singleUserAcceptedAt?: string
  /** A writer only: what the last look at its login found. */
  login?: WriterLogin
}

export type WriterLogin = { state: 'logged-in' | 'logged-out' | 'unknown'; checkedAt: string }

export type Identity = {
  classification: OrgClass
  orgName: string
  orgId: string
  user: string
  mode: SfMode
  operation: string
}

export type SfIssue = {
  id: string
  kind: IssueKind
  orgId: string
  orgName: string
  user: string
  operationClass: string
  message: string
}

export type Acknowledgement = {
  issueId: string
  orgId: string
  user: string
  operationClass: string
  payloadHash: string
  recordSetHash: string
  orgIdentityHash: string
}

/** Contract section 9. The code picks the class, and this text. Nothing the model writes changes either. */
export type ReversibilityClass = 'restorable' | 'recycle-bin' | 'forward-only' | 'access' | 'irreversible'

export const REVERSIBILITY_TEXT: Record<ReversibilityClass, string> = {
  restorable: 'Old values are saved. Restoring is a new plan, automation fires again, and records changed since are listed, not overwritten.',
  'recycle-bin': "Usually 15 days in the Recycle Bin, but it can purge after 2 hours. There's no CLI undelete, so a person restores from Setup.",
  'forward-only': 'No undo. Restoring means deploying the pre-deploy snapshot as a new change.',
  access: "The assignment can be removed. Access already used can't be undone.",
  irreversible: "Sends and callouts can't be recalled.",
}

export function reversibilityOf(plan: { kind: 'records'; operation: 'update' | 'delete' } | { kind: 'deploy' }): ReversibilityClass {
  if (plan.kind === 'deploy') return 'forward-only'
  return plan.operation === 'delete' ? 'recycle-bin' : 'restorable'
}

/** What a redeploy can't restore, shown before approval. */
export const REDEPLOY_CANNOT_RESTORE: readonly string[] = ['deleted field data', 'field type changes', 'picklist replacements', 'flow versions already run']

export const REPORT_ROW_CAP = 2000
export const STALE_MS = 24 * 60 * 60 * 1000
/** Ceilings and allowed classes are constants in code. orgs.json may only narrow them. */
export const DESTRUCTIVE_CEILING = 100
/** The most records one plan can touch. A constant in code, like the delete ceiling, and the plan tool's schema says the same. */
export const RECORD_WRITE_CEILING = 10_000
export const ALLOWED_OPERATION_CLASSES = ['read', 'plan', 'validate', 'write'] as const

/** The promise, word for word. The README, /topia-sf:enable, and the dialog that accepts one user all carry it. */
export const SALESFORCE_PROMISE =
  "Topia's Salesforce tools can change your org only after you approve the exact change in a dialog. That applies to Topia's tools, not to everything the assistant can do. The assistant can also run shell commands as you, and if your Salesforce CLI login can write, a shell command can write too. This approval slows that down, but it can't prevent it. To make it a hard limit, connect production with a read-only Salesforce user, and log in as a write-capable user only when you intend to make a change."

export const WRITE_WARNING = "This CLI user can write directly. Topia's approval doesn't stop a shell command."
export const SINGLE_USER_WARNING = `One user both reads and writes this production org, as a person accepted at registration. ${WRITE_WARNING}`
export const SINGLE_USER_LABEL = 'Accept one user for writes'

/** For a person's own terminal. The assistant never runs these. */
export function writerLogoutCommand(username: string): string {
  return `sf org logout --target-org ${username}`
}

export function writerLoginSteps(username: string, instanceUrl: string): string {
  return `In your own terminal, run sf org login web --instance-url ${instanceUrl}, and sign in as ${username} in the browser, with MFA. Then run this command again. When the change is done, run ${writerLogoutCommand(username)}. The assistant doesn't run these.`
}

/** What the band keeps saying until a look finds the writer gone. Null means nothing to say. */
export function writerNoticeFor(writers: { username: string; login?: WriterLogin }[]): string | null {
  const up = writers.filter(writer => writer.login?.state !== 'logged-out')
  if (up.length === 0) return null
  return up
    .map(writer => (writer.login?.state === 'logged-in' ? `Writer still logged in: ${writer.username}. When you're done, run ${writerLogoutCommand(writer.username)} in your own terminal.` : `Topia couldn't check whether the writer ${writer.username} is logged in, so treat it as logged in. When you're done, run ${writerLogoutCommand(writer.username)} in your own terminal.`))
    .join(' ')
}

export function writerLogoutReminder(username: string): string {
  return `The writer ${username} is still logged in. When you've finished this change, run this in your own terminal: ${writerLogoutCommand(username)}. The assistant doesn't run it.`
}
export const UNKNOWN_WRITE_WARNING = "Topia couldn't confirm this CLI user is read-only, so treat it as able to write. Topia's approval doesn't stop a shell command."

/** The last comparison of the org's audit trail with the journal. A null text means nothing to report, and only a check that ran can say that. */
export type AuditSnapshot = { state: 'clean' | 'found' | 'could-not-check'; text: string | null; checkedAt: string }

/** What the band draws from. Written after every live check and read through the runner. */
export type SessionSnapshot = {
  identity: Omit<Identity, 'operation'> | null
  issue: SfIssue | null
  orgIdentityHash: string
  checkedAt: string
  writeWarning: string | null
  audit?: AuditSnapshot | null
}

const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-Z\\^_])|\u009b[0-?]*[ -/]*[@-~]/g
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\u{e0000}-\u{e0fff}]/gu
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u0084\u0086-\u009f]/g

/** Removes what a reader can't see but a terminal or a model can: ANSI, control characters, bidi, zero-width, and tag characters. Line breaks and tabs stay. */
export function stripInvisible(value: string): string {
  return value.replace(ANSI, '').replace(INVISIBLE, '').replace(CONTROL, '')
}

/**
 * Org-authored or model-authored text on one plain line: control characters, ANSI,
 * bidi overrides, zero-width characters, and newlines removed, then capped.
 */
export function plainText(value: string, cap: number): string {
  const cleaned = stripInvisible(value)
    .replace(/[\r\n\t\u0085\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= cap) return cleaned
  const cut = cleaned.slice(0, cap - 1)
  return `${/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut}…`
}

/**
 * Everything a reader could not see or tell apart from a space: control, format, bidi and tag
 * characters, line and paragraph separators, every space but the plain one, private use, unassigned
 * code points, and the fillers that draw as blank. A value shown to a person has each of these
 * written out, so what they read is what gets written.
 */
const UNSEEN = /[\p{C}\p{Z}­͏؜ᅟᅠ឴឵᠋-᠏ㅤ︀-️ﾠ]/u
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

export function hasUnseen(text: string): boolean {
  return Array.from(text).some(char => char !== ' ' && UNSEEN.test(char))
}

/** Value text on the screen: how many characters of it show, and at most how long the written-out form gets. */
export const VALUE_SHOWN = 120
export const VALUE_OUT_MAX = 360

/** Code points in the string, which is what a person counts. */
export function charCount(text: string): number {
  return Array.from(text).length
}

/**
 * A string written out with nothing hidden: backslash, quote and the usual breaks as `\\`, `\"`, `\n`,
 * and every other unseen character as `\u{hex}`. Quoting is the caller's. Stops at `maxChars` characters or
 * `maxOut` output, and says how many characters it covered.
 */
export function escapeExact(value: string, maxChars: number = Number.POSITIVE_INFINITY, maxOut: number = Number.POSITIVE_INFINITY): { text: string; covered: number } {
  let text = ''
  let covered = 0
  for (const char of Array.from(value)) {
    if (covered >= maxChars) break
    let out: string
    if (char === '\\') out = '\\\\'
    else if (char === '"') out = '\\"'
    else if (char === '\n') out = '\\n'
    else if (char === '\r') out = '\\r'
    else if (char === '\t') out = '\\t'
    else if (char !== ' ' && UNSEEN.test(char)) out = `\\u{${(char.codePointAt(0) as number).toString(16)}}`
    else out = char
    if (text.length + out.length > maxOut) break
    text += out
    covered += 1
  }
  return { text, covered }
}

/**
 * Why a value can't be shown to a person in full, or null. A value that is cut on the screen has its
 * start written out, so what is cut must hold nothing hidden, or the screen would hide it.
 */
export function valueProblem(value: string): string | null {
  if (LONE_SURROGATE.test(value)) return 'holds half of a character pair, which cannot be written out, or written as it is'
  const { covered } = escapeExact(value, VALUE_SHOWN, VALUE_OUT_MAX)
  const rest = Array.from(value).slice(covered).join('')
  if (rest.length > 0 && hasUnseen(rest)) return 'is too long to show in full and holds invisible or control characters past the part that shows'
  return null
}

export function classLabel(kind: OrgClass): string {
  switch (kind) {
    case 'production':
      return 'Production'
    case 'sandbox':
      return 'Sandbox'
    case 'scratch':
      return 'Scratch'
    case 'other':
      return 'Other'
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}

export function modeLabel(mode: SfMode): string {
  switch (mode) {
    case 'read-only':
      return 'Read-only'
    case 'explain':
      return 'Explain'
    case 'investigate':
      return 'Investigate'
    case 'plan':
      return 'Plan'
    case 'validate':
      return 'Validate'
    case 'execute':
      return 'Execute'
    case 'review':
      return 'Review'
    default: {
      const exhaustive: never = mode
      return exhaustive
    }
  }
}

export function isWriteTool(name: string): boolean {
  return (WRITE_TOOLS as readonly string[]).includes(name)
}

export function isKnownTool(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

export function formatIdentity(identity: Identity): string {
  return [
    classLabel(identity.classification),
    identity.orgName,
    identity.orgId,
    identity.user,
    modeLabel(identity.mode),
    identity.operation,
  ].join('  ')
}

