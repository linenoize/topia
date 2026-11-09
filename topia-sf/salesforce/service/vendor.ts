import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { isFailure, type Adapter, type Failure, type FailureKind } from './adapter.js'
import { plainText, type OrgRecord, type SfIssue, type ToolName } from './contract.js'
import {
  evidenceNamesOrg,
  type FindingStatus,
  packageFilePath,
  type PackageFileEntry,
  parsePackageFile,
  parseVendorFinding,
  seedPackageFile,
  type SubscriberEditable,
  type VendorFindingEntry,
  vendorFindingPath,
  vendorFindingProblems,
  vendorFindingsDirectory,
  vendorsDirectory,
  writePackageFile,
  writeVendorFinding,
} from './document.js'
import { sameId } from './identity.js'
import { type InstalledPackage, type Inventory, type PackageRead, type QueryLog, readInstalledPackages, readInventory, versionsMatch } from './inventory.js'
import { issue, noticeText, showsContinue } from './issues.js'
import { appendJournal } from './journal.js'
import { safeId } from './paths.js'
import { findRegistered } from './registry.js'
import type { CallContext, Ready, ToolResult } from './tools.js'

/**
 * Vendor overlays: what an installed package changes about Salesforce, recorded
 * in the person's own project with evidence and a pinned version. Nothing here
 * names a vendor. A package is found in the org, and a finding is whatever the
 * project's files say. Those files are read as untrusted text, like org text.
 */

/** What the vendor tools need from the gate in tools.ts: the same identity check and the same refusals as every other tool. */
export type VendorGate = {
  check: (orgId: string) => Promise<Ready | ToolResult>
  isReady: (value: Ready | ToolResult) => value is Ready
  ok: (checked: Ready, data: unknown, item?: SfIssue) => ToolResult
  refuse: (orgId: string, user: string, message: string, data?: Record<string, unknown>) => ToolResult
  failed: (checked: Ready, failure: Failure) => ToolResult
  local: (data: unknown) => ToolResult
}

type Args = Record<string, unknown>

const MAX_FILE_BYTES = 256 * 1024
const MAX_FINDINGS = 1000
const DRIFT_IDS_SHOWN = 10
/** A login or rate problem has to reach the person as itself. Anything else just means the version was not read. */
const VERSION_CHECK_STOPS: readonly FailureKind[] = ['expired-auth', 'rate-limit', 'cli-missing']

function queryLog(ctx: CallContext, orgId: string): QueryLog {
  return (soql, rows) => appendJournal(ctx.projectRoot, { event: 'query.executed', correlationId: ctx.correlationId, projectRoot: ctx.projectRoot, mode: ctx.mode, at: new Date(ctx.now).toISOString(), orgId, soql, counts: { rows } })
}

function today(ctx: CallContext): string {
  return new Date(ctx.now).toISOString().slice(0, 10)
}

function projectPath(projectRoot: string, file: string): string {
  return relative(projectRoot, file).split(sep).join('/')
}

// ── reading the project's notes ──

export type VendorSummary = { vendor: string; product: string; packageName: string; namespace: string | null }
export type LoadedFinding = { entry: VendorFindingEntry; file: string }
export type MalformedFile = { file: string; problems: string[] }
export type VendorNotes = { vendors: VendorSummary[]; findings: LoadedFinding[]; malformed: MalformedFile[] }

function readBounded(file: string): string | { problem: string } {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return { problem: `The file is larger than ${MAX_FILE_BYTES} bytes, so it was not read.` }
    return readFileSync(file, 'utf8')
  } catch {
    return { problem: 'The file could not be read.' }
  }
}

function folderNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => item.name)
      .sort()
  } catch {
    return []
  }
}

function markdownNames(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter(name => name.toLowerCase().endsWith('.md'))
      .sort()
  } catch {
    return []
  }
}

function isSafeName(value: string): boolean {
  try {
    safeId(value)
    return true
  } catch {
    return false
  }
}

