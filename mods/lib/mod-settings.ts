import type { ModChoices, ModId, ModScope, ModSettings, ModsPrefs, ProjectMods } from '../types'

// Which of Topia's mods are on, and why. A choice saved for this project
// beats one saved for you (all projects), which beats the /config switch;
// a /config row an organization's policy locks beats them all. Choices live
// in the plugin's own store under ~/.claude, never in the repo.

export const MOD_IDS = ['gitBand', 'standingOrders', 'remoteHosts', 'quietReports', 'modelPreset', 'promptRouting'] as const

export type ModInfo = {
  short: string
  label: string
  isDefaultOn: boolean
  about: string
}

export const MODS: Record<ModId, ModInfo> = {
  gitBand: {
    short: 'git',
    label: 'Git band',
    isDefaultOn: true,
    about: 'A row above the prompt with uncommitted and unpushed counts and Commit / Push buttons; hidden when the tree is clean.',
  },
  standingOrders: {
    short: 'orders',
    label: 'Standing orders',
    isDefaultOn: true,
    about: 'Rules you turn on per project (/orders) added to the system prompt. Flipping it mid-session changes that prompt.',
  },
  remoteHosts: {
    short: 'hosts',
    label: 'Remote hosts',
    isDefaultOn: false,
    about: 'Remembers SSH hosts from ssh commands that worked in this project and lists them to the model (/hosts).',
  },
  quietReports: {
    short: 'quiet',
    label: 'Quiet reports',
    isDefaultOn: true,
    about: "Keeps Topia's session reports and banners out of the model's context (/topia-activity); usage in the status line.",
  },
  modelPreset: {
    short: 'model',
    label: 'Model preset',
    isDefaultOn: true,
    about: 'Remembers the model you last used in this project and starts the next session on it (/model-preset).',
  },
  promptRouting: {
    short: 'routing',
    label: 'Prompt routing',
    isDefaultOn: true,
    about: 'As you type, names the Topia skills your wording points at and underlines the words; predicted vs ran after.',
  },
}

export type ModSource = 'default' | 'config' | 'user' | 'project' | 'locked'

export const SOURCE_LABELS: Record<ModSource, string> = {
  default: 'default',
  config: '/config',
  user: 'you',
  project: 'this project',
  locked: 'locked',
}

export const SOURCE_ABOUT: Record<ModSource, string> = {
  default: "Nobody has chosen; this is the plugin's default.",
  config: 'Set by the switch in /config, which applies to every project.',
  user: 'Your choice for every project, saved with /mods.',
  project: 'Chosen for this project only; it beats your all-projects choice.',
  locked: "Your organization's policy fixes this switch in /config.",
}

export const NO_SETTINGS: ModSettings = { user: {}, project: {}, locked: [] }

export const DEFAULT_PREFS: ModsPrefs = { askNewProjects: true, recapAt: 0, sessionsSinceRecap: 0, isRecapOff: false }

// Every 10 sessions and 14 days, whichever comes later.
export const RECAP_SESSIONS = 10
export const RECAP_MS = 14 * 24 * 60 * 60 * 1000

export type Options = Readonly<Record<string, unknown>>

export function resolve(id: ModId, options: Options, settings: ModSettings): { isOn: boolean; source: ModSource } {
  const config = options[id]
  const configured = typeof config === 'boolean' ? config : MODS[id].isDefaultOn
  if (settings.locked.includes(id)) return { isOn: configured, source: 'locked' }
  const project = settings.project[id]
  if (project !== undefined) return { isOn: project, source: 'project' }
  const user = settings.user[id]
  if (user !== undefined) return { isOn: user, source: 'user' }
  return { isOn: configured, source: configured === MODS[id].isDefaultOn ? 'default' : 'config' }
}

export function effective(options: Options, settings: ModSettings): Record<ModId, boolean> {
  return Object.fromEntries(MOD_IDS.map(id => [id, resolve(id, options, settings).isOn])) as Record<ModId, boolean>
}

// The mods whose effective state differs between two settings.
export function flipped(options: Options, before: ModSettings, after: ModSettings): { id: ModId; isOn: boolean }[] {
  const was = effective(options, before)
  const now = effective(options, after)
  return MOD_IDS.filter(id => was[id] !== now[id]).map(id => ({ id, isOn: now[id] }))
}

// One mod's choice at one scope: a boolean sets it, undefined clears it.
export function choose(settings: ModSettings, scope: ModScope, id: ModId, value: boolean | undefined): ModSettings {
  const next: ModChoices = { ...settings[scope] }
  if (value === undefined) delete next[id]
  else next[id] = value
  return { ...settings, [scope]: next }
}

export function normalizeRoot(root: string): string {
  return root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export const USER_KEY = 'mods:user'
export const PREFS_KEY = 'mods:prefs'
export function projectModsKey(root: string): string {
  return `mods:${normalizeRoot(root)}`
}

export const EMPTY_PROJECT: ProjectMods = { choices: {}, isConfirmed: false, isOnboardAsked: false }

export function shouldRecap(prefs: ModsPrefs, now: number): boolean {
  return !prefs.isRecapOff && prefs.sessionsSinceRecap >= RECAP_SESSIONS && now - prefs.recapAt >= RECAP_MS
}

export function findMod(word: string): ModId | null {
  const lower = word.toLowerCase()
  return MOD_IDS.find(id => id.toLowerCase() === lower || MODS[id].short === lower) ?? null
}

export type ModsCommand =
  | { kind: 'open' }
  | { kind: 'set'; ids: ModId[]; value: boolean | undefined | 'toggle'; scope: ModScope | null }
  | { kind: 'forget-project' }
  | { kind: 'error'; text: string }

export const MODS_USAGE =
  '/mods [git|orders|hosts|quiet|model|routing|all] [on|off|reset] [--project|--user] · /mods forget-project'

// `/mods`, `/mods git off`, `/mods all on --project`, `/mods routing reset`.
export function parseModsArgs(args: string): ModsCommand {
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word.length > 0)
  if (words.length === 0) return { kind: 'open' }
  if (words[0] === 'forget-project') return { kind: 'forget-project' }

  let scope: ModScope | null = null
  let value: boolean | undefined | 'toggle' = 'toggle'
  const ids: ModId[] = []
  for (const word of words) {
    const bare = word.replace(/^--/, '')
    if (bare === 'project' || bare === 'user') scope = bare
    else if (bare === 'on' || bare === 'off') value = bare === 'on'
    else if (bare === 'reset') value = undefined
    else if (bare === 'all') ids.push(...MOD_IDS)
    else {
      const id = findMod(bare)
      if (id === null) return { kind: 'error', text: `Unknown mod "${word}". ${MODS_USAGE}` }
      ids.push(id)
    }
  }
  if (ids.length === 0) return { kind: 'error', text: `Name a mod. ${MODS_USAGE}` }

  return { kind: 'set', ids: [...new Set(ids)], value, scope }
}

// Where a choice goes when the command names no scope: this project if it
// already has a choice for that mod (so the change takes effect), else you.
export function defaultScope(settings: ModSettings, id: ModId): ModScope {
  return settings.project[id] !== undefined ? 'project' : 'user'
}

export function summary(options: Options, settings: ModSettings): string {
  const now = effective(options, settings)
  const on = MOD_IDS.filter(id => now[id]).map(id => MODS[id].short)
  const off = MOD_IDS.filter(id => !now[id]).map(id => MODS[id].short)
  return [on.length > 0 ? `${on.join(' · ')} on` : '', off.length > 0 ? `${off.join(' · ')} off` : '']
    .filter(part => part.length > 0)
    .join(', ')
}
