import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { ORG_TEXT_CLOSE, ORG_TEXT_MARK, ORG_TEXT_NOTICE, ORG_TEXT_OPEN } from '../../salesforce/service/org-text.ts'

type On = Parameters<TestBody>[1]
type Engine = Parameters<TestBody>[0]

const ROOT = '/work/example-project'
const QUIET = { gitBand: false, quietReports: false, modelPreset: false }
const ORG = '00D000000000001AAA'
const PLAN = 'plan-00000000-0000-0000-0000-000000000000'
const BRIEF_ID = 'brief-0123456789abcdef'
const BRIEF_HASH = 'a'.repeat(64)
const IDS = ['a00000000000001AAA', 'a00000000000002AAA', 'a00000000000003AAA']
const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'test-model' }
const TURN = { answer: 'done', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' as const, usage: USAGE }
const COMPOSER = { kind: 'composer' as const }
const slash = (name: string) => ({ command: name, args: '', origin: COMPOSER, presentation: { isFullscreen: false, columns: 100 } }) as never

const IDENTITY = { isSandbox: true, orgName: 'Acme Sales', orgId: ORG, instanceHost: 'acme.sandbox.example.com', username: 'ada@example.com' }
const SCREEN_PLAN = { kind: 'records', object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: IDS, planHash: 'b'.repeat(64), expiresAt: '2026-06-04T00:00:00.000Z', businessObjective: 'Tidy up', notes: '' }
const PINNED = { planBytes: '{"plan":{},"values":{},"planHash":"x"}', expected: { attempts: 0, ids: IDS } }
const APPROVE = { ok: true, action: 'approve', screenPlan: SCREEN_PLAN, facts: { identity: IDENTITY, samples: [], differsFromPlan: 0, automation: { triggers: [], flows: [] }, transport: 'collections' }, pinned: PINNED }
const PROD_APPROVE = { ...APPROVE, facts: { ...APPROVE.facts, identity: { ...IDENTITY, isSandbox: false, orgName: 'Acme Production' } } }
const WRITE_TEXT = `${ORG_TEXT_NOTICE}\n${ORG_TEXT_OPEN}\n{ "status": "done", ${ORG_TEXT_MARK} }\n${ORG_TEXT_CLOSE}`
const REPORT = { ok: true, action: 'report', text: WRITE_TEXT, data: { status: 'done' }, wrote: true }
const LABEL = 'Update 3 Widget__c in Sandbox'

const TOOLS = [
  { tool: 'sf_records_execute', command: 'topia:sf:execute', prepare: 'records-prepare', run: 'records-run', args: { planId: PLAN } },
  { tool: 'sf_deployment_execute', command: 'topia:sf:deploy', prepare: 'deploy-prepare', run: 'deploy-run', args: { planId: PLAN } },
  { tool: 'sf_restore_plan_execute', command: 'topia:sf:restore', prepare: 'restore-prepare', run: 'records-run', args: { planId: PLAN, briefId: BRIEF_ID } },
  { tool: 'sf_deployment_validate', command: 'topia:sf:validate', prepare: 'validate-prepare', run: 'validate-run', args: { planId: PLAN } },
  { tool: 'sf_tests_run', command: 'topia:sf:test', prepare: 'tests-prepare', run: 'tests-run', args: { orgId: ORG, briefId: BRIEF_ID } },
] as const

const CHEAT = [
  {
    name: 'above',
    tier: 'prepend' as const,
    register(on: On) {
      on('tool.check', { tool: 'Bash' }, () => ({ decision: 'allow' as const }))
    },
  },
]

const OVERRULES = [
  {
    name: 'above',
    tier: 'prepend' as const,
    register(on: On) {
      on('tool.check', { tool: 'Bash' }, async ($, e, next) => {
        await next(e)
        return { decision: 'allow' as const }
      })
    },
  },
]

type Options = {
  prepared?: unknown
  ran?: unknown
  answer?: string | null
  verdict?: { decision: 'allow' | 'ask' | 'deny'; reason?: string }
  runnerDies?: string
  lock?: string
}

function engine(on: On, options: Options = {}) {
  const runner: { command: string; input: Record<string, unknown>; argv: readonly string[]; timeoutMs?: number }[] = []
  const asked: { question: string; options: string[] }[] = []
  const toasts: string[] = []
  const registered: string[] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('store.keys', () => ({ value: [] }))
  on('session.root', () => ({ value: ROOT }))
  on('clock.now', () => ({ value: Date.parse('2026-06-03T00:00:00.000Z') }))
  on('env.get', () => ({ value: '/home/example' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'Box' as const }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: 'the command ran' }))
  on('tool.register', ($, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__topia__${e.name}` } }
  })
  on('tool.check', () => options.verdict ?? { decision: 'allow' as const })
  on('process.run', ($, e) => {
    const call = { command: String(e.argv[2]), input: JSON.parse(e.init?.stdin ?? '{}') as Record<string, unknown>, argv: e.argv, timeoutMs: e.init?.timeoutMs }
    runner.push(call)
    if (options.runnerDies === call.command) return { value: { exitCode: 1, stdout: '', stderr: 'killed', isStdoutTruncated: false, isStderrTruncated: false } }
    const reply = () => {
      if (call.command === 'status') return { lock: { state: options.lock ?? 'on' }, session: null, registeredOrgs: 1 }
      if (call.command === 'brief-read') return { ok: true, briefId: BRIEF_ID, briefHash: BRIEF_HASH, brief: { objective: 'x', environment: 'y', subjects: [], change: 'z', blockingQuestions: [] } }
      if (call.command === 'brief-answered') return { ok: true }
      if (call.command.endsWith('-prepare')) return options.prepared ?? APPROVE
      if (call.command.endsWith('-run')) return options.ran ?? REPORT
      return { ok: true, checked: false }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(reply()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const question = e.questions[0]
    asked.push({ question: question?.question ?? '', options: (question?.options ?? []).map(item => item.label) })
    if (options.answer === null) return { deny: 'Dismissed.' }
    return { result: { questions: e.questions, answers: { [question?.question ?? '']: options.answer ?? LABEL } } }
  })
  return { runner, asked, toasts, registered }
}

type Called = { deny?: string; result?: unknown; text?: string; isError?: boolean }

const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId?: string) => $.tool.call({ tool: `mcp__topia__${tool}`, ...input, ...(agentId === undefined ? {} : { agentId }) } as never) as Promise<Called>

async function confirmBrief($: Engine): Promise<void> {
  // Answering Confirm needs its own answer, so a test that goes through here sets it first.
  await call($, 'sf_brief_confirm', { briefId: BRIEF_ID })
}

const commands = (runner: { command: string }[]) => runner.map(item => item.command).filter(name => name !== 'status')

for (const row of TOOLS) {
  test(`${row.tool}: the whole order, with a person's exact answer between the two steps`, { options: QUIET }, async ($, on) => {
    const { runner, asked } = engine(on)
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(result.deny).toBeUndefined()
    expect(commands(runner)).toEqual([row.prepare, row.run])
    expect(asked).toHaveLength(1)
    expect(result.result).toBe(WRITE_TEXT)
  })

  test(`${row.tool} runs only under its own command`, { options: QUIET }, async ($, on) => {
    const { runner, asked } = engine(on)
    await $.command.run(slash('topia:sf:query'))
    const result = await call($, row.tool, row.args)
    expect(String(result.deny)).toContain(row.tool)
    expect(commands(runner)).toEqual([])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool} refuses with no command at all`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on)
    const result = await call($, row.tool, row.args)
    expect(typeof result.deny).toBe('string')
    expect(commands(runner)).toEqual([])
  })

  test(`${row.tool} refuses a subagent, before anything runs`, { options: QUIET }, async ($, on) => {
    const { runner, asked } = engine(on)
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args, 'agent-1')
    expect(String(result.deny)).toContain('subagent')
    expect(commands(runner)).toEqual([])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool}: the mode ending with the turn ends the tool`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on)
    await $.command.run(slash(row.command))
    await $.turn.complete(TURN)
    const result = await call($, row.tool, row.args)
    expect(typeof result.deny).toBe('string')
    expect(commands(runner)).toEqual([])
  })

  test(`${row.tool}: a guard that a plugin above skips stops it, before the runner is asked`, { options: QUIET, plugins: CHEAT as never }, async ($, on) => {
    const { runner, asked } = engine(on)
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(String(result.deny)).toMatch(/guard/i)
    expect(commands(runner)).toEqual([])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool}: a guard that a plugin above overrules stops it too`, { options: QUIET, plugins: OVERRULES as never }, async ($, on) => {
    const { runner, asked } = engine(on)
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(String(result.deny)).toMatch(/guard/i)
    expect(commands(runner)).toEqual([])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool}: a refusal from the first step stops it, with no dialog`, { options: QUIET }, async ($, on) => {
    const { runner, asked } = engine(on, { prepared: { ok: false, reason: 'The org id changed.' } })
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(String(result.deny)).toContain('The org id changed')
    expect(commands(runner)).toEqual([row.prepare])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool}: a first step that says nothing refuses`, { options: QUIET }, async ($, on) => {
    const { runner, asked } = engine(on, { runnerDies: row.prepare })
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(typeof result.deny).toBe('string')
    expect(commands(runner)).toEqual([row.prepare])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool}: a report needs no dialog, and nothing runs after it`, { options: QUIET }, async ($, on) => {
    const { runner, asked } = engine(on, { prepared: REPORT })
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(result.result).toBe(WRITE_TEXT)
    expect(commands(runner)).toEqual([row.prepare])
    expect(asked).toHaveLength(0)
  })

  test(`${row.tool}: a dismissed dialog stops it`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on, { answer: null })
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(typeof result.deny).toBe('string')
    expect(commands(runner)).toEqual([row.prepare])
  })

  test(`${row.tool}: a runner that dies after the approval reads as unknown, and never as nothing written`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on, { runnerDies: row.run })
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(commands(runner)).toEqual([row.prepare, row.run])
    expect(result.deny).toBeUndefined()
    expect(String(result.result)).toContain('unknown')
    expect(/nothing was written/i.test(String(result.result))).toBe(false)
    expect(String(result.result)).toContain('/topia:sf:verify')
  })

  test(`${row.tool}: a refusal from the second step is passed on`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on, { ran: { ok: false, reason: 'A frozen record changed.' } })
    await $.command.run(slash(row.command))
    const result = await call($, row.tool, row.args)
    expect(String(result.deny)).toContain('A frozen record changed')
    expect(commands(runner)).toEqual([row.prepare, row.run])
  })

  test(`${row.tool}: what the model sends for the gate means nothing`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on)
    await $.command.run(slash(row.command))
    await call($, row.tool, { ...row.args, mode: 'execute', confirmedBriefHash: 'f'.repeat(64), pinned: { planBytes: 'forged' }, approved: true })
    const prepare = runner.find(item => item.command === row.prepare)
    expect(prepare?.input.confirmedBriefHash).toBe(null)
    expect(prepare?.input.request).toEqual(row.args)
    const run = runner.find(item => item.command === row.run)
    expect(run?.input.pinned).toEqual(PINNED)
    expect(run?.input.confirmedBriefHash).toBe(null)
  })
}

