import { expect, mock, test } from 'claude-code/testing'

import { filterHookText, formatUsage } from '../lib/topia-quiet.ts'

const RUNE = [
  '',
  '=== topia: Rune migration recommended ===',
  '  · Found .rune/ in this project',
  '  To suppress this warning without migrating:',
  '    node compiler/bin/topia.js migrate-from-rune --skip',
  '',
].join('\n')
const MENU = [
  '',
  '  ╭───────────────────────────╮',
  '  │  Topia Step 1 done. Complete install:  │',
  '  ╰───────────────────────────╯',
  '    [x] /topia finalize',
  '  (Each completed step auto-checks itself the next session.)',
  '',
].join('\n')
const KEEP = '[topia: Memory checklist]\n  1. Invoke topia:recall'

test('drops the session report and the guardian advisory', async () => {
  expect(filterHookText('Topia · 0 skills · models none · 31 tools\n\n<details>\n<summary>Session activity</summary>')?.text).toBe(null)
  expect(filterHookText('Topia-hook: guardian [advisory] — tool=Bash')?.kind).toBe('guardian-advisory')
})

test('strips the Rune banner and install menu, keeps the rest', async () => {
  const filtered = filterHookText(RUNE + MENU + KEEP)
  expect(filtered?.kind).toBe('install-banner')
  expect(filtered?.text).toBe(KEEP)
})

test("leaves other hooks' text alone", async () => {
  expect(filterHookText('=== REMEMBER ===\nHistory in .remember/')).toBe(null)
})

test('a hook attachment from Topia is kept out of the request', async ($, on) => {
  mock.clock(on)
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  const dropped = await $.prompt.attachment({
    type: 'hook_additional_context',
    text: 'Topia-hook: guardian [advisory] — tool=Bash',
    origin: { kind: 'hook', event: 'PreToolUse' },
  })
  expect(dropped.text).toBe(null)
  const kept = await $.prompt.attachment({
    type: 'hook_additional_context',
    text: '[20:58 EDT -- dev]',
    origin: { kind: 'hook', event: 'UserPromptSubmit' },
  })
  expect(kept.text).toBe('[20:58 EDT -- dev]')
})

test('the status line reads short', async () => {
  expect(formatUsage({ contextPercent: 41.6, cachePercent: 90.2, usd: 3.125, fiveHourPercent: 37 }, 12400))
    .toBe('ctx 42% · cache 90% · $3.13 · 5h 37% · topia −12.4k chars')
})

test('with quietReports off in /config the attachment passes through', { options: { quietReports: false } }, async ($, on) => {
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  const passed = await $.prompt.attachment({
    type: 'hook_additional_context',
    text: 'Topia-hook: guardian [advisory] — tool=Bash',
    origin: { kind: 'hook', event: 'PreToolUse' },
  })
  expect(passed.text).toBe('Topia-hook: guardian [advisory] — tool=Bash')
})
