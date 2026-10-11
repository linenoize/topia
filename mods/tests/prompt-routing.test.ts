import { expect, mock, test } from 'claude-code/testing'

import {
  compare,
  contextText,
  decorations,
  isWritten,
  predict,
  ranSkill,
  toView,
  withoutRouterSuggestion,
} from '../lib/prompt-routing.ts'
import { SKILL_ROUTES } from '../lib/skill-routes.generated.ts'

const DRAFT = 'fix the crash in the parser and add a unit test'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
// Only the routing mod's hooks reach the engine in the turn tests.
const ROUTING_ONLY = { gitBand: false, standingOrders: false, quietReports: false, modelPreset: false }
// What the band is when no plugin draws one: an empty Box.
const NO_BAND = () => ({ type: 'Box' as const })
// A prompt as the engine raises it from the person's Enter, and a command as typed.
const typed = (text: string) => ({ text, origin: { kind: 'composer' as const }, wait: false })
const routingCommand = (args: string) => ({
  command: 'routing',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const names = (text: string) => predict(text).skills.map(skill => skill.name)

test('whole words only: "address" is not "add", "build" holds no "ui"', async () => {
  expect(names('update the address field')).toEqual([])
  expect(names('rebuild')).toEqual([])
})

test('a draft points at build first, then the most specific words', async () => {
  const prediction = predict(DRAFT)
  expect(prediction.skills.map(skill => skill.name)).toEqual(['build', 'test', 'debug'])
  expect(prediction.skills[0]?.keywords).toEqual(['fix', 'add'])
  expect(prediction.skills[1]?.keywords).toEqual(['unit test'])
  // build's usual hand-offs, less the skills already shown
  expect(prediction.chain).toEqual(['plan', 'fix', 'readiness', 'guardian', 'review', 'completion-gate', 'verification'])
})

test('plain endings count: tests, crashes, deployed', async () => {
  expect(names('the tests are red')).toEqual(['test'])
  expect(names('it crashes')).toEqual(['debug'])
  expect(names('we deployed')[0]).toBe('launch')
})

test('a skill named outright wins', async () => {
  const prediction = predict('/topia-review the login change')
  expect(prediction.skills[0]?.name).toBe('review')
  expect(prediction.skills[0]?.isExplicit).toBe(true)
  expect(names('ask topia:recon where the router lives')[0]).toBe('recon')
})

test('nothing matched, nothing shown', async () => {
  expect(toView(predict('hello there'))).toBe(null)
})

test('each matched span is underlined once, in its skill color', async () => {
  const runs = decorations(predict(DRAFT))
  expect(runs).toEqual([
    { start: 0, end: 3, color: 'cyan', underline: true },
    { start: 8, end: 13, color: 'yellow', underline: true },
    { start: 32, end: 35, color: 'cyan', underline: true },
    { start: 38, end: 47, color: 'magenta', underline: true },
  ])
  expect(DRAFT.slice(38, 47)).toBe('unit test')
})

test('predicted vs ran', async () => {
  const turn = { predicted: ['build', 'test'], chain: ['readiness'], ran: ['build', 'readiness', 'git'], isDone: true }
  expect(compare(turn)).toEqual({ hit: ['build'], missed: ['test'], chained: ['readiness'], extra: ['git'] })
})

test('a run is read from a skill id or a Topia subagent type', async () => {
  expect(ranSkill('topia:build')).toBe('build')
  expect(ranSkill('topia:topia-build')).toBe('build')
  expect(ranSkill('commit')).toBe(null)
  expect(ranSkill('topia:no-such-skill')).toBe(null)
})

test('the person writes the prompt; a notification does not', async () => {
  expect(isWritten({ kind: 'composer' })).toBe(true)
  expect(isWritten({ kind: 'plugin', asUser: true })).toBe(true)
  expect(isWritten({ kind: 'plugin' })).toBe(false)
  expect(isWritten({ kind: 'task-notification' })).toBe(false)
})

test('every keyword and hand-off names a real skill', async () => {
  const known = new Set(SKILL_ROUTES.map(route => route.name))
  for (const route of SKILL_ROUTES) {
    for (const next of route.chain) expect(known.has(next)).toBe(true)
  }
  expect(SKILL_ROUTES.filter(route => route.userInvocable && route.keywords.length > 0).length).toBeGreaterThan(50)
})

test('the model hint names skills and words, never the prompt', async () => {
  const view = toView(predict(DRAFT))
  expect(view).not.toBe(null)
  const text = contextText(view!)
  expect(text).toContain('topia:build ("fix", "add")')
  expect(text).not.toContain('parser')
})

test('a submitted prompt carries the hint, and the band follows the turn', { options: ROUTING_ONLY }, async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('skill.prompt', ($, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', NO_BAND)

  const entered = await $.prompt.submit(typed(DRAFT))
  expect(entered.text).toBe(DRAFT)
  expect(entered.context?.[0]).toContain('[topia prompt-routing]')

  await $.skill.prompt({ skill: 'topia:build', text: '' })
  await $.skill.prompt({ skill: 'topia:readiness', text: '' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'topia', surface, ...BAND })
    expect(await ui.find({ key: 'route-build' })).toBeDefined()
    await ui.press({ key: 'route-test' })
    expect(await ui.find({ type: 'Text', text: /^ⓘ test: TDD test writer/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'route-build' }))?.text).toBe('build ✓')
  expect((await ui.find({ key: 'route-test' }))?.text).toBe('test ✗')
  expect((await ui.find({ key: 'route-readiness' }))?.text).toBe('readiness')
  await ui.unmount()
})

test('/routing off hides the band and adds nothing for the model', { options: ROUTING_ONLY }, async ($, on) => {
  mock.store(on)
  on('session.root', () => ({ value: '/work/example-project' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))

  const answer = await $.command.run(routingCommand('off'))
  expect(answer.text).toContain('off')
  const entered = await $.prompt.submit(typed(DRAFT))
  expect(entered.context).toBe(undefined)

  await $.command.run(routingCommand('on'))
  const again = await $.prompt.submit(typed(DRAFT))
  expect(again.context?.[0]).toContain('topia:build')
})

test('with the hint off in /config the band still shows, the model gets nothing', { options: { ...ROUTING_ONLY, promptRoutingHint: false } }, async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('ui.render', NO_BAND)
  const entered = await $.prompt.submit(typed(DRAFT))
  expect(entered.context).toBe(undefined)
  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'route-build' })).toBeDefined()
  await ui.unmount()
})