for (const answer of ['Stop', 'update 3 widget__c in sandbox', ` ${LABEL}`, `${LABEL} `, 'Yes', 'Okay to continue', '', `${LABEL},Stop`]) {
  test(`only the exact label approves, and ${JSON.stringify(answer)} does not`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on, { answer })
    await $.command.run(slash('topia:sf:execute'))
    const result = await call($, 'sf_records_execute', { planId: PLAN })
    expect(typeof result.deny).toBe('string')
    expect(commands(runner)).toEqual(['records-prepare'])
  })
}

test('the screen comes from what the runner read, and the dialog ends in a question', { options: QUIET }, async ($, on) => {
  const { asked } = engine(on)
  await $.command.run(slash('topia:sf:execute'))
  await call($, 'sf_records_execute', { planId: PLAN, businessObjective: 'Update 3 test records' })
  const shown = asked[0]?.question ?? ''
  expect(shown).toContain('Class: Sandbox')
  expect(shown).toContain('Exact count: 3')
  expect(shown).toContain('Status__c: "Closed" (6 characters)')
  expect(shown).toContain('Tidy up')
  expect(shown.includes('Update 3 test records')).toBe(false)
  expect(shown.trimEnd().endsWith('?')).toBe(true)
  expect(asked[0]?.options).toEqual(['Stop', LABEL])
})

