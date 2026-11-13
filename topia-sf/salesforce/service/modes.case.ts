import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MOD_ONLY_TOOLS, TOOL_NAMES, WRITE_TOOLS, modeLabel, type SfCommandName, type SfMode } from './contract.js'
import { COMMAND_TOOLS, READ_ONLY_TOOLS, SF_COMMANDS, commandFromName, effectiveMode, modeAllowsTool, needsBrief, toolAllowed, toolRefusal } from './modes.js'

/** Every tool the contract names, built or not. A new tool has to take a place in this table. */
const ALL_TOOLS = [
  'vendor_findings_list',
  'vendor_fingerprint',
  'vendor_finding_add',
  'vendor_finding_reverify',
  'org_inspect',
  'schema_describe',
  'records_query',
  'users_resolve',
  'audit_query',
  'reports_describe',
  'reports_run',
  'metadata_retrieve',
  'metadata_diff',
  'packages_inventory',
  'dependency_report',
  'records_preview',
  'brief_propose',
  'practice_record',
  'records_plan_update',
  'deployment_plan',
  'deployment_validate',
  'deployment_verify',
  'sf_brief_confirm',
  'sf_show_values',
  'sf_ack_issue',
  'sf_records_execute',
  'sf_deployment_execute',
  'sf_deployment_validate',
  'sf_tests_run',
  'sf_restore_plan_execute',
  'sf_org_register',
]

const READ_ONLY = ['org_inspect', 'schema_describe', 'records_query', 'users_resolve', 'audit_query', 'reports_describe', 'reports_run', 'metadata_retrieve', 'metadata_diff', 'packages_inventory', 'vendor_findings_list', 'dependency_report', 'records_preview', 'brief_propose', 'sf_brief_confirm', 'sf_show_values', 'sf_ack_issue']

/** Written out by hand, on purpose: it can't be derived from the table it checks. */
const EXPECTED: Record<SfCommandName, { mode: SfMode; tools: string[] }> = {
  ask: { mode: 'investigate', tools: READ_ONLY },
  capture: { mode: 'investigate', tools: READ_ONLY },
  connect: { mode: 'investigate', tools: ['org_inspect', 'sf_org_register'] },
  context: { mode: 'investigate', tools: READ_ONLY },
  deploy: { mode: 'execute', tools: [...READ_ONLY, 'deployment_validate', 'sf_deployment_validate', 'deployment_verify', 'sf_deployment_execute'] },
  diagnose: { mode: 'investigate', tools: READ_ONLY },
  diff: { mode: 'investigate', tools: READ_ONLY },
  disable: { mode: 'read-only', tools: [] },
  document: { mode: 'explain', tools: READ_ONLY },
  enable: { mode: 'read-only', tools: [] },
  enhance: { mode: 'explain', tools: ['org_inspect', 'users_resolve', 'schema_describe', 'brief_propose', 'sf_brief_confirm'] },
  execute: { mode: 'execute', tools: [...READ_ONLY, 'deployment_verify', 'sf_records_execute'] },
  explain: { mode: 'explain', tools: READ_ONLY },
  inspect: { mode: 'investigate', tools: READ_ONLY },
  plan: { mode: 'plan', tools: [...READ_ONLY, 'practice_record', 'records_plan_update', 'deployment_plan'] },
  query: { mode: 'investigate', tools: READ_ONLY },
  report: { mode: 'investigate', tools: READ_ONLY },
  restore: { mode: 'execute', tools: [...READ_ONLY, 'deployment_verify', 'sf_restore_plan_execute'] },
  'review-access': { mode: 'review', tools: READ_ONLY },
  'review-flow': { mode: 'review', tools: READ_ONLY },
  test: { mode: 'validate', tools: [...READ_ONLY, 'sf_tests_run'] },
  validate: { mode: 'validate', tools: [...READ_ONLY, 'deployment_validate', 'sf_deployment_validate'] },
  vendor: { mode: 'investigate', tools: [...READ_ONLY, 'vendor_fingerprint', 'vendor_finding_add', 'vendor_finding_reverify'] },
  verify: { mode: 'validate', tools: [...READ_ONLY, 'deployment_verify'] },
}

test('the table has one row for each command, and no more', () => {
  assert.deepEqual([...SF_COMMANDS].sort(), Object.keys(EXPECTED).sort())
  assert.deepEqual(Object.keys(COMMAND_TOOLS).sort(), Object.keys(EXPECTED).sort())
})

for (const [command, row] of Object.entries(EXPECTED) as [SfCommandName, { mode: SfMode; tools: string[] }][]) {
  test(`/topia-sf:${command} runs in ${row.mode} and reaches exactly its tools`, () => {
    assert.equal(COMMAND_TOOLS[command]?.mode, row.mode)
    assert.equal(commandFromName(`topia-sf:${command}`), command)
    assert.equal(commandFromName(command), command)
    assert.equal(commandFromName(`sf:${command}`), null)
    for (const tool of ALL_TOOLS) assert.equal(toolAllowed(command, tool), row.tools.includes(tool), `${command} and ${tool}`)
  })
}

