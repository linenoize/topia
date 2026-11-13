import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import { GUARD_MISSING } from './lib/compose-watch'
import {
  BRIEF_OPTIONS,
  SALESFORCE_ABOUT,
  SALESFORCE_ACK_LABEL,
  SALESFORCE_RUNNER,
  SALESFORCE_STDIO_PREFIX,
  SALESFORCE_STORE_FILE,
  SALESFORCE_TOOL_SPECS,
  ackQuestion,
  asWriteReply,
  briefQuestion,
  confirmShownPath,
  hashesOf,
  isBriefRead,
  isPrepared,
  isResolved,
  registrationApproved,
  registrationPinned,
  registrationScreen,
  SALESFORCE_WRITE_TOOLS,
  SALESFORCE_WRITE_UNKNOWN,
  showsContinue,
  valuesScreen,
  viewBand,
  writeRequest,
  type SalesforceWriteTool,
} from './lib/salesforce-env'
import { approvalAccepted, buildApprovalScreen } from '../salesforce/service/approval-screen'
import { fileDenyReason, filePathsOf, filePatternsOf, GUARD_PROBE_LINE, GUARD_SOURCE, guardReason, isNetworkLooking, judgeFilePath, judgeSearchRoot, judgeShellLine, networkReason, patternRoot } from '../salesforce/service/guard-rules'
import { sameId } from '../salesforce/service/identity'
import { COMMAND_TOOLS, commandFromName, effectiveMode, toolRefusal, SF_COMMANDS } from '../salesforce/service/modes'
import { writerLogoutCommand } from '../salesforce/service/contract'
import { ORG_TEXT_MARK, wrapOrgText } from '../salesforce/service/org-text'
import { stampInput, withoutStamp, type StampAck } from '../salesforce/service/stamp'
import type {
  SalesforceAck,
  SalesforceIssue,
  SalesforceLockState,
  SalesforceSession,
} from './types'

// topia-sf Claude Code mods: Salesforce band, person-gated tools, and guards.
// Install topia first; this plugin is the optional add-on. One plugin registers
// each event once in a single module.

function scopeOf(key: string): string {
  return `topia-sf:${key}`
}

const salesforceBand = atom({ plugin: 'topia-sf', key: 'salesforceBand' } as const, null)
const salesforcePendingEnable = atom({ plugin: 'topia-sf', key: 'salesforcePendingEnable' } as const, null)
const salesforcePendingDisable = atom({ plugin: 'topia-sf', key: 'salesforcePendingDisable' } as const, null)
const salesforceAck = atom({ plugin: 'topia-sf', key: 'salesforceAck' } as const, null)
const salesforceToolRegistered = atom({ plugin: 'topia-sf', key: 'salesforceToolRegistered' } as const, false)
const salesforceMode = atom({ plugin: 'topia-sf', key: 'salesforceMode' } as const, null)
const salesforceBrief = atom({ plugin: 'topia-sf', key: 'salesforceBrief' } as const, null)
const salesforceTainted = atom({ plugin: 'topia-sf', key: 'salesforceTainted' } as const, false)
const salesforceGuardMissing = atom({ plugin: 'topia-sf', key: 'salesforceGuardMissing' } as const, false)
const salesforceHeadless = atom({ plugin: 'topia-sf', key: 'salesforceHeadless' } as const, false)
// A hot reload raises session.start again. The identity check runs the CLI, so only the first start does it.
const salesforceStarted = atom({ plugin: 'topia-sf', key: 'salesforceStarted' } as const, false)
const bandFocus = atom({ plugin: 'topia-sf', key: 'bandFocus' } as const, null)

// What a value means, in one fixed slot under the rows, like Claude Code's own
// menus. The slot keeps its height whatever is shown, so the rows above never
// move or rewrap: the line for the value under the pointer covers the slot
// (hover, no hook), else the focused value's line (Tab, arrows, a click), else
// the hint. Long lines wrap inside the slot and are clipped at its height.
const ABOUT_LINES = 2

function aboutSlot(
  { Box, Text }: { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> },
  abouts: Record<string, string>,
  focused: string | undefined,
) {
  return (
    <Box key="about" flexDirection="column" height={ABOUT_LINES} overflow="hidden">
      {Object.keys(abouts).map(key => (
        <Box key={`about-${key}`} display="none" height={ABOUT_LINES} flexShrink={0} hover={{ scope: scopeOf(key), display: 'flex' }}>
          <Text dimColor wrap="wrap">
            ⓘ {abouts[key]}
          </Text>
        </Box>
      ))}
      <Box key="about-rest" height={ABOUT_LINES} flexShrink={0}>
        <Text dimColor wrap="wrap">
          ⓘ {focused ?? 'Hover or Tab to a value to see what it means.'}
        </Text>
      </Box>
    </Box>
  )
}

// Says so before anyone reaches a dialog, once a session.
let salesforceGuardProbed = false

async function noticeGuardMissing($: EngineInterface) {
  if (salesforceGuardProbed) return
  salesforceGuardProbed = true
  try {
    await salesforceGuardGate($)
  } catch {
    // The dialogs check again for themselves.
  }
}

