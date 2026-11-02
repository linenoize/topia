import { isFailure, type Adapter, type Failure, type FailureKind, type QueryRows } from './adapter.js'
import { plainText } from './contract.js'

/**
 * Finds out what is installed, without being told. Every query is fixed text with
 * no input from the model, and goes through the same query file and closed argv as
 * every other read. A query that fails is reported as not checked, never as empty.
 */

export const MANAGED_CODE_NOTE = "Managed code is hidden. These are names and counts, not source. Salesforce doesn't show the Apex inside a managed package, so a short list here doesn't mean the package does little."
export const LICENSE_HOLDERS_NOTE = "These are counts. Who holds a license is personal data, so it isn't read here."

/** Salesforce namespaces are short. Anything else from an org is treated as a bad row and goes no further. */
export const NAMESPACE = /^[A-Za-z][A-Za-z0-9_]{0,14}$/

export type ComponentType = 'ApexTrigger' | 'ApexClass' | 'FlowDefinition' | 'EntityDefinition' | 'PermissionSet'
export type InstalledPackage = { name: string; namespace: string | null; version: string }
export type NamespaceComponents = { namespace: string; installed: boolean; types: { type: ComponentType; count: number; names: string[] }[] }
export type NotChecked = { object: string; state: FailureKind | 'cut-short' | 'malformed-rows'; message: string }
export type PackageLicense = { namespace: string; allowed: number; used: number; status: string }
export type Inventory = {
  /** Null means not checked. An empty list means the org returned none. */
  packages: InstalledPackage[] | null
  components: NamespaceComponents[]
  licenses: { packageLicenses: PackageLicense[]; userLicenses: { name: string; total: number; used: number; status: string }[]; permissionSetLicenses: { name: string; total: number; used: number }[] }
  notChecked: NotChecked[]
  partial: boolean
  managedCode: string
  holders: string
  notes: string[]
}

const ROW_LIMIT = 2000
const NAMES_SHOWN = 100
const TEXT_CAP = 200
const API_NAME = /^[A-Za-z0-9_]{1,255}$/

export const INSTALLED_PACKAGES_SOQL =
  'SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage'

const COMPONENT_QUERIES: { type: ComponentType; nameField: string; tooling: boolean; soql: string }[] = [
  { type: 'ApexClass', nameField: 'Name', tooling: true, soql: `SELECT NamespacePrefix, Name FROM ApexClass WHERE NamespacePrefix != null LIMIT ${ROW_LIMIT}` },
  { type: 'ApexTrigger', nameField: 'Name', tooling: true, soql: `SELECT NamespacePrefix, Name FROM ApexTrigger WHERE NamespacePrefix != null LIMIT ${ROW_LIMIT}` },
  { type: 'EntityDefinition', nameField: 'QualifiedApiName', tooling: true, soql: `SELECT NamespacePrefix, QualifiedApiName FROM EntityDefinition WHERE NamespacePrefix != null LIMIT ${ROW_LIMIT}` },
  { type: 'FlowDefinition', nameField: 'DeveloperName', tooling: true, soql: `SELECT NamespacePrefix, DeveloperName FROM FlowDefinition WHERE NamespacePrefix != null LIMIT ${ROW_LIMIT}` },
  { type: 'PermissionSet', nameField: 'Name', tooling: false, soql: `SELECT NamespacePrefix, Name FROM PermissionSet WHERE NamespacePrefix != null AND IsOwnedByProfile = false LIMIT ${ROW_LIMIT}` },
]

const PACKAGE_LICENSE_SOQL = 'SELECT NamespacePrefix, AllowedLicenses, UsedLicenses, Status FROM PackageLicense'
const USER_LICENSE_SOQL = 'SELECT Name, TotalLicenses, UsedLicenses, Status FROM UserLicense'
const PERMISSION_SET_LICENSE_SOQL = 'SELECT DeveloperName, TotalLicenses, UsedLicenses FROM PermissionSetLicense'

/** A login or rate problem stops everything, because every other answer would be the same. Anything else is about one query. */
const STOPS_THE_CALL: readonly FailureKind[] = ['expired-auth', 'rate-limit', 'cli-missing']

export type QueryLog = (soql: string, rows: number) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1
}

