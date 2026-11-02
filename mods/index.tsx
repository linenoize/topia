import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, TextProps } from 'claude-code'

import { BYPASS_NOTE, GUARD_MISSING, UNSEEN, bypassText, isNewBypass, sentRequest } from './lib/compose-watch'
import { COMMIT, COMMIT_PUSH, NOT_A_REPO, PUSH, WRITING_TOOLS, parseStatus } from './lib/git-band'
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
import { COMMAND_TOOLS, commandFromName, effectiveMode, toolRefusal } from '../salesforce/service/modes'
import { writerLogoutCommand } from '../salesforce/service/contract'
import { ORG_TEXT_MARK, wrapOrgText } from '../salesforce/service/org-text'
import { stampInput, withoutStamp, type StampAck } from '../salesforce/service/stamp'
import {
  DEFAULT_PREFS,
  EMPTY_PROJECT,
  MOD_IDS,
  MODS,
  MODS_USAGE,
  NO_SETTINGS,
  PREFS_KEY,
  SOURCE_ABOUT,
  SOURCE_LABELS,
  USER_KEY,
  choose,
  defaultScope,
  flipped,
  parseModsArgs,
  projectModsKey,
  resolve,
  shouldRecap,
  summary,
} from './lib/mod-settings'
import type { Options } from './lib/mod-settings'
import { projectKey, projectName } from './lib/model-preset'
import {
  compare,
  contextText,
  decorations,
  describeSkill,
  isWritten,
  predict,
  ranSkill,
  skillColor,
  startTurn,
  toView,
  viewKey,
  withoutRouterSuggestion,
} from './lib/prompt-routing'
import { FAILED, composeText as hostsText, hostsKey, learnHosts, parseSsh } from './lib/remote-hosts'
import { DEFAULTS, IDS, RULES, composeText as ordersText, ordersKey, ordersStatus } from './lib/standing-orders'
import { joinStatus } from './lib/status'
import type { StatusSlot } from './lib/status'
import { filterHookText, formatUsage } from './lib/topia-quiet'
import { GIT_ABOUT, ORDERS_STATUS_ABOUT, ROUTING_ABOUT, gitParts, scopeOf, usageParts } from './lib/value-help'
import type {
  GitInfo,
  Host,
  HiddenReport,
  ModChoices,
  ModId,
  ModScope,
  ModSettings,
  ModsPrefs,
  OrderId,
  Orders,
  ProjectMods,
  RoutingView,
  SalesforceAck,
  SalesforceIssue,
  SalesforceLockState,
  SalesforceSession,
  SshTarget,
  UsageLine,
} from './types'

// Topia's Claude Code mods. Each has a userConfig switch in
// .claude-plugin/plugin.json (its default), and /mods turns one on or off
// for you (every project) or for this project, without a reload:
//   gitBand        changed / unpushed counts above the prompt, Commit and Push buttons
//   standingOrders per-project rules in the system prompt, /orders
//   remoteHosts    SSH hosts learned from ssh calls that worked, per project, /hosts (off by default)
//   quietReports   Topia's hook reports kept out of context, usage status line, /topia-activity
//   modelPreset    the model used last per project, restored at startup, /model-preset
//   promptRouting  the Topia skills a draft's wording points at, live above the prompt,
//                  then predicted vs ran; promptRoutingHint tells the model too; /routing
// The first session in a project (and the first onboard run there) asks which
// to keep in a row above the prompt; a recap row comes back every so often.
// A plugin registers each event once without a matcher, so the shared events
// below run every mod's part in turn, each gated on whether it is on now. The
// engine-facing code is all in this file; the logic it calls is in ./lib.

const gitInfo = atom({ plugin: 'topia', key: 'gitInfo' } as const, null)
const gitBandHidden = atom({ plugin: 'topia', key: 'gitBandHidden' } as const, false)
const standingOrders = atom({ plugin: 'topia', key: 'standingOrders' } as const, null)
const sshHosts = atom({ plugin: 'topia', key: 'sshHosts' } as const, {})
const quietHidden = atom({ plugin: 'topia', key: 'quietHidden' } as const, [])
const quietSavedChars = atom({ plugin: 'topia', key: 'quietSavedChars' } as const, 0)
const quietUsage = atom({ plugin: 'topia', key: 'quietUsage' } as const, null)
// Set on the session's first session.start, so a hot reload (which fires it
// again) neither asks about mods again nor switches the model mid-session.
const modelPresetApplied = atom({ plugin: 'topia', key: 'modelPresetApplied' } as const, false)
const routingLive = atom({ plugin: 'topia', key: 'routingLive' } as const, null)
const routingTurn = atom({ plugin: 'topia', key: 'routingTurn' } as const, null)
const routingHidden = atom({ plugin: 'topia', key: 'routingHidden' } as const, false)
const bandFocus = atom({ plugin: 'topia', key: 'bandFocus' } as const, null)
const modSettings = atom({ plugin: 'topia', key: 'modSettings' } as const, null)
const modsPrompt = atom({ plugin: 'topia', key: 'modsPrompt' } as const, null)
const modsScope = atom({ plugin: 'topia', key: 'modsScope' } as const, 'project')
const modsFocus = atom({ plugin: 'topia', key: 'modsFocus' } as const, null)
const modsPrefs = atom({ plugin: 'topia', key: 'modsPrefs' } as const, null)
const composeWatch = atom({ plugin: 'topia', key: 'composeWatch' } as const, UNSEEN)
const salesforceBand = atom({ plugin: 'topia', key: 'salesforceBand' } as const, null)
const salesforcePendingEnable = atom({ plugin: 'topia', key: 'salesforcePendingEnable' } as const, null)
const salesforcePendingDisable = atom({ plugin: 'topia', key: 'salesforcePendingDisable' } as const, null)
const salesforceAck = atom({ plugin: 'topia', key: 'salesforceAck' } as const, null)
const salesforceToolRegistered = atom({ plugin: 'topia', key: 'salesforceToolRegistered' } as const, false)
const salesforceMode = atom({ plugin: 'topia', key: 'salesforceMode' } as const, null)
const salesforceBrief = atom({ plugin: 'topia', key: 'salesforceBrief' } as const, null)
const salesforceTainted = atom({ plugin: 'topia', key: 'salesforceTainted' } as const, false)
const salesforceGuardMissing = atom({ plugin: 'topia', key: 'salesforceGuardMissing' } as const, false)
const salesforceHeadless = atom({ plugin: 'topia', key: 'salesforceHeadless' } as const, false)