// Salesforce stays off until this project root has a lock. The lock lives in the
// service's store, and the mod reads and changes it only through the runner, so
// this file keeps no copy. cwd is the plugin folder: on Windows a bare `node` is
// searched for in the working directory first, and the project could plant one.
async function salesforceRunner($: EngineInterface, command: string, input: Record<string, unknown>, timeoutMs = 20_000): Promise<unknown> {
  try {
    const ran = await $.process.run(['node', `${$.plugin.root}/${SALESFORCE_RUNNER}`, command], {
      cwd: $.plugin.root,
      stdin: JSON.stringify(input),
      env: { NODE_OPTIONS: '' },
      timeoutMs,
    })
    return ran.exitCode === 0 ? (JSON.parse(ran.stdout) as unknown) : null
  } catch {
    return null
  }
}

type SalesforceStatus = { lock: SalesforceLockState; session: SalesforceSession | null; registeredOrgs: number; writerNotice?: string | null; writerCheck?: boolean }

function asStatus(reply: unknown): SalesforceStatus | null {
  if (reply === null || typeof reply !== 'object') return null
  const status = reply as Partial<SalesforceStatus>
  const state = status.lock?.state
  if (state !== 'on' && state !== 'off' && state !== 'unreadable') return null
  return { lock: status.lock as SalesforceLockState, session: status.session ?? null, registeredOrgs: status.registeredOrgs ?? 0, writerNotice: typeof status.writerNotice === 'string' ? status.writerNotice : null, writerCheck: status.writerCheck === true }
}

const RUNNER_FAILED = 'Salesforce could not check the lock: the runner did not answer. Its tools refuse until this works.'

async function salesforceStatus($: EngineInterface, root: string): Promise<SalesforceStatus> {
  return asStatus(await salesforceRunner($, 'status', { projectRoot: root })) ?? { lock: { state: 'unreadable', message: RUNNER_FAILED }, session: null, registeredOrgs: 0 }
}

// One refresh at a time. A call during a refresh asks for one more run after it.
let salesforceRefreshing: Promise<void> | null = null
let salesforceRefreshAgain = false

function refreshSalesforce($: EngineInterface): Promise<void> {
  if (salesforceRefreshing !== null) {
    salesforceRefreshAgain = true
    return salesforceRefreshing
  }
  const run = async () => {
    try {
      do {
        salesforceRefreshAgain = false
        await drawSalesforce($)
      } while (salesforceRefreshAgain)
    } catch {
      // The band keeps what it last drew. The tools read the lock themselves.
    } finally {
      salesforceRefreshing = null
    }
  }
  salesforceRefreshing = run()
  return salesforceRefreshing
}

// True while the last status found a writer not known to be logged out. Each turn then looks again, so the band clears soon after a person logs it out.
let salesforceWriterUp = false

async function drawSalesforce($: EngineInterface) {
  const root = await $.session.root()
  const status = await salesforceStatus($, root)
  salesforceWriterUp = status.writerCheck === true
  const view = viewBand({
    lock: status.lock,
    session: status.session,
    ack: await read($, salesforceAck),
    registeredOrgs: status.registeredOrgs,
    now: await $.clock.now(),
    mode: effectiveMode((await read($, salesforceMode))?.mode),
    writerNotice: status.writerNotice,
  })
  await update($, salesforceBand, () => view)
  if (status.lock.state === 'on') await registerSalesforceTool($)
}

// Only in a project that is on, so every other project lists none of them.
async function registerSalesforceTool($: EngineInterface) {
  if (await read($, salesforceToolRegistered)) return
  for (const spec of SALESFORCE_TOOL_SPECS) await $.tool.register(spec)
  await update($, salesforceToolRegistered, () => true)
}

const IDENTITY_CHECK_MS = 180_000

// The band shows what a live check found this session, not what was left in the
// store. This runs the CLI, so only in a project that is on, and never awaited.
async function startSalesforce($: EngineInterface, checkIdentity: boolean) {
  try {
    await refreshSalesforce($)
    if (!checkIdentity || (await read($, salesforceBand)) === null) return
    await salesforceRunner($, 'identity-check', { projectRoot: await $.session.root() }, IDENTITY_CHECK_MS)
    await refreshSalesforce($)
  } catch {
    // The band keeps what it last drew. The tools check for themselves.
  }
}

// Runs the CLI, so only while a writer is up, and never awaited.
async function afterTurnSalesforce($: EngineInterface) {
  try {
    await refreshSalesforce($)
    if (!salesforceWriterUp) return
    await salesforceRunner($, 'writer-check', { projectRoot: await $.session.root() }, IDENTITY_CHECK_MS)
    await refreshSalesforce($)
  } catch {
    // The band keeps what it last drew.
  }
}

