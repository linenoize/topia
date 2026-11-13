import { ALLOWED_OPERATION_CLASSES, DESTRUCTIVE_CEILING, SINGLE_USER_WARNING, UNKNOWN_WRITE_WARNING, WRITE_WARNING } from './contract.js'
import type { OrgEntry, OrgRecord, WriterLogin } from './contract.js'
import { sameId, to18 } from './identity.js'
import { readJson, UnreadableFileError, writeJson } from './json-file.js'
import { orgRecordKey, orgRecordPrefix, orgsFile, orgWriterKey, orgWriterPrefix } from './paths.js'
import { readStore, updateStore } from './store.js'

/**
 * A registered org has two halves. orgs.json is committed, so a team shares it,
 * and it holds no username. The store record is this machine's, and holds the
 * username every call targets. Both have to be present.
 */

function isEntry(value: unknown): value is OrgEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Partial<OrgEntry>
  return typeof entry.orgId === 'string' && entry.orgId.length > 0
}

export function readOrgsFile(projectRoot: string): OrgEntry[] {
  const file = orgsFile(projectRoot)
  const parsed = readJson<{ orgs?: unknown }>(file)
  if (parsed === null) return []
  if (typeof parsed !== 'object' || !Array.isArray(parsed.orgs)) throw new UnreadableFileError(file, 'expected { orgs: [...] }')
  return parsed.orgs.filter(isEntry)
}

function isRecord(value: unknown): value is OrgRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Partial<OrgRecord>
  return typeof record.orgId === 'string' && typeof record.username === 'string' && record.username.length > 0 && typeof record.isSandbox === 'boolean' && typeof record.instanceUrl === 'string'
}

export function listOrgRecords(storeRoot: string, projectRoot: string): OrgRecord[] {
  const prefix = orgRecordPrefix(projectRoot)
  const records: OrgRecord[] = []
  for (const [key, value] of Object.entries(readStore(storeRoot))) {
    if (key.startsWith(prefix) && isRecord(value)) records.push(value)
  }
  return records
}

export type RegisteredOrg = { entry: OrgEntry; record: OrgRecord }

export function findRegistered(storeRoot: string, projectRoot: string, orgId: string): RegisteredOrg | { missing: string } {
  const entry = readOrgsFile(projectRoot).find(item => sameId(item.orgId, orgId))
  const record = listOrgRecords(storeRoot, projectRoot).find(item => sameId(item.orgId, orgId))
  if (!entry && !record) return { missing: `Org ${orgId} is not registered. The CLI default org is not used. /topia-sf:connect registers one.` }
  if (!entry) return { missing: `Org ${orgId} is not in this project's orgs.json. /topia-sf:connect registers it again.` }
  if (!record) return { missing: `Org ${orgId} is in orgs.json but is not connected on this machine. /topia-sf:connect connects it.` }
  return { entry, record }
}

/** A username somebody added by hand to the committed file does not survive the next write. */
function withoutUsername(entry: OrgEntry): OrgEntry {
  const { username: _dropped, ...kept } = entry as OrgEntry & { username?: unknown }
  return kept
}

/** The only writer of orgs.json. It keeps a team's narrowing and never writes a username. */
export function registerOrg(storeRoot: string, projectRoot: string, record: OrgRecord, at: string): void {
  const orgId = to18(record.orgId)
  const current = readOrgsFile(projectRoot)
  const existing = current.find(item => sameId(item.orgId, orgId))
  const entry: OrgEntry = { ...(existing ? withoutUsername(existing) : {}), orgId, instanceUrl: record.instanceUrl, name: record.name, verifiedAt: at }
  updateStore(storeRoot, data => {
    data[orgRecordKey(projectRoot, orgId)] = { ...record, orgId }
  })
  writeJson(orgsFile(projectRoot), { orgs: [...current.filter(item => !sameId(item.orgId, orgId)).map(withoutUsername), entry] })
}

