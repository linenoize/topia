import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { proposeBrief } from './brief.js'
import { MOD_ONLY_TOOLS, TOOL_NAMES, WRITE_TOOLS, isWriteTool } from './contract.js'
import { showsContinue } from './issues.js'
import { toolRefusal } from './modes.js'
import { planHashOf } from './plans.js'
import { assertReviewTool } from './practice.js'
import { effectiveLimits } from './registry.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY } from './stamp.js'
import { baseScenario, contextFor, countRows, fakeCalls, fakeHome, ORG, queryRows, registerFake, writeScenario, type FakeHome } from './test-support.js'
import { callTool, type ToolResult } from './tools.js'
import { TOOL_SCHEMAS } from './tool-schemas.js'

/**
 * docs/plans/2026-10-30-salesforce-review.md section 2.4, item by item. Each test
 * names the item. Execution doesn't exist until C5, so the items about it are
 * listed at the end with who owns them, and this file checks they are still absent.
 * The rest are also covered where the behaviour lives: gate, modes, plan-tools, soql.
 */

const here = dirname(fileURLToPath(import.meta.url))

function rig(body: (home: FakeHome, call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>) => Promise<void>, scenario: Record<string, unknown> = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home)
      writeScenario(home, baseScenario(scenario))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'x', environment: '', subjects: [], change: '', blockingQuestions: [] }, '2026-06-01T00:00:00.000Z')
      await body(home, (name, args) => callTool(adapter, name, { briefId, ...args, [STAMP_KEY]: { mode: 'plan', agentId: null, confirmedBriefHash: briefHash, ack: null } }, contextFor(home, { hookHost: true })))
    } finally {
      home.cleanup()
    }
  }
}

// 2.4: "Mode gating (one test runs org.inspect under execute)."
test('2.4 mode gating: a mode reaches only its own tools, here and in modes.case', () => {
  assert.notEqual(toolRefusal('records_plan_update', 'query'), null)
  assert.notEqual(toolRefusal('sf_deployment_execute', 'plan'), null)
  assert.equal(toolRefusal('records_plan_update', 'plan'), null)
})

// 2.4: "The practice-review ban on deployment.execute and tests.run."
test('2.4 the practice review cannot reach deployment or test execution', () => {
  assert.throws(() => assertReviewTool('sf_deployment_execute'), /practice-review/)
  assert.throws(() => assertReviewTool('sf_tests_run'), /practice-review/)
  assert.throws(() => assertReviewTool('sf_records_execute'), /practice-review/)
  assert.equal(isWriteTool('sf_tests_run'), true)
  for (const tool of ['sf_deployment_execute', 'sf_tests_run', 'sf_records_execute', 'sf_restore_plan_execute']) assert.match(String(toolRefusal(tool, 'deploy', 'agent-1')), /subagent/, tool)
  const agent = readFileSync(join(here, '..', '..', '..', 'agents', 'sf-practice-review.md'), 'utf8')
  assert.match(agent, /^tools: Read, Grep, Glob\s*$/m, 'its frontmatter gives it read-only file tools and nothing else')
})

// 2.4: "A SOQL that doesn't match fields/limit, FIELDS(ALL), and subqueries."
for (const [name, args] of [
  ['free-text soql', { object: 'Widget__c', fields: ['Id'], limit: 1, soql: 'SELECT Email FROM Contact' }],
  ['FIELDS(ALL)', { object: 'Widget__c', fields: ['FIELDS(ALL)'], limit: 1 }],
  ['a subquery in fields', { object: 'Widget__c', fields: ['(SELECT Id FROM Contacts)'], limit: 1 }],
  ['a semi-join in where', { object: 'Widget__c', fields: ['Id'], limit: 1, where: [{ field: 'Id IN (SELECT Id FROM Widget__c)', op: 'eq', value: 'x' }] }],
  ['no limit', { object: 'Widget__c', fields: ['Id'] }],
  ['a limit over the cap', { object: 'Widget__c', fields: ['Id'], limit: 2001 }],
] as const) {
  test(`2.4 a query can't run off its fields and limit: ${name}`, rig(async (home, call) => {
    const result = await call('records_query', { orgId: ORG, ...args })
    assert.equal(result.ok, false)
    assert.equal(fakeCalls(home).filter(item => (item.soql ?? '').includes('FROM Widget__c')).length, 0)
  }))
}