function isPart(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function packageFrom(row: Record<string, unknown>): InstalledPackage | null {
  const owner = row.SubscriberPackage
  const version = row.SubscriberPackageVersion
  if (!isRecord(owner) || !isRecord(version)) return null
  const { Name, NamespacePrefix } = owner
  const { MajorVersion, MinorVersion, PatchVersion, BuildNumber } = version
  if (typeof Name !== 'string' || Name.trim().length === 0) return null
  if (NamespacePrefix !== null && NamespacePrefix !== undefined && (typeof NamespacePrefix !== 'string' || !NAMESPACE.test(NamespacePrefix))) return null
  if (!isPart(MajorVersion) || !isPart(MinorVersion) || !isPart(PatchVersion)) return null
  const parts = [MajorVersion, MinorVersion, PatchVersion, ...(isPart(BuildNumber) ? [BuildNumber] : [])]
  return { name: plainText(Name, TEXT_CAP), namespace: typeof NamespacePrefix === 'string' ? NamespacePrefix : null, version: parts.join('.') }
}

function cutShort(object: string, rows: QueryRows, limit: number | null): NotChecked[] {
  if (!rows.truncated && (limit === null || rows.records.length < limit)) return []
  return [{ object, state: 'cut-short', message: `The org returned ${rows.records.length} rows and may hold more.` }]
}

function badRows(object: string, count: number): NotChecked[] {
  return count === 0 ? [] : [{ object, state: 'malformed-rows', message: `${count} rows did not fit the expected shape, so they aren't listed.` }]
}

export type PackageRead = { packages: InstalledPackage[]; notChecked: NotChecked[] }

function readPackageRows(rows: QueryRows): PackageRead {
  const packages: InstalledPackage[] = []
  let bad = 0
  for (const row of rows.records) {
    const item = packageFrom(row)
    if (item === null) bad += 1
    else packages.push(item)
  }
  packages.sort((left, right) => left.name.localeCompare(right.name))
  return { packages, notChecked: [...cutShort('InstalledSubscriberPackage', rows, null), ...badRows('InstalledSubscriberPackage', bad)] }
}

/** The one read a version check needs. A failure here is a failure, and the caller says the version was not checked. */
export async function readInstalledPackages(adapter: Adapter, username: string, log: QueryLog): Promise<PackageRead | Failure> {
  const rows = await adapter.query(username, INSTALLED_PACKAGES_SOQL, { tooling: true })
  if (isFailure(rows)) return rows
  log(INSTALLED_PACKAGES_SOQL, rows.records.length)
  return readPackageRows(rows)
}

function qualified(namespace: string, name: string): string {
  return name.toLowerCase().startsWith(`${namespace.toLowerCase()}__`) ? name : `${namespace}__${name}`
}

function groupComponents(found: { type: ComponentType; nameField: string; rows: QueryRows }[], packages: InstalledPackage[] | null): { groups: NamespaceComponents[]; bad: NotChecked[] } {
  const byNamespace = new Map<string, Map<ComponentType, string[]>>()
  const bad: NotChecked[] = []
  for (const { type, nameField, rows } of found) {
    let badCount = 0
    for (const row of rows.records) {
      const namespace = row.NamespacePrefix
      const name = row[nameField]
      if (typeof namespace !== 'string' || !NAMESPACE.test(namespace) || typeof name !== 'string' || !API_NAME.test(name)) {
        badCount += 1
        continue
      }
      const types = byNamespace.get(namespace) ?? new Map<ComponentType, string[]>()
      byNamespace.set(namespace, types)
      types.set(type, [...(types.get(type) ?? []), qualified(namespace, name)])
    }
    bad.push(...badRows(type, badCount))
  }
  const known = new Set((packages ?? []).flatMap(item => (item.namespace === null ? [] : [item.namespace.toLowerCase()])))
  const groups = [...byNamespace.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, types]) => ({
      namespace,
      installed: known.has(namespace.toLowerCase()),
      types: [...types.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, names]) => ({ type, count: names.length, names: [...names].sort().slice(0, NAMES_SHOWN) })),
    }))
  return { groups, bad }
}

type Query = { object: string; soql: string; tooling: boolean }

async function runAll(adapter: Adapter, username: string, queries: Query[], log: QueryLog): Promise<{ query: Query; rows: QueryRows | Failure }[]> {
  return Promise.all(
    queries.map(async query => {
      const rows = await adapter.query(username, query.soql, { tooling: query.tooling })
      if (!isFailure(rows)) log(query.soql, rows.records.length)
      return { query, rows }
    }),
  )
}

function licenseRows<T>(object: string, rows: QueryRows | Failure, read: (row: Record<string, unknown>) => T | null): { items: T[]; notChecked: NotChecked[] } {
  if (isFailure(rows)) return { items: [], notChecked: [{ object, state: rows.failure, message: rows.message }] }
  const items: T[] = []
  let bad = 0
  for (const row of rows.records) {
    const item = read(row)
    if (item === null) bad += 1
    else items.push(item)
  }
  return { items, notChecked: [...cutShort(object, rows, null), ...badRows(object, bad)] }
}