// A person-gated tool, as contract section 2 sets out: the screen comes from a
// fresh live check, the answer returns to this call, and the runner gets what was
// shown. Nothing about the approval is on disk, and a subagent cannot get this far.
async function registerSalesforceOrg($: EngineInterface, e: { agentId?: string; target?: unknown; role?: unknown }) {
  const refused = await salesforceToolGate($, 'sf_org_register', e)
  if (refused !== null) return { deny: refused }
  if (typeof e.target !== 'string') return { deny: 'Registration needs target: a CLI alias or a username.' }
  if (e.role !== undefined && e.role !== 'reader' && e.role !== 'writer') return { deny: 'A role is reader or writer.' }
  const projectRoot = await $.session.root()
  const resolved = await salesforceRunner($, 'org-resolve', { projectRoot, target: e.target, ...(e.role === 'writer' ? { role: 'writer' } : {}) }, IDENTITY_CHECK_MS)
  if (!isResolved(resolved)) {
    const reason = (resolved as { reason?: unknown } | null)?.reason
    return { deny: typeof reason === 'string' ? wrapOrgText(reason) : 'The org could not be checked, so nothing was registered.' }
  }
  const guard = await salesforceGuardGate($)
  if (guard !== null) return { deny: guard }
  const screen = registrationScreen(resolved)
  let answer: string
  try {
    answer = await $.ui.ask(screen.question, { options: screen.options, header: 'Salesforce' })
  } catch {
    return { deny: 'Nobody answered the dialog, so nothing was registered.' }
  }
  if (!registrationApproved(screen, answer)) return { deny: 'The person did not approve this org, so nothing was registered.' }
  const wrote = (await salesforceRunner($, 'org-register', { projectRoot, ...registrationPinned(screen, answer) }, IDENTITY_CHECK_MS)) as { ok?: boolean; reason?: unknown } | null
  if (wrote?.ok !== true) return { deny: typeof wrote?.reason === 'string' ? wrapOrgText(wrote.reason) : 'The registry could not be written, so nothing was registered.' }
  await refreshSalesforce($)
  if (resolved.role === 'writer') return { result: wrapOrgText(`Registered ${resolved.live.username} as the writer for ${resolved.live.name}. Writes target this user, and reads stay with ${resolved.reader ?? 'the reader'}. When the change is done, a person runs this in their own terminal: ${writerLogoutCommand(resolved.live.username)}`) }
  return { result: wrapOrgText(`Registered ${resolved.live.name} (${resolved.live.orgId}). The band shows its live identity. Targets go by username from here on.`) }
}

// ── the gate ────────────────────────────────────────────────────────────────

// A person answers these, in the hook, and the answer stays in session memory.
// None of it is on disk, so no file can grant any of it. Everything here that asks
// is exact: the Other box returns free text, so nothing close counts.

async function salesforceToolGate($: EngineInterface, tool: string, e: { agentId?: string }): Promise<string | null> {
  return toolRefusal(tool, (await read($, salesforceMode))?.command as never ?? null, e.agentId ?? null)
}

// A guard can be skipped by a plugin ahead of Topia, so its run count is the proof
// it's in the chain. It's a module variable, so it reads true inside one dispatch.
let salesforceGuardRuns = 0

async function salesforceGuardInForce($: EngineInterface): Promise<boolean> {
  const before = salesforceGuardRuns
  let decision: string
  try {
    decision = (await $.tool.check({ tool: 'Bash', input: { command: GUARD_PROBE_LINE } })).decision
  } catch {
    return false
  }
  return salesforceGuardRuns > before && decision !== 'allow'
}

async function salesforceGuardGate($: EngineInterface): Promise<string | null> {
  if (await salesforceGuardInForce($)) return null
  if (!(await read($, salesforceGuardMissing))) {
    await update($, salesforceGuardMissing, () => true)
    $.ui.toast(GUARD_MISSING, { timeoutMs: 12000 })
  }
  return GUARD_MISSING
}

async function confirmSalesforceBrief($: EngineInterface, e: { agentId?: string; briefId?: unknown }) {
  const refused = await salesforceToolGate($, 'sf_brief_confirm', e)
  if (refused !== null) return { deny: refused }
  const projectRoot = await $.session.root()
  const read_ = await salesforceRunner($, 'brief-read', { projectRoot, briefId: e.briefId })
  if (!isBriefRead(read_)) {
    const reason = (read_ as { reason?: unknown } | null)?.reason
    return { deny: typeof reason === 'string' ? wrapOrgText(reason) : 'That brief could not be read, so nothing was confirmed.' }
  }
  const guard = await salesforceGuardGate($)
  if (guard !== null) return { deny: guard }
  let answer: string
  try {
    answer = await $.ui.ask(briefQuestion(read_), { options: BRIEF_OPTIONS, header: 'Salesforce' })
  } catch {
    return { deny: 'Nobody answered the dialog, so the brief is not confirmed. A chat reply is not confirmation.' }
  }
  const confirmed = answer === 'Confirm'
  await salesforceRunner($, 'brief-answered', { projectRoot, briefId: read_.briefId, confirmed })
  if (!confirmed) {
    if (answer === 'Change it') return { deny: 'The person wants this brief changed. Ask what changes, then call brief_propose again. It is not confirmed.' }
    return { deny: 'The person did not confirm this brief, so stop. Do not investigate.' }
  }
  const at = new Date(await $.clock.now()).toISOString()
  await update($, salesforceBrief, () => ({ briefHash: read_.briefHash, at }))
  return { result: `A person confirmed brief ${read_.briefId}. Pass this briefId to investigation and plan tools.` }
}