function loadPackage(projectRoot: string, vendor: string, into: VendorNotes): PackageFileEntry | null {
  const file = packageFilePath(projectRoot, vendor)
  const shown = projectPath(projectRoot, file)
  if (!existsSync(file)) {
    into.malformed.push({ file: shown, problems: ['package.md is missing. /topia:sf:vendor fingerprint writes it.'] })
    return null
  }
  const text = readBounded(file)
  if (typeof text !== 'string') {
    into.malformed.push({ file: shown, problems: [text.problem] })
    return null
  }
  const parsed = parsePackageFile(text, vendor)
  if ('problems' in parsed) {
    into.malformed.push({ file: shown, problems: parsed.problems })
    return null
  }
  return parsed.entry
}

function loadFindings(projectRoot: string, vendor: string, owner: PackageFileEntry | null, into: VendorNotes): void {
  const dir = vendorFindingsDirectory(projectRoot, vendor)
  for (const name of markdownNames(dir)) {
    const shown = projectPath(projectRoot, join(dir, name))
    const id = name.slice(0, -3)
    if (!isSafeName(id)) {
      into.malformed.push({ file: shown, problems: ['That file name is not a safe finding id.'] })
      continue
    }
    if (into.findings.length >= MAX_FINDINGS) {
      into.malformed.push({ file: shown, problems: [`Only the first ${MAX_FINDINGS} findings are read.`] })
      continue
    }
    const text = readBounded(join(dir, name))
    if (typeof text !== 'string') {
      into.malformed.push({ file: shown, problems: [text.problem] })
      continue
    }
    const parsed = parseVendorFinding(text, { vendor, id })
    if ('problems' in parsed) {
      into.malformed.push({ file: shown, problems: parsed.problems })
      continue
    }
    if (owner !== null && owner.namespace.toLowerCase() !== parsed.entry.namespace.toLowerCase()) {
      into.malformed.push({ file: shown, problems: ['Its namespace does not match package.md for this vendor.'] })
      continue
    }
    into.findings.push({ entry: parsed.entry, file: shown })
  }
}

/** Everything recorded in this project. No folder means no notes, and costs one existence check. */
export function loadVendorNotes(projectRoot: string, only?: string): VendorNotes {
  const notes: VendorNotes = { vendors: [], findings: [], malformed: [] }
  const root = vendorsDirectory(projectRoot)
  if (!existsSync(root)) return notes
  for (const vendor of folderNames(root)) {
    if (only !== undefined && vendor !== only) continue
    if (!isSafeName(vendor)) {
      notes.malformed.push({ file: projectPath(projectRoot, join(root, vendor)), problems: ['That folder name is not a safe vendor name.'] })
      continue
    }
    const owner = loadPackage(projectRoot, vendor, notes)
    if (owner !== null) notes.vendors.push({ vendor, product: owner.product, packageName: owner.packageName, namespace: owner.namespace.length > 0 ? owner.namespace : null })
    loadFindings(projectRoot, vendor, owner, notes)
  }
  return notes
}

// ── what a finding looks like to whoever reads it ──

export type VersionState = 'current' | 'stale' | 'not-installed' | 'not-checked'

export type FindingView = {
  vendor: string
  id: string
  file: string
  packageName: string
  namespace: string | null
  pinnedVersion: string
  lastVerified: string
  /** Always here. `suspected` is not fact. */
  status: FindingStatus
  standardBehavior: string
  observedBehavior: string
  component: string
  adminImpact: string
  workaround: string
  subscriberEditable: SubscriberEditable
  vendorTicket: string | null
  version: { state: VersionState; live: string | null }
  stale: boolean
  verifiedInThisOrg: boolean | null
  text: string
}

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/** A namespace is unique. A package with none can only be matched by its name. */
function findInstalled(packages: InstalledPackage[], namespace: string, packageName: string): InstalledPackage | undefined {
  if (namespace.length > 0) return packages.find(item => item.namespace !== null && sameName(item.namespace, namespace))
  return packages.find(item => item.namespace === null && sameName(item.name, packageName))
}

