import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import {
  DEFAULTS,
  EMPTY_TIPS,
  IDS,
  ORDERS_INTRO,
  RULES,
  TIP_AFTER,
  composeText,
  countCues,
  cuedOrders,
  markDone,
  ordersKey,
  tipText,
  tipsKey,
} from '../lib/standing-orders.ts'

type On = Parameters<TestBody>[1]

const ROOT = '/work/example-project'
// Only the standing-orders mod reaches the engine in the turn tests.
const ORDERS_ONLY = { gitBand: false, quietReports: false, modelPreset: false, promptRouting: false }
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const PANE = {
  component: 'Pane',
  requestId: 'topia-standing-orders',
  props: { title: 'Standing orders', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const typed = (text: string) => ({ text, origin: { kind: 'composer' as const }, wait: false })
const ordersCommand = (args: string) => ({
  command: 'orders',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})
const OFF = { fanout: false, ledger: false, scripts: false, commit: false, trunk: false, decisions: false }

function memoryStore(on: On, entries: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  on('store.get', ($, e) => ({ value: structuredClone(store.get(e.key)) }))
  on('store.set', ($, e) => {
    store.set(e.key, structuredClone(e.value))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  return store
}

function engine(on: On) {
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Box' as const }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
}

const start = { cwd: ROOT, surface: 'terminal' as const, isInteractive: false }

// ── the orders ──

test('a fresh install adds nothing to the system prompt', async () => {
  expect(composeText(DEFAULTS)).toBe(null)
  for (const id of IDS) expect(DEFAULTS[id]).toBe(false)
})

test('only the orders turned on are added', async () => {
  const text = composeText({ ...OFF, fanout: true, ledger: true }) ?? ''
  expect(text).toContain(RULES.fanout.text)
  expect(text).toContain(RULES.ledger.text)
  expect(text.includes(RULES.scripts.text)).toBe(false)
  expect(text.includes(RULES.commit.text)).toBe(false)
})

test('trunk lands finished branches on local main, never pushes, never rewrites', async () => {
  expect(IDS).toContain('trunk')
  const text = composeText({ ...OFF, trunk: true }) ?? ''
  expect(text).toContain(RULES.trunk.text)
  expect(RULES.trunk.text).toMatch(/merge/i)
  expect(RULES.trunk.text).toMatch(/local main/)
  expect(RULES.trunk.text).toMatch(/worktree/)
  expect(RULES.trunk.text).toMatch(/ahead/)
  expect(RULES.trunk.text).toMatch(/[Nn]ever push/)
  expect(RULES.trunk.text).toMatch(/force/)
  expect(RULES.trunk.text).toMatch(/rewrite history/)
  expect(RULES.trunk.text).toMatch(/conflict/)
})

test('decisions are asked one at a time, with a default "ok" accepts, and journaled', async () => {
  expect(IDS).toContain('decisions')
  const text = RULES.decisions.text
  expect(text).toMatch(/one at a time/)
  expect(text).toMatch(/recommended default/)
  expect(text).toContain('"ok"')
  expect(text).toContain('topia:journal')
  expect(text).toMatch(/decision form, if (one is )?available/)
})

test('every order explains itself in one or two plain sentences', async () => {
  for (const id of IDS) {
    const about = RULES[id].about
    expect(about.length).toBeGreaterThan(20)
    expect((about.match(/[.!?](\s|$)/g) ?? []).length <= 2).toBe(true)
  }
  expect(ORDERS_INTRO).toMatch(/^Standing orders are rules/)
})

// ── cues in what the person types ──

test('wording that asks for what an order does is read as a cue', async () => {
  expect(cuedOrders('fan out subagents for the three modules')).toEqual(['fanout'])
  expect(cuedOrders('Fan-out the investigation')).toEqual(['fanout'])
  expect(cuedOrders('use parallel subagents')).toEqual(['fanout'])
  expect(cuedOrders('merge it into main and delete the worktree')).toEqual(['trunk'])
  expect(cuedOrders('why is this on a side branch? land it on main')).toEqual(['trunk'])
  expect(cuedOrders('clean up the stray worktrees')).toEqual(['trunk'])
  expect(cuedOrders('1. ok 2. go with your recommendation 3. yes')).toEqual(['decisions'])
  expect(cuedOrders('ask me one at a time')).toEqual(['decisions'])
  expect(cuedOrders('what did you skip?')).toEqual(['ledger'])
  expect(cuedOrders('commit and push')).toEqual(['commit'])
  expect(cuedOrders('give me one script I can run on the server')).toEqual(['scripts'])
})

test('ordinary wording is not a cue', async () => {
  expect(cuedOrders('fix the main menu')).toEqual([])
  expect(cuedOrders('run git status')).toEqual([])
  expect(cuedOrders('the main branch build is red')).toEqual([])
  expect(cuedOrders('3 tests skipped on CI')).toEqual([])
  expect(cuedOrders('what is the fanout of this graph node')).toEqual([])
})

test('a tip is due on the third cue, once, and never for an order that is on', async () => {
  let tips = EMPTY_TIPS
  const seen: (string | null)[] = []
  for (let i = 0; i < TIP_AFTER + 2; i += 1) {
    const counted = countCues(tips, ['fanout'], OFF, true)
    tips = counted.tips
    seen.push(counted.due)
  }
  expect(TIP_AFTER).toBe(3)
  expect(seen).toEqual([null, null, 'fanout', null, null])
  expect(tips.done).toEqual(['fanout'])

  const on = countCues(EMPTY_TIPS, ['trunk'], { ...OFF, trunk: true }, true)
  expect(on.tips).toBe(EMPTY_TIPS)
  expect(on.due).toBe(null)
})

test('a tip that cannot show yet waits for the next cue', async () => {
  const busy = countCues({ counts: { fanout: 2 }, done: [] }, ['fanout'], OFF, false)
  expect(busy.due).toBe(null)
  expect(busy.tips.done).toEqual([])
  expect(countCues(busy.tips, ['fanout'], OFF, true).due).toBe('fanout')
})

test('an order turned on is never tipped later', async () => {
  const tips = markDone({ counts: { trunk: 1 }, done: [] }, ['trunk'])
  expect(tips.done).toEqual(['trunk'])
  expect(markDone(tips, ['trunk'])).toBe(tips)
  for (let i = 0; i < 5; i += 1) expect(countCues(tips, ['trunk'], OFF, true).due).toBe(null)
})

test('the tip says what the order does and how to turn it on', async () => {
  const text = tipText('fanout')
  expect(text).toContain(RULES.fanout.about)
  expect(text).toContain('"fanout"')
  expect(tipsKey('C:\\Work\\App')).toBe('orders-tips:c:/work/app')
})

// ── the engine ──

test('the third "fan out" shows a tip; Turn on turns the order on and the tip goes', { options: ORDERS_ONLY }, async ($, on) => {
  const store = memoryStore(on)
  engine(on)
  await $.session.start(start)

  for (let i = 0; i < 2; i += 1) await $.prompt.submit(typed('fan out subagents for this'))
  const early = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await early.find({ key: 'orders-tip-on' })).toBe(undefined)
  await early.unmount()

  await $.prompt.submit(typed('please fan out subagents again'))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'topia', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /"fanout" standing order/ })).toBeDefined()
    expect(await ui.find({ key: 'orders-tip-on' })).toBeDefined()
    expect(await ui.find({ key: 'orders-tip-no' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  await ui.press({ key: 'orders-tip-on' })
  expect(await ui.find({ key: 'orders-tip-on' })).toBe(undefined)
  await ui.unmount()

  expect(store.get(ordersKey(ROOT))).toMatchObject({ fanout: true })
  // Counts and ids only: no prompt text is kept.
  const kept = JSON.stringify(store.get(tipsKey(ROOT)))
  expect(kept.includes('subagents')).toBe(false)
  expect(store.get(tipsKey(ROOT))).toMatchObject({ done: ['fanout'] })
})

test('No thanks hides the tip for good in this project', { options: ORDERS_ONLY }, async ($, on) => {
  const store = memoryStore(on)
  engine(on)
  await $.session.start(start)
  for (let i = 0; i < 3; i += 1) await $.prompt.submit(typed('merge it into main'))

  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /"trunk" standing order/ })).toBeDefined()
  await ui.press({ key: 'orders-tip-no' })
  expect(await ui.find({ key: 'orders-tip-no' })).toBe(undefined)
  await ui.unmount()

  for (let i = 0; i < 5; i += 1) await $.prompt.submit(typed('merge it into main'))
  const later = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await later.find({ key: 'orders-tip-no' })).toBe(undefined)
  await later.unmount()
  expect(store.get(ordersKey(ROOT))).toBe(undefined)
})