async function showSalesforceValues($: EngineInterface, e: Record<string, unknown> & { agentId?: string }) {
  const refused = await salesforceToolGate($, 'sf_show_values', e)
  if (refused !== null) return { deny: refused }
  const projectRoot = await $.session.root()
  const { agentId: _loop, tool: _tool, tool_use_id: _call, consent: _consent, confirmedBriefHash: _sent, pinned: _pinned, ...request } = e
  const confirmedBriefHash = (await read($, salesforceBrief))?.briefHash ?? null
  const mode = effectiveMode((await read($, salesforceMode))?.mode)
  const prepared = await salesforceRunner($, 'values-prepare', { projectRoot, request, confirmedBriefHash, mode }, IDENTITY_CHECK_MS)
  if (!isPrepared(prepared)) {
    const reason = (prepared as { reason?: unknown } | null)?.reason
    return { deny: typeof reason === 'string' ? wrapOrgText(reason) : 'The values could not be prepared, so nothing was shown.' }
  }
  const guard = await salesforceGuardGate($)
  if (guard !== null) return { deny: guard }
  const screen = valuesScreen(prepared)
  let answer: string
  try {
    answer = await $.ui.ask(screen.question, { options: screen.options, header: 'Salesforce' })
  } catch {
    return { deny: 'Nobody answered the dialog, so no values were shown.' }
  }
  if (answer !== screen.approveLabel) return { deny: 'The person did not approve this, so no values were shown.' }
  // What was shown is what runs: the runner gets this over stdin, and it doesn't read a file for it.
  const ran = (await salesforceRunner($, 'values-run', { projectRoot, pinned: prepared.pinned, confirmedBriefHash, mode }, IDENTITY_CHECK_MS)) as { ok?: boolean; text?: unknown; reason?: unknown } | null
  if (ran?.ok !== true || typeof ran.text !== 'string') return { deny: typeof ran?.reason === 'string' ? wrapOrgText(ran.reason) : 'The values could not be read.' }
  await update($, salesforceTainted, () => true)
  return { result: ran.text }
}

// The write tools, in the order contract section 9 sets out. Nothing about the approval
// is on disk, and the runner gets the plan bytes held here, over stdin. A silent runner
// after the approval is unknown, never "nothing was written".
const SALESFORCE_WRITE_MS = 590_000

async function salesforceWrite($: EngineInterface, tool: SalesforceWriteTool, e: Record<string, unknown> & { agentId?: string }) {
  const refused = await salesforceToolGate($, tool, e)
  if (refused !== null) return { deny: refused }
  const guard = await salesforceGuardGate($)
  if (guard !== null) return { deny: guard }
  const projectRoot = await $.session.root()
  const confirmedBriefHash = (await read($, salesforceBrief))?.briefHash ?? null
  const mode = effectiveMode((await read($, salesforceMode))?.mode)
  const { prepare, run } = SALESFORCE_WRITE_TOOLS[tool]
  const prepared = asWriteReply(await salesforceRunner($, prepare, { projectRoot, request: writeRequest(tool, e), confirmedBriefHash, mode }, IDENTITY_CHECK_MS))
  if (prepared === null) return { deny: 'The org could not be checked, so nothing was written.' }
  if (!prepared.ok) return { deny: wrapOrgText(prepared.reason) }
  if (prepared.action === 'report') {
    await update($, salesforceTainted, () => true)
    void refreshSalesforce($)
    return { result: prepared.text }
  }
  const screen = buildApprovalScreen(prepared.screenPlan, prepared.facts)
  if (screen.refusal !== null) return { deny: screen.refusal }
  let answer: string
  try {
    answer = await $.ui.ask(screen.text, { options: screen.options, header: 'Salesforce' })
  } catch {
    return { deny: 'Nobody answered the dialog, so nothing was written. A chat reply is not an approval.' }
  }
  if (!approvalAccepted(screen, answer)) return { deny: 'The person did not approve this, so nothing was written.' }
  const ran = asWriteReply(await salesforceRunner($, run, { projectRoot, pinned: prepared.pinned, confirmedBriefHash, mode }, SALESFORCE_WRITE_MS))
  await update($, salesforceTainted, () => true)
  void refreshSalesforce($)
  if (ran === null || (ran.ok && ran.action !== 'report')) return { result: SALESFORCE_WRITE_UNKNOWN }
  return ran.ok ? { result: ran.text } : { deny: wrapOrgText(ran.reason) }
}

