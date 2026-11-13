import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { SALESFORCE_DISABLE_LABEL, SALESFORCE_ENABLE_LABEL, askInsteadOfBand } from '../lib/salesforce-env.ts'

// The band above the prompt is drawn only by the terminal and the Desktop app.
// Where no surface draws it (the VS Code extension, a phone), turning Salesforce
// on or off asks in the question dialog instead. A person still has to answer it.

type On = Parameters<TestBody>[1]
type Body = Parameters<TestBody>[0]

const ROOT = '/work/example-project'
const QUIET_START = { gitBand: false, quietReports: false, modelPreset: false }
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const command = (name: string, args = '') => ({
  command: name,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

type Call = { command: string; input: Record<string, unknown> }
type Asked = { question: string; options: string[]; header: string }

function engine(on: On, options: { surfaces: readonly string[]; lock: 'on' | 'off'; answer?: string | null; rootAfterAsk?: string; enableReply?: unknown }) {
  const calls: Call[] = []
  const asked: Asked[] = []
  const toasts: string[] = []
  const storeOps: string[] = []
  let root = ROOT
  let state = options.lock
  on('store.get', ($, e) => {
    storeOps.push(`get ${e.key}`)
    return { value: undefined }
  })
  on('store.set', ($, e) => {
    storeOps.push(`set ${e.key}`)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    storeOps.push(`delete ${e.key}`)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [] }))
  on('session.root', () => ({ value: root }))
  on('session.surfaces', () => ({ value: options.surfaces as never }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.parse('2026-06-03T00:00:00.000Z') }))
  on('env.get', () => ({ value: '/home/example' }))
  on('fs.exists', () => ({ value: true }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Box' as const }))
  on('process.run', ($, e) => {
    const call: Call = { command: String(e.argv[2]), input: JSON.parse(e.init?.stdin ?? '{}') as Record<string, unknown> }
    calls.push(call)
    const reply = () => {
      switch (call.command) {
        case 'status':
          return { lock: { state }, session: null, registeredOrgs: 0 }
        case 'enable':
          if (options.enableReply !== undefined) return options.enableReply
          state = 'on'
          return { ok: true }
        case 'disable':
          state = 'off'
          return { ok: true }
        default:
          return { ok: true, checked: false }
      }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(reply()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]
    asked.push({ question: question?.question ?? '', options: (question?.options ?? []).map(item => item.label), header: question?.header ?? '' })
    if (options.rootAfterAsk !== undefined) root = options.rootAfterAsk
    if (options.answer === null) return { deny: 'Dismissed.' }
    return { result: { questions: e.questions, answers: { [question?.question ?? '']: options.answer ?? '' } } }
  })
  return { calls, asked, toasts, storeOps }
}

const ran = (calls: Call[], name: string) => calls.filter(call => call.command === name)
const interactive = ($: Body, surface: 'terminal' | 'vscode' = 'vscode') => $.session.start({ cwd: ROOT, surface, isInteractive: true })

// ── which sessions ask ──

test('only a live session with no surface that draws the band asks instead', async () => {
  expect(askInsteadOfBand(['vscode'], false)).toBe(true)
  expect(askInsteadOfBand(['mobile'], false)).toBe(true)
  expect(askInsteadOfBand(['vscode', 'mobile'], false)).toBe(true)
  expect(askInsteadOfBand(['terminal'], false)).toBe(false)
  expect(askInsteadOfBand(['desktop'], false)).toBe(false)
  expect(askInsteadOfBand(['vscode', 'terminal'], false)).toBe(false)
  expect(askInsteadOfBand(['mobile', 'desktop'], false)).toBe(false)
  // Nothing draws at all (claude -p, a cloud session with no app attached): no one to ask.
  expect(askInsteadOfBand([], false)).toBe(false)
  // A headless session never asks, whatever it reports.
  expect(askInsteadOfBand(['vscode'], true)).toBe(false)
})

// ── enable ──

test('in VS Code, enable asks a person, names the path, and only their exact answer turns it on', { options: QUIET_START }, async ($, on) => {
  const { calls, asked, storeOps } = engine(on, { surfaces: ['vscode'], lock: 'off', answer: SALESFORCE_ENABLE_LABEL })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:enable', 'ada@example.com'))
  expect(asked.length).toBe(1)
  expect(asked[0]?.header).toBe('Salesforce')
  expect(asked[0]?.question).toContain(ROOT)
  expect(asked[0]?.question.trimEnd().endsWith('?')).toBe(true)
  expect(asked[0]?.options).toEqual(['Stop', SALESFORCE_ENABLE_LABEL])
  expect(ran(calls, 'enable').length).toBe(1)
  expect(ran(calls, 'enable')[0]?.input).toEqual({ projectRoot: ROOT, user: 'ada@example.com' })
  expect(answer.text).toContain(`Salesforce is on for ${ROOT}`)
  expect(storeOps.filter(op => op.includes('sf:'))).toEqual([])
})

test('after a dialog answer, no band button is left waiting', { options: QUIET_START }, async ($, on) => {
  engine(on, { surfaces: ['vscode'], lock: 'off', answer: 'Stop' })
  await interactive($)
  await $.command.run(command('topia-sf:enable'))
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sf-enable' })).toBe(undefined)
})

for (const reply of ['Stop', 'yes', 'Okay to continue', `${SALESFORCE_ENABLE_LABEL} `, SALESFORCE_ENABLE_LABEL.toLowerCase(), `${SALESFORCE_ENABLE_LABEL},Stop`, '']) {
  test(`in VS Code, the answer "${reply}" leaves Salesforce off`, { options: QUIET_START }, async ($, on) => {
    const { calls } = engine(on, { surfaces: ['vscode'], lock: 'off', answer: reply })
    await interactive($)
    const answer = await $.command.run(command('topia-sf:enable'))
    expect(ran(calls, 'enable').length).toBe(0)
    expect(answer.text).toContain('stays off')
  })
}

test('in VS Code, a dismissed dialog leaves Salesforce off and says a chat reply does not count', { options: QUIET_START }, async ($, on) => {
  const { calls } = engine(on, { surfaces: ['vscode'], lock: 'off', answer: null })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:enable'))
  expect(ran(calls, 'enable').length).toBe(0)
  expect(answer.text).toContain('stays off')
  expect(answer.text).toContain('chat reply')
})

test('in VS Code, a project path that changed while the dialog was open turns nothing on', { options: QUIET_START }, async ($, on) => {
  const { calls } = engine(on, { surfaces: ['vscode'], lock: 'off', answer: SALESFORCE_ENABLE_LABEL, rootAfterAsk: '/work/other-project' })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:enable'))
  expect(ran(calls, 'enable').length).toBe(0)
  expect(answer.text).toContain('only to the project path that was shown')
})

test('in VS Code, a failed enable says so and leaves it off', { options: QUIET_START }, async ($, on) => {
  engine(on, { surfaces: ['vscode'], lock: 'off', answer: SALESFORCE_ENABLE_LABEL, enableReply: { ok: false, reason: 'The store cannot be written.' } })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:enable'))
  expect(answer.text).toContain('cannot be written')
})

test('in VS Code, enable on a project that is already on asks nothing', { options: QUIET_START }, async ($, on) => {
  const { asked } = engine(on, { surfaces: ['vscode'], lock: 'on', answer: SALESFORCE_ENABLE_LABEL })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:enable'))
  expect(asked.length).toBe(0)
  expect(answer.text).toContain('already on')
})

// ── disable ──

test('in VS Code, disable asks a person and only their exact answer turns it off', { options: QUIET_START }, async ($, on) => {
  const { calls, asked, storeOps } = engine(on, { surfaces: ['vscode'], lock: 'on', answer: SALESFORCE_DISABLE_LABEL })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:disable'))
  expect(asked.length).toBe(1)
  expect(asked[0]?.header).toBe('Salesforce')
  expect(asked[0]?.question).toContain(ROOT)
  expect(asked[0]?.question.trimEnd().endsWith('?')).toBe(true)
  expect(asked[0]?.options).toEqual(['Stop', SALESFORCE_DISABLE_LABEL])
  expect(ran(calls, 'disable').length).toBe(1)
  expect(answer.text).toContain(`Salesforce is off for ${ROOT}`)
  expect(storeOps.filter(op => op.includes('sf:'))).toEqual([])
})

for (const reply of ['Stop', 'yes', 'Okay to continue', SALESFORCE_ENABLE_LABEL, '']) {
  test(`in VS Code, the answer "${reply}" leaves Salesforce on`, { options: QUIET_START }, async ($, on) => {
    const { calls } = engine(on, { surfaces: ['vscode'], lock: 'on', answer: reply })
    await interactive($)
    const answer = await $.command.run(command('topia-sf:disable'))
    expect(ran(calls, 'disable').length).toBe(0)
    expect(answer.text).toContain('stays on')
  })
}

test('in VS Code, a dismissed disable dialog leaves Salesforce on', { options: QUIET_START }, async ($, on) => {
  const { calls } = engine(on, { surfaces: ['vscode'], lock: 'on', answer: null })
  await interactive($)
  const answer = await $.command.run(command('topia-sf:disable'))
  expect(ran(calls, 'disable').length).toBe(0)
  expect(answer.text).toContain('stays on')
  expect(answer.text).toContain('chat reply')
})

test('in VS Code, a disable path that changed while the dialog was open turns nothing off', { options: QUIET_START }, async ($, on) => {
  const { calls } = engine(on, { surfaces: ['vscode'], lock: 'on', answer: SALESFORCE_DISABLE_LABEL, rootAfterAsk: '/work/other-project' })
  await interactive($)
  await $.command.run(command('topia-sf:disable'))
  expect(ran(calls, 'disable').length).toBe(0)
})

// ── where the band is drawn, or nobody can answer ──

test('in the terminal, enable and disable still use the band and ask nothing', { options: QUIET_START }, async ($, on) => {
  const { calls, asked } = engine(on, { surfaces: ['terminal'], lock: 'off', answer: SALESFORCE_ENABLE_LABEL })
  await interactive($, 'terminal')
  await $.command.run(command('topia-sf:enable'))
  expect(asked.length).toBe(0)
  expect(ran(calls, 'enable').length).toBe(0)
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sf-enable' })).not.toBe(undefined)
})

test('with VS Code and a terminal both attached, the band is used', { options: QUIET_START }, async ($, on) => {
  const { calls, asked } = engine(on, { surfaces: ['terminal', 'vscode'], lock: 'on', answer: SALESFORCE_DISABLE_LABEL })
  await interactive($, 'terminal')
  await $.command.run(command('topia-sf:disable'))
  expect(asked.length).toBe(0)
  expect(ran(calls, 'disable').length).toBe(0)
})

test('a headless session asks nothing and changes nothing, even if it reports VS Code', { options: QUIET_START }, async ($, on) => {
  const { calls, asked } = engine(on, { surfaces: ['vscode'], lock: 'off', answer: SALESFORCE_ENABLE_LABEL })
  await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: false })
  await $.command.run(command('topia-sf:enable'))
  expect(asked.length).toBe(0)
  expect(ran(calls, 'enable').length).toBe(0)
})

test('a session that draws nothing asks nothing and changes nothing', { options: QUIET_START }, async ($, on) => {
  const { calls, asked } = engine(on, { surfaces: [], lock: 'on', answer: SALESFORCE_DISABLE_LABEL })
  await $.command.run(command('topia-sf:disable'))
  expect(asked.length).toBe(0)
  expect(ran(calls, 'disable').length).toBe(0)
})
