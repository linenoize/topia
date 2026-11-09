import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { normalizeRoot } from './contract.js'

export { normalizeRoot, pathsMatch } from './contract.js'

/** Plugin-store key for one project. There is no user-wide key. */
export function activationKey(projectRoot: string): string {
  return `sf:activation:${normalizeRoot(projectRoot)}`
}

export function sessionKey(projectRoot: string): string {
  return `sf:session:${normalizeRoot(projectRoot)}`
}

/** The registered org's username and live facts. On this machine only, never in the committed orgs.json. */
export function orgRecordKey(projectRoot: string, orgId: string): string {
  return `${orgRecordPrefix(projectRoot)}${orgId}`
}

export function orgRecordPrefix(projectRoot: string): string {
  return `sf:org:${normalizeRoot(projectRoot)}:`
}

/** The second user of an org, for production writes. On this machine only. It has its own prefix, so a list of orgs never holds it. */
export function orgWriterKey(projectRoot: string, orgId: string): string {
  return `${orgWriterPrefix(projectRoot)}${orgId}`
}

export function orgWriterPrefix(projectRoot: string): string {
  return `sf:writer:${normalizeRoot(projectRoot)}:`
}

export type LogStream = 'plugin-tests' | 'sf-test-runs'

export function defaultStoreRoot(): string {
  return join(homedir(), '.claude', 'plugins', 'store')
}

export function storeFilePath(storeRoot: string): string {
  return join(storeRoot, 'topia-salesforce.json')
}

export function projectLogFolder(projectRoot: string): string {
  // The readable part alone would give C:/work/a_b, C:/work/a/b and C:/work/a b one folder. The hash keeps them apart.
  const root = normalizeRoot(projectRoot)
  return `${root.replace(/[^a-z0-9._-]+/g, '_')}-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`
}

export function logDirectory(storeRoot: string, projectRoot: string, stream: LogStream): string {
  return join(storeRoot, 'topia-salesforce-logs', projectLogFolder(projectRoot), stream)
}

export type LocalKind = 'briefs' | 'plans' | 'practice' | 'ledger' | 'preimages' | 'results' | 'validations' | 'zips' | 'snapshots'

/** Free text and values stay here, in the plugin store, keyed by project. Nothing here is committed. */
export function localDirectory(storeRoot: string, projectRoot: string, kind: LocalKind): string {
  return join(storeRoot, 'topia-salesforce-local', projectLogFolder(projectRoot), kind)
}

export function localFile(storeRoot: string, projectRoot: string, kind: LocalKind, id: string): string {
  return join(localDirectory(storeRoot, projectRoot, kind), `${safeId(id)}.json`)
}

export function orgsFile(projectRoot: string): string {
  return join(projectRoot, '.topia', 'salesforce', 'orgs.json')
}

export function plansDirectory(projectRoot: string): string {
  return join(projectRoot, '.topia', 'salesforce', 'plans')
}

/** Committed. Ids, field names, counts, and hashes only. */
export function planFile(projectRoot: string, planId: string): string {
  return join(plansDirectory(projectRoot), `${safeId(planId)}.json`)
}

export function journalDirectory(projectRoot: string): string {
  return join(projectRoot, '.topia', 'salesforce', 'journal')
}

export function journalFile(projectRoot: string, correlationId: string): string {
  return join(journalDirectory(projectRoot), `${safeId(correlationId)}.jsonl`)
}

export function safeId(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value) || /^[.]+$/.test(value)) {
    throw new Error('Id contains characters that are not safe in a file name.')
  }
  return value
}