test('with promptRouting off in /config a prompt passes untouched', { options: { ...ROUTING_ONLY, promptRouting: false } }, async ($, on) => {
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  const entered = await $.prompt.submit(typed(DRAFT))
  expect(entered.context).toBe(undefined)
})

// What hooks/intent-router prints for DRAFT where this module is not loaded.
const ROUTER_BLOCK = [
  '',
  '🧭 [Topia intent-router] Suggested: topia:build (L1, sonnet) — wording: "fix", "add"',
  '   Slash: /topia-build or /topia:build',
  '   Chain: build → plan → fix → readiness → guardian',
  '   Also consider: test, debug',
  '   Keyword reading only; skill-router decides the route.',
  '',
].join('\n')
const hookText = (text: string) => ({
  type: 'hook_additional_context' as const,
  text,
  origin: { kind: 'hook' as const, event: 'UserPromptSubmit' },
})

test('the intent-router block goes, the hook text around it stays', async () => {
  expect(withoutRouterSuggestion(ROUTER_BLOCK)).toBe('')
  expect(withoutRouterSuggestion(`[12:09 EDT -- dev]\n${ROUTER_BLOCK}`)).toBe('[12:09 EDT -- dev]')
  expect(withoutRouterSuggestion('[12:09 EDT -- dev]\n')).toBe('[12:09 EDT -- dev]\n')
})

test('the model reads the routing once: the hook block is dropped', { options: ROUTING_ONLY }, async ($, on) => {
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  expect((await $.prompt.attachment(hookText(ROUTER_BLOCK))).text).toBe(null)
  expect((await $.prompt.attachment(hookText(`[12:09 EDT -- dev]${ROUTER_BLOCK}`))).text).toBe('[12:09 EDT -- dev]')
  expect((await $.prompt.attachment(hookText('[12:09 EDT -- dev]'))).text).toBe('[12:09 EDT -- dev]')
})

test('with quietReports on too, the hook block is still dropped', { options: { ...ROUTING_ONLY, quietReports: true } }, async ($, on) => {
  mock.clock(on)
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  expect((await $.prompt.attachment(hookText(ROUTER_BLOCK))).text).toBe(null)
})