async function ackSalesforceIssue($: EngineInterface, e: { agentId?: string; issueId?: unknown }) {
  const refused = await salesforceToolGate($, 'sf_ack_issue', e)
  if (refused !== null) return { deny: refused }
  const projectRoot = await $.session.root()
  const status = await salesforceStatus($, projectRoot)
  if (status.lock.state !== 'on') return { deny: status.lock.state === 'unreadable' ? status.lock.message : 'Salesforce is not on for this project.' }
  const band = viewBand({ lock: status.lock, session: status.session, ack: null, registeredOrgs: status.registeredOrgs, now: await $.clock.now() })
  const item = band !== null && 'issue' in band ? (band.issue as SalesforceIssue | undefined) : undefined
  if (item === undefined) return { deny: 'No notice is live, so there is nothing to acknowledge.' }
  if (item.id !== e.issueId) return { deny: `That is not the live notice. The live one is ${item.id}.` }
  if (!showsContinue(item.kind)) return { deny: "That notice can't be acknowledged. It takes a fix, not an answer." }
  const checked = (await salesforceRunner($, 'ack-check', { projectRoot, orgId: item.orgId, kind: item.kind }, IDENTITY_CHECK_MS)) as { ok?: boolean; reason?: unknown } | null
  if (checked?.ok !== true) return { deny: typeof checked?.reason === 'string' ? wrapOrgText(checked.reason) : 'The org could not be checked, so the notice stays.' }
  const guard = await salesforceGuardGate($)
  if (guard !== null) return { deny: guard }
  let answer: string
  try {
    answer = await $.ui.ask(ackQuestion(item), { options: ['Stop', SALESFORCE_ACK_LABEL], header: 'Salesforce' })
  } catch {
    return { deny: 'Nobody answered the dialog, so the notice stays.' }
  }
  if (answer !== SALESFORCE_ACK_LABEL) return { deny: 'The person did not acknowledge this, so the notice stays.' }
  const ack: SalesforceAck = { issueId: item.id, kind: item.kind, orgId: item.orgId, user: item.user, operationClass: item.operationClass, ...hashesOf(status.session) }
  await update($, salesforceAck, () => ack)
  void refreshSalesforce($)
  return { result: 'A person acknowledged this notice. It applies to the next call on this org, and it does not approve a change.' }
}

// Single use: whichever stdio call on this org comes next takes it, whether or not it needs it.
async function takeSalesforceAck($: EngineInterface, orgId: unknown): Promise<StampAck | null> {
  const held = await read($, salesforceAck)
  if (held === null || typeof orgId !== 'string' || !sameId(held.orgId, orgId)) return null
  await update($, salesforceAck, () => null)
  return { kind: held.kind, orgId: held.orgId, user: held.user, orgIdentityHash: held.orgIdentityHash }
}

// Every stdio call. The stamp overwrites what the model sent. A headless session
// has nobody to confirm a brief, so it is a host without hooks: no stamp, reads only.
async function stampSalesforceCall($: EngineInterface, e: Record<string, unknown> & { tool: string; agentId?: string }, next: (input: never) => Promise<{ deny?: string; text?: string }>) {
  const tool = String(e.tool).slice(SALESFORCE_STDIO_PREFIX.length)
  const headless = await read($, salesforceHeadless)
  const held = await read($, salesforceMode)
  const agentId = e.agentId ?? null
  if (!headless) {
    const refused = toolRefusal(tool, (held?.command as never) ?? null, agentId)
    if (refused !== null) return { deny: refused }
  }
  const input = headless
    ? withoutStamp(e)
    : stampInput(e, { mode: effectiveMode(held?.mode, agentId), agentId, confirmedBriefHash: (await read($, salesforceBrief))?.briefHash ?? null, ack: await takeSalesforceAck($, e.orgId) })
  const ran = await next(input as never)
  // Text the hook can't read counts as org text. Only a plain refusal doesn't.
  if (ran.deny === undefined && (typeof ran.text !== 'string' || ran.text.includes(ORG_TEXT_MARK))) await update($, salesforceTainted, () => true)
  return ran
}

const SALESFORCE_GUARD_FAILED = `${GUARD_SOURCE} The check on this call failed, so it is refused. Do not reshape the command to get past this.`

async function salesforceActivated($: EngineInterface): Promise<boolean> {
  if (!(await salesforceMayBeOn($))) return false
  return (await salesforceStatus($, await $.session.root())).lock.state !== 'off'
}

type CheckVerdict = { decision: 'allow' | 'ask' | 'deny'; reason?: string }

// A person's ask, not a verdict for the mode to settle. A deny from a settings rule stands.
async function guardShellLine($: EngineInterface, e: { input: unknown }, next: (input: never) => Promise<CheckVerdict>) {
  salesforceGuardRuns += 1
  const below = await next(e as never)
  if (below.decision === 'deny') return below
  const given = e.input as { command?: unknown; ws?: unknown } | null
  // Monitor can open an outbound socket without any command line at all.
  if (given?.ws !== undefined && given.ws !== null && (await read($, salesforceTainted))) return { decision: 'ask' as const, reason: networkReason() }
  const command = given?.command
  if (typeof command !== 'string') return below
  const named = judgeShellLine(command, { activated: false }) ?? (judgeShellLine(command, { activated: true }) !== null && (await salesforceActivated($)) ? judgeShellLine(command, { activated: true }) : null)
  if (named !== null) return { decision: 'ask' as const, reason: guardReason(named) }
  if ((await read($, salesforceTainted)) && isNetworkLooking(command)) return { decision: 'ask' as const, reason: networkReason() }
  return below
}