/** The second user of an org. It goes in the store and never in orgs.json, and it leaves the reader as it is. */
export function registerWriter(storeRoot: string, projectRoot: string, record: OrgRecord): void {
  const orgId = to18(record.orgId)
  updateStore(storeRoot, data => {
    data[orgWriterKey(projectRoot, orgId)] = { ...record, orgId, role: 'writer' }
  })
}

export function listWriters(storeRoot: string, projectRoot: string): OrgRecord[] {
  const prefix = orgWriterPrefix(projectRoot)
  const records: OrgRecord[] = []
  for (const [key, value] of Object.entries(readStore(storeRoot))) {
    if (key.startsWith(prefix) && isRecord(value)) records.push(value)
  }
  return records
}

export function readWriter(storeRoot: string, projectRoot: string, orgId: string): OrgRecord | null {
  return listWriters(storeRoot, projectRoot).find(item => sameId(item.orgId, orgId)) ?? null
}

export function setWriterLogin(storeRoot: string, projectRoot: string, orgId: string, login: WriterLogin): void {
  updateStore(storeRoot, data => {
    const key = orgWriterKey(projectRoot, to18(orgId))
    if (isRecord(data[key])) data[key] = { ...data[key], login }
  })
}

/**
 * Who a change on this org runs as. A sandbox needs none of this. Production goes to
 * its writer, or to its one user if a person accepted that, and nothing else.
 */
export function writeTargetOf(storeRoot: string, projectRoot: string, reader: OrgRecord): { record: OrgRecord } | { refused: string } {
  if (reader.isSandbox) return { record: reader }
  const writer = readWriter(storeRoot, projectRoot, reader.orgId)
  if (writer !== null) return { record: writer }
  if (reader.singleUserAcceptedAt !== undefined) return { record: reader }
  const accept = reader.writeAccess.canWrite === 'no' ? '' : ` If this org has only one user that can write, /topia-sf:connect lets you accept that when you register ${reader.username} again.`
  return { refused: `This is production, and no writer is registered, so nothing changed. In your own terminal, run sf org login web --instance-url ${reader.instanceUrl}, and sign in as a write-capable user in the browser, with MFA. Then run /topia-sf:connect, and register that user with role writer.${accept}` }
}

/** Drops an org a person has replaced in the dialog, from both halves, with its writer. */
export function removeOrg(storeRoot: string, projectRoot: string, orgId: string): void {
  const prefixes = [orgRecordPrefix(projectRoot), orgWriterPrefix(projectRoot)]
  updateStore(storeRoot, data => {
    for (const key of Object.keys(data)) {
      for (const prefix of prefixes) if (key.startsWith(prefix) && sameId(key.slice(prefix.length), orgId)) delete data[key]
    }
  })
  writeJson(orgsFile(projectRoot), { orgs: readOrgsFile(projectRoot).filter(item => !sameId(item.orgId, orgId)).map(withoutUsername) })
}

export type EffectiveLimits = { allowedOperationClasses: string[]; destructiveCeiling: number }

/** orgs.json is committed and editable, so it can only ever make these smaller. */
export function effectiveLimits(entry: OrgEntry): EffectiveLimits {
  // A key that is there and malformed is a narrowing that went wrong. It narrows to nothing, and never widens to everything.
  const given = entry.allowedOperationClasses as unknown
  const narrowed = given === undefined ? [...ALLOWED_OPERATION_CLASSES] : Array.isArray(given) ? ALLOWED_OPERATION_CLASSES.filter(name => given.includes(name)) : []
  const asked = entry.destructiveCeiling as unknown
  const ceiling = asked === undefined ? DESTRUCTIVE_CEILING : typeof asked === 'number' && Number.isFinite(asked) && asked >= 0 ? Math.min(asked, DESTRUCTIVE_CEILING) : 0
  return { allowedOperationClasses: narrowed, destructiveCeiling: ceiling }
}

export function writeWarningFor(record: OrgRecord): string | null {
  if (record.singleUserAcceptedAt !== undefined) return SINGLE_USER_WARNING
  switch (record.writeAccess?.canWrite) {
    case 'no':
      return null
    case 'yes':
      return WRITE_WARNING
    default:
      return UNKNOWN_WRITE_WARNING
  }
}