const ORDERS_PANE = 'topia-standing-orders'
const HOSTS_PANE = 'topia-remote-hosts'
const ACTIVITY_PANE = 'topia-activity'
const MODS_PANE = 'topia-mods'
// Before /mods, /routing kept its own global switch; read once and folded in.
const ROUTING_OFF_KEY = 'promptRouting:off'

const COMMANDS = [
  { name: 'mods', description: 'Turn Topia mods on or off, for you or for this project', argumentHint: '[mod] [on|off|reset] [--project|--user]' },
  { name: 'routing', description: 'Turn the Topia prompt-routing band and highlights on or off', argumentHint: '[on|off]' },
  { name: 'orders', description: 'Show or toggle your standing orders for this project', argumentHint: '[fanout|ledger|scripts|commit] [on|off]' },
  { name: 'hosts', description: 'Show the SSH hosts the model knows about; forget one', argumentHint: '[forget <user@host>]' },
  { name: 'topia-activity', description: "Show the Topia hook reports kept out of the model's context" },
  { name: 'model-preset', description: 'Show or forget the model remembered for this project', argumentHint: '[forget]' },
] as const

// Module state: a reload clears it and each mod sets its slot again from
// session.start.
const statusSlots: Partial<Record<StatusSlot, string>> = {}

function setStatus($: EngineInterface, slot: StatusSlot, text: string | undefined) {
  if (text === undefined || text.length === 0) delete statusSlots[slot]
  else statusSlots[slot] = text
  $.ui.status(joinStatus(statusSlots))
}

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

function offText(id: ModId): string {
  return `${MODS[id].label} is off. /mods ${MODS[id].short} on turns it on (for you; add --project for this project only).`
}

// ── mods on and off ─────────────────────────────────────────────────────────

async function loadProject($: EngineInterface): Promise<ProjectMods> {
  const saved = (await $.store.get(projectModsKey(await $.session.root()))) as Partial<ProjectMods> | undefined
  return { ...EMPTY_PROJECT, ...(saved ?? {}) }
}

async function saveProject($: EngineInterface, change: (project: ProjectMods) => ProjectMods) {
  const next = change(await loadProject($))
  await $.store.set(projectModsKey(await $.session.root()), next)
  return next
}

async function loadPrefs($: EngineInterface): Promise<ModsPrefs> {
  const saved = (await $.store.get(PREFS_KEY)) as Partial<ModsPrefs> | undefined
  const prefs = { ...DEFAULT_PREFS, ...(saved ?? {}) }
  await update($, modsPrefs, () => prefs)
  return prefs
}

async function savePrefs($: EngineInterface, change: (prefs: ModsPrefs) => ModsPrefs) {
  const next = change(await loadPrefs($))
  await $.store.set(PREFS_KEY, next)
  await update($, modsPrefs, () => next)
  return next
}

// The /config rows an organization's policy fixes: those switches win.
async function lockedMods($: EngineInterface): Promise<ModId[]> {
  try {
    const rows = await $.config.list()
    return MOD_IDS.filter(id => rows.some(row => row.key === `topia.${id}` && row.isLocked))
  } catch {
    return []
  }
}

async function loadModSettings($: EngineInterface): Promise<ModSettings> {
  const user = { ...(((await $.store.get(USER_KEY)) ?? {}) as ModChoices) }
  const wasOff = await $.store.get(ROUTING_OFF_KEY)
  if (wasOff !== undefined) {
    if (wasOff === true && user.promptRouting === undefined) user.promptRouting = false
    await $.store.set(USER_KEY, user)
    await $.store.delete(ROUTING_OFF_KEY)
  }
  const settings: ModSettings = { user, project: (await loadProject($)).choices, locked: await lockedMods($) }
  await update($, modSettings, () => settings)
  return settings
}

// ── git band ────────────────────────────────────────────────────────────────

async function refreshGit($: EngineInterface) {
  const cwd = await $.session.cwd()
  let next: GitInfo
  try {
    const ran = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { cwd, timeoutMs: 10_000 })
    next = ran.exitCode === 0 ? parseStatus(ran.stdout) : NOT_A_REPO
  } catch {
    next = NOT_A_REPO
  }
  await update($, gitInfo, () => next)
}

// ── standing orders ─────────────────────────────────────────────────────────

async function loadOrders($: EngineInterface) {
  const saved = (await $.store.get(ordersKey(await $.session.root()))) as Partial<Orders> | undefined
  const merged: Orders = { ...DEFAULTS, ...(saved ?? {}) }
  await update($, standingOrders, () => merged)
  setStatus($, 'orders', ordersStatus(merged))
  return merged
}

async function saveOrders($: EngineInterface, next: Orders) {
  await $.store.set(ordersKey(await $.session.root()), next)
  await update($, standingOrders, () => next)
  setStatus($, 'orders', ordersStatus(next))
}

// ── compose bypass ──────────────────────────────────────────────────────────

// What Topia's prompt.compose hook would add now, by name; empty when nothing.
async function composeParts($: EngineInterface, config: Options): Promise<string[]> {
  const parts: string[] = []
  const orders = (await isOn($, config, 'standingOrders')) ? await read($, standingOrders) : null
  if (orders !== null && ordersText(orders) !== null) parts.push('standing orders')
  if ((await isOn($, config, 'remoteHosts')) && hostsText(await read($, sshHosts)) !== null) parts.push('known SSH hosts')
  return parts
}

async function noticeBypass($: EngineInterface, config: Options) {
  const missing = await composeParts($, config)
  if (!isNewBypass(await read($, composeWatch), missing)) return
  await update($, composeWatch, watch => ({ ...watch, isBypassed: true }))
  $.ui.toast(bypassText(missing), { timeoutMs: 12000 })
}

