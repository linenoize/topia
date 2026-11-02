// State contract for Topia's Claude Code mods (mods/*.tsx). Every value is
// held under the `topia` plugin, so each key carries its mod's prefix.

export type GitInfo = {
  isRepo: boolean
  branch: string
  changed: number
  unpushed: number
  behind: number
  hasUpstream: boolean
}

export type OrderId = 'fanout' | 'ledger' | 'scripts' | 'commit'
export type Orders = Record<OrderId, boolean>

export type Host = {
  host: string
  user?: string
  key?: string
  port?: string
  sudoOk: boolean
  uses: number
  firstSeen: string
  lastOk: string
}

export type SshTarget = { host: string; user?: string; key?: string; port?: string; remote: string }

export type HiddenReport = {
  event: string
  kind: 'session-report' | 'guardian-advisory' | 'install-banner'
  chars: number
  at: number
  text: string
}

export type UsageLine = {
  contextPercent?: number
  cachePercent?: number
  usd?: number
  fiveHourPercent?: number
}

// Prompt routing: what a draft's wording points at, as the band shows it.
// Keywords only, never the prompt's text.
export type RoutedSkill = { name: string; keywords: string[]; isExplicit: boolean }
export type RoutingView = { skills: RoutedSkill[]; chain: string[] }
export type RoutingTurn = { predicted: string[]; chain: string[]; ran: string[]; isDone: boolean }

// Mods on and off: a choice per scope, the effective value resolved in
// lib/mod-settings.ts (project > user > /config; a policy lock beats all).
export type ModId = 'gitBand' | 'standingOrders' | 'remoteHosts' | 'quietReports' | 'modelPreset' | 'promptRouting'
export type ModChoices = Partial<Record<ModId, boolean>>
export type ModScope = 'user' | 'project'
export type ModSettings = { user: ModChoices; project: ModChoices; locked: ModId[] }
// One project's record: its choices, whether the person has answered the
// first-run row here, and whether onboard has asked yet.
export type ProjectMods = { choices: ModChoices; isConfirmed: boolean; isOnboardAsked: boolean }
// The person's own, for every project.
export type ModsPrefs = { askNewProjects: boolean; recapAt: number; sessionsSinceRecap: number; isRecapOff: boolean }
// The row above the prompt that asks about mods, when one shows.
export type ModsPrompt = 'first-run' | 'onboard' | 'recap'

// Whether Topia's prompt.compose hook has run this session, and whether a
// turn showed a plugin ahead of it sent the system prompt on past it.
export type ComposeWatch = { isComposed: boolean; isBypassed: boolean }
// Salesforce environment band. Not a /mods switch. On only when this project
// root has a lock in the service's store. claude plugin validate requires this
// file to stand alone, so these unions are a copy of salesforce/service/contract.ts,
// held to it by salesforce/service/mod-parity.test.js.
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
// Who asked for what this turn. Set only by a command typed at the prompt, and back to null when the main loop's turn ends.
export type SalesforceModeState = { mode: SalesforceMode; command: string }
// What a person confirmed in the dialog. Session memory only: no file can set this.
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
    topia: {
      gitInfo: GitInfo | null
      gitBandHidden: boolean
      standingOrders: Orders | null
      sshHosts: Record<string, Host>
      quietHidden: HiddenReport[]
      quietSavedChars: number
      quietUsage: UsageLine | null
      modelPresetApplied: boolean
      routingLive: RoutingView | null
      routingTurn: RoutingTurn | null
      routingHidden: boolean
      bandFocus: string | null
      modSettings: ModSettings | null
      modsPrompt: ModsPrompt | null
      modsScope: ModScope
      modsFocus: string | null
      modsPrefs: ModsPrefs | null
      composeWatch: ComposeWatch
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
    }
  }
}
