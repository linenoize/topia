import type { OrderId, Orders } from '../types'

// Off until the user turns one on with /orders: these change how the model works.
export const DEFAULTS: Orders = { fanout: false, ledger: false, scripts: false, commit: false }

export const RULES: Record<OrderId, { label: string; text: string }> = {
  fanout: {
    label: 'Fan out independent work to parallel subagents',
    text:
      'When work splits into independent parts (several files, modules, features or investigations), ' +
      'fan it out to parallel subagents instead of working through it serially. Keep shared decisions ' +
      'and the final integration in the main thread.',
  },
  ledger: {
    label: 'End tasks with a skipped / deferred ledger',
    text:
      'End every task that changes code or docs with a short "Skipped / deferred" list: each item not done, ' +
      'why, and the file path where it is recorded for later. Record deferred items in the project\'s existing ' +
      'TODO or plan doc (create docs/TODO.md if there is none). If nothing was skipped, say so in one line.',
  },
  scripts: {
    label: 'Hand-offs are one logged script with yes/no confirms',
    text:
      'When the user has to run something themselves (another machine, a server, an install), hand it over ' +
      'as one script, not steps to copy and paste. The script says up front what it will do, prints clear ' +
      'progress, writes a timestamped log file and prints its path so the user can hand it back for review, ' +
      'and asks for an explicit yes/no before anything destructive.',
  },
  commit: {
    label: 'Commit and push when a task is done',
    text:
      'When a task is finished and its checks pass, commit the changes with a descriptive message and push ' +
      'to the current branch\'s remote, unless the user said not to.',
  },
}

export const IDS = Object.keys(RULES) as OrderId[]

export function ordersKey(root: string) {
  return `orders:${root.replace(/\\/g, '/').toLowerCase()}`
}

export function ordersStatus(current: Orders): string | undefined {
  const on = IDS.filter(id => current[id])
  return on.length > 0 ? `orders: ${on.join('·')}` : undefined
}

export function composeText(current: Orders): string | null {
  const on = IDS.filter(id => current[id])
  if (on.length === 0) return null
  return [
    '# Standing orders from the user',
    'The user has asked for these in every session of this project; follow them without being asked again.',
    ...on.map(id => `- ${RULES[id].text}`),
  ].join('\n')
}
