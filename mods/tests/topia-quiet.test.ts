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

test('the status line names the project, the weekly limit, and what Topia saved', async () => {
  expect(formatUsage({ root: 'C:\\CodeBase\\topia', weeklyPercent: 26.9 }, 3600))
    .toBe("Project: 'C:\\CodeBase\\topia' · 26% of weekly · topia saved −3.6k chars")
})

test('on Fable the Fable weekly limit shows, when the engine gives one', async () => {
  const line = { root: '/work/app', weeklyPercent: 26, isFableModel: true, fableWeeklyPercent: 31.2 }
  expect(formatUsage(line, 0)).toBe("Project: '/work/app' · 26% of weekly · (31% of Fable weekly)")
})

test('the Fable part is left out when the engine gives no figure or the model is not Fable', async () => {
  expect(formatUsage({ root: '/work/app', weeklyPercent: 26, isFableModel: true }, 0)).toBe("Project: '/work/app' · 26% of weekly")
  expect(formatUsage({ root: '/work/app', weeklyPercent: 26, isFableModel: false, fableWeeklyPercent: 31 }, 0)).toBe("Project: '/work/app' · 26% of weekly")
})

test('before any limit is known, only the project shows', async () => {
  expect(formatUsage({ root: '/work/app' }, 0)).toBe("Project: '/work/app'")
})

test('a long path keeps its drive and last two folders, and a quote in it switches the quotes', async () => {
  expect(formatUsage({ root: 'C:\\Users\\someone\\Documents\\clients\\very-long-folder-name\\repos\\service-api' }, 0))
    .toBe("Project: 'C:\\…\\repos\\service-api'")
  expect(formatUsage({ root: "/work/bob's app" }, 0)).toBe('Project: "/work/bob\'s app"')
})

test('a usage line saved in the old shape before a reload does not break the line', async () => {
  expect(formatUsage({ contextPercent: 41, cachePercent: 90, usd: 3 } as never, 1200)).toBe('topia saved −1.2k chars')
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