// Where a path lands, or undefined when it can't be placed. A file not there yet lands in its folder.
async function salesforcePlaced($: EngineInterface, path: string): Promise<string | undefined> {
  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own?.realPath !== undefined) return own.realPath
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (cut < 0) return undefined
  const folder = await $.fs.stat(path.slice(0, cut + 1), { resolve: true }).catch(() => undefined)
  return folder?.realPath === undefined ? undefined : `${folder.realPath.replace(/[\\/]$/, '')}/${path.slice(cut + 1)}`
}

const WRITING_FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

async function guardFileTool($: EngineInterface, e: { tool: string; input: unknown }, next: (input: never) => Promise<CheckVerdict>) {
  salesforceGuardRuns += 1
  const below = await next(e as never)
  if (below.decision === 'deny') return below
  const tool = String(e.tool)
  const isWrite = WRITING_FILE_TOOLS.has(tool)
  const paths = filePathsOf(e.input)
  const spots = [...paths, ...filePatternsOf(e.input, tool)]
  for (const path of paths) {
    const real = await salesforcePlaced($, path)
    if (real !== undefined) spots.push(real)
  }
  // A search reads everything under its root, so a root that holds a protected folder is judged like the folder.
  const roots: string[] = []
  const base = await $.session.root()
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (tool === 'Grep' || tool === 'Glob') {
    const given = (e.input as { path?: unknown } | null)?.path
    const searched = typeof given === 'string' && given.length > 0 ? given : base
    roots.push(searched)
    const placed = await salesforcePlaced($, searched)
    if (placed !== undefined) roots.push(placed)
    for (const pattern of filePatternsOf(e.input, tool)) {
      const start = patternRoot(pattern)
      if (start !== null) roots.push(start)
    }
  }
  const judgedRoots = (activated: boolean) => roots.map(root => judgeSearchRoot(root, { activated, home, base })).find(named => named !== null) ?? null
  for (const spot of spots) {
    const always = judgeFilePath(spot, { activated: false, isWrite })
    if (always !== null) return { decision: 'deny' as const, reason: fileDenyReason(always) }
  }
  const alwaysRoot = judgedRoots(false)
  if (alwaysRoot !== null) return { decision: 'deny' as const, reason: fileDenyReason(alwaysRoot) }
  const guardedRoot = judgedRoots(true)
  if (guardedRoot !== null && (await salesforceActivated($))) return { decision: 'deny' as const, reason: fileDenyReason(guardedRoot) }
  const guarded = spots.map(spot => judgeFilePath(spot, { activated: true, isWrite })).find(named => named !== null)
  if (guarded !== undefined && guarded !== null && (await salesforceActivated($))) return { decision: 'deny' as const, reason: fileDenyReason(guarded) }
  return below
}

// Tools that only read from their own service. Everything else outside Topia can send, post, or navigate.
const MCP_READ_ONLY = /__(?:get|list|read|describe|whoami|resolve)(?:_|$)/
const MCP_OWN = /^mcp__(?:plugin_topia-sf_|topia-sf__)/

// After a session has read org values, any other MCP tool that isn't read-only is a way out, so a person is asked.
async function guardMcpTool($: EngineInterface, e: { tool: string }, next: (input: never) => Promise<CheckVerdict>) {
  salesforceGuardRuns += 1
  const below = await next(e as never)
  if (below.decision === 'deny') return below
  const tool = String(e.tool)
  if (MCP_OWN.test(tool) || MCP_READ_ONLY.test(tool)) return below
  return (await read($, salesforceTainted)) ? { decision: 'ask' as const, reason: networkReason() } : below
}

async function guardNetworkTool($: EngineInterface, e: { input: unknown }, next: (input: never) => Promise<CheckVerdict>) {
  salesforceGuardRuns += 1
  const below = await next(e as never)
  if (below.decision === 'deny') return below
  return (await read($, salesforceTainted)) ? { decision: 'ask' as const, reason: networkReason() } : below
}

// A machine that has never turned Salesforce on has no store file, so a project
// that never uses Salesforce spawns nothing. The file only rules Salesforce out:
// when it exists, the lock is still read through the runner, in the background.
async function salesforceMayBeOn($: EngineInterface): Promise<boolean> {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    return home === undefined ? true : await $.fs.exists(`${home}/${SALESFORCE_STORE_FILE}`)
  } catch {
    return true
  }
}

async function pressSalesforceEnable($: EngineInterface) {
  try {
    const root = await $.session.root()
    const pending = await read($, salesforcePendingEnable)
    const shown = confirmShownPath(pending?.projectRoot ?? null, root)
    if (!shown.ok) {
      $.ui.toast(shown.reason)
      return
    }
    const reply = (await salesforceRunner($, 'enable', { projectRoot: root, user: pending?.user ?? 'unknown' })) as { ok?: boolean; reason?: string } | null
    if (reply?.ok !== true) {
      $.ui.toast(reply?.reason ?? 'Could not turn Salesforce on. It is still off for this project.')
      return
    }
    await update($, salesforcePendingEnable, () => null)
    await refreshSalesforce($)
  } catch {
    $.ui.toast('Could not turn Salesforce on. It is still off for this project.')
  }
}