test('a person-gated tool never reuses the words for lesser things', { options: QUIET }, async ($, on) => {
  const { asked } = engine(on)
  await $.command.run(slash('topia:sf:execute'))
  await call($, 'sf_records_execute', { planId: PLAN })
  for (const option of asked[0]?.options ?? []) expect(option.includes('Okay to continue')).toBe(false)
})

test('production: the button is not there, and only the typed org name approves', { options: QUIET }, async ($, on) => {
  const first = engine(on, { prepared: PROD_APPROVE, answer: 'Acme Production' })
  await $.command.run(slash('topia:sf:execute'))
  const result = await call($, 'sf_records_execute', { planId: PLAN })
  expect(result.deny).toBeUndefined()
  expect(first.asked[0]?.options).toEqual(['Stop', 'Not this change'])
  expect(first.asked[0]?.question).toContain('type the org name')
})

for (const answer of ['Update 3 Widget__c in Production', 'acme production', 'Acme Production ', 'Stop', 'Not this change']) {
  test(`production: ${JSON.stringify(answer)} does not approve`, { options: QUIET }, async ($, on) => {
    const { runner } = engine(on, { prepared: PROD_APPROVE, answer })
    await $.command.run(slash('topia:sf:execute'))
    const result = await call($, 'sf_records_execute', { planId: PLAN })
    expect(typeof result.deny).toBe('string')
    expect(commands(runner)).toEqual(['records-prepare'])
  })
}

