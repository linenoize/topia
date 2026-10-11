import type { RoutedSkill, RoutingTurn, RoutingView } from '../types'
import { SKILL_ROUTES } from './skill-routes.generated'
import type { SkillRoute } from './skill-routes.generated'

// Reads a prompt's wording the way skill-router's tables do: which Topia
// skills its words point at, and where in the text. A keyword is 3 points a
// word (as the intent-router hook scores a word; "unit test" says more than
// "test"), an L1 orchestrator 1 more, and a skill named outright
// (/topia-debug, topia:debug) wins.

export const MAX_SKILLS = 3
// Past this a paste is not read further: the band is a hint, not a parser.
export const MAX_CHARS = 8000

const MIN_SCORE = 3
const KEYWORD_SCORE = 3
const EXPLICIT_SCORE = 100

export type RouteMatch = { start: number; end: number; keyword: string }
export type ScoredSkill = RoutedSkill & { score: number; matches: RouteMatch[] }
export type Prediction = { skills: ScoredSkill[]; chain: string[] }

const BY_NAME = new Map<string, SkillRoute>(SKILL_ROUTES.map(route => [route.name, route]))

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Whole words only, so "ui" never matches inside "build" nor "add" inside
// "address"; the words of a phrase may be split by any spaces, and a word
// may take a plain ending (tests, fixed, adding).
function keywordPattern(keyword: string): RegExp {
  const words = keyword.trim().split(/\s+/).map(escapeRegExp).join('\\s+')
  const suffix = /[a-z]$/i.test(keyword) ? '(?:s|es|ed|d|ing)?' : ''
  return new RegExp(`(?<![\\w-])${words}${suffix}(?![\\w-])`, 'gi')
}

const PATTERNS = SKILL_ROUTES.flatMap(route =>
  route.keywords.map(keyword => ({ name: route.name, keyword, pattern: keywordPattern(keyword) })),
)

const EXPLICIT = /(?:\/topia[-:]|\/topia\s+|(?<![\w-])topia:)([a-z][\w-]*)/gi

function layerRank(name: string): number {
  return Number(BY_NAME.get(name)?.layer.replace(/\D/g, '') || 9)
}

// Within one skill the longest of overlapping matches wins: "unit test" is
// one match, not "unit test" and "test".
function dropOverlaps(matches: RouteMatch[]): RouteMatch[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: RouteMatch[] = []
  for (const match of sorted) {
    const last = kept[kept.length - 1]
    if (last === undefined || match.start >= last.end) kept.push(match)
  }
  return kept
}

export function predict(text: string): Prediction {
  const read = text.slice(0, MAX_CHARS)
  const found = new Map<string, { matches: RouteMatch[]; isExplicit: boolean }>()
  const entry = (name: string) => {
    let one = found.get(name)
    if (one === undefined) {
      one = { matches: [], isExplicit: false }
      found.set(name, one)
    }
    return one
  }

  for (const hit of read.matchAll(EXPLICIT)) {
    const name = (hit[1] ?? '').toLowerCase()
    if (!BY_NAME.has(name) || hit.index === undefined) continue
    const one = entry(name)
    one.isExplicit = true
    one.matches.push({ start: hit.index, end: hit.index + hit[0].length, keyword: `topia:${name}` })
  }

  for (const { name, keyword, pattern } of PATTERNS) {
    pattern.lastIndex = 0
    for (const hit of read.matchAll(pattern)) {
      if (hit.index === undefined) continue
      entry(name).matches.push({ start: hit.index, end: hit.index + hit[0].length, keyword })
    }
  }

  const scored: ScoredSkill[] = []
  for (const [name, one] of found) {
    const matches = dropOverlaps(one.matches)
    const keywords = [...new Set(matches.map(match => match.keyword))]
    // Each keyword counts once, so "fix it, fix it" does not outrank a
    // prompt that says two different things.
    const words = keywords.reduce((sum, keyword) => sum + keyword.split(/\s+/).length, 0)
    let score = one.isExplicit ? EXPLICIT_SCORE : words * KEYWORD_SCORE
    if (score > 0 && BY_NAME.get(name)?.layer === 'L1') score += 1
    if (score >= MIN_SCORE) scored.push({ name, keywords, isExplicit: one.isExplicit, score, matches })
  }

  scored.sort((a, b) => b.score - a.score || layerRank(a.name) - layerRank(b.name) || a.name.localeCompare(b.name))
  const skills = scored.slice(0, MAX_SKILLS)
  const shown = new Set(skills.map(skill => skill.name))
  const top = skills[0]
  const chain = top === undefined ? [] : (BY_NAME.get(top.name)?.chain ?? []).filter(name => !shown.has(name))

  return { skills, chain }
}

