import type { GitInfo, UsageLine } from '../types'

// What each value the mods draw means, in a line: shown at the end of its row
// while the pointer rests on it, and under the band while it holds the focus.

export type Part = { key: string; text: string; about: string }

export const GIT_ABOUT = {
  branch: 'The branch checked out in this folder.',
  changed: 'Files with changes not yet committed, new untracked files included.',
  unpushed: 'Commits on this branch that its upstream does not have yet.',
  behind: 'Commits on the upstream that you have not pulled.',
  upstream: 'This branch tracks no remote branch, so nothing counts as unpushed; git push -u sets one.',
  commit: 'Asks Claude to commit the current changes with a descriptive message.',
  commitPush: 'Asks Claude to commit the current changes, then push them.',
  push: 'Asks Claude to push the unpushed commits.',
  hide: 'Hides this row until the session ends; /mods git off turns it off for good.',
} as const

export function gitParts(git: GitInfo): Part[] {
  const parts: Part[] = [{ key: 'git-branch', text: `⎇ ${git.branch}`, about: GIT_ABOUT.branch }]
  if (git.changed > 0) parts.push({ key: 'git-changed', text: `${git.changed} changed`, about: GIT_ABOUT.changed })
  if (git.unpushed > 0) parts.push({ key: 'git-unpushed', text: `${git.unpushed} unpushed`, about: GIT_ABOUT.unpushed })
  if (git.behind > 0) parts.push({ key: 'git-behind', text: `${git.behind} behind`, about: GIT_ABOUT.behind })
  if (!git.hasUpstream) parts.push({ key: 'git-upstream', text: 'no upstream', about: GIT_ABOUT.upstream })
  return parts
}

export const ROUTING_ABOUT = {
  chain: 'The skills the lead skill usually hands off to next.',
  hide: 'Hides this row until the session ends; /routing off (or /mods routing off) turns it off for good.',
  hit: 'Predicted from your wording, and it ran this turn.',
  missed: 'Predicted from your wording, but it did not run this turn.',
  chained: 'Ran this turn as one of the lead skill’s usual hand-offs.',
  extra: 'Ran this turn without being predicted from your wording.',
} as const

// The status line is plain text and takes no pointer or focus, so its items
// are explained in the /mods and /topia-activity panes.
const PATH_MAX = 48

// Keeps the drive or root and the last two folders: C:\…\repos\service-api.
export function elidePath(path: string, max = PATH_MAX): string {
  if (path.length <= max) return path
  const sep = path.includes('\\') ? '\\' : '/'
  const segments = path.split(/[\\/]/)
  if (segments.length < 4) return `…${path.slice(-(max - 1))}`
  const short = `${segments[0]}${sep}…${sep}${segments.slice(-2).join(sep)}`
  return short.length <= max ? short : `…${sep}${segments[segments.length - 1]}`
}

function quotePath(path: string): string {
  return path.includes("'") ? `"${path}"` : `'${path}'`
}

// Floor, not round, so the figure matches /usage.
const percent = (value: number) => `${Math.floor(value)}%`

export function usageParts(line: UsageLine | null, savedChars: number): Part[] {
  const parts: Part[] = []
  if (typeof line?.root === 'string' && line.root.length > 0) {
    parts.push({ key: 'usage-project', text: `Project: ${quotePath(elidePath(line.root))}`, about: `The project folder this session works in: ${line.root}` })
  }
  if (typeof line?.weeklyPercent === 'number') {
    parts.push({
      key: 'usage-weekly',
      text: `${percent(line.weeklyPercent)} of weekly`,
      about: "How much of your account's weekly usage limit is used. It resets once a week; /usage shows when.",
    })
  }
  if (line?.isFableModel === true && typeof line.fableWeeklyPercent === 'number') {
    parts.push({
      key: 'usage-fable',
      text: `(${percent(line.fableWeeklyPercent)} of Fable weekly)`,
      about: "How much of Fable's own weekly limit is used. It shows only while the session runs on Fable.",
    })
  }
  if (savedChars > 0) {
    parts.push({
      key: 'usage-saved',
      text: `topia saved −${(savedChars / 1000).toFixed(1)}k chars`,
      about: "Topia hook text kept out of the model's context this session (/topia-activity).",
    })
  }
  return parts
}

export const ORDERS_STATUS_ABOUT = 'The standing orders on in this project (/orders).'

// A hover group's name: 1 to 64 characters.
export function scopeOf(key: string): string {
  return `topia-about-${key}`.slice(0, 64)
}