test('with no command in force, only the read-only row applies', () => {
  assert.deepEqual([...READ_ONLY_TOOLS].sort(), [...READ_ONLY].sort())
  for (const tool of ALL_TOOLS) assert.equal(toolAllowed(null, tool), READ_ONLY.includes(tool), tool)
  for (const tool of WRITE_TOOLS) assert.equal(toolAllowed(null, tool), false, tool)
})

test('every tool that exists has a place in the table', () => {
  for (const tool of [...TOOL_NAMES, ...MOD_ONLY_TOOLS, ...WRITE_TOOLS]) assert.ok(ALL_TOOLS.includes(tool), tool)
})

test('other names are not commands', () => {
  for (const name of ['orders', 'sf', 'sf:', 'sf:nope', 'sf:plan', 'topia:sf:plan', 'topia-sf:', 'topia-sf:PLAN', 'other:sf:plan', 'sf:plan ', 'sf:plan:x']) {
    assert.equal(commandFromName(name), null, name)
  }
})

test('absent mode means read-only', () => {
  assert.equal(effectiveMode(undefined), 'read-only')
  assert.equal(effectiveMode(null), 'read-only')
  assert.equal(effectiveMode('plan'), 'plan')
  assert.equal(modeLabel('read-only'), 'Read-only')
})

test('a subagent is read-only, whatever the session is doing', () => {
  assert.equal(effectiveMode('execute', 'agent-1'), 'read-only')
  assert.equal(effectiveMode('plan', 'agent-1'), 'read-only')
  assert.equal(effectiveMode('plan', null), 'plan')
})

test('a subagent is denied every person-gated tool, in every command', () => {
  for (const tool of ['sf_brief_confirm', 'sf_show_values', 'sf_ack_issue', ...WRITE_TOOLS]) {
    for (const command of [null, ...Object.keys(EXPECTED)] as (SfCommandName | null)[]) assert.match(String(toolRefusal(tool, command, 'agent-1')), /subagent/i, `${tool} under ${command}`)
  }
})

test('a subagent keeps the reads and loses the plan tools', () => {
  assert.equal(toolRefusal('records_query', 'plan', 'agent-1'), null)
  assert.match(String(toolRefusal('records_plan_update', 'plan', 'agent-1')), /read-only/)
  assert.match(String(toolRefusal('practice_record', 'plan', 'agent-1')), /read-only/)
})

test('a refusal names the command that leads to the tool', () => {
  assert.equal(toolRefusal('records_plan_update', 'plan'), null)
  assert.match(String(toolRefusal('records_plan_update', null)), /\/topia-sf:plan/)
  assert.match(String(toolRefusal('sf_records_execute', 'plan')), /\/topia-sf:execute/)
  assert.match(String(toolRefusal('sf_org_register', null)), /\/topia-sf:connect/)
  assert.match(String(toolRefusal('sf_deployment_execute', 'validate')), /\/topia-sf:deploy/)
})

test('the mode check is what the server can see from a stamp', () => {
  assert.equal(modeAllowsTool('read-only', 'records_query'), true)
  assert.equal(modeAllowsTool('read-only', 'records_plan_update'), false)
  assert.equal(modeAllowsTool('plan', 'records_plan_update'), true)
  assert.equal(modeAllowsTool('investigate', 'records_plan_update'), false)
  assert.equal(modeAllowsTool('explain', 'practice_record'), false)
})

test('a tool nobody listed reaches no mode', () => {
  for (const mode of ['read-only', 'explain', 'investigate', 'plan', 'validate', 'execute', 'review'] as SfMode[]) assert.equal(modeAllowsTool(mode, 'tool_from_the_future'), false, mode)
  assert.equal(toolAllowed(null, 'tool_from_the_future'), false)
})

test('investigation and plan tools need a brief. Identity and candidate lookups do not', () => {
  for (const tool of ['schema_describe', 'records_query', 'audit_query', 'reports_describe', 'reports_run', 'metadata_retrieve', 'metadata_diff', 'practice_record', 'records_plan_update', 'deployment_plan', 'packages_inventory', 'tool_from_the_future']) {
    assert.equal(needsBrief(tool, {}), true, tool)
  }
  for (const tool of ['org_inspect', 'users_resolve', 'brief_propose']) assert.equal(needsBrief(tool, {}), false, tool)
  assert.equal(needsBrief('schema_describe', { purpose: 'candidate' }), false)
  assert.equal(needsBrief('schema_describe', { purpose: 'investigate' }), true)
  assert.equal(needsBrief('records_query', { purpose: 'candidate' }), true, 'only schema_describe has a candidate form')
})

test('listing vendor notes needs no brief until it reaches an org', () => {
  assert.equal(needsBrief('vendor_findings_list', {}), false)
  assert.equal(needsBrief('vendor_findings_list', { orgId: '00D000000000001AAA' }), true)
  assert.equal(needsBrief('packages_inventory', {}), true)
  assert.equal(needsBrief('vendor_fingerprint', {}), true)
})