export async function readInventory(adapter: Adapter, username: string, log: QueryLog): Promise<Inventory | Failure> {
  const queries: Query[] = [
    { object: 'InstalledSubscriberPackage', soql: INSTALLED_PACKAGES_SOQL, tooling: true },
    ...COMPONENT_QUERIES.map(item => ({ object: item.type, soql: item.soql, tooling: item.tooling })),
    { object: 'PackageLicense', soql: PACKAGE_LICENSE_SOQL, tooling: false },
    { object: 'UserLicense', soql: USER_LICENSE_SOQL, tooling: false },
    { object: 'PermissionSetLicense', soql: PERMISSION_SET_LICENSE_SOQL, tooling: false },
  ]
  const answers = await runAll(adapter, username, queries, log)
  const answer = (object: string): QueryRows | Failure => (answers.find(item => item.query.object === object) as { rows: QueryRows | Failure }).rows
  for (const { rows } of answers) if (isFailure(rows) && STOPS_THE_CALL.includes(rows.failure)) return rows

  const notChecked: NotChecked[] = []
  const installed = answer('InstalledSubscriberPackage')
  let packages: InstalledPackage[] | null = null
  if (isFailure(installed)) {
    // Output nobody can read says nothing about what is installed, so it isn't dressed up as a partial result.
    if (installed.failure === 'unknown') return installed
    notChecked.push({ object: 'InstalledSubscriberPackage', state: installed.failure, message: installed.message })
  } else {
    const read = readPackageRows(installed)
    packages = read.packages
    notChecked.push(...read.notChecked)
  }

  const found: { type: ComponentType; nameField: string; rows: QueryRows }[] = []
  for (const item of COMPONENT_QUERIES) {
    const rows = answer(item.type)
    if (isFailure(rows)) {
      notChecked.push({ object: item.type, state: rows.failure, message: rows.message })
      continue
    }
    notChecked.push(...cutShort(item.type, rows, ROW_LIMIT))
    found.push({ type: item.type, nameField: item.nameField, rows })
  }
  const { groups, bad } = groupComponents(found, packages)
  notChecked.push(...bad)

  const packageLicenses = licenseRows('PackageLicense', answer('PackageLicense'), row =>
    typeof row.NamespacePrefix === 'string' && isCount(row.AllowedLicenses) && isCount(row.UsedLicenses) && typeof row.Status === 'string'
      ? { namespace: row.NamespacePrefix, allowed: row.AllowedLicenses, used: row.UsedLicenses, status: plainText(row.Status, TEXT_CAP) }
      : null,
  )
  const userLicenses = licenseRows('UserLicense', answer('UserLicense'), row =>
    typeof row.Name === 'string' && isCount(row.TotalLicenses) && isCount(row.UsedLicenses) && typeof row.Status === 'string'
      ? { name: plainText(row.Name, TEXT_CAP), total: row.TotalLicenses, used: row.UsedLicenses, status: plainText(row.Status, TEXT_CAP) }
      : null,
  )
  const permissionSetLicenses = licenseRows('PermissionSetLicense', answer('PermissionSetLicense'), row =>
    typeof row.DeveloperName === 'string' && isCount(row.TotalLicenses) && isCount(row.UsedLicenses) ? { name: plainText(row.DeveloperName, TEXT_CAP), total: row.TotalLicenses, used: row.UsedLicenses } : null,
  )
  notChecked.push(...packageLicenses.notChecked, ...userLicenses.notChecked, ...permissionSetLicenses.notChecked)

  const notes: string[] = []
  if (packages !== null && packages.length === 0) notes.push("No package came back. That isn't proof that none is installed: this CLI user may not be able to see them.")
  if (packages?.some(item => item.namespace === null)) notes.push("A package with no namespace is still a package. Its components can't be grouped by namespace, so they weren't checked here.")

  return {
    packages,
    components: groups,
    licenses: { packageLicenses: packageLicenses.items, userLicenses: userLicenses.items, permissionSetLicenses: permissionSetLicenses.items },
    notChecked,
    partial: notChecked.length > 0,
    managedCode: MANAGED_CODE_NOTE,
    holders: LICENSE_HOLDERS_NOTE,
    notes,
  }
}

/** A pin of 1.4.2 matches a live 1.4.2.7. A pin that names a build has to match it. */
export function versionsMatch(pinned: string, live: string): boolean {
  return live === pinned || live.startsWith(`${pinned}.`)
}
