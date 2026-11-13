import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const ROOT = '/work/example-project'
const QUIET_START = { gitBand: false, quietReports: false, modelPreset: false }
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 100, scroll: { offset: 0, bodyRows: 12 }, view: {} },
} as const
const command = (name: string, args = '') => ({
  command: name,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

type Call = { command: string; input: Record<string, unknown>; argv: readonly string[]; cwd?: string }

/** Stands for the host: the runner is a process, and nothing else holds the lock. */
function engine(on: On, runner: (call: Call) => { exitCode: number; reply?: unknown; stdout?: string }) {
  const calls: Call[] = []
  const toasts: string[] = []
  const storeOps: string[] = []
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
  on('session.root', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: Date.parse('2026-06-03T00:00:00.000Z') }))
  on('env.get', () => ({ value: '/home/example' }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', ($, e) => {
    const call: Call = {
      command: String(e.argv[2]),
      input: JSON.parse(e.init?.stdin ?? '{}') as Record<string, unknown>,
      argv: e.argv,
      cwd: e.init?.cwd,
    }
    calls.push(call)
    const answer = runner(call)
    return { value: { exitCode: answer.exitCode, stdout: answer.stdout ?? JSON.stringify(answer.reply ?? {}), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Box' as const }))
  return { calls, toasts, storeOps }
}

function lockedRunner(initial: 'on' | 'off') {
  let state = initial
  return (call: Call) => {
    switch (call.command) {
      case 'status':
        return { exitCode: 0, reply: { lock: { state }, session: null, registeredOrgs: 0 } }
      case 'enable':
        state = 'on'
        return { exitCode: 0, reply: { ok: true } }
      case 'disable':
        state = 'off'
        return { exitCode: 0, reply: { ok: true } }
      default:
        return { exitCode: 0, reply: { ok: true, checked: false } }
    }
  }
}

test('the mod runs bin/runner.js by its plugin path and not from the project folder', { options: QUIET_START }, async ($, on) => {
  const { calls } = engine(on, lockedRunner('on'))
  await $.command.run(command('topia-sf:disable'))
  expect(calls[0]?.argv[0]).toBe('node')
  expect(calls[0]?.argv[1]).toBe(`${calls[0]?.cwd}/salesforce/service/bin/runner.js`)
  expect(calls[0]?.cwd?.includes(ROOT)).toBe(false)
  expect(calls[0]?.input.projectRoot).toBe(ROOT)
})

test('with no lock, disable says so and offers nothing', { options: QUIET_START }, async ($, on) => {
  engine(on, lockedRunner('off'))
  const answer = await $.command.run(command('topia-sf:disable'))
  expect(answer.text).toContain('not on')
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sf-disable' })).toBe(undefined)
})

test('asking to disable does nothing until a person presses the button, and the runner does the change', { options: QUIET_START }, async ($, on) => {
  const { calls, toasts, storeOps } = engine(on, lockedRunner('on'))
  const answer = await $.command.run(command('topia-sf:disable'))
  expect(answer.text).toContain(ROOT)
  expect(calls.some(call => call.command === 'disable')).toBe(false)
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  await ui.press({ key: 'sf-disable' })
  expect(calls.some(call => call.command === 'disable')).toBe(true)
  expect(toasts.join(' ')).toContain('off')
  expect(await ui.find({ key: 'sf-disable' })).toBe(undefined)
  expect(storeOps.filter(op => op.includes('sf:'))).toEqual([])
})

test('a failed disable leaves it on and says so', { options: QUIET_START }, async ($, on) => {
  const inner = lockedRunner('on')
  const { toasts } = engine(on, call => (call.command === 'disable' ? { exitCode: 0, reply: { ok: false, reason: 'The store cannot be read.' } } : inner(call)))
  await $.command.run(command('topia-sf:disable'))
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  await ui.press({ key: 'sf-disable' })
  expect(toasts.join(' ')).toContain('still on')
})

test('a runner that throws during a press does not escape the handler', { options: QUIET_START }, async ($, on) => {
  const inner = lockedRunner('on')
  const { toasts } = engine(on, call => {
    if (call.command === 'disable') throw new Error('spawn failed')
    return inner(call)
  })
  await $.command.run(command('topia-sf:disable'))
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  await ui.press({ key: 'sf-disable' })
  expect(toasts.join(' ')).toContain('still on')
})

test('cancel keeps it on and takes the button away', { options: QUIET_START }, async ($, on) => {
  const { calls } = engine(on, lockedRunner('on'))
  await $.command.run(command('topia-sf:disable'))
  await $.command.run(command('topia-sf:disable', 'cancel'))
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sf-disable' })).toBe(undefined)
  expect(calls.some(call => call.command === 'disable')).toBe(false)
})

test('enable arms a button, and only the press writes the lock through the runner', { options: QUIET_START }, async ($, on) => {
  const { calls, storeOps } = engine(on, lockedRunner('off'))
  const answer = await $.command.run(command('topia-sf:enable'))
  expect(answer.text).toContain(ROOT)
  expect(calls.some(call => call.command === 'enable')).toBe(false)
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  await ui.press({ key: 'sf-enable' })
  expect(calls.some(call => call.command === 'enable')).toBe(true)
  expect(storeOps.filter(op => op.includes('sf:'))).toEqual([])
})

test('enable says so when the lock cannot be read, and arms nothing', { options: QUIET_START }, async ($, on) => {
  engine(on, () => ({ exitCode: 0, reply: { lock: { state: 'unreadable', message: 'The store cannot be read.' }, session: null } }))
  const answer = await $.command.run(command('topia-sf:enable'))
  expect(answer.text).toContain('cannot be read')
  const ui = await $.ui.mount({ plugin: 'topia-sf', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'sf-enable' })).toBe(undefined)
})

test('a runner that fails or prints junk reads as cannot check, never as on or off', { options: QUIET_START }, async ($, on) => {
  engine(on, () => ({ exitCode: 1, stdout: 'not json' }))
  const answer = await $.command.run(command('topia-sf:disable'))
  expect(answer.text).toContain('could not')
  const enable = await $.command.run(command('topia-sf:enable'))
  expect(enable.text).toContain('could not')
})
