import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { COMMIT, COMMIT_PUSH, NOT_A_REPO, PUSH, WRITING_TOOLS, bandParts, parseStatus } from './lib/git-band'
import { projectKey, projectName } from './lib/model-preset'
import { FAILED, composeText as hostsText, hostsKey, learnHosts, parseSsh } from './lib/remote-hosts'
import { DEFAULTS, IDS, RULES, composeText as ordersText, ordersKey, ordersStatus } from './lib/standing-orders'
import { joinStatus } from './lib/status'
import type { StatusSlot } from './lib/status'
import { filterHookText, formatUsage } from './lib/topia-quiet'
import type { GitInfo, Host, HiddenReport, OrderId, Orders, SshTarget, UsageLine } from './types'

// Topia's Claude Code mods, each behind a userConfig switch in
// .claude-plugin/plugin.json (changing one in /config reloads this module):
//   gitBand        changed / unpushed counts above the prompt, Commit and Push buttons
//   standingOrders per-project rules in the system prompt, /orders
//   remoteHosts    SSH hosts learned from ssh calls that worked, per project, /hosts (off by default)
//   quietReports   Topia's hook reports kept out of context, usage status line, /topia-activity
//   modelPreset    the model used last per project, restored at startup, /model-preset
// A plugin registers each event once without a matcher, so the shared events
// below run every enabled mod's part in turn. The engine-facing code is all in
// this file; the logic it calls is in ./lib, where the tests reach it.

const gitInfo = atom({ plugin: 'topia', key: 'gitInfo' } as const, null)
const gitBandHidden = atom({ plugin: 'topia', key: 'gitBandHidden' } as const, false)
const standingOrders = atom({ plugin: 'topia', key: 'standingOrders' } as const, null)
const sshHosts = atom({ plugin: 'topia', key: 'sshHosts' } as const, {})
const quietHidden = atom({ plugin: 'topia', key: 'quietHidden' } as const, [])
const quietSavedChars = atom({ plugin: 'topia', key: 'quietSavedChars' } as const, 0)
const quietUsage = atom({ plugin: 'topia', key: 'quietUsage' } as const, null)
// Set once the preset has been applied, so a hot reload (which fires
// session.start again) never switches the model mid-session.
const modelPresetApplied = atom({ plugin: 'topia', key: 'modelPresetApplied' } as const, false)

const ORDERS_PANE = 'topia-standing-orders'
const HOSTS_PANE = 'topia-remote-hosts'
const ACTIVITY_PANE = 'topia-activity'

// Module state: a reload clears it and each mod sets its slot again from
// session.start.
const statusSlots: Partial<Record<StatusSlot, string>> = {}

function setStatus($: EngineInterface, slot: StatusSlot, text: string | undefined) {
  if (text === undefined || text.length === 0) delete statusSlots[slot]
  else statusSlots[slot] = text
  $.ui.status(joinStatus(statusSlots))
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
  if (await read($, modelPresetApplied)) return
  await update($, modelPresetApplied, () => true)

  const root = await $.session.root()
  const saved = await $.store.get(projectKey(root))
  const current = await $.session.model()
  if (typeof saved !== 'string' || saved === current) return

  await $.command.run({ command: 'model', args: saved })
  $.ui.toast(`topia: ${projectName(root)} last used ${saved}; switched (was ${current}).`, { timeoutMs: 8000 })
}

