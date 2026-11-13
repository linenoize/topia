import type { HiddenReport, UsageLine } from '../types'
import { usageParts } from './value-help'

// The blocks Topia's settings hooks print (hooks/session-start/index.cjs,
// hooks/lib/session-report.cjs, compiler/commands/hook-dispatch.js).
const RUNE_BLOCK = /\n?=== topia: Rune migration recommended ===[\s\S]*?migrate-from-rune --skip\n*/
const INSTALL_MENU = /\n?\s*╭─+╮\s*\n\s*│\s*Topia Step 1 done[\s\S]*?auto-checks itself the next session\.\)\n*/
const SESSION_REPORT = /<summary>Session activity<\/summary>|^Topia · \d+ skills? · /m
const GUARDIAN = /^\s*Topia-hook: [\w:-]+ \[advisory\] — tool=\S+\s*$/

export type Filtered = { text: string | null; kind: HiddenReport['kind'] } | null

// What the model should read instead of a settings hook's text; null when
// the text is none of Topia's noise and passes through unchanged.
export function filterHookText(text: string): Filtered {
  if (SESSION_REPORT.test(text)) return { text: null, kind: 'session-report' }
  if (GUARDIAN.test(text)) return { text: null, kind: 'guardian-advisory' }

  const stripped = text.replace(RUNE_BLOCK, '\n').replace(INSTALL_MENU, '\n')
  if (stripped === text) return null

  const kept = stripped.replace(/\n{3,}/g, '\n\n').trim()
  return { text: kept.length > 0 ? kept : null, kind: 'install-banner' }
}

// The panes explain the same parts, so both read from usageParts.
export function formatUsage(line: UsageLine, saved: number): string {
  return usageParts(line, saved)
    .map(part => part.text)
    .join(' · ')
}
