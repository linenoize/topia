import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

import { UNSEEN, bypassText, isNewBypass, sentRequest } from '../lib/compose-watch.ts'
import { ordersKey } from '../lib/standing-orders.ts'

const ROOT = '/work/example-project'
// Mods whose session.start work needs more of the engine than these tests answer.
const QUIET_START = { gitBand: false, quietReports: false, modelPreset: false }
const COMPOSE = { model: 'test-model', promptModel: 'test-model', surfaces: [], tools: [], outputStyle: null, traits: [] }
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'test-model' }
const ANSWERED = { answer: 'done', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' as const, usage: USAGE }
const orders = (args: string) => ({
  command: 'orders',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

// One order on in the store, and the engine answers session.start needs.
function engine(on: On) {
  const toasts: string[] = []
  const saved = new Map<string, unknown>([[ordersKey(ROOT), { fanout: true, ledger: false, scripts: false, commit: false }]])
  on('store.get', ($, e) => ({ value: structuredClone(saved.get(e.key)) }))
  on('store.set', ($, e) => {
    saved.set(e.key, structuredClone(e.value))
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Box' as const }))
  on('prompt.compose', () => ({ sections: [] }))
  on('turn.complete', () => ({ text: '' }))
  return toasts
}

test('only an answered main-loop turn with usage counts as a request', async () => {
  expect(sentRequest(ANSWERED)).toBe(true)
  expect(sentRequest({ ...ANSWERED, usage: undefined })).toBe(false)
  expect(sentRequest({ ...ANSWERED, reason: 'aborted' })).toBe(false)
  expect(sentRequest({ ...ANSWERED, agentId: 'agent-1' })).toBe(false)
})

test('a bypass is new once, only when Topia had something to add', async () => {
  expect(isNewBypass(UNSEEN, ['standing orders'])).toBe(true)
  expect(isNewBypass(UNSEEN, [])).toBe(false)
  expect(isNewBypass({ isComposed: true, isBypassed: false }, ['standing orders'])).toBe(false)
  expect(isNewBypass({ isComposed: false, isBypassed: true }, ['standing orders'])).toBe(false)
  expect(bypassText(['standing orders', 'known SSH hosts'])).toContain('standing orders and known SSH hosts are not reaching')
})

test('a turn whose system prompt skipped Topia says so once, and /orders keeps saying it', { options: QUIET_START }, async ($, on) => {
  const toasts = engine(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })

  // No $.prompt.compose call: a plugin ahead of Topia sent the event past it.
  await $.turn.complete(ANSWERED)
  await $.turn.complete({ ...ANSWERED, turnId: 'turn-2' })
  expect(toasts.filter(text => text.includes('not reaching the model'))).toHaveLength(1)
  expect(toasts[0]).toContain('standing orders')

  const answer = await $.command.run(orders('fanout on'))
  expect(answer.text).toContain('Not reaching the model this session')

  // Once Topia's hook runs again, the sections reach the model and the note goes.
  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.some(section => section.id === 'topia:standing-orders')).toBe(true)
  expect((await $.command.run(orders('fanout on'))).text).not.toContain('Not reaching')
})

test('a session whose system prompt reached Topia stays quiet', { options: QUIET_START }, async ($, on) => {
  const toasts = engine(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: false })

  await $.prompt.compose(COMPOSE)
  await $.turn.complete(ANSWERED)
  expect(toasts.some(text => text.includes('not reaching the model'))).toBe(false)
})