// ── hooks ───────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  const git = options.gitBand !== false
  const orders = options.standingOrders !== false
  const hosts = options.remoteHosts === true
  const quiet = options.quietReports !== false
  const preset = options.modelPreset !== false

  on('session.start', async ($, e, next) => {
    if (git) void refreshGit($)
    if (orders) {
      await $.command.register({
        name: 'orders',
        description: 'Show or toggle your standing orders for this project',
        argumentHint: '[fanout|ledger|scripts|commit] [on|off]',
      })
      await loadOrders($)
    }
    if (hosts) {
      await $.command.register({
        name: 'hosts',
        description: 'Show the SSH hosts the model knows about; forget one',
        argumentHint: '[forget <user@host>]',
      })
      await loadHosts($)
    }
    if (quiet) {
      await $.command.register({
        name: 'topia-activity',
        description: "Show the Topia hook reports kept out of the model's context",
      })
      void refreshUsage($)
    }
    if (preset) {
      await $.command.register({
        name: 'model-preset',
        description: 'Show or forget the model remembered for this project',
        argumentHint: '[forget]',
      })
    }

    const started = await next(e)
    if (preset && e.isInteractive) void applyModel($)

    return started
  })

  on('session.end', async ($, e, next) => {
    if (preset) await rememberModel($)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const tool = String(e.tool)
    if (git && WRITING_TOOLS.has(tool)) void refreshGit($)

    const command = (e as { command?: unknown }).command
    const succeeded = ran.deny === undefined && ran.isError !== true && !FAILED.test(ran.text ?? '')
    if (hosts && succeeded && (tool === 'Bash' || tool === 'PowerShell') && typeof command === 'string') {
      // The remote command may hold `;` or `|` inside quotes, which the segment
      // split cuts, so sudo is judged on the whole line.
      const targets = parseSsh(command).map(target => ({ ...target, remote: command }))
      if (targets.length > 0) await learnFrom($, targets)
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (git) void refreshGit($)
    const result = await next(e)
    if (e.agentId === undefined) {
      if (quiet) {
        const turn = e.usage
        const input = turn ? turn.input_tokens + turn.cache_read_input_tokens + turn.cache_creation_input_tokens : 0
        void refreshUsage($, turn && input > 0 ? (turn.cache_read_input_tokens / input) * 100 : undefined)
      }
      // The /model picker settles after its command returns, so the choice is
      // read again once each main-thread turn ends, and when the session ends.
      if (preset) await rememberModel($)
    }

    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const sections = [...composed.sections]

    const current = orders ? await read($, standingOrders) : null
    const rules = current === null ? null : ordersText(current)
    if (rules !== null) sections.push({ id: 'topia:standing-orders', text: rules, scope: 'session' as const })

    const known = hosts ? hostsText(await read($, sshHosts)) : null
    if (known !== null) sections.push({ id: 'topia:known-hosts', text: known, scope: 'session' as const })

    return sections.length === composed.sections.length ? composed : { sections }
  })

  on('prompt.attachment', async ($, e, next) => {
    if (!quiet || e.origin.kind !== 'hook') return next(e)

    const filtered = filterHookText(e.text)
    if (filtered === null) return next(e)

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

  // ── git band ──

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!git) return next(e)
    const info = await read($, gitInfo)
    const isClean = info === null || !info.isRepo || (info.changed === 0 && info.unpushed === 0)

    if (e.props.hasSurvey || isClean || (await read($, gitBandHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const submit = (text: string) => () => $.prompt.submit({ text, asUser: true })

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={info.changed > 0 ? 'yellow' : 'cyan'}>
          ⎇ {info.branch} · {bandParts(info).join(' · ')}
        </Text>
        {!e.props.isWorking && info.changed > 0 && (
          <Button key="commit" label="Commit" hotkey="c" onPress={submit(COMMIT)} />
        )}
        {!e.props.isWorking && info.changed > 0 && (
          <Button key="commit-push" label="Commit & push" hotkey="p" variant="primary" onPress={submit(COMMIT_PUSH)} />
        )}
        {!e.props.isWorking && info.changed === 0 && info.unpushed > 0 && (
          <Button key="push" label="Push" hotkey="p" variant="primary" onPress={submit(PUSH)} />
        )}
        <Button key="hide" label="Hide" plain onPress={() => update($, gitBandHidden, () => true)} />
      </Box>
    )
  })

  // ── standing orders ──

  on('command.run', { command: 'orders' }, async ($, e, next) => {
    if (!orders) return next(e)
    const current = (await read($, standingOrders)) ?? (await loadOrders($))
    const [id, value] = e.args.trim().toLowerCase().split(/\s+/)

    if (!id) {
      await $.ui.open({ id: ORDERS_PANE, title: 'Standing orders', focus: true, closeOnEscape: true })
      return { text: 'Standing orders pane opened.' }
    }
    if (!IDS.includes(id as OrderId)) {
      return { text: `Unknown order "${id}". Orders: ${IDS.join(', ')}.` }
    }

    const key = id as OrderId
    const turnOn = value === 'on' ? true : value === 'off' ? false : !current[key]
    await saveOrders($, { ...current, [key]: turnOn })

    return { text: `Standing order "${key}" is now ${turnOn ? 'on' : 'off'} for this project.` }
  })

  on('ui.render', { component: 'Pane', requestId: ORDERS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = (await read($, standingOrders)) ?? DEFAULTS

    return (
      <Box flexDirection="column">
        <Text dimColor>Added to the system prompt for this project. Press to toggle.</Text>
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

  on('command.run', { command: 'hosts' }, async ($, e, next) => {
    if (!hosts) return next(e)
    const [verb, id] = e.args.trim().split(/\s+/)
    if (verb === 'forget' && id) {
      const known = await loadHosts($)
      if (!known[id]) return { text: `No host "${id}". Known: ${Object.keys(known).join(', ') || 'none'}.` }
      await forgetHost($, id)
      return { text: `Forgot ${id}.` }
    }

    await $.ui.open({ id: HOSTS_PANE, title: 'Known SSH hosts', focus: true, closeOnEscape: true })
    return { text: 'Known SSH hosts pane opened.' }
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

  on('command.run', { command: 'topia-activity' }, async ($, e, next) => {
    if (!quiet) return next(e)
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

    return (
      <Box flexDirection="column">
        <Text>
          Kept out of context this session: {(saved / 1000).toFixed(1)}k chars (~{Math.round(saved / 4)} tokens)
        </Text>
        <Text dimColor>
          {counts['session-report']} session reports · {counts['guardian-advisory']} guardian advisories ·{' '}
          {counts['install-banner']} install/migration banners
        </Text>
        {lastReport === undefined
          ? <Text dimColor>No Topia session report yet this session.</Text>
          : <Markdown key="report" text={lastReport.text} />}
      </Box>
    )
  })

  // ── model preset ──

  on('command.run', { command: 'model' }, async ($, e, next) => {
    const ran = await next(e)
    if (preset && e.args.trim().length > 0) await rememberModel($)

    return ran
  })

  on('command.run', { command: 'model-preset' }, async ($, e, next) => {
    if (!preset) return next(e)
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
