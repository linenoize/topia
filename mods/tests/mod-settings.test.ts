import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

import {
  DEFAULT_PREFS,
  MOD_IDS,
  NO_SETTINGS,
  RECAP_MS,
  USER_KEY,
  choose,
  defaultScope,
  flipped,
  parseModsArgs,
  projectModsKey,
  resolve,
  shouldRecap,
  summary,
} from '../lib/mod-settings.ts'
import { ordersKey } from '../lib/standing-orders.ts'
import { gitParts, usageParts } from '../lib/value-help.ts'

const ROOT = '/work/example-project'
const DEFAULT_OPTIONS = { gitBand: true, standingOrders: true, remoteHosts: false, quietReports: true, modelPreset: true, promptRouting: true }
// Mods whose session.start work needs more of the engine than these tests answer.
const QUIET_START = { gitBand: false, quietReports: false, modelPreset: false }
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const mods = (args: string) => ({
  command: 'mods',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})
const startSession = (isInteractive = true) => ({ cwd: ROOT, surface: 'terminal' as const, isInteractive })

// The plugin's store, in memory and open to the test (its $ has no store).
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

const COMPOSE = { model: 'test-model', promptModel: 'test-model', surfaces: [], tools: [], outputStyle: null, traits: [] }

// Answers what session.start and the band ask the engine for.
function engine(on: On) {
  const status: (string | undefined)[] = []
  on('session.root', () => ({ value: ROOT }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Box' as const }))
  return status
}

// ── the resolver ──

test('a project choice beats yours, yours beats /config, a policy lock beats all', async () => {
  expect(resolve('gitBand', DEFAULT_OPTIONS, NO_SETTINGS)).toEqual({ isOn: true, source: 'default' })
  expect(resolve('gitBand', { ...DEFAULT_OPTIONS, gitBand: false }, NO_SETTINGS)).toEqual({ isOn: false, source: 'config' })
  const user = choose(NO_SETTINGS, 'user', 'gitBand', false)
  expect(resolve('gitBand', DEFAULT_OPTIONS, user)).toEqual({ isOn: false, source: 'user' })
  const project = choose(user, 'project', 'gitBand', true)
  expect(resolve('gitBand', DEFAULT_OPTIONS, project)).toEqual({ isOn: true, source: 'project' })
  expect(resolve('gitBand', { ...DEFAULT_OPTIONS, gitBand: false }, { ...project, locked: ['gitBand'] })).toEqual({
    isOn: false,
    source: 'locked',
  })
  expect(resolve('remoteHosts', DEFAULT_OPTIONS, NO_SETTINGS).isOn).toBe(false)
})

test('a reset clears one scope, and only the mods that changed are flipped', async () => {
  const off = choose(NO_SETTINGS, 'user', 'promptRouting', false)
  expect(flipped(DEFAULT_OPTIONS, NO_SETTINGS, off)).toEqual([{ id: 'promptRouting', isOn: false }])
  expect(choose(off, 'user', 'promptRouting', undefined).user).toEqual({})
  expect(summary(DEFAULT_OPTIONS, off)).toBe('git · orders · quiet · model on, hosts · routing off')
})

test('/mods reads mods, values and scopes in any order', async () => {
  expect(parseModsArgs('')).toEqual({ kind: 'open' })
  expect(parseModsArgs('git off')).toEqual({ kind: 'set', ids: ['gitBand'], value: false, scope: null })
  expect(parseModsArgs('--project hosts quiet on')).toEqual({
    kind: 'set',
    ids: ['remoteHosts', 'quietReports'],
    value: true,
    scope: 'project',
  })
  expect(parseModsArgs('all reset --user')).toEqual({ kind: 'set', ids: [...MOD_IDS], value: undefined, scope: 'user' })
  expect(parseModsArgs('routing')).toEqual({ kind: 'set', ids: ['promptRouting'], value: 'toggle', scope: null })
  expect(parseModsArgs('forget-project')).toEqual({ kind: 'forget-project' })
  expect(parseModsArgs('gti off').kind).toBe('error')
})

test('with no scope named, a change goes where it takes effect', async () => {
  expect(defaultScope(NO_SETTINGS, 'gitBand')).toBe('user')
  expect(defaultScope(choose(NO_SETTINGS, 'project', 'gitBand', true), 'gitBand')).toBe('project')
})

test('the recap waits for 10 sessions and 14 days, and stops when dismissed', async () => {
  const due = { ...DEFAULT_PREFS, recapAt: 1, sessionsSinceRecap: 10 }
  expect(shouldRecap(due, 1 + RECAP_MS)).toBe(true)
  expect(shouldRecap(due, RECAP_MS)).toBe(false)
  expect(shouldRecap({ ...due, sessionsSinceRecap: 9 }, 1 + RECAP_MS)).toBe(false)
  expect(shouldRecap({ ...due, isRecapOff: true }, 1 + RECAP_MS)).toBe(false)
})

test('every value the band shows has a line on what it means', async () => {
  const parts = gitParts({ isRepo: true, branch: 'main', changed: 3, unpushed: 1, behind: 2, hasUpstream: false })
  expect(parts.map(part => part.text)).toEqual(['⎇ main', '3 changed', '1 unpushed', '2 behind', 'no upstream'])
  for (const part of parts) expect(part.about.length).toBeGreaterThan(20)
  const usage = usageParts({ contextPercent: 41.6, cachePercent: 90.2, usd: 3.125, fiveHourPercent: 37 }, 12400)
  expect(usage.map(part => part.text)).toEqual(['ctx 42%', 'cache 90%', '$3.13', '5h 37%', 'topia −12.4k chars'])
})

// ── the engine ──

test('/mods turns a mod off for you without a reload, and its command says so', { options: QUIET_START }, async ($, on) => {
  memoryStore(on, { [ordersKey(ROOT)]: { fanout: true, ledger: false, scripts: false, commit: false } })
  engine(on)
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(startSession(false))

  const before = await $.prompt.compose(COMPOSE)
  expect(before.sections.some(section => section.id === 'topia:standing-orders')).toBe(true)

  const answer = await $.command.run(mods('orders off'))
  expect(answer.text).toContain('Standing orders off for you (every project)')
  const after = await $.prompt.compose(COMPOSE)
  expect(after.sections.some(section => section.id === 'topia:standing-orders')).toBe(false)
  expect((await $.command.run({ ...mods(''), command: 'orders' })).text).toContain('/mods orders on')
})

test('a project choice is saved under the project, and wins over yours', { options: QUIET_START }, async ($, on) => {
  const store = memoryStore(on)
  engine(on)
  await $.session.start(startSession(false))
  await $.command.run(mods('hosts on --project'))
  await $.command.run(mods('hosts off --user'))
  const answer = await $.command.run(mods('hosts'))
  // No scope named: this project already chose, so the toggle lands there.
  expect(answer.text).toContain('for this project (example-project)')
  expect(store.get(projectModsKey(ROOT))).toMatchObject({ choices: { remoteHosts: false }, isConfirmed: true })
  expect(store.get(USER_KEY)).toEqual({ remoteHosts: false })
})

test("the old /routing switch is folded into yours, once", { options: QUIET_START }, async ($, on) => {
  const store = memoryStore(on, { 'promptRouting:off': true })
  engine(on)
  await $.session.start(startSession(false))
  expect(store.get(USER_KEY)).toEqual({ promptRouting: false })
  expect(store.get('promptRouting:off')).toBe(undefined)
})

test('the first session in a project asks which mods to keep; Keep answers it', { options: QUIET_START }, async ($, on) => {
  const store = memoryStore(on)
  mock.clock(on, { now: 1_000 })
  engine(on)
  await $.session.start(startSession())

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'topia', surface, ...BAND })
    expect((await ui.find({ key: 'mods-standingOrders' }))?.text).toBe('orders ✓')
    expect((await ui.find({ key: 'mods-gitBand' }))?.text).toBe('git ✗')
    expect((await ui.find({ key: 'mods-remoteHosts' }))?.text).toBe('hosts ✗')
    await ui.unmount()
  }

  // Each chip's line waits, hidden, at the end of its row for the pointer;
  // a narrow band leaves them out.
  const narrow = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND, props: { ...BAND.props, bodyColumns: 40 } })
  expect(await narrow.find({ key: 'about-mods-gitBand' })).toBe(undefined)
  await narrow.unmount()
  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'about-mods-gitBand' })).toBeDefined()
  // A chip switches its mod for this project, and its line shows under the band.
  await ui.press({ key: 'mods-remoteHosts' })
  expect((await ui.find({ key: 'mods-remoteHosts' }))?.text).toBe('hosts ✓')
  expect(await ui.find({ type: 'Text', text: /^ⓘ Remote hosts: Remembers SSH hosts/ })).toBeDefined()
  await ui.press({ key: 'mods-keep' })
  expect(await ui.find({ key: 'mods-keep' })).toBe(undefined)
  await ui.unmount()

  expect(store.get(projectModsKey(ROOT))).toMatchObject({ choices: { remoteHosts: true }, isConfirmed: true })
  // A hot reload fires session.start again: nothing is asked twice.
  await $.session.start(startSession())
  const again = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await again.find({ key: 'mods-keep' })).toBe(undefined)
  await again.unmount()
})