// What the band and the turn keep: names and keywords, never offsets or text.
export function toView(prediction: Prediction): RoutingView | null {
  if (prediction.skills.length === 0) return null
  return {
    skills: prediction.skills.map(({ name, keywords, isExplicit }) => ({ name, keywords, isExplicit })),
    chain: prediction.chain,
  }
}

export function viewKey(view: RoutingView | null): string {
  return view === null ? '' : JSON.stringify(view)
}

// One painted run per matched span, in the color of the highest-ranked skill
// that claims it.
export const SKILL_COLORS = ['cyan', 'magenta', 'yellow'] as const
export type SkillColor = (typeof SKILL_COLORS)[number]
export type Run = { start: number; end: number; color: SkillColor; underline: true }

export function skillColor(index: number): SkillColor {
  return SKILL_COLORS[index % SKILL_COLORS.length] ?? 'cyan'
}

export function decorations(prediction: Prediction): Run[] {
  const runs: Run[] = []
  prediction.skills.forEach((skill, index) => {
    const color = skillColor(index)
    for (const match of skill.matches) {
      const isTaken = runs.some(run => match.start < run.end && run.start < match.end)
      if (!isTaken) runs.push({ start: match.start, end: match.end, color, underline: true })
    }
  })
  return runs.sort((a, b) => a.start - b.start)
}

// The note the model reads beside the prompt (never shown to the person).
export function contextText(view: RoutingView): string {
  const parts = view.skills.map(skill =>
    skill.isExplicit
      ? `topia:${skill.name} (named outright)`
      : `topia:${skill.name} (${skill.keywords.map(keyword => `"${keyword}"`).join(', ')})`,
  )
  const lead = view.skills[0]?.name
  const chain = lead !== undefined && view.chain.length > 0 ? ` Usual hand-offs after topia:${lead}: ${view.chain.join(' → ')}.` : ''
  return (
    `[topia prompt-routing] The wording of this prompt points at ${parts.join(', ')}.${chain} ` +
    'This is a keyword reading shown to the user in a band above the prompt; skill-router still decides the route.'
  )
}

// A skill the turn ran, from the Skill tool or a slash command (`topia:build`,
// `topia:topia-build` for the /topia-build alias) or a Topia subagent type.
export function ranSkill(id: string | undefined): string | null {
  if (id === undefined || !id.startsWith('topia:')) return null
  const name = id.slice('topia:'.length).replace(/^topia-/, '')
  return BY_NAME.has(name) ? name : null
}

// A prompt the person wrote: typed, sent from a phone or the SDK, or put in
// as their own words by a plugin (the git band's Commit). Not a notification,
// a peer's message or a scheduled task's.
export function isWritten(origin: { kind: string; asUser?: true }): boolean {
  return ['composer', 'bridge', 'sdk'].includes(origin.kind) || (origin.kind === 'plugin' && origin.asUser === true)
}

export function startTurn(view: RoutingView): RoutingTurn {
  return { predicted: view.skills.map(skill => skill.name), chain: view.chain, ran: [], isDone: false }
}

export function compare(turn: RoutingTurn): { hit: string[]; missed: string[]; chained: string[]; extra: string[] } {
  const ran = new Set(turn.ran)
  const predicted = new Set(turn.predicted)
  const chain = new Set(turn.chain)
  return {
    hit: turn.predicted.filter(name => ran.has(name)),
    missed: turn.predicted.filter(name => !ran.has(name)),
    chained: turn.ran.filter(name => !predicted.has(name) && chain.has(name)),
    extra: turn.ran.filter(name => !predicted.has(name) && !chain.has(name)),
  }
}

export function describeSkill(name: string, max = 220): string {
  const text = BY_NAME.get(name)?.description ?? ''
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

// The intent-router hook (hooks/intent-router) prints the same reading for
// hosts without this module. Where the module runs, the band and the hint
// stand in for it, and its block is dropped so the model reads it once.
const ROUTER_HEAD = '🧭 [Topia intent-router]'
const ROUTER_BLOCK = /\n*🧭 \[Topia intent-router\][^\n]*(?:\n {3}[^\n]*)*\n*/g

export function withoutRouterSuggestion(text: string): string {
  if (!text.includes(ROUTER_HEAD)) return text
  return text.replace(ROUTER_BLOCK, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