function versionOf(entry: VendorFindingEntry, read: PackageRead | null): FindingView['version'] {
  if (read === null) return { state: 'not-checked', live: null }
  const found = findInstalled(read.packages, entry.namespace, entry.packageName)
  // A partial list can't show a package is absent. A read that came back whole can.
  if (found === undefined) return { state: read.notChecked.length > 0 ? 'not-checked' : 'not-installed', live: null }
  return { state: versionsMatch(entry.pinnedVersion, found.version) ? 'current' : 'stale', live: found.version }
}

function sentence(entry: VendorFindingEntry, version: FindingView['version'], inThisOrg: boolean | null): string {
  const said = `Known vendor behavior: ${plainText(entry.observedBehavior, 400).replace(/[.\s]+$/, '')}, verified v${entry.pinnedVersion} on ${entry.lastVerified}, status ${entry.status}.`
  const parts = [said]
  if (version.state === 'stale') parts.push(`Stale: this org has v${version.live}. Re-verify before relying on it.`)
  if (version.state === 'not-checked') parts.push("The installed version wasn't checked, so this may be stale.")
  if (version.state === 'not-installed') parts.push("This package isn't installed in this org.")
  if (inThisOrg === false) parts.push('It was not verified in this org.')
  return parts.join(' ')
}

export function findingView(loaded: LoadedFinding, read: PackageRead | null, orgId: string | null): FindingView {
  const { entry, file } = loaded
  const version = versionOf(entry, read)
  const inThisOrg = orgId === null ? null : entry.orgs.some(id => sameId(id, orgId))
  return {
    vendor: entry.vendor,
    id: entry.id,
    file,
    packageName: entry.packageName,
    namespace: entry.namespace.length > 0 ? entry.namespace : null,
    pinnedVersion: entry.pinnedVersion,
    lastVerified: entry.lastVerified,
    status: entry.status,
    standardBehavior: entry.standardBehavior,
    observedBehavior: entry.observedBehavior,
    component: entry.component,
    adminImpact: entry.adminImpact,
    workaround: entry.workaround,
    subscriberEditable: entry.subscriberEditable,
    vendorTicket: entry.vendorTicket.length > 0 ? entry.vendorTicket : null,
    version,
    stale: version.state === 'stale',
    verifiedInThisOrg: inThisOrg,
    text: sentence(entry, version, inThisOrg),
  }
}

export function driftIssue(record: OrgRecord, views: FindingView[]): SfIssue | undefined {
  const stale = views.filter(view => view.stale)
  if (stale.length === 0) return undefined
  const shown = stale.slice(0, DRIFT_IDS_SHOWN).map(view => `${view.vendor}/${view.id}`)
  const more = stale.length > shown.length ? `, and ${stale.length - shown.length} more` : ''
  return issue({
    kind: 'vendor-version-drift',
    orgId: record.orgId,
    orgName: record.name,
    user: record.username,
    operationClass: 'read',
    message: `${stale.length === 1 ? 'A vendor finding is' : `${stale.length} vendor findings are`} pinned to a different package version than this org has: ${shown.join(', ')}${more}. They show as stale until re-verified with /topia:sf:vendor reverify.`,
  })
}

// ── the tools ──

function partialIssue(record: OrgRecord): SfIssue {
  return issue({ kind: 'partial-dependency-coverage', orgId: record.orgId, orgName: record.name, user: record.username, operationClass: 'read', message: 'The inventory is partial. What was not checked stays listed.' })
}

function packageReadOf(inventory: Inventory): PackageRead | null {
  return inventory.packages === null ? null : { packages: inventory.packages, notChecked: inventory.notChecked.filter(item => item.object === 'InstalledSubscriberPackage') }
}