test('2.4 what runs is the bound the caller gave, and rows stop at it', rig(async (home, call) => {
  const result = await call('records_query', { orgId: ORG, object: 'Widget__c', fields: ['Id'], limit: 1 })
  assert.equal((result.data as { rows: unknown[] }).rows.length, 1)
  for (const item of fakeCalls(home).filter(entry => (entry.soql ?? '').includes('FROM Widget__c'))) assert.match(item.soql ?? '', /LIMIT 1$/)
}, { queries: [{ match: 'SELECT COUNT', result: countRows(2) }, { match: 'SELECT Id FROM Widget__c', result: queryRows([{ Id: 'a00000000000001AAA' }, { Id: 'a00000000000002AAA' }]) }] }))

// 2.4: "A ceiling of 0 and the operation spelling."
test('2.4 a ceiling of 0 stays 0, and is not read as unset', () => {
  assert.equal(effectiveLimits({ orgId: ORG, instanceUrl: '', name: '', verifiedAt: '', destructiveCeiling: 0 }).destructiveCeiling, 0)
})

test('2.4 the operation spelling: an enum, so no spelling can slip past', () => {
  const operation = (TOOL_SCHEMAS.records_plan_update.inputSchema.properties as Record<string, { enum?: string[] }>).operation
  assert.deepEqual(operation?.enum, ['update', 'delete'])
})

// 2.4: "A forged approval via plan_update."
test('2.4 a forged approval does not change the hash, and is not on the schema', () => {
  const properties = Object.keys(TOOL_SCHEMAS.records_plan_update.inputSchema.properties as object)
  assert.equal(properties.includes('approval'), false)
  const plan = { id: 'plan-1', count: 3 }
  assert.equal(planHashOf({ ...plan, approval: { hash: 'forged', approver: 'x', at: 'y' } }), planHashOf(plan))
})

// 2.4: "Forged acknowledgements."
test('2.4 acknowledgements are not arguments on any stdio tool', () => {
  for (const name of TOOL_NAMES) {
    const properties = Object.keys(TOOL_SCHEMAS[name].inputSchema.properties as object)
    for (const banned of ['ack', 'acknowledgement', 'issueId']) assert.equal(properties.includes(banned), false, `${name} takes ${banned}`)
  }
  assert.equal(showsContinue('org-id-mismatch'), false)
  assert.equal(showsContinue('unknown'), false)
  assert.equal(showsContinue('forged-kind' as never), false)
})

// 2.4: "Rerun-query writes."
test('2.4 rerun-query plans are gone: no kind, no query, and no field to hold one', () => {
  for (const name of ['records_plan_update', 'deployment_plan'] as const) {
    const properties = Object.keys(TOOL_SCHEMAS[name].inputSchema.properties as object)
    for (const banned of ['rerunQuery', 'kind', 'soql', 'where']) assert.equal(properties.includes(banned), false, `${name} takes ${banned}`)
  }
  const source = readFileSync(join(here, '..', 'plans.ts'), 'utf8')
  assert.equal(source.includes('rerunQuery'), false)
})

// 2.4: "Plan expiry and elevation expiry."
test('2.4 elevation is gone: approval lives in the hook call, so there is no expiry to get wrong', () => {
  const source = readFileSync(join(here, '..', 'plans.ts'), 'utf8')
  for (const name of ['elevationAllows', 'productionAllows', 'approvePlan', 'approvalPayload']) assert.equal(source.includes(name), false, name)
})

// 2.4: "The validate\u2192execute artifact override."
test('2.4 a plan takes no artifact hash from the model: the code computes it', () => {
  // The execute half is C5's: it has to read the hash from the plan and from the zip, never from an argument.
  const properties = Object.keys(TOOL_SCHEMAS.deployment_plan.inputSchema.properties as object)
  assert.equal(properties.includes('artifactHash'), false)
})

// C5 built execution. The items about it live where the behaviour lives:
//   - Concurrent or crash double-execution: records-write.case.ts.
//   - tests.run: tests-run.case.ts.
//   - Rate limit on validate: deploy.case.ts.
//   - The execute half of the artifact override: deploy.case.ts.
test('2.4 what changes an org is mod-only, so a host without hooks has none of it', () => {
  for (const tool of ['sf_records_execute', 'sf_deployment_execute', 'sf_tests_run', 'sf_restore_plan_execute']) {
    assert.equal((TOOL_NAMES as readonly string[]).includes(tool), false, tool)
    assert.equal((MOD_ONLY_TOOLS as readonly string[]).includes(tool), true, tool)
    assert.equal(WRITE_TOOLS.includes(tool as never), true, tool)
  }
})