test('an order already on is never tipped, and a plugin prompt is not counted', { options: ORDERS_ONLY }, async ($, on) => {
  const store = memoryStore(on, { [ordersKey(ROOT)]: { ...OFF, fanout: true } })
  engine(on)
  await $.session.start(start)
  for (let i = 0; i < 4; i += 1) await $.prompt.submit(typed('fan out subagents'))
  for (let i = 0; i < 4; i += 1) {
    await $.prompt.submit({ text: 'Commit the changes, then commit and push.', origin: { kind: 'plugin' as const, name: 'example-plugin', asUser: true as const }, wait: false })
  }
  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'orders-tip-on' })).toBe(undefined)
  await ui.unmount()
  expect(store.get(tipsKey(ROOT))).toBe(undefined)
})

test('with standing orders off nothing is counted', { options: { ...ORDERS_ONLY, standingOrders: false } }, async ($, on) => {
  const store = memoryStore(on)
  engine(on)
  await $.session.start(start)
  for (let i = 0; i < 4; i += 1) await $.prompt.submit(typed('fan out subagents'))
  expect(store.get(tipsKey(ROOT))).toBe(undefined)
})

test('/orders explains what standing orders are, and lists trunk and decisions', { options: ORDERS_ONLY }, async ($, on) => {
  memoryStore(on)
  engine(on)
  mock.clock(on)
  await $.session.start(start)
  const answer = await $.command.run(ordersCommand(''))
  expect(answer.text).toMatch(/^Standing orders are rules/)

  const pane = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: /^Standing orders are rules/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: RULES.trunk.label })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: RULES.decisions.about })).toBeDefined()
  await pane.unmount()

  const turned = await $.command.run(ordersCommand('decisions on'))
  expect(turned.text).toContain('"decisions" is now on')
})