async function packagesInventory(adapter: Adapter, args: Args, ctx: CallContext, gate: VendorGate): Promise<ToolResult> {
  const checked = await gate.check(args.orgId as string)
  if (!gate.isReady(checked)) return checked
  const { record } = checked
  const inventory = await readInventory(adapter, record.username, queryLog(ctx, record.orgId))
  if (isFailure(inventory)) return gate.failed(checked, inventory)
  const notes = loadVendorNotes(ctx.projectRoot)
  const findings = notes.findings.map(item => findingView(item, packageReadOf(inventory), record.orgId))
  const drift = driftIssue(record, findings)
  const issues = [...(drift !== undefined ? [drift] : []), ...(inventory.partial ? [partialIssue(record)] : [])]
  return gate.ok(checked, { ...inventory, findings, malformed: notes.malformed, issues }, issues[0])
}

async function findingsList(adapter: Adapter, args: Args, ctx: CallContext, gate: VendorGate): Promise<ToolResult> {
  const notes = loadVendorNotes(ctx.projectRoot, typeof args.vendor === 'string' ? args.vendor : undefined)
  const answer = (views: FindingView[], versionCheck: string) => ({ vendors: notes.vendors, findings: views, malformed: notes.malformed, versionCheck })
  if (typeof args.orgId !== 'string') return gate.local(answer(notes.findings.map(item => findingView(item, null, null)), 'No org was named, so no installed version was read.'))
  const checked = await gate.check(args.orgId)
  if (!gate.isReady(checked)) return checked
  const { record } = checked
  const read = await readInstalledPackages(adapter, record.username, queryLog(ctx, record.orgId))
  if (isFailure(read)) {
    if (VERSION_CHECK_STOPS.includes(read.failure)) return gate.failed(checked, read)
    return gate.ok(checked, answer(notes.findings.map(item => findingView(item, null, record.orgId)), `The installed version could not be read: ${read.message}`))
  }
  const views = notes.findings.map(item => findingView(item, read, record.orgId))
  return gate.ok(checked, answer(views, read.notChecked.length > 0 ? 'The package list came back partial.' : 'Compared with the live package list.'), driftIssue(record, views))
}

async function fingerprint(adapter: Adapter, args: Args, ctx: CallContext, gate: VendorGate): Promise<ToolResult> {
  const orgId = args.orgId as string
  const vendor = args.vendor as string
  const namespace = typeof args.namespace === 'string' ? args.namespace : null
  const packageName = typeof args.packageName === 'string' ? args.packageName : null
  if ((namespace === null) === (packageName === null)) return gate.refuse(orgId, '', 'Name one package: a namespace or a package name, not both. Run packages_inventory to see what is installed.')

  const file = packageFilePath(ctx.projectRoot, vendor)
  let existing: PackageFileEntry | null = null
  if (existsSync(file)) {
    const text = readBounded(file)
    const parsed = typeof text === 'string' ? parsePackageFile(text, vendor) : { problems: [text.problem] }
    if ('problems' in parsed) return gate.refuse(orgId, '', "package.md can't be read back, so it wasn't overwritten. Fix it or remove it, then run this again.", { problems: parsed.problems })
    existing = parsed.entry
  }

  const checked = await gate.check(orgId)
  if (!gate.isReady(checked)) return checked
  const { record } = checked
  const inventory = await readInventory(adapter, record.username, queryLog(ctx, record.orgId))
  if (isFailure(inventory)) return gate.failed(checked, inventory)
  if (inventory.packages === null) return gate.refuse(record.orgId, record.username, 'The package list could not be checked, so nothing was written.', { notChecked: inventory.notChecked })
  const found = findInstalled(inventory.packages, namespace ?? '', packageName ?? '')
  if (found === undefined) return gate.refuse(record.orgId, record.username, "That package isn't installed in this org, or it isn't visible to this CLI user. Nothing was written.", { installed: inventory.packages, notChecked: inventory.notChecked })
  const liveNamespace = found.namespace ?? ''
  if (existing !== null && existing.namespace.toLowerCase() !== liveNamespace.toLowerCase()) {
    return gate.refuse(record.orgId, record.username, 'This vendor folder already records a different namespace. One folder holds one package, so use another vendor name, such as vendorco-billing.')
  }

  let written: string
  try {
    const seeded = seedPackageFile(
      {
        vendor,
        namespace: liveNamespace,
        packageName: found.name,
        version: found.version,
        orgId: record.orgId,
        today: today(ctx),
        ...(typeof args.product === 'string' ? { product: args.product } : {}),
        ...(typeof args.dependencies === 'string' ? { dependencies: args.dependencies } : {}),
      },
      inventory,
      existing,
    )
    written = writePackageFile(ctx.projectRoot, seeded)
  } catch (error) {
    return gate.refuse(record.orgId, record.username, error instanceof Error ? error.message : 'package.md could not be written.')
  }

  const views = loadVendorNotes(ctx.projectRoot).findings.map(item => findingView(item, packageReadOf(inventory), record.orgId))
  const drift = driftIssue(record, views)
  const data = { wrote: projectPath(ctx.projectRoot, written), packageName: found.name, namespace: found.namespace, version: found.version, partial: inventory.partial, notChecked: inventory.notChecked, managedCode: inventory.managedCode, staleFindings: views.filter(view => view.stale).map(view => view.id) }
  return gate.ok(checked, data, drift ?? (inventory.partial ? partialIssue(record) : undefined))
}