test('nothing is asked in a session nobody is at', { options: QUIET_START }, async ($, on) => {
  memoryStore(on)
  engine(on)
  await $.session.start(startSession(false))
  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'mods-keep' })).toBe(undefined)
  await ui.unmount()
})

test('the first onboard run in a project asks too', { options: QUIET_START }, async ($, on) => {
  memoryStore(on, { [projectModsKey(ROOT)]: { choices: {}, isConfirmed: true, isOnboardAsked: false } })
  engine(on)
  on('skill.prompt', ($, e) => ({ text: e.text }))
  await $.session.start(startSession(false))
  await $.skill.prompt({ skill: 'topia:onboard', text: '' })

  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /which mods here/ })).toBeDefined()
  await ui.press({ key: 'mods-keep' })
  await ui.unmount()

  await $.skill.prompt({ skill: 'topia:onboard', text: '' })
  const later = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await later.find({ key: 'mods-keep' })).toBe(undefined)
  await later.unmount()
})

test('a recap comes back after 10 sessions and 14 days; Got it resets the count', { options: QUIET_START }, async ($, on) => {
  const store = memoryStore(on, {
    [projectModsKey(ROOT)]: { choices: {}, isConfirmed: true, isOnboardAsked: true },
    'mods:prefs': { ...DEFAULT_PREFS, recapAt: 1, sessionsSinceRecap: 9 },
  })
  mock.clock(on, { now: 2 + RECAP_MS })
  engine(on)
  await $.session.start(startSession())

  const ui = await $.ui.mount({ plugin: 'topia', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'mods-got-it' })).toBeDefined()
  await ui.press({ key: 'mods-got-it' })
  expect(await ui.find({ key: 'mods-got-it' })).toBe(undefined)
  await ui.unmount()
  expect(store.get('mods:prefs')).toMatchObject({ recapAt: 2 + RECAP_MS, sessionsSinceRecap: 0 })
})