async function bypassNote($: EngineInterface): Promise<string> {
  return (await read($, composeWatch)).isBypassed ? `\n${BYPASS_NOTE}` : ''
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

// Reads the latest value at press time, never the one a drawing captured.
async function toggleOrder($: EngineInterface, id: OrderId) {
  const latest = (await read($, standingOrders)) ?? DEFAULTS
  await saveOrders($, { ...latest, [id]: !latest[id] })
}

// ── remote hosts ────────────────────────────────────────────────────────────

async function loadHosts($: EngineInterface) {
  const saved = ((await $.store.get(hostsKey(await $.session.root()))) ?? {}) as Record<string, Host>
  await update($, sshHosts, () => saved)
  return saved
}

async function forgetHost($: EngineInterface, id: string) {
  const latest = { ...(await loadHosts($)) }
  delete latest[id]
  await $.store.set(hostsKey(await $.session.root()), latest)
  await update($, sshHosts, () => latest)
}

async function learnFrom($: EngineInterface, targets: SshTarget[]) {
  const today = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const { known, learned } = learnHosts(await loadHosts($), targets, today)
  await $.store.set(hostsKey(await $.session.root()), known)
  await update($, sshHosts, () => known)
  for (const id of learned) {
    $.ui.toast(`topia: learned ssh host ${id}${known[id]?.key ? ' (key)' : ''}`)
  }
}

// ── quiet reports ───────────────────────────────────────────────────────────

async function refreshUsage($: EngineInterface, cachePercent?: number) {
  const now = await $.session.usage()
  const previous = await read($, quietUsage)
  const line: UsageLine = {
    contextPercent: now.context.percent,
    cachePercent: cachePercent ?? previous?.cachePercent,
    usd: now.cost?.usd,
    fiveHourPercent: now.rateLimits.find(limit => limit.kind === 'five_hour')?.percentUsed,
  }
  await update($, quietUsage, () => line)
  setStatus($, 'usage', formatUsage(line, await read($, quietSavedChars)))
}

// ── model preset ────────────────────────────────────────────────────────────

async function rememberModel($: EngineInterface) {
  const root = await $.session.root()
  const model = await $.session.model()
  if (model && (await $.store.get(projectKey(root))) !== model) {
    await $.store.set(projectKey(root), model)
  }
}

async function applyModel($: EngineInterface) {
  const root = await $.session.root()
  const saved = await $.store.get(projectKey(root))
  const current = await $.session.model()
  if (typeof saved !== 'string' || saved === current) return

  await $.command.run({ command: 'model', args: saved })
  $.ui.toast(`topia: ${projectName(root)} last used ${saved}; switched (was ${current}).`, { timeoutMs: 8000 })
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
const MCP_OWN = /^mcp__(?:plugin_topia_|topia__)/

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
  return { text: `Turn Salesforce off for this project only:\n${root}\nOkay to continue applies only to that path. /topia:sf:disable cancel keeps it on.` }
}

async function enableSalesforce($: EngineInterface, userArg: string) {
  const root = await $.session.root()
  const { lock } = await salesforceStatus($, root)
  if (lock.state === 'unreadable') return { text: `Salesforce could not read this project's lock, so nothing changed. ${lock.message}` }
  if (lock.state === 'on') return { text: `Salesforce is already on for ${root}. /topia:sf:disable turns it off.` }
  await update($, salesforcePendingEnable, () => ({ projectRoot: root, user: userArg.trim().length > 0 ? userArg.trim() : 'unknown' }))
  return { text: `Enable Salesforce for this project only:\n${root}\nOkay to continue applies only to that path.` }
}

// ── prompt routing ──────────────────────────────────────────────────────────

// Module state: what the band last showed, so a keystroke that changes
// nothing in it does not redraw it.
let routingShown = ''

async function showLive($: EngineInterface, view: RoutingView | null) {
  const key = viewKey(view)
  if (key === routingShown) return
  routingShown = key
  await update($, routingLive, () => view)
}

async function recordRan($: EngineInterface, name: string) {
  await update($, routingTurn, turn =>
    turn === null || turn.isDone || turn.ran.includes(name) ? turn : { ...turn, ran: [...turn.ran, name] },
  )
}

// ── mods on and off: what each switch does now ──────────────────────────────

async function settingsNow($: EngineInterface): Promise<ModSettings> {
  return (await read($, modSettings)) ?? NO_SETTINGS
}

async function isOn($: EngineInterface, config: Options, id: ModId): Promise<boolean> {
  return resolve(id, config, await settingsNow($)).isOn
}

async function isHintOn($: EngineInterface, config: Options): Promise<boolean> {
  return config.promptRoutingHint !== false && (await isOn($, config, 'promptRouting'))
}

// What turning a mod on or off does now, without a reload: start what it
// shows, clear what it left behind, and bring back a row hidden this session.
async function applyFlips($: EngineInterface, flips: { id: ModId; isOn: boolean }[]) {
  for (const { id, isOn: turnedOn } of flips) {
    if (id === 'gitBand' && turnedOn) {
      await update($, gitBandHidden, () => false)
      void refreshGit($)
    }
    if (id === 'standingOrders') {
      if (turnedOn) await loadOrders($)
      else setStatus($, 'orders', undefined)
    }
    if (id === 'remoteHosts' && turnedOn) await loadHosts($)
    if (id === 'quietReports') {
      if (turnedOn) void refreshUsage($)
      else setStatus($, 'usage', undefined)
    }
    if (id === 'promptRouting') {
      await update($, routingHidden, () => false)
      if (!turnedOn) {
        await showLive($, null)
        await update($, routingTurn, () => null)
      }
    }
  }
}

// Sets each mod at one scope (a boolean, 'toggle', or undefined to clear)
// and saves that scope. A mod the policy locks is left as it is.
async function setMods(
  $: EngineInterface,
  config: Options,
  scope: ModScope,
  ids: readonly ModId[],
  value: boolean | undefined | 'toggle',
): Promise<ModSettings> {
  const before = (await read($, modSettings)) ?? (await loadModSettings($))
  let after = before
  for (const id of ids) {
    if (before.locked.includes(id)) continue
    const next = value === 'toggle' ? !resolve(id, config, after).isOn : value
    after = choose(after, scope, id, next)
  }
  if (scope === 'user') await $.store.set(USER_KEY, after.user)
  else await saveProject($, project => ({ ...project, choices: after.project, isConfirmed: true }))
  await update($, modSettings, () => after)
  await applyFlips($, flipped(config, before, after))
  return after
}

async function forgetProject($: EngineInterface, config: Options): Promise<string> {
  const root = await $.session.root()
  const before = await settingsNow($)
  for (const key of [projectModsKey(root), ordersKey(root), hostsKey(root), projectKey(root)]) await $.store.delete(key)
  const after = await loadModSettings($)
  await applyFlips($, flipped(config, before, after))
  if (await isOn($, config, 'standingOrders')) await loadOrders($)
  await update($, sshHosts, () => ({}))
  return root
}

async function openModsPane($: EngineInterface) {
  await update($, modsPrompt, () => null)
  await saveProject($, project => ({ ...project, isConfirmed: true }))
  await loadPrefs($)
  await $.ui.open({ id: MODS_PANE, title: 'Topia mods', focus: true, closeOnEscape: true, holdToasts: true })
}

// The first session in a project asks which mods to keep there; after that,
// a recap comes back every 10 sessions and 14 days at most.
async function askAboutMods($: EngineInterface) {
  const now = await $.clock.now()
  const project = await loadProject($)
  const prefs = await savePrefs($, saved => ({
    ...saved,
    sessionsSinceRecap: saved.sessionsSinceRecap + 1,
    recapAt: saved.recapAt === 0 ? now : saved.recapAt,
  }))
  const ask = !project.isConfirmed && prefs.askNewProjects ? 'first-run' : shouldRecap(prefs, now) ? 'recap' : null
  await update($, modsPrompt, () => ask)
}

// ── hooks ───────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const config: Options = options

  on('session.start', async ($, e, next) => {
    const isFirstStart = !(await read($, modelPresetApplied))
    await update($, modelPresetApplied, () => true)
    await update($, salesforceHeadless, () => !e.isInteractive)

    for (const spec of COMMANDS) await $.command.register(spec)
    await loadModSettings($)

    if (await isOn($, config, 'gitBand')) void refreshGit($)
    if (await isOn($, config, 'standingOrders')) await loadOrders($)
    if (await isOn($, config, 'remoteHosts')) await loadHosts($)
    if (await isOn($, config, 'quietReports')) void refreshUsage($)
    if (await salesforceMayBeOn($)) void startSalesforce($, isFirstStart)
    // A reload clears the slots; this clears a line a mod now off left behind.
    $.ui.status(joinStatus(statusSlots))

    if (isFirstStart && e.isInteractive) await askAboutMods($)

    const started = await next(e)
    if (isFirstStart && e.isInteractive && (await isOn($, config, 'modelPreset'))) void applyModel($)

    return started
  })

  on('session.end', async ($, e, next) => {
    // Taint stays: what a session read doesn't leave it because the conversation was cleared.
    await update($, salesforceMode, () => null)
    await update($, salesforceBrief, () => null)
    await update($, salesforceAck, () => null)
    if (await isOn($, config, 'modelPreset')) await rememberModel($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (tool === 'Agent' && (await isOn($, config, 'promptRouting'))) {
      const agent = ranSkill((e as { subagent_type?: unknown }).subagent_type as string | undefined)
      if (agent !== null) await recordRan($, agent)
    }

    const ran = await next(e)
    if (WRITING_TOOLS.has(tool) && (await isOn($, config, 'gitBand'))) void refreshGit($)

    const command = (e as { command?: unknown }).command
    const succeeded = ran.deny === undefined && ran.isError !== true && !FAILED.test(ran.text ?? '')
    if (succeeded && (tool === 'Bash' || tool === 'PowerShell') && typeof command === 'string' && (await isOn($, config, 'remoteHosts'))) {
      // The remote command may hold `;` or `|` inside quotes, which the segment
      // split cuts, so sudo is judged on the whole line.
      const targets = parseSsh(command).map(target => ({ ...target, remote: command }))
      if (targets.length > 0) await learnFrom($, targets)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    // First, so nothing later in this hook can leave a mode standing.
    if (e.agentId === undefined) await update($, salesforceMode, () => null)
    if (await isOn($, config, 'gitBand')) void refreshGit($)
    if ((await read($, salesforceBand)) !== null) void afterTurnSalesforce($)
    const result = await next(e)
    if (e.agentId === undefined) {
      if (await isOn($, config, 'quietReports')) {
        const turn = e.usage
        const input = turn ? turn.input_tokens + turn.cache_read_input_tokens + turn.cache_creation_input_tokens : 0
        void refreshUsage($, turn && input > 0 ? (turn.cache_read_input_tokens / input) * 100 : undefined)
      }
      // The /model picker settles after its command returns, so the choice is
      // read again once each main-thread turn ends, and when the session ends.
      if (await isOn($, config, 'modelPreset')) await rememberModel($)
      await update($, routingTurn, turn => (turn === null ? null : { ...turn, isDone: true }))
      // A request went out, so a system prompt was rendered: if Topia's compose
      // hook never ran this session, a plugin ahead of it sent the event past.
      if (sentRequest(e)) await noticeBypass($, config)
      if (sentRequest(e) && (await read($, salesforceBand)) !== null) void noticeGuardMissing($)
    }

    return result
  })

  // ── mods ──

  on('command.run', { command: 'mods' }, async ($, e) => {
    const asked = parseModsArgs(e.args)
    if (asked.kind === 'error') return { text: asked.text }
    if (asked.kind === 'open') {
      await openModsPane($)
      return { text: `Topia mods: ${summary(config, await settingsNow($))}. The pane is open.` }
    }
    if (asked.kind === 'forget-project') {
      const root = await forgetProject($, config)
      return {
        text: `Forgot Topia's data for ${projectName(root)}: its mod choices, standing orders, SSH hosts and model. Now: ${summary(config, await settingsNow($))}.`,
      }
    }

    const settings = (await read($, modSettings)) ?? (await loadModSettings($))
    const locked = asked.ids.filter(id => settings.locked.includes(id))
    const scope = asked.scope ?? defaultScope(settings, asked.ids[0] ?? 'gitBand')
    const after = await setMods($, config, scope, asked.ids, asked.value)
    const where = scope === 'project' ? `this project (${projectName(await $.session.root())})` : 'you (every project)'
    const names = asked.ids.filter(id => !locked.includes(id)).map(id => MODS[id].label)
    const verb = asked.value === undefined ? 'reset' : asked.value === 'toggle' ? 'switched' : asked.value ? 'on' : 'off'
    const lockNote = locked.length > 0 ? ` ${locked.map(id => MODS[id].label).join(', ')}: locked by your organization's policy.` : ''

    return {
      text: `${names.length > 0 ? `${names.join(', ')} ${verb} for ${where}.` : 'Nothing changed.'}${lockNote} Now: ${summary(config, after)}.`,
    }
  })

  on('tool.call', { tool: 'mcp__topia__sf_org_register' } as never, async ($, e) => registerSalesforceOrg($, e as unknown as { agentId?: string; target?: unknown })).catch(() => ({
    deny: 'Salesforce registration failed, so nothing was registered.',
  }))
  on('tool.call', { tool: 'mcp__topia__sf_brief_confirm' } as never, async ($, e) => confirmSalesforceBrief($, e as unknown as { agentId?: string; briefId?: unknown })).catch(() => ({
    deny: 'The brief could not be confirmed, so it is not confirmed.',
  }))
  on('tool.call', { tool: 'mcp__topia__sf_show_values' } as never, async ($, e) => showSalesforceValues($, e as unknown as Record<string, unknown> & { agentId?: string })).catch(() => ({
    deny: 'The values could not be shown, so none were.',
  }))
  on('tool.call', { tool: 'mcp__topia__sf_ack_issue' } as never, async ($, e) => ackSalesforceIssue($, e as unknown as { agentId?: string; issueId?: unknown })).catch(() => ({
    deny: 'The notice could not be acknowledged, so it stays.',
  }))
  for (const tool of Object.keys(SALESFORCE_WRITE_TOOLS) as SalesforceWriteTool[]) {
    on('tool.call', { tool: `mcp__topia__${tool}` } as never, async ($, e) => salesforceWrite($, tool, e as unknown as Record<string, unknown> & { agentId?: string })).catch(() => ({
      deny: `${tool} failed. If it got as far as sending anything, the result is unknown, and it is not stopped. /topia:sf:verify reads it. Nothing is re-sent.`,
    }))
  }
  on('tool.call', { tool: /^mcp__plugin_topia_topia-salesforce__/ } as never, async ($, e, next) => stampSalesforceCall($, e as never, next as never)).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'The Salesforce stamp could not be written, so the call is refused.' },
  )

  // Never gated on a mod switch, and a failure denies. A speed bump, not a boundary: docs/salesforce/README.md.
  on('tool.check', { tool: ['Bash', 'PowerShell', 'Monitor'] } as never, async ($, e, next) => guardShellLine($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))
  on('tool.check', { tool: ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'] } as never, async ($, e, next) => guardFileTool($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))
  on('tool.check', { tool: ['WebFetch', 'WebSearch'] } as never, async ($, e, next) => guardNetworkTool($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))
  on('tool.check', { tool: /^mcp__/ } as never, async ($, e, next) => guardMcpTool($, e as never, next as never)).catch(() => ({ decision: 'deny' as const, reason: SALESFORCE_GUARD_FAILED }))

  // Mode: only a command typed at the prompt sets it, and anything else clears it.
  on('command.run', { command: /^(?:topia:)?sf:/ } as never, async ($, e, next) => {
    const command = commandFromName(e.command)
    await update($, salesforceMode, () => (command !== null && e.origin.kind === 'composer' ? { mode: COMMAND_TOOLS[command].mode, command } : null))
    if ((await read($, salesforceBand)) !== null) void refreshSalesforce($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'sf:enable' }, async ($, e) => enableSalesforce($, e.args))
  on('command.run', { command: 'topia:sf:enable' }, async ($, e) => enableSalesforce($, e.args))
  on('command.run', { command: 'sf:disable' }, async ($, e) => disableSalesforce($, e.args))
  on('command.run', { command: 'topia:sf:disable' }, async ($, e) => disableSalesforce($, e.args))

  on('ui.focus', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId === MODS_PANE && e.plugin === 'topia') await update($, modsFocus, () => e.element ?? null)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: MODS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const settings = await settingsNow($)
    const scope = await read($, modsScope)
    const prefs = (await read($, modsPrefs)) ?? DEFAULT_PREFS
    const focus = await read($, modsFocus)
    const hidden = { gitBand: await read($, gitBandHidden), promptRouting: await read($, routingHidden) } as Partial<Record<ModId, boolean>>
    const here = projectName(await $.session.root())

    const abouts: Record<string, string> = {}
    const described = (key: string, about: string) => {
      abouts[key] = about
      return { key, hover: { scope: scopeOf(key), underline: true } }
    }
    const toggle = async (id: ModId) => {
      if (settings.locked.includes(id)) {
        $.ui.toast(`topia: ${MODS[id].label} is locked by your organization's policy.`)
        return
      }
      const latest = await settingsNow($)
      if (scope === 'user' && latest.project[id] !== undefined) {
        $.ui.toast(`topia: this project has its own choice for ${MODS[id].label}; switch "Save for" to this project, or clear it.`)
        return
      }
      await setMods($, config, scope, [id], 'toggle')
    }
    const usage = usageParts(await read($, quietUsage), await read($, quietSavedChars))
    const ordersOn = statusSlots.orders

    return (
      <Box flexDirection="column">
        <Box key="scope" flexDirection="row" gap={1}>
          <Text dimColor>Save for</Text>
          <Button
            {...described('scope-project', `Choices apply in ${here} only and beat your all-projects choices.`)}
            label={`this project (${here})`}
            hotkey="p"
            variant={scope === 'project' ? 'primary' : 'secondary'}
            onPress={() => update($, modsScope, () => 'project')}
          />
          <Button
            {...described('scope-user', 'Choices apply in every project that has no choice of its own.')}
            label="all my projects"
            hotkey="u"
            variant={scope === 'user' ? 'primary' : 'secondary'}
            onPress={() => update($, modsScope, () => 'user')}
          />
        </Box>
        {MOD_IDS.map((id, index) => {
          const { isOn: modOn, source } = resolve(id, config, settings)
          return (
            <Box key={`row-${id}`} flexDirection="row" gap={1}>
              <Button
                {...described(`mod-${id}`, MODS[id].about)}
                hotkey={String(index + 1)}
                label={modOn ? 'on ' : 'off'}
                variant={modOn ? 'primary' : 'secondary'}
                onPress={() => toggle(id)}
              />
              <Text dimColor={!modOn}>{MODS[id].label}</Text>
              <Button {...described(`source-${id}`, SOURCE_ABOUT[source])} plain onPress={() => update($, modsFocus, () => `source-${id}`)}>
                <Text dimColor>
                  {SOURCE_LABELS[source]}
                  {hidden[id] ? ' · hidden this session' : ''}
                </Text>
              </Button>
            </Box>
          )
        })}
        {(usage.length > 0 || ordersOn !== undefined) && (
          <Box key="status" flexDirection="row" gap={1}>
            <Text dimColor>Status line:</Text>
            {ordersOn !== undefined && (
              <Button {...described('status-orders', ORDERS_STATUS_ABOUT)} plain onPress={() => update($, modsFocus, () => 'status-orders')}>
                <Text dimColor>{ordersOn}</Text>
              </Button>
            )}
            {usage.map(part => (
              <Button {...described(part.key, part.about)} plain onPress={() => update($, modsFocus, () => part.key)}>
                <Text dimColor>{part.text}</Text>
              </Button>
            ))}
          </Box>
        )}
        <Box key="actions" flexDirection="row" gap={1}>
          <Button
            {...described('clear-project', `Drops ${here}'s own choices, so your all-projects choices apply here.`)}
            label="Clear this project's choices"
            plain
            onPress={async () => {
              await setMods($, config, 'project', MOD_IDS, undefined)
            }}
          />
          <Button
            {...described('ask-new', 'Whether a new project asks which mods to keep the first time you open it.')}
            label={prefs.askNewProjects ? 'Stop asking in new projects' : 'Ask in new projects'}
            plain
            onPress={() => savePrefs($, saved => ({ ...saved, askNewProjects: !saved.askNewProjects }))}
          />
          <Button
            {...described('recap', 'Whether a reminder of these settings shows every 10 sessions and 14 days.')}
            label={prefs.isRecapOff ? 'Remind me now and then' : 'No more reminders'}
            plain
            onPress={() => savePrefs($, saved => ({ ...saved, isRecapOff: !saved.isRecapOff }))}
          />
        </Box>
        {aboutSlot({ Box, Text }, abouts, focus !== null ? abouts[focus] : undefined)}
        <Text dimColor>{MODS_USAGE}</Text>
      </Box>
    )
  })

  // ── prompt routing ──

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (!(await isOn($, config, 'promptRouting'))) return box

    const prediction = predict(box.text)
    await showLive($, toView(prediction))
    const runs = decorations(prediction)

    return runs.length === 0 ? box : { ...box, decorations: [...(box.decorations ?? []), ...runs] }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!isWritten(e.origin) || !(await isOn($, config, 'promptRouting'))) return next(e)

    const view = toView(predict(e.text))
    await showLive($, null)
    await update($, bandFocus, () => null)
    // Typed over a running turn, it waits; that turn keeps its own tally.
    if (e.turnId === undefined) await update($, routingTurn, () => (view === null ? null : startTurn(view)))
    if (view === null || !(await isHintOn($, config))) return next(e)

    return next({ ...e, context: [...(e.context ?? []), contextText(view)] })
  })

  on('skill.prompt', async ($, e, next) => {
    const name = ranSkill(e.skill)
    if (name !== null && (await isOn($, config, 'promptRouting'))) await recordRan($, name)
    // The first onboard run in a project asks about mods too.
    if (name === 'onboard') {
      const project = await loadProject($)
      if (!project.isOnboardAsked) {
        await saveProject($, saved => ({ ...saved, isOnboardAsked: true }))
        await update($, modsPrompt, () => 'onboard')
      }
    }

    return next(e)
  })

  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    await update($, bandFocus, () => (e.plugin === 'topia' ? (e.element ?? null) : null))

    return next(e)
  })

  on('command.run', { command: 'routing' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const settings = (await read($, modSettings)) ?? (await loadModSettings($))
    const value = arg === 'off' ? false : arg === 'on' ? true : 'toggle'
    const after = await setMods($, config, defaultScope(settings, 'promptRouting'), ['promptRouting'], value)
    const { isOn: routingOn, source } = resolve('promptRouting', config, after)
    const hintOff = options.promptRoutingHint === false ? ' The model hint is off (promptRoutingHint in /config).' : ''
    const lock = source === 'locked' ? " It is locked by your organization's policy." : ''

    return {
      text: routingOn
        ? `Prompt routing is on.${hintOff}${lock}`
        : `Prompt routing is off: no band, no highlights, nothing added for the model. /routing on brings it back.${lock}`,
    }
  })

  on('prompt.compose', async ($, e, next) => {
    // Marked before next, so a failure beneath still counts as having run here.
    if (!(await read($, composeWatch)).isComposed) await update($, composeWatch, () => ({ isComposed: true, isBypassed: false }))
    const composed = await next(e)
    const sections = [...composed.sections]

    const current = (await isOn($, config, 'standingOrders')) ? await read($, standingOrders) : null
    const rules = current === null ? null : ordersText(current)
    if (rules !== null) sections.push({ id: 'topia:standing-orders', text: rules, scope: 'session' as const })

    const known = (await isOn($, config, 'remoteHosts')) ? hostsText(await read($, sshHosts)) : null
    if (known !== null) sections.push({ id: 'topia:known-hosts', text: known, scope: 'session' as const })

    return sections.length === composed.sections.length ? composed : { sections }
  })

  // The intent-router hook's suggestion is dropped whatever the switches: the
  // band and the hint stand in for it, and /routing off means none at all.
  on('prompt.attachment', async ($, e, next) => {
    if (e.origin.kind !== 'hook') return next(e)

    const text = withoutRouterSuggestion(e.text)
    const filtered = text.length > 0 && (await isOn($, config, 'quietReports')) ? filterHookText(text) : null
    if (filtered === null) return text === e.text ? next(e) : { text: text.length > 0 ? text : null }

    const removed = e.text.length - (filtered.text?.length ?? 0)
    const report: HiddenReport = {
      event: e.origin.event,
      kind: filtered.kind,
      chars: removed,
      at: await $.clock.now(),
      text: e.text.slice(0, 4000),
    }
    await update($, quietHidden, list => [...list, report].slice(-30))
    await update($, quietSavedChars, total => total + removed)

    return { text: filtered.text }
  })

  // ── the band: mods prompt, prompt routing, git ──

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const settings = await settingsNow($)
    const ask = await read($, modsPrompt)

    const info = (await isOn($, config, 'gitBand')) ? await read($, gitInfo) : null
    const isClean = info === null || !info.isRepo || (info.changed === 0 && info.unpushed === 0)
    const showGit = !isClean && !(await read($, gitBandHidden))

    const isRouting = (await isOn($, config, 'promptRouting')) && !(await read($, routingHidden))
    const live = isRouting ? await read($, routingLive) : null
    const turn = isRouting && live === null ? await read($, routingTurn) : null
    const focus = await read($, bandFocus)
    const sfBand = await read($, salesforceBand)
    const sfPending = await read($, salesforcePendingEnable)
    const sfPendingOff = await read($, salesforcePendingDisable)
    const showSf = sfBand !== null || sfPendingOff !== null || sfPending !== null

    if (ask === null && !showGit && live === null && turn === null && !showSf) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const submit = (text: string) => () => $.prompt.submit({ text, asUser: true })
    const hideRouting = () => update($, routingHidden, () => true)

    // Every value carries a line on what it means, shown in the slot under
    // the band (aboutSlot).
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

    let modsRow = null
    if (ask !== null) {
      const here = projectName(await $.session.root())
      const chips = MOD_IDS.map(id => {
        const { isOn: modOn, source } = resolve(id, config, settings)
        const about = `${MODS[id].label}: ${MODS[id].about} (${modOn ? 'on' : 'off'}, ${SOURCE_LABELS[source]})`
        return ask === 'recap'
          ? value(`mods-${id}`, `${MODS[id].short} ${modOn ? '✓' : '✗'}`, about, modOn ? { color: 'green' } : {})
          : value(`mods-${id}`, `${MODS[id].short} ${modOn ? '✓' : '✗'}`, `${about} Press to switch it for ${here}.`, modOn ? { color: 'green' } : {}, () =>
              setMods($, config, 'project', [id], 'toggle'),
            )
      })
      const keep = async () => {
        await saveProject($, project => ({ ...project, isConfirmed: true }))
        await update($, modsPrompt, () => null)
      }
      const gotIt = async () => {
        const now = await $.clock.now()
        await savePrefs($, saved => ({ ...saved, recapAt: now, sessionsSinceRecap: 0 }))
        await update($, modsPrompt, () => null)
      }
      modsRow =
        ask === 'recap' ? (
          <Box key="mods" flexDirection="row" gap={1}>
            <Text color="cyan">topia mods</Text>
            {chips}
            <Text dimColor>· /mods changes them, for you or this project</Text>
            <Button {...described('mods-got-it', 'Hides this reminder until it is due again.')} label="Got it" plain onPress={gotIt} />
            <Button
              {...described('mods-no-recap', 'Stops these reminders; /mods turns them back on.')}
              label="Don't remind me"
              plain
              onPress={async () => {
                await savePrefs($, saved => ({ ...saved, isRecapOff: true }))
                await update($, modsPrompt, () => null)
              }}
            />
          </Box>
        ) : (
          <Box key="mods" flexDirection="row" gap={1}>
            <Text color="cyan">{ask === 'onboard' ? 'topia onboard · which mods here?' : `topia mods for ${here}?`}</Text>
            {chips}
            <Button {...described('mods-keep', `Keeps these for ${here}; /mods changes them any time.`)} label="Keep" variant="primary" onPress={keep} />
            <Button {...described('mods-choose', 'Opens the mods pane: save for this project or all your projects.')} label="More…" plain onPress={() => openModsPane($)} />
            <Button
              {...described('mods-no-ask', 'New projects stop asking; the reminder still comes now and then.')}
              label="Don't ask in new projects"
              plain
              onPress={async () => {
                await savePrefs($, saved => ({ ...saved, askNewProjects: false }))
                await keep()
              }}
            />
          </Box>
        )
    }

    const chip = (name: string, label: string, about: string, color?: 'cyan' | 'magenta' | 'yellow' | 'green', bold?: boolean) =>
      value(`route-${name}`, label, about, { color, bold })
    const skillAbout = (name: string, note?: string) => `${name}: ${describeSkill(name)}${note ? ` (${note})` : ''}`

    let routingRow = null
    if (live !== null) {
      routingRow = (
        <Box key="routing" flexDirection="row" gap={1}>
          <Text dimColor>topia →</Text>
          {live.skills.map((skill, index) =>
            chip(skill.name, skill.name, skillAbout(skill.name, `matched ${skill.keywords.join(', ')}`), skillColor(index), skill.isExplicit),
          )}
          {live.chain.length > 0 && value('routing-chain', `then ${live.chain.join(' → ')}`, ROUTING_ABOUT.chain)}
          <Button {...described('routing-hide', ROUTING_ABOUT.hide)} label="Hide" plain onPress={hideRouting} />
        </Box>
      )
    } else if (turn !== null) {
      const { hit, chained, extra } = compare(turn)
      routingRow = (
        <Box key="routing" flexDirection="row" gap={1}>
          <Text dimColor>{turn.isDone ? 'topia predicted' : 'topia →'}</Text>
          {turn.predicted.map((name, index) =>
            !turn.isDone
              ? chip(name, name, skillAbout(name), skillColor(index))
              : hit.includes(name)
                ? chip(name, `${name} ✓`, skillAbout(name, ROUTING_ABOUT.hit), 'green')
                : chip(name, `${name} ✗`, skillAbout(name, ROUTING_ABOUT.missed)),
          )}
          {chained.length + extra.length > 0 && <Text dimColor>· also ran</Text>}
          {chained.map(name => chip(name, name, skillAbout(name, ROUTING_ABOUT.chained), 'cyan'))}
          {extra.map(name => chip(name, name, skillAbout(name, ROUTING_ABOUT.extra), 'yellow'))}
          <Button {...described('routing-hide', ROUTING_ABOUT.hide)} label="Hide" plain onPress={hideRouting} />
        </Box>
      )
    }

    let gitRow = null
    if (showGit && info !== null) {
      const color = info.changed > 0 ? 'yellow' : 'cyan'
      gitRow = (
        <Box key="git" flexDirection="row" gap={1}>
          {gitParts(info).map(part => value(part.key, part.text, part.about, { color }))}
          {!e.props.isWorking && info.changed > 0 && (
            <Button {...described('commit', GIT_ABOUT.commit)} label="Commit" hotkey="c" onPress={submit(COMMIT)} />
          )}
          {!e.props.isWorking && info.changed > 0 && (
            <Button {...described('commit-push', GIT_ABOUT.commitPush)} label="Commit & push" hotkey="p" variant="primary" onPress={submit(COMMIT_PUSH)} />
          )}
          {!e.props.isWorking && info.changed === 0 && info.unpushed > 0 && (
            <Button {...described('push', GIT_ABOUT.push)} label="Push" hotkey="p" variant="primary" onPress={submit(PUSH)} />
          )}
          <Button {...described('hide', GIT_ABOUT.hide)} label="Hide" plain onPress={() => update($, gitBandHidden, () => true)} />
        </Box>
      )
    }

    let salesforceRow = null
    if (sfPendingOff !== null) {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="yellow">{`Salesforce turn off for ${sfPendingOff}`}</Text>
          <Button {...described('sf-disable', SALESFORCE_ABOUT.disable)} label="Okay to continue" variant="primary" onPress={() => pressSalesforceDisable($)} />
        </Box>
      )
    } else if (sfPending !== null && sfBand === null) {
      salesforceRow = (
        <Box key="salesforce" flexDirection="row" gap={1}>
          <Text color="yellow">{`Salesforce enable for ${sfPending.projectRoot}`}</Text>
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
        {modsRow}
        {routingRow}
        {salesforceRow}
        {salesforceWarning}
        {gitRow}
        {aboutSlot({ Box, Text }, abouts, focus !== null ? abouts[focus] : undefined)}
      </Box>
    )
  })

  // ── standing orders ──

  on('command.run', { command: 'orders' }, async ($, e) => {
    if (!(await isOn($, config, 'standingOrders'))) return { text: offText('standingOrders') }
    const current = (await read($, standingOrders)) ?? (await loadOrders($))
    const [id, value] = e.args.trim().toLowerCase().split(/\s+/)

    if (!id) {
      await $.ui.open({ id: ORDERS_PANE, title: 'Standing orders', focus: true, closeOnEscape: true })
      return { text: `Standing orders pane opened.${await bypassNote($)}` }
    }
    if (!IDS.includes(id as OrderId)) {
      return { text: `Unknown order "${id}". Orders: ${IDS.join(', ')}.` }
    }

    const key = id as OrderId
    const turnOn = value === 'on' ? true : value === 'off' ? false : !current[key]
    await saveOrders($, { ...current, [key]: turnOn })

    return { text: `Standing order "${key}" is now ${turnOn ? 'on' : 'off'} for this project.${await bypassNote($)}` }
  })

  on('ui.render', { component: 'Pane', requestId: ORDERS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = (await read($, standingOrders)) ?? DEFAULTS

    return (
      <Box flexDirection="column">
        <Text dimColor>Added to the system prompt for this project. Press to toggle.</Text>
        {(await read($, composeWatch)).isBypassed && <Text color="warning">{BYPASS_NOTE}</Text>}
        {IDS.map((id, index) => (
          <Box key={`row-${id}`} flexDirection="row" gap={1}>
            <Button
              key={id}
              hotkey={String(index + 1)}
              label={current[id] ? 'on ' : 'off'}
              variant={current[id] ? 'primary' : 'secondary'}
              onPress={() => toggleOrder($, id)}
            />
            <Text dimColor={!current[id]}>{RULES[id].label}</Text>
          </Box>
        ))}
      </Box>
    )
  })

  // ── remote hosts ──

  on('command.run', { command: 'hosts' }, async ($, e) => {
    if (!(await isOn($, config, 'remoteHosts'))) return { text: offText('remoteHosts') }
    const [verb, id] = e.args.trim().split(/\s+/)
    if (verb === 'forget' && id) {
      const known = await loadHosts($)
      if (!known[id]) return { text: `No host "${id}". Known: ${Object.keys(known).join(', ') || 'none'}.` }
      await forgetHost($, id)
      return { text: `Forgot ${id}.` }
    }

    await $.ui.open({ id: HOSTS_PANE, title: 'Known SSH hosts', focus: true, closeOnEscape: true })
    return { text: `Known SSH hosts pane opened.${await bypassNote($)}` }
  })

  on('ui.render', { component: 'Pane', requestId: HOSTS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = Object.entries(await read($, sshHosts)).sort(([, a], [, b]) => b.lastOk.localeCompare(a.lastOk))

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>No hosts yet. They are learned from ssh commands that succeed.</Text>}
        {list.map(([id, h]) => (
          <Box key={`row-${id}`} flexDirection="row" gap={1}>
            <Button key={`forget-${id}`} label="Forget" plain onPress={() => forgetHost($, id)} />
            <Text bold>{id}</Text>
            <Text dimColor>
              {h.key ? 'key' : 'no key'} · {h.sudoOk ? 'sudo ✓' : 'sudo ?'} · {h.uses} uses · last {h.lastOk}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })

  // ── quiet reports ──

  on('command.run', { command: 'topia-activity' }, async ($, e) => {
    if (!(await isOn($, config, 'quietReports'))) return { text: offText('quietReports') }
    await $.ui.open({ id: ACTIVITY_PANE, title: 'Topia activity (hidden from the model)', focus: true, closeOnEscape: true })

    return { text: 'Topia activity pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: ACTIVITY_PANE }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const list = await read($, quietHidden)
    const saved = await read($, quietSavedChars)
    const counts = { 'session-report': 0, 'guardian-advisory': 0, 'install-banner': 0 }
    for (const one of list) counts[one.kind] += 1
    const lastReport = [...list].reverse().find(one => one.kind === 'session-report')
    const usage = usageParts(await read($, quietUsage), saved)

    return (
      <Box flexDirection="column">
        <Text>
          Kept out of context this session: {(saved / 1000).toFixed(1)}k chars (~{Math.round(saved / 4)} tokens)
        </Text>
        <Text dimColor>
          {counts['session-report']} session reports · {counts['guardian-advisory']} guardian advisories ·{' '}
          {counts['install-banner']} install/migration banners
        </Text>
        {usage.map(part => (
          <Text key={`means-${part.key}`} dimColor>
            {part.text}: {part.about}
          </Text>
        ))}
        {lastReport === undefined
          ? <Text dimColor>No Topia session report yet this session.</Text>
          : <Markdown key="report" text={lastReport.text} />}
      </Box>
    )
  })

  // ── model preset ──

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.args.trim().length > 0 && (await isOn($, config, 'modelPreset'))) await rememberModel($)

    return ran
  })

  on('command.run', { command: 'model-preset' }, async ($, e) => {
    if (!(await isOn($, config, 'modelPreset'))) return { text: offText('modelPreset') }
    const root = await $.session.root()
    if (e.args.trim() === 'forget') {
      await $.store.delete(projectKey(root))
      return { text: `Forgot the model for ${projectName(root)}.` }
    }
    const saved = await $.store.get(projectKey(root))

    return {
      text: typeof saved === 'string'
        ? `${projectName(root)} starts on ${saved}. /model to change it; /model-preset forget to stop.`
        : `No model remembered for ${projectName(root)} yet; the next one you use is kept.`,
    }
  })
}