function loadOwner(ctx: CallContext, vendor: string): { owner: PackageFileEntry } | { problem: string; problems?: string[] } {
  const file = packageFilePath(ctx.projectRoot, vendor)
  if (!existsSync(file)) return { problem: 'This vendor has no package.md yet. Run /topia:sf:vendor fingerprint first.' }
  const text = readBounded(file)
  const parsed = typeof text === 'string' ? parsePackageFile(text, vendor) : { problems: [text.problem] }
  if ('problems' in parsed) return { problem: "package.md can't be read back. Fix it or remove it first.", problems: parsed.problems }
  return { owner: parsed.entry }
}

async function liveVersion(adapter: Adapter, ctx: CallContext, gate: VendorGate, checked: Ready, namespace: string, packageName: string): Promise<{ found: InstalledPackage } | ToolResult> {
  const { record } = checked
  const read = await readInstalledPackages(adapter, record.username, queryLog(ctx, record.orgId))
  if (isFailure(read)) return VERSION_CHECK_STOPS.includes(read.failure) || read.failure === 'unknown' ? gate.failed(checked, read) : gate.refuse(record.orgId, record.username, "The installed version couldn't be read, so it wasn't guessed. Nothing was written.", { access: read.failure })
  const found = findInstalled(read.packages, namespace, packageName)
  if (found !== undefined) return { found }
  if (read.notChecked.length > 0) return gate.refuse(record.orgId, record.username, 'The package list came back partial and this package is not on it, so its version is unknown. Nothing was written.', { notChecked: read.notChecked })
  return gate.refuse(record.orgId, record.username, "This package isn't installed in this org, or it isn't visible to this CLI user, so there is no version to pin. Nothing was written.")
}

function isFound(value: { found: InstalledPackage } | ToolResult): value is { found: InstalledPackage } {
  return 'found' in value
}