test('turning standing orders off clears its part of the status line', { options: QUIET_START }, async ($, on) => {
  memoryStore(on, { [ordersKey(ROOT)]: { fanout: true, ledger: false, scripts: false, commit: false } })
  const status = engine(on)
  await $.session.start(startSession(false))
  expect(status[status.length - 1]).toContain('fanout')
  await $.command.run(mods('orders off'))
  expect(status[status.length - 1]).toBe(undefined)
})

test('the mods pane lists each mod with where its value comes from', { options: QUIET_START }, async ($, on) => {
  memoryStore(on, { [USER_KEY]: { gitBand: false } })
  engine(on)
  await $.session.start(startSession(false))
  await $.command.run(mods(''))

  const pane = await $.ui.mount({
    plugin: 'topia',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'topia-mods',
    props: { title: 'Topia mods', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect((await pane.find({ key: 'mod-gitBand' }))?.text).toBe('off')
  expect((await pane.find({ key: 'source-gitBand' }))?.text).toBe('you')
  expect((await pane.find({ key: 'source-remoteHosts' }))?.text).toBe('default')
  // Saving for this project by default: a press makes a project choice.
  await pane.press({ key: 'mod-remoteHosts' })
  expect((await pane.find({ key: 'mod-remoteHosts' }))?.text).toBe('on ')
  expect((await pane.find({ key: 'source-remoteHosts' }))?.text).toBe('this project')
  await pane.unmount()
})
