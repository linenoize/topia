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
export function usageParts(line: UsageLine | null, savedChars: number): Part[] {
  const parts: Part[] = []
  if (line?.contextPercent !== undefined) {
    parts.push({ key: 'usage-ctx', text: `ctx ${Math.round(line.contextPercent)}%`, about: "How full the model's context window is." })
  }
  if (line?.cachePercent !== undefined) {
    parts.push({
      key: 'usage-cache',
      text: `cache ${Math.round(line.cachePercent)}%`,
      about: "The share of the last turn's input read from the prompt cache: cheaper and faster.",
    })
  }
  if (line?.usd !== undefined) {
    parts.push({ key: 'usage-usd', text: `$${line.usd.toFixed(2)}`, about: 'The estimated cost of this session so far.' })
  }
  if (line?.fiveHourPercent !== undefined) {
    parts.push({
      key: 'usage-5h',
      text: `5h ${Math.round(line.fiveHourPercent)}%`,
      about: 'How much of your five-hour usage limit is used.',
    })
  }
  if (savedChars > 0) {
    parts.push({
      key: 'usage-saved',
      text: `topia −${(savedChars / 1000).toFixed(1)}k chars`,
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