async function findingAdd(adapter: Adapter, args: Args, ctx: CallContext, gate: VendorGate): Promise<ToolResult> {
  const orgId = args.orgId as string
  const vendor = args.vendor as string
  const id = args.id as string
  const file = vendorFindingPath(ctx.projectRoot, vendor, id)
  if (existsSync(file)) return gate.refuse(orgId, '', 'A finding with that id already exists. Use /topia:sf:vendor reverify to change it.')
  const owned = loadOwner(ctx, vendor)
  if ('problem' in owned) return gate.refuse(orgId, '', owned.problem, owned.problems === undefined ? undefined : { problems: owned.problems })

  const checked = await gate.check(orgId)
  if (!gate.isReady(checked)) return checked
  const { record } = checked
  const live = await liveVersion(adapter, ctx, gate, checked, owned.owner.namespace, owned.owner.packageName)
  if (!isFound(live)) return live

  const entry: VendorFindingEntry = {
    kind: 'vendor-finding',
    vendor,
    id,
    scope: args.scope as string,
    owner: args.owner as string,
    evidence: args.evidence as string,
    lastVerified: today(ctx),
    rationale: args.rationale as string,
    dependencies: args.dependencies as string,
    uncertainty: args.uncertainty as string,
    body: typeof args.body === 'string' ? args.body : '',
    packageName: owned.owner.packageName,
    namespace: owned.owner.namespace,
    pinnedVersion: live.found.version,
    orgs: [record.orgId],
    standardBehavior: args.standardBehavior as string,
    observedBehavior: args.observedBehavior as string,
    component: args.component as string,
    // Never from the caller. Reaching another status takes reverify and its evidence.
    status: 'suspected',
    vendorTicket: typeof args.vendorTicket === 'string' ? args.vendorTicket : '',
    adminImpact: args.adminImpact as string,
    workaround: args.workaround as string,
    subscriberEditable: args.subscriberEditable as SubscriberEditable,
    reverifyOn: args.reverifyOn as string[],
  }
  const problems = vendorFindingProblems(entry)
  if (problems.length > 0) return gate.refuse(record.orgId, record.username, 'That finding was not written.', { problems })
  const written = writeVendorFinding(ctx.projectRoot, entry, { createOnly: true })
  return gate.ok(checked, { wrote: projectPath(ctx.projectRoot, written), status: entry.status, pinnedVersion: entry.pinnedVersion, note: 'A new finding starts at suspected. It stays there until it is reproduced, then /topia:sf:vendor reverify moves it.' })
}

async function findingReverify(adapter: Adapter, args: Args, ctx: CallContext, gate: VendorGate): Promise<ToolResult> {
  const orgId = args.orgId as string
  const vendor = args.vendor as string
  const id = args.id as string
  const file = vendorFindingPath(ctx.projectRoot, vendor, id)
  if (!existsSync(file)) return gate.refuse(orgId, '', 'There is no finding with that id for this vendor.')
  const text = readBounded(file)
  const parsed = typeof text === 'string' ? parseVendorFinding(text, { vendor, id }) : { problems: [text.problem] }
  if ('problems' in parsed) return gate.refuse(orgId, '', "That finding can't be read back, so it wasn't changed. Fix the file first.", { problems: parsed.problems })
  const before = parsed.entry

  const checked = await gate.check(orgId)
  if (!gate.isReady(checked)) return checked
  const { record } = checked
  const status = args.status as FindingStatus
  const evidence = args.evidence as string
  if (status === 'confirmed-in-org' && !evidenceNamesOrg(evidence, record.orgId)) {
    return gate.refuse(record.orgId, record.username, 'Status confirmed-in-org needs evidence that names this org, by org id. Nothing was written.')
  }
  const live = await liveVersion(adapter, ctx, gate, checked, before.namespace, before.packageName)
  if (!isFound(live)) return live

  const next: VendorFindingEntry = {
    ...before,
    status,
    evidence,
    pinnedVersion: live.found.version,
    lastVerified: today(ctx),
    orgs: before.orgs.some(item => sameId(item, record.orgId)) ? before.orgs : [...before.orgs, record.orgId],
    ...(typeof args.vendorTicket === 'string' ? { vendorTicket: args.vendorTicket } : {}),
    ...(typeof args.uncertainty === 'string' ? { uncertainty: args.uncertainty } : {}),
  }
  const problems = vendorFindingProblems(next)
  if (problems.length > 0) return gate.refuse(record.orgId, record.username, 'That change was not written.', { problems })
  const written = writeVendorFinding(ctx.projectRoot, next)
  return gate.ok(checked, { wrote: projectPath(ctx.projectRoot, written), status: { from: before.status, to: next.status }, pinnedVersion: { from: before.pinnedVersion, to: next.pinnedVersion }, lastVerified: next.lastVerified })
}

