import type { OrderId, OrderTips, Orders } from '../types'

// Off until the user turns one on with /orders: these change how the model works.
export const DEFAULTS: Orders = { fanout: false, ledger: false, scripts: false, commit: false, trunk: false, decisions: false }

// What the /orders pane and its command say first.
export const ORDERS_INTRO =
  'Standing orders are rules Claude follows in every session of this project, so you do not have to repeat them. ' +
  'Each one is off until you turn it on.'

// label: the pane's row. about: one or two plain sentences for the person.
// text: what the model reads in the system prompt while the order is on.
export const RULES: Record<OrderId, { label: string; about: string; text: string }> = {
  fanout: {
    label: 'Fan out independent work to parallel subagents',
    about: 'Claude splits independent work across parallel subagents without being asked.',
    text:
      'When work splits into independent parts (several files, modules, features or investigations), ' +
      'fan it out to parallel subagents instead of working through it serially. Keep shared decisions ' +
      'and the final integration in the main thread.',
  },
  ledger: {
    label: 'End tasks with a skipped / deferred ledger',
    about: 'Each task ends with a list of what was skipped or put off, and where that list is written down.',
    text:
      'End every task that changes code or docs with a short "Skipped / deferred" list: each item not done, ' +
      'why, and the file path where it is recorded for later. Record deferred items in the project\'s existing ' +
      'TODO or plan doc (create docs/TODO.md if there is none). If nothing was skipped, say so in one line.',
  },
  scripts: {
    label: 'Hand-offs are one logged script with yes/no confirms',
    about: 'Steps you run yourself come as one script that logs what it did and asks before anything destructive.',
    text:
      'When the user has to run something themselves (another machine, a server, an install), hand it over ' +
      'as one script, not steps to copy and paste. The script says up front what it will do, prints clear ' +
      'progress, writes a timestamped log file and prints its path so the user can hand it back for review, ' +
      'and asks for an explicit yes/no before anything destructive.',
  },
  commit: {
    label: 'Commit and push when a task is done',
    about: 'Finished work is committed and pushed to the current branch.',
    text:
      'When a task is finished and its checks pass, commit the changes with a descriptive message and push ' +
      'to the current branch\'s remote, unless the user said not to.',
  },
  trunk: {
    label: 'Land finished work on local main',
    about: 'Finished agent and worktree branches are merged into your local main branch and cleaned up. Nothing is pushed unless you ask.',
    text:
      'When a task is done and its checks pass, land the work on the local main branch (main, or the repo\'s ' +
      'default branch): commit what is finished, merge each finished agent or worktree branch into local main, ' +
      'then delete the merged worktrees and branches. Then report how many commits local main is ahead of and ' +
      'behind its remote. Never push unless the user asks (the commit-and-push order, when on, counts as asking). ' +
      'Never force, rebase shared commits or otherwise rewrite history. If a merge conflicts, stop: leave the ' +
      'branches and worktrees in place and report the conflict.',
  },
  decisions: {
    label: 'Ask decisions one at a time, with a default',
    about: 'Claude asks one decision at a time, each with a recommended default. Reply "ok" to accept it.',
    text:
      'When you need the user to make several decisions, ask them one at a time. Give each a recommended ' +
      'default and a one-line reason; a reply of "ok" (or "yes") accepts the default. Record each accepted ' +
      'decision with topia:journal. For a batch of more than about 5 related decisions, you may offer a ' +
      'decision form, if one is available, instead of asking one by one.',
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

// ── tips: an order the person keeps asking for by hand ──────────────────────

// The cue count at which the tip shows, per order and project.
export const TIP_AFTER = 3
// A long paste is not read for cues past this.
const CUE_CHARS = 2000

export const EMPTY_TIPS: OrderTips = { counts: {}, done: [] }

// Wording that asks, by hand, for what an order does every time.
const CUES: Record<OrderId, RegExp[]> = {
  fanout: [/\bfan[\s-]?out\s+(?:the\s+|to\s+|into\s+)?(?:sub-?)?agents?\b/i, /\bfan[\s-]out\b/i, /\bparallel\s+(?:sub-?)?agents\b/i],
  ledger: [
    /\bwhat\s+(?:did|have)\s+(?:you|we)\s+(?:skip|defer)/i,
    /\bwhat\s+(?:was|got|is|were)\s+(?:skipped|deferred)\b/i,
    /\banything\s+(?:skipped|deferred)\b/i,
    /\bskipped\s+(?:or|and|\/)\s*deferred\b/i,
  ],
  scripts: [
    /\b(?:one|a\s+single)\s+script\b/i,
    /\bgive\s+me\s+a\s+script\b/i,
    /\bscript\s+(?:that\s+)?(?:i|we)\s+can\s+run\b/i,
  ],
  commit: [/\bcommit\s+(?:and|&)\s+push\b/i],
  trunk: [
    /\bmerge\s+(?:it|this|that|them|everything|the\s+branch(?:es)?|the\s+work|it\s+all)?\s*(?:back\s+)?(?:in)?to\s+(?:local\s+)?main\b/i,
    /\bland\s+(?:it|this|that|them|the\s+work)?\s*on\s+(?:local\s+)?main\b/i,
    /\b(?:clean\s+up|delete|remove)\s+(?:the\s+|all\s+the\s+|stray\s+|old\s+|those\s+|these\s+)*(?:agent\s+|side\s+)?(?:worktrees?|branches)\b/i,
    /\bon\s+a\s+side\s+branch\b/i,
  ],
  decisions: [
    /\bone\s+(?:question\s+|decision\s+|thing\s+)?at\s+a\s+time\b/i,
    /\b(?:go|went|going)\s+with\s+(?:your|the)\s+recommend/i,
    /\b(?:accept|use|take)\s+(?:all\s+)?(?:of\s+)?(?:your|the)\s+recommend/i,
    /\bwhatever\s+you\s+recommend\b/i,
    /\bas\s+(?:you\s+)?recommended\b/i,
  ],
}

// The orders whose job this prompt asks for by hand. Ids only; the text is
// never kept.
export function cuedOrders(text: string): OrderId[] {
  const read = text.slice(0, CUE_CHARS)
  return IDS.filter(id => CUES[id].some(cue => cue.test(read)))
}

// Counts one prompt's cues for orders that are off and not tipped yet. The
// tip falls due on the TIP_AFTER-th cue, when one can show now; it is then
// marked done so it never comes back.
export function countCues(
  tips: OrderTips,
  cued: readonly OrderId[],
  orders: Orders,
  canShow: boolean,
): { tips: OrderTips; due: OrderId | null } {
  const counts = { ...tips.counts }
  let done = tips.done
  let due: OrderId | null = null
  let isCounted = false
  for (const id of cued) {
    if (orders[id] || done.includes(id)) continue
    isCounted = true
    counts[id] = (counts[id] ?? 0) + 1
    if (due === null && canShow && (counts[id] ?? 0) >= TIP_AFTER) {
      due = id
      done = [...done, id]
    }
  }
  // Nothing counted: the same object, so the caller writes nothing.
  return { tips: isCounted ? { counts, done } : tips, due }
}

// An order turned on is never tipped later, even if turned off again.
export function markDone(tips: OrderTips, ids: readonly OrderId[]): OrderTips {
  const fresh = ids.filter(id => !tips.done.includes(id))
  return fresh.length === 0 ? tips : { ...tips, done: [...tips.done, ...fresh] }
}

export function tipsKey(root: string) {
  return `orders-tips:${root.replace(/\\/g, '/').toLowerCase()}`
}

const ASKED: Record<OrderId, string> = {
  fanout: 'You often ask to fan out to subagents.',
  ledger: 'You often ask what was skipped.',
  scripts: 'You often ask for a script to run.',
  commit: 'You often ask to commit and push.',
  trunk: 'You often ask to merge work back into main.',
  decisions: 'You often take the recommended answer.',
}

export function tipText(id: OrderId): string {
  return `${ASKED[id]} The "${id}" standing order does this for you in every session of this project. ${RULES[id].about}`
}
