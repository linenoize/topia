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
    }
  }
}