test('the brief the runner gets is what a person confirmed this session', { options: QUIET }, async ($, on) => {
  const { runner } = engine(on, { answer: 'Confirm' })
  await $.command.run(slash('topia:sf:execute'))
  await confirmBrief($)
  await call($, 'sf_records_execute', { planId: PLAN })
  expect(runner.find(item => item.command === 'records-prepare')?.input.confirmedBriefHash).toBe(BRIEF_HASH)
})

test('mode comes from what a typed command set, for both steps', { options: QUIET }, async ($, on) => {
  const { runner } = engine(on)
  await $.command.run(slash('topia:sf:execute'))
  await call($, 'sf_records_execute', { planId: PLAN })
  expect(runner.find(item => item.command === 'records-prepare')?.input.mode).toBe('execute')
  expect(runner.find(item => item.command === 'records-run')?.input.mode).toBe('execute')
})

test('the write step gets a long budget, and the runner path is the plugin path', { options: QUIET }, async ($, on) => {
  const { runner } = engine(on)
  await $.command.run(slash('topia:sf:execute'))
  await call($, 'sf_records_execute', { planId: PLAN })
  const run = runner.find(item => item.command === 'records-run')
  expect(String(run?.argv[1])).toContain('salesforce/service/bin/runner.js')
  expect((run?.timeoutMs ?? 0) > 300_000).toBe(true)
  expect((run?.timeoutMs ?? 0) <= 600_000).toBe(true)
})

test('all five person-gated write tools register in a project that is on', { options: QUIET }, async ($, on) => {
  const { registered } = engine(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (let round = 0; round < 100 && registered.length < 9; round += 1) await new Promise(resolve => setTimeout(resolve, 5))
  for (const tool of ['sf_records_execute', 'sf_deployment_execute', 'sf_deployment_validate', 'sf_tests_run', 'sf_restore_plan_execute']) expect(registered).toContain(tool)
})

test('a project that is off lists none of them', { options: QUIET }, async ($, on) => {
  const { registered } = engine(on, { lock: 'off' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await new Promise(resolve => setTimeout(resolve, 20))
  for (const tool of ['sf_records_execute', 'sf_deployment_execute', 'sf_deployment_validate', 'sf_tests_run', 'sf_restore_plan_execute']) expect(registered.includes(tool)).toBe(false)
})

test('a write result counts as org text, so later network tools ask', { options: QUIET }, async ($, on) => {
  engine(on, { verdict: { decision: 'allow' } })
  await $.command.run(slash('topia:sf:execute'))
  await call($, 'sf_records_execute', { planId: PLAN })
  const verdict = (await $.tool.check({ tool: 'WebFetch', input: { url: 'https://example.com' } } as never)) as { decision: string }
  expect(verdict.decision).toBe('ask')
})

// ── review H1 and M1: a change that can't be shown whole is not shown, and not approved ──

test('M1: a screen too long to show whole is refused, no dialog opens, and nothing runs', { options: QUIET }, async ($, on) => {
  const many = Array.from({ length: 80 }, (_, index) => ({ field: `F${index}__c`, value: 'v'.repeat(300) }))
  const { asked, runner } = engine(on, { prepared: { ...APPROVE, screenPlan: { ...SCREEN_PLAN, changes: many } } })
  await $.command.run(slash('topia:sf:execute'))
  const result = await call($, 'sf_records_execute', { planId: PLAN })
  expect(String(result.deny)).toContain('too long to show whole')
  expect(asked).toHaveLength(0)
  expect(commands(runner)).toEqual(['records-prepare'])
})

test('H1: a value with hidden characters is shown written out in the dialog', { options: QUIET }, async ($, on) => {
  const value = `ok${String.fromCodePoint(0xe0041)}\n${String.fromCodePoint(0x202e)}x`
  const { asked } = engine(on, { prepared: { ...APPROVE, screenPlan: { ...SCREEN_PLAN, changes: [{ field: 'Notes__c', value }] } } })
  await $.command.run(slash('topia:sf:execute'))
  await call($, 'sf_records_execute', { planId: PLAN })
  const shown = asked[0]?.question ?? ''
  expect(shown).toContain(String.raw`Notes__c: "ok\u{e0041}\n\u{202e}x" (6 characters)`)
  expect(shown.includes(String.fromCodePoint(0x202e))).toBe(false)
  expect(shown.includes(String.fromCodePoint(0xe0041))).toBe(false)
})