async function pressSalesforceContinue($: EngineInterface) {
  try {
    const band = await read($, salesforceBand)
    if (band === null || band.kind !== 'notice' || band.issue === undefined) return
    const status = await salesforceStatus($, await $.session.root())
    const live = viewBand({ lock: status.lock, session: status.session, ack: null, registeredOrgs: status.registeredOrgs, now: await $.clock.now() })
    if (live === null || !('issue' in live) || live.issue?.id !== band.issue.id || !showsContinue(band.issue.kind)) {
      $.ui.toast('That notice has changed. Read it again.')
      await refreshSalesforce($)
      return
    }
    const ack: SalesforceAck = {
      issueId: band.issue.id,
      kind: band.issue.kind,
      orgId: band.issue.orgId,
      user: band.issue.user,
      operationClass: band.issue.operationClass,
      ...hashesOf(status.session),
    }
    await update($, salesforceAck, () => ack)
    await refreshSalesforce($)
  } catch {
    $.ui.toast('Could not acknowledge that notice.')
  }
}

async function pressSalesforceDisable($: EngineInterface) {
  const stillOn = 'Could not turn Salesforce off. It is still on for this project.'
  try {
    const root = await $.session.root()
    const shown = confirmShownPath(await read($, salesforcePendingDisable), root)
    if (!shown.ok) {
      $.ui.toast(shown.reason)
      return
    }
    const reply = (await salesforceRunner($, 'disable', { projectRoot: root })) as { ok?: boolean } | null
    if (reply?.ok !== true) {
      $.ui.toast(stillOn)
      return
    }
    await update($, salesforcePendingDisable, () => null)
    await refreshSalesforce($)
    $.ui.toast(`Salesforce is off for ${root}.`)
  } catch {
    $.ui.toast(stillOn)
  }
}

async function disableSalesforce($: EngineInterface, args: string) {
  if (args.trim() === 'cancel') {
    await update($, salesforcePendingDisable, () => null)
    return { text: 'Salesforce stays on for this project.' }
  }
  const root = await $.session.root()
  const { lock } = await salesforceStatus($, root)
  if (lock.state === 'unreadable') return { text: `Salesforce could not read this project's lock, so nothing changed. ${lock.message}` }
  if (lock.state === 'off') return { text: `Salesforce is not on for ${root}.` }
  await update($, salesforcePendingDisable, () => root)
  return { text: `Turn Salesforce off for this project only:\n${root}\nOkay to continue applies only to that path. /topia-sf:disable cancel keeps it on.` }
}

async function enableSalesforce($: EngineInterface, userArg: string) {
  const root = await $.session.root()
  const { lock } = await salesforceStatus($, root)
  if (lock.state === 'unreadable') return { text: `Salesforce could not read this project's lock, so nothing changed. ${lock.message}` }
  if (lock.state === 'on') return { text: `Salesforce is already on for ${root}. /topia-sf:disable turns it off.` }
  await update($, salesforcePendingEnable, () => ({ projectRoot: root, user: userArg.trim().length > 0 ? userArg.trim() : 'unknown' }))
  return { text: `Enable Salesforce for this project only:\n${root}\nOkay to continue applies only to that path.` }
}

