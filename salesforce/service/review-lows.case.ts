import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toolRefusal } from './modes.js'
import { projectLogFolder } from './paths.js'
import { committedTextProblems } from './document.js'
import { effectiveLimits } from './registry.js'
import { SfCliAdapter } from './sf-adapter.js'
import { baseScenario, fakeHome, queryRows, USERNAME, writeScenario } from './test-support.js'
import { TOOL_SCHEMAS, validateArgs } from './tool-schemas.js'

// Review findings L2 to L5, L7.

const ENTRY = { orgId: '00D000000000001AAA', instanceUrl: 'https://acme.sandbox.example.com', name: 'Acme Sales', verifiedAt: '2026-06-01T00:00:00.000Z' }

test('L3: a narrowing that is there and malformed narrows to nothing, and never widens', () => {
  assert.deepEqual(effectiveLimits({ ...ENTRY, allowedOperationClasses: 'read' as never }).allowedOperationClasses, [])
  assert.deepEqual(effectiveLimits({ ...ENTRY, allowedOperationClasses: {} as never }).allowedOperationClasses, [])
  for (const bad of ['5', -1, Number.NaN, null, {}]) assert.equal(effectiveLimits({ ...ENTRY, destructiveCeiling: bad as never }).destructiveCeiling, 0, JSON.stringify(bad))
})

test('L3: a well-formed narrowing still narrows, and an absent one leaves the constants', () => {
  assert.deepEqual(effectiveLimits({ ...ENTRY, allowedOperationClasses: ['read', 'plan'] }).allowedOperationClasses, ['read', 'plan'])
  assert.equal(effectiveLimits({ ...ENTRY, destructiveCeiling: 5 }).destructiveCeiling, 5)
  assert.equal(effectiveLimits({ ...ENTRY, destructiveCeiling: 5000 }).destructiveCeiling, 100)
  const open = effectiveLimits(ENTRY)
  assert.equal(open.destructiveCeiling, 100)
  assert.deepEqual(open.allowedOperationClasses, ['read', 'plan', 'validate', 'write'])
})

test('L4: an empty permission read is unknown, so the warning shows', async () => {
  const home = fakeHome()
  try {
    writeScenario(home, baseScenario({ queries: [{ match: '^SELECT PermissionSet[.]', result: queryRows([], 'PermissionSetAssignment') }] }))
    const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000 })
    const access = await adapter.writeAccess(USERNAME, '00500000000000AAAA')
    assert.equal(access.canWrite, 'unknown')
  } finally {
    home.cleanup()
  }
})

test('L5: an address with a zero-width space in it is caught, as it will be written', () => {
  const sneaky = `grace${String.fromCodePoint(0x200b)}@example.com`
  assert.match(committedTextProblems('Evidence', sneaky).join(' '), /email address/)
  assert.match(committedTextProblems('Evidence', `gra${String.fromCodePoint(0xe0041)}ce@example.com`).join(' '), /email address/)
  assert.deepEqual(committedTextProblems('Evidence', 'a plain sentence'), [])
})

test('L7: project paths that read alike get different store folders', () => {
  const folders = ['C:/work/a_b', 'C:/work/a/b', 'C:/work/a b'].map(projectLogFolder)
  assert.equal(new Set(folders).size, 3)
  assert.equal(projectLogFolder('C:/Work/A_B/'), projectLogFolder('c:/work/a_b'), 'the same project is the same folder however it is spelled')
  assert.match(projectLogFolder('C:/work/a_b'), /^c_work_a_b-[0-9a-f]{8}$/)
})

test('L2: users_resolve takes three characters, and a subagent cannot call it', () => {
  const schema = TOOL_SCHEMAS.users_resolve.inputSchema
  assert.notEqual(validateArgs(schema, { orgId: '00D000000000001AAA', text: 'ad' }), null)
  assert.equal(validateArgs(schema, { orgId: '00D000000000001AAA', text: 'ada' }), null)
  assert.match(toolRefusal('users_resolve', null, 'agent-1') ?? '', /subagent cannot call users_resolve/)
  assert.equal(toolRefusal('users_resolve', null, null), null)
  assert.equal(toolRefusal('users_resolve', 'enhance', undefined), null)
})
