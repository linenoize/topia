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
    }
  }
}