const SF_COMMAND_RE = new RegExp('^(?:topia-sf:)?(?:' + SF_COMMANDS.map(c => c.replace(/-/g, '\\-')).join('|') + ')$')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const isFirstStart = !(await read($, salesforceStarted))
    await update($, salesforceStarted, () => true)
    await update($, salesforceHeadless, () => !e.isInteractive)
    if (await salesforceMayBeOn($)) void startSalesforce($, isFirstStart)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await update($, salesforceMode, () => null)
    await update($, salesforceBrief, () => null)
    await update($, salesforceAck, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, salesforceMode, () => null)
    if ((await read($, salesforceBand)) !== null) void afterTurnSalesforce($)
    const result = await next(e)
    if (e.agentId === undefined && (await read($, salesforceBand)) !== null) void noticeGuardMissing($)
    return result
  })

  on('tool.call', { tool: 'mcp__topia-sf__sf_org_register' } as never, async ($, e) => registerSalesforceOrg($, e as unknown as { agentId?: string; target?: unknown })).catch(() => ({
    deny: 'Salesforce registration failed, so nothing was registered.',
  }))
  on('tool.call', { tool: 'mcp__topia-sf__sf_brief_confirm' } as never, async ($, e) => confirmSalesforceBrief($, e as unknown as { agentId?: string; briefId?: unknown })).catch(() => ({
    deny: 'The brief could not be confirmed, so it is not confirmed.',
  }))
  on('tool.call', { tool: 'mcp__topia-sf__sf_show_values' } as never, async ($, e) => showSalesforceValues($, e as unknown as Record<string, unknown> & { agentId?: string })).catch(() => ({
    deny: 'The values could not be shown, so none were.',
  }))
  on('tool.call', { tool: 'mcp__topia-sf__sf_ack_issue' } as never, async ($, e) => ackSalesforceIssue($, e as unknown as { agentId?: string; issueId?: unknown })).catch(() => ({
    deny: 'The notice could not be acknowledged, so it stays.',
  }))
  for (const tool of Object.keys(SALESFORCE_WRITE_TOOLS) as SalesforceWriteTool[]) {
    on('tool.call', { tool: ('mcp__topia-sf__' + tool) as never }, async ($, e) => salesforceWrite($, tool, e as unknown as Record<string, unknown> & { agentId?: string })).catch(() => ({
      deny: tool + ' failed. If it got as far as sending anything, the result is unknown, and it is not stopped. /topia-sf:verify reads it. Nothing is re-sent.',
    }))
  }
  on('tool.call', { tool: /^mcp__plugin_topia-sf_topia-salesforce__/ } as never, async ($, e, next) => stampSalesforceCall($, e as never, next as never)).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'The Salesforce stamp could not be written, so the call is refused.' },
  )

  on('tool.check', { tool: ['Bash', 'PowerShell', 'Monitor'] } as never, async ($, e, next) => guardShellLine($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))
  on('tool.check', { tool: ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'] } as never, async ($, e, next) => guardFileTool($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))
  on('tool.check', { tool: ['WebFetch', 'WebSearch'] } as never, async ($, e, next) => guardNetworkTool($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))
  on('tool.check', { tool: /^mcp__/ } as never, async ($, e, next) => guardMcpTool($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))

  on('command.run', { command: SF_COMMAND_RE } as never, async ($, e, next) => {
    const command = commandFromName(e.command)
    await update($, salesforceMode, () => (command !== null && e.origin.kind === 'composer' ? { mode: COMMAND_TOOLS[command].mode, command } : null))
    if ((await read($, salesforceBand)) !== null) void refreshSalesforce($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'enable' }, async ($, e) => enableSalesforce($, e.args))
  on('command.run', { command: 'topia-sf:enable' }, async ($, e) => enableSalesforce($, e.args))
  on('command.run', { command: 'disable' }, async ($, e) => disableSalesforce($, e.args))
  on('command.run', { command: 'topia-sf:disable' }, async ($, e) => disableSalesforce($, e.args))

  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    await update($, bandFocus, () => (e.plugin === 'topia-sf' ? (e.element ?? null) : null))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const focus = await read($, bandFocus)
    const sfBand = await read($, salesforceBand)
    const sfPending = await read($, salesforcePendingEnable)
    const sfPendingOff = await read($, salesforcePendingDisable)
    const showSf = sfBand !== null || sfPendingOff !== null || sfPending !== null
    if (!showSf) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const abouts: Record<string, string> = {}
    const described = (key: string, about: string) => {
      abouts[key] = about
      return { key, hover: { scope: scopeOf(key), underline: true } }
    }
    const value = (key: string, label: string, about: string, look: { color?: string; bold?: boolean } = {}, onPress?: () => unknown) => (
      <Button
        {...described(key, about)}
        plain
        onPress={async () => {
          await update($, bandFocus, () => key)
          await onPress?.()
        }}
      >
        <Text color={look.color} dimColor={look.color === undefined} bold={look.bold}>
          {label}
        </Text>
      </Button>
    )

    let salesforceRow = null
    if (sfPendingOff !== null) {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="yellow">{'Salesforce turn off for ' + sfPendingOff}</Text>
          <Button {...described('sf-disable', SALESFORCE_ABOUT.disable)} label="Okay to continue" variant="primary" onPress={() => pressSalesforceDisable($)} />
        </Box>
      )
    } else if (sfPending !== null && sfBand === null) {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="yellow">{'Salesforce enable for ' + sfPending.projectRoot}</Text>
          <Button {...described('sf-enable', SALESFORCE_ABOUT.enable)} label="Okay to continue" variant="primary" onPress={() => pressSalesforceEnable($)} />
        </Box>
      )
    } else if (sfBand?.kind === 'quiet') {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="cyan">Salesforce</Text>
          {sfBand.parts.map(part => value(part.key, part.text, part.about, { color: 'cyan' }))}
        </Box>
      )
    } else if (sfBand?.kind === 'notice') {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="yellow">{sfBand.text}</Text>
          {sfBand.canContinue ? <Button {...described('sf-continue', SALESFORCE_ABOUT.continue)} label="Okay to continue" onPress={() => pressSalesforceContinue($)} /> : null}
        </Box>
      )
    } else if (sfBand?.kind === 'stop') {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="red">{sfBand.text}</Text>
        </Box>
      )
    }
    const salesforceWarning = sfBand?.warning ? (
      <Box key="salesforce-warning" flexDirection="row">
        <Text color="yellow">{sfBand.warning}</Text>
      </Box>
    ) : null

    return (
      <Box flexDirection="column">
        {salesforceRow}
        {salesforceWarning}
        {aboutSlot({ Box, Text }, abouts, focus !== null ? abouts[focus] : undefined)}
      </Box>
    )
  })
}
