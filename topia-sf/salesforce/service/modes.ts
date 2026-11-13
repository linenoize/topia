import type { SfCommandName, SfMode } from './contract.js'

/**
 * Contract section 3. Mode is an accident guard, not the boundary. Each command
 * names its tools outright, and nothing is derived from a tool's class. A tool
 * nobody listed reaches no mode. No Node here: the mod and the server both read this.
 */

export const READ_ONLY_TOOLS: readonly string[] = [
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
  'vendor_findings_list',
  'dependency_report',
  'records_preview',
  'brief_propose',
  'sf_brief_confirm',
  'sf_show_values',
  'sf_ack_issue',
]

export const COMMAND_TOOLS: Record<SfCommandName, { mode: SfMode; tools: readonly string[] }> = {
  ask: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  capture: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  connect: { mode: 'investigate', tools: ['org_inspect', 'sf_org_register'] },
  context: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  deploy: { mode: 'execute', tools: [...READ_ONLY_TOOLS, 'deployment_validate', 'sf_deployment_validate', 'deployment_verify', 'sf_deployment_execute'] },
  diagnose: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  diff: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  // The mod answers these two itself, and no tool runs under them.
  disable: { mode: 'read-only', tools: [] },
  document: { mode: 'explain', tools: READ_ONLY_TOOLS },
  enable: { mode: 'read-only', tools: [] },
  enhance: { mode: 'explain', tools: ['org_inspect', 'users_resolve', 'schema_describe', 'brief_propose', 'sf_brief_confirm'] },
  execute: { mode: 'execute', tools: [...READ_ONLY_TOOLS, 'deployment_verify', 'sf_records_execute'] },
  explain: { mode: 'explain', tools: READ_ONLY_TOOLS },
  inspect: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  plan: { mode: 'plan', tools: [...READ_ONLY_TOOLS, 'practice_record', 'records_plan_update', 'deployment_plan'] },
  query: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  report: { mode: 'investigate', tools: READ_ONLY_TOOLS },
  restore: { mode: 'execute', tools: [...READ_ONLY_TOOLS, 'deployment_verify', 'sf_restore_plan_execute'] },
  'review-access': { mode: 'review', tools: READ_ONLY_TOOLS },
  'review-flow': { mode: 'review', tools: READ_ONLY_TOOLS },
  test: { mode: 'validate', tools: [...READ_ONLY_TOOLS, 'sf_tests_run'] },
  validate: { mode: 'validate', tools: [...READ_ONLY_TOOLS, 'deployment_validate', 'sf_deployment_validate'] },
  vendor: { mode: 'investigate', tools: [...READ_ONLY_TOOLS, 'vendor_fingerprint', 'vendor_finding_add', 'vendor_finding_reverify'] },
  verify: { mode: 'validate', tools: [...READ_ONLY_TOOLS, 'deployment_verify'] },
}

export const SF_COMMANDS = Object.keys(COMMAND_TOOLS) as SfCommandName[]

/** Tools a person answers. A subagent gets none of them, under any command. */
const PERSON_GATED: readonly string[] = ['sf_brief_confirm', 'sf_show_values', 'sf_ack_issue', 'sf_records_execute', 'sf_deployment_execute', 'sf_deployment_validate', 'sf_tests_run', 'sf_restore_plan_execute', 'sf_org_register']

/** Read tools a subagent still can't call: this one walks the user directory, one prefix at a time, and needs no brief. */
const NO_SUBAGENT: readonly string[] = ['users_resolve']

/** Accepts `topia-sf:<action>` and the bare action `command.run` may carry, and nothing else. */
export function commandFromName(name: string): SfCommandName | null {
  const match = /^(?:topia-sf:)?([a-z-]+)$/.exec(name)
  const command = match?.[1]
  return command !== undefined && Object.hasOwn(COMMAND_TOOLS, command) ? (command as SfCommandName) : null
}

/** Absent means read-only. A subagent is read-only, whatever the session is doing. */
export function effectiveMode(mode: SfMode | null | undefined, agentId?: string | null): SfMode {
  if (agentId !== undefined && agentId !== null) return 'read-only'
  return mode ?? 'read-only'
}

export function toolAllowed(command: SfCommandName | null, tool: string): boolean {
  return (command === null ? READ_ONLY_TOOLS : COMMAND_TOOLS[command].tools).includes(tool)
}

/** All a server can see from a stamp: the rows with this mode, and the read-only row. */
export function modeAllowsTool(mode: SfMode, tool: string): boolean {
  if (READ_ONLY_TOOLS.includes(tool)) return true
  return mode !== 'read-only' && SF_COMMANDS.some(command => COMMAND_TOOLS[command].mode === mode && COMMAND_TOOLS[command].tools.includes(tool))
}

function commandFor(tool: string): SfCommandName | undefined {
  return SF_COMMANDS.find(command => COMMAND_TOOLS[command].tools.includes(tool))
}

/** Why this call can't run under this command in this loop, or null when it can. */
export function toolRefusal(tool: string, command: SfCommandName | null, agentId?: string | null): string | null {
  const isSubagent = agentId !== undefined && agentId !== null
  if (isSubagent && NO_SUBAGENT.includes(tool)) return `A subagent cannot call ${tool}, because it lists the org's users. Do this from the main conversation.`
  if (isSubagent && PERSON_GATED.includes(tool)) return `A subagent cannot call ${tool}, because a person has to answer it. Do this from the main conversation.`
  if (toolAllowed(isSubagent ? null : command, tool)) return null
  const home = commandFor(tool)
  const where = home === undefined ? 'No command leads to it.' : `A person runs /topia-sf:${home} for that, and it applies to that turn only.`
  return isSubagent ? `A subagent is read-only, so it cannot call ${tool}.` : `${tool} does not run here. ${where}`
}

/** These run before confirmation: the identity check, and lookups that return a list to confirm. Anything else needs a brief, including a tool nobody listed. */
const BRIEF_EXEMPT: readonly string[] = ['org_inspect', 'users_resolve', 'brief_propose']

export function needsBrief(tool: string, args: Record<string, unknown>): boolean {
  if (BRIEF_EXEMPT.includes(tool)) return false
  // Reading this project's own notes touches no org. With an org it reads the live version, and that needs a brief.
  if (tool === 'vendor_findings_list' && args.orgId === undefined) return false
  return !(tool === 'schema_describe' && args.purpose === 'candidate')
}