export function vendorTool(adapter: Adapter, tool: ToolName, args: Args, ctx: CallContext, gate: VendorGate): Promise<ToolResult> {
  switch (tool) {
    case 'packages_inventory':
      return packagesInventory(adapter, args, ctx, gate)
    case 'vendor_findings_list':
      return findingsList(adapter, args, ctx, gate)
    case 'vendor_fingerprint':
      return fingerprint(adapter, args, ctx, gate)
    case 'vendor_finding_add':
      return findingAdd(adapter, args, ctx, gate)
    case 'vendor_finding_reverify':
      return findingReverify(adapter, args, ctx, gate)
    default:
      return Promise.resolve(gate.refuse('', '', 'That tool is not part of the Salesforce service.'))
  }
}

// ── annotation: the finding reaches the admin at the moment it matters ──

/** The tools whose results can name a component. A candidate list isn't an investigation, so it stays out. */
const ANNOTATED: ReadonlySet<string> = new Set<ToolName>(['schema_describe', 'metadata_retrieve', 'metadata_diff', 'records_query', 'reports_describe', 'reports_run'])
const MAX_ATTACHED = 10

function collectText(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value)
  else if (Array.isArray(value)) for (const item of value) collectText(item, into)
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.push(key)
      collectText(inner, into)
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** By namespace prefix, or for a package with no namespace, by the one component the finding names. */
function touches(entry: VendorFindingEntry, text: string): boolean {
  if (entry.namespace.length > 0) return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(entry.namespace)}__[A-Za-z0-9]`, 'i').test(text)
  const name = (entry.component.split(':').pop() ?? '').trim()
  return name.length > 0 && new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(name)}(?![A-Za-z0-9_])`, 'i').test(text)
}

async function buildNotes(result: ToolResult, args: Args, adapter: Adapter, ctx: CallContext): Promise<ToolResult> {
  const notes = loadVendorNotes(ctx.projectRoot)
  if (notes.findings.length === 0 && notes.malformed.length === 0) return result
  const seen: string[] = []
  collectText(args, seen)
  collectText(result.data, seen)
  const text = seen.join('\n')
  const touched = notes.findings.filter(item => touches(item.entry, text))
  if (touched.length === 0 && notes.malformed.length === 0) return result

  let read: PackageRead | null = null
  let versionCheck: string | undefined
  if (touched.length > 0) {
    const answer = await readInstalledPackages(adapter, result.user, queryLog(ctx, result.orgId))
    if (isFailure(answer)) versionCheck = `The installed version could not be read: ${answer.message}`
    else read = answer
  }
  const views = touched.map(item => findingView(item, read, result.orgId)).sort((left, right) => Number(right.stale) - Number(left.stale) || left.id.localeCompare(right.id))
  const found = findRegistered(ctx.storeRoot, ctx.projectRoot, result.orgId)
  const drift = 'missing' in found ? undefined : driftIssue(found.record, views)
  const kept = result.issue !== undefined
  const vendorNotes = {
    findings: views.slice(0, MAX_ATTACHED),
    ...(views.length > MAX_ATTACHED ? { moreFindings: views.length - MAX_ATTACHED } : {}),
    malformed: notes.malformed,
    ...(versionCheck !== undefined ? { versionCheck } : {}),
    ...(drift !== undefined && kept ? { driftIssue: drift } : {}),
  }
  return { ...result, vendorNotes, ...(drift !== undefined && !kept ? { issue: drift, canContinue: showsContinue(drift.kind), notice: noticeText(drift) } : {}) }
}

/** A read that worked stays a read that worked. If the notes themselves can't be read, it says so and the result still stands. */
export async function attachVendorNotes(result: ToolResult, tool: string, args: Args, adapter: Adapter, ctx: CallContext): Promise<ToolResult> {
  if (!ANNOTATED.has(tool) || !result.ok || args.purpose === 'candidate') return result
  try {
    return await buildNotes(result, args, adapter, ctx)
  } catch {
    return { ...result, vendorNotes: { findings: [], malformed: [], versionCheck: 'The vendor notes in this project could not be read.' } }
  }
}
