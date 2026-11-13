// State contract for topia-sf Claude Code mods. Values are held under the
// `topia-sf` plugin. claude plugin validate requires this file to stand alone,
// so these unions are a copy of salesforce/service/contract.ts, held to it by
// salesforce/service/mod-parity.test.js.

export type SalesforceOrgClass = 'production' | 'sandbox' | 'scratch' | 'other'
export type SalesforceMode = 'read-only' | 'explain' | 'investigate' | 'plan' | 'validate' | 'execute' | 'review'
export type SalesforceIssueKind =
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
export type SalesforceIssue = {
  id: string
  kind: SalesforceIssueKind
  orgId: string
  orgName: string
  user: string
  operationClass: string
  message: string
}
export type SalesforceIdentity = {
  classification: SalesforceOrgClass
  orgName: string
  orgId: string
  user: string
  mode: SalesforceMode
}
export type SalesforceAck = {
  issueId: string
  kind: SalesforceIssueKind
  orgId: string
  user: string
  operationClass: string
  payloadHash: string
  recordSetHash: string
  orgIdentityHash: string
}
export type SalesforceModeState = { mode: SalesforceMode; command: string }
export type SalesforceConfirmedBrief = { briefHash: string; at: string }
export type SalesforceAudit = { state: 'clean' | 'found' | 'could-not-check'; text: string | null; checkedAt: string }
export type SalesforceBriefRead = {
  ok: true
  briefId: string
  briefHash: string
  brief: { objective: string; environment: string; subjects: { name: string; status: string }[]; change: string; blockingQuestions: string[] }
}
export type SalesforcePrepared = {
  ok: true
  kind: 'records' | 'report'
  identity: { isSandbox: boolean; orgName: string; orgId: string; instanceHost: string; username: string }
  object?: string
  reportName?: string
  fields: string[]
  filters: { field: string; op: string; value: unknown }[]
  sort: { field: string; direction: string } | null
  limit: number
  pinned: unknown
}
export type SalesforcePart = { key: string; text: string; about: string }
export type SalesforceBand =
  | { kind: 'quiet'; text: string; parts: SalesforcePart[]; warning?: string }
  | { kind: 'notice'; text: string; canContinue: boolean; issue?: SalesforceIssue; warning?: string }
  | { kind: 'stop'; text: string; canContinue: false; issue: SalesforceIssue; warning?: string }
export type SalesforceLockState = { state: 'off' } | { state: 'on' } | { state: 'unreadable'; message: string }
export type SalesforceSession = {
  identity: SalesforceIdentity | null
  issue: SalesforceIssue | null
  orgIdentityHash: string
  checkedAt: string
  payloadHash?: string
  recordSetHash?: string
  writeWarning?: string | null
  audit?: SalesforceAudit | null
}
export type SalesforcePendingEnable = { projectRoot: string; user: string }
export type SalesforceResolved = {
  ok: true
  live: { orgId: string; name: string; isSandbox: boolean; class: string; organizationType: string; instanceUrl: string; instanceHost: string; username: string }
  writeAccess: { canWrite: 'yes' | 'no' | 'unknown'; reasons: string[] }
  previous: { orgId: string; name: string; isSandbox: boolean; instanceHost: string; username: string } | null
  others: { orgId: string; name: string; isSandbox: boolean }[]
  requiresTypedName: boolean
  role?: 'writer'
  reader?: string
  canAcceptSingleUser?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'topia-sf': {
      salesforceBand: SalesforceBand | null
      salesforcePendingEnable: SalesforcePendingEnable | null
      salesforcePendingDisable: string | null
      salesforceAck: SalesforceAck | null
      salesforceToolRegistered: boolean
      salesforceMode: SalesforceModeState | null
      salesforceBrief: SalesforceConfirmedBrief | null
      salesforceTainted: boolean
      salesforceGuardMissing: boolean
      salesforceHeadless: boolean
      salesforceStarted: boolean
      bandFocus: string | null
    }
  }
}
