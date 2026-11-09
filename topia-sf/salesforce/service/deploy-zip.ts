import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { DeployStatus, RawRetrieved } from './adapter.js'
import { plainText } from './contract.js'
import { sameId } from './identity.js'
import { localFile } from './paths.js'
import { canonical, sha256 } from './plans.js'
import { hashContent } from './sf-adapter.js'
import { METADATA_MEMBER } from './sf-cli.js'
import { readZip, writeZip, ZipError, type ZipEntry } from './zip.js'

/**
 * Contract sections 7 and 8. The runner builds the zip itself, into a private
 * folder, and everything anyone reads about a deploy comes from that zip: what ships,
 * what it deletes, and what the job must have validated. `.forceignore` and the
 * working tree have no say, because nothing here asks the CLI to read a project.
 */

/** Salesforce's limit is 10 days from the start of the validation. This leaves a margin. */
export const VALIDATION_MAX_AGE_MS = 9 * 24 * 60 * 60 * 1000

const CLOCK_SKEW_MS = 5 * 60 * 1000
const MANIFEST = 'package.xml'
const DESTRUCTIVE = ['destructiveChanges.xml', 'destructiveChangesPre.xml', 'destructiveChangesPost.xml']
const MAX_ARTIFACT_FILES = 20_000

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

const NAMESPACE = 'http://soap.sforce.com/2006/04/metadata'
const NAMESPACE_PATTERN = NAMESPACE.replaceAll('.', '[.]')
/** Text between two tags: no markup, and only the five named entities. A numeric entity or CDATA is not in it. */
const TEXT = '((?:[^<>&]|&(?:amp|lt|gt|quot|apos);)*)'

function xmlText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_all, name: string) => XML_ENTITIES[name] as string)
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * A manifest is read only in the exact plain form the Salesforce CLI writes, and packageXml writes. Anything else is
 * refused, because a form this reader skips could still be read by Salesforce, and then the screen and the Apex gate
 * would show less than ships: `<name >`, CDATA, an attribute on a tag, a prefixed tag, a comment, a numeric entity,
 * a second `<name>`. Refusing is the check. There is no attempt to read every XML spelling.
 */
function membersIn(xml: string, file: string): string[] | { problem: string } {
  let rest = xml.replace(/^﻿/, '')
  const stuck = (why: string): { problem: string } => ({
    problem: `${file} isn't in the plain form this service reads (${why}), so nothing was planned from it. Write it the way the Salesforce CLI does: a <Package xmlns="${NAMESPACE}"> holding <types> blocks, each with <members> lines and one <name>, and no comments, CDATA, attributes, prefixes, spaces inside a tag, or entities other than &amp; &lt; &gt; &quot; &apos;. It stopped at: ${rest.length === 0 ? 'the end of the file' : `"${plainText(rest.slice(0, 50), 50)}"`}.`,
  })
  const eat = (pattern: RegExp): RegExpExecArray | null => {
    const found = pattern.exec(rest)
    if (found !== null) rest = rest.slice(found[0].length)
    return found
  }
  const word = (value: string | undefined): string | null => {
    const text = xmlText(value ?? '')
    return text.length > 0 && text === text.trim() ? text : null
  }
  eat(/^<\?xml version="1[.]0" encoding="UTF-8"\?>\s*/)
  if (eat(new RegExp(`^<Package xmlns="${NAMESPACE_PATTERN}">\\s*`)) === null) return stuck('the root is not a plain <Package> in the metadata namespace')
  const members: string[] = []
  let versions = 0
  for (;;) {
    if (eat(/^<\/Package>\s*$/) !== null) return members
    if (eat(/^<version>\d{1,3}[.]\d{1,2}<\/version>\s*/) !== null) {
      versions += 1
      if (versions > 1) return stuck('two versions')
      continue
    }
    if (eat(/^<types>\s*/) === null) return stuck('something other than <types>, <version>, or the end')
    const names: string[] = []
    const named: string[] = []
    for (;;) {
      if (eat(/^<\/types>\s*/) !== null) break
      const member = eat(new RegExp(`^<members>${TEXT}</members>\\s*`))
      if (member !== null) {
        const text = word(member[1])
        if (text === null) return stuck('an empty member, or one with spaces around it')
        named.push(text)
        continue
      }
      const name = eat(new RegExp(`^<name>${TEXT}</name>\\s*`))
      if (name !== null) {
        const text = word(name[1])
        if (text === null) return stuck('an empty type name, or one with spaces around it')
        names.push(text)
        continue
      }
      return stuck('something other than <members> or <name> inside <types>')
    }
    if (names.length !== 1) return stuck(`${names.length} <name> elements in one <types>`)
    if (named.length === 0) return stuck('a <types> with no members')
    for (const member of named) members.push(`${names[0]}:${member}`)
  }
}

export function packageXml(members: readonly string[], version = '66.0'): string {
  const byType = new Map<string, string[]>()
  for (const member of members) {
    const at = member.indexOf(':')
    const type = member.slice(0, at)
    byType.set(type, [...(byType.get(type) ?? []), member.slice(at + 1)])
  }
  const types = [...byType.keys()].sort().map(type => `  <types>\n${(byType.get(type) as string[]).sort().map(name => `    <members>${escapeXml(name)}</members>`).join('\n')}\n    <name>${escapeXml(type)}</name>\n  </types>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types.join('\n')}\n  <version>${version}</version>\n</Package>\n`
}

export type Manifest = { members: string[]; destructive: string[] }

/** Read from the zip, never from the plan. A wildcard can't be compared with what a job validated, so it's refused. */
export function manifestOf(entries: readonly ZipEntry[]): Manifest | { problem: string } {
  const text = (path: string) => entries.find(item => item.path === path)?.bytes.toString('utf8')
  const manifest = text(MANIFEST)
  if (manifest === undefined) return { problem: 'A deploy takes metadata format: a package.xml at the root of the folder or zip. Source format has to be converted first, and that isn\'t something this service does.' }
  const members = membersIn(manifest, MANIFEST)
  if ('problem' in members) return members
  const destructive: string[] = []
  for (const path of DESTRUCTIVE) {
    const held = text(path)
    if (held === undefined) continue
    const read = membersIn(held, path)
    if ('problem' in read) return read
    destructive.push(...read)
  }
  if (members.length === 0 && destructive.length === 0) return { problem: 'That package.xml names no members.' }
  for (const member of [...members, ...destructive]) {
    if (member.includes('*')) return { problem: 'That package.xml uses a wildcard. Name each member, so the job can be compared with what ships.' }
    if (!METADATA_MEMBER.test(member)) return { problem: `That package.xml names something this service can't check: ${plainText(member, 80)}.` }
  }
  const stray = filesOutsideManifest(entries, members)
  if (stray !== null) return { problem: stray }
  return { members, destructive }
}

/** Code is read from one folder per kind. A file there that the manifest doesn't name would ship unflagged to anything that read it. */
const CODE_FOLDERS: { folder: string; type: string; suffixes: string[] }[] = [
  { folder: 'classes', type: 'ApexClass', suffixes: ['.cls', '.cls-meta.xml'] },
  { folder: 'triggers', type: 'ApexTrigger', suffixes: ['.trigger', '.trigger-meta.xml'] },
  { folder: 'pages', type: 'ApexPage', suffixes: ['.page', '.page-meta.xml'] },
  { folder: 'components', type: 'ApexComponent', suffixes: ['.component', '.component-meta.xml'] },
]
const BUNDLE_FOLDERS: { folder: string; type: string }[] = [
  { folder: 'lwc', type: 'LightningComponentBundle' },
  { folder: 'aura', type: 'AuraDefinitionBundle' },
]
const APEX_FILE = /[.](?:cls|trigger)(?:-meta[.]xml)?$/i

/**
 * Every file in those folders has to belong to a member the manifest names, so the list the person sees is the list
 * that ships. Other kinds of file are not matched here, and nothing says they are.
 */
function filesOutsideManifest(entries: readonly ZipEntry[], members: readonly string[]): string | null {
  const named = new Set(members)
  for (const entry of entries) {
    const path = entry.path
    if (path.endsWith('/') || path === MANIFEST || DESTRUCTIVE.includes(path)) continue
    const parts = path.split('/')
    const code = CODE_FOLDERS.find(item => item.folder === parts[0])
    if (code !== undefined) {
      const suffix = parts.length === 2 ? code.suffixes.find(item => path.endsWith(item)) : undefined
      const name = suffix === undefined ? '' : (parts[1] as string).slice(0, -suffix.length)
      if (name.length === 0) return `The zip holds ${plainText(path, 80)}, which is not a component file of the kind ${code.folder}/ holds, so it was refused.`
      if (!named.has(`${code.type}:${name}`)) return `The zip holds ${plainText(path, 80)}, and package.xml does not name ${code.type}:${plainText(name, 60)}, so it was refused. Name it in package.xml, or take the file out.`
      continue
    }
    const bundle = BUNDLE_FOLDERS.find(item => item.folder === parts[0])
    if (bundle !== undefined) {
      if (parts.length < 3 || !named.has(`${bundle.type}:${parts[1]}`)) return `The zip holds ${plainText(path, 80)}, and package.xml does not name ${bundle.type}:${plainText(parts[1] ?? '', 60)}, so it was refused. Name it in package.xml, or take the file out.`
      continue
    }
    if (APEX_FILE.test(path)) return `The zip holds Apex outside classes/ and triggers/, at ${plainText(path, 80)}, so it was refused.`
  }
  return null
}

/**
 * What a plan can say about an artifact before anything runs: that its manifest can't be read the way this
 * service reads one, or that its files don't match it. A missing manifest or a wildcard are said later, as before.
 */
export function artifactProblem(real: string): string | null {
  try {
    const entries = statSync(real).isDirectory() ? folderEntries(real) : readZip(readFileSync(real))
    if (!entries.some(item => item.path === MANIFEST)) return null
    const manifest = manifestOf(entries)
    if (!('problem' in manifest)) return null
    return /plain form|not a component file|does not name|Apex outside/.test(manifest.problem) ? manifest.problem : null
  } catch {
    // A zip that can't be opened, or a link in the folder, is said where it always was.
    return null
  }
}

export type ComponentGroup = { type: string; added: string[]; changed: string[]; deleted: string[] }

/** By type, added, changed, and deleted. `existing` is what the baseline retrieve found in the org. */
export function componentSummary(manifest: Manifest, existing: readonly string[]): ComponentGroup[] {
  const known = new Set(existing)
  const groups = new Map<string, ComponentGroup>()
  const group = (member: string): { group: ComponentGroup; name: string } => {
    const at = member.indexOf(':')
    const type = member.slice(0, at)
    if (!groups.has(type)) groups.set(type, { type, added: [], changed: [], deleted: [] })
    return { group: groups.get(type) as ComponentGroup, name: member.slice(at + 1) }
  }
  for (const member of manifest.members) {
    const { group: into, name } = group(member)
    ;(known.has(member) ? into.changed : into.added).push(name)
  }
  for (const member of manifest.destructive) {
    const { group: into, name } = group(member)
    into.deleted.push(name)
  }
  return [...groups.values()].sort((left, right) => left.type.localeCompare(right.type))
}

function isShipped(path: string): boolean {
  return !basename(path).startsWith('.')
}

function walk(dir: string, into: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    // A link could carry a file from anywhere into what ships.
    if (lstatSync(path).isSymbolicLink()) throw new Error(`That artifact holds a link, ${plainText(name, 80)}, so it was refused. Copy the file in, or take the link out.`)
    if (statSync(path).isDirectory()) {
      if (isShipped(path)) walk(path, into)
    } else if (isShipped(path)) into.push(path)
    if (into.length > MAX_ARTIFACT_FILES) throw new Error('That artifact holds too many files.')
  }
}

/** Sorted, with dot files left out, so a `.forceignore` can't change what ships or what the hash says. */
export function folderEntries(root: string): ZipEntry[] {
  const files: string[] = []
  walk(root, files)
  return files.map(file => ({ path: relative(root, file).split(sep).join('/'), bytes: readFileSync(file) })).sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
}

/** What a plan binds: the sorted paths and bytes. A zip with the same contents has the same hash, whatever its bytes. */
export function contentHashOf(entries: readonly ZipEntry[]): string {
  const sorted = [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  return sha256(canonical(sorted.map(item => ({ path: item.path, sha256: sha256(item.bytes) }))))
}

/** The real path has to stay inside the project, so a link can't reach out. */
export function placeArtifact(projectRoot: string, given: string): { real: string } | { problem: string } {
  let real: string
  let root: string
  try {
    real = realpathSync(isAbsolute(given) ? given : resolve(projectRoot, given))
    root = realpathSync(projectRoot)
  } catch {
    return { problem: 'That artifact does not exist in this project.' }
  }
  const inside = relative(root, real)
  if (inside.length === 0 || inside.startsWith('..') || isAbsolute(inside)) return { problem: 'An artifact has to be inside this project.' }
  return { real }
}

export function hashArtifactAt(real: string): { hash: string; files: number } {
  if (!statSync(real).isDirectory()) return { hash: sha256(readFileSync(real)), files: 1 }
  const entries = folderEntries(real)
  return { hash: contentHashOf(entries), files: entries.length }
}

const SNAPSHOT = 'snapshot:'

export function snapshotFile(storeRoot: string, projectRoot: string, planId: string): string {
  return localFile(storeRoot, projectRoot, 'snapshots', planId).replace(/\.json$/, '.zip')
}

export function zipFile(storeRoot: string, projectRoot: string, planId: string): string {
  return localFile(storeRoot, projectRoot, 'zips', planId).replace(/\.json$/, '.zip')
}

export function snapshotArtifact(planId: string): string {
  return `${SNAPSHOT}${planId}`
}

export type BuiltZip = { bytes: Buffer; hash: string; entries: ZipEntry[]; manifest: Manifest }

function factsOf(bytes: Buffer): BuiltZip | { problem: string } {
  try {
    const entries = readZip(bytes)
    const manifest = manifestOf(entries)
    if ('problem' in manifest) return manifest
    return { bytes, hash: sha256(bytes), entries, manifest }
  } catch (error) {
    if (error instanceof ZipError) return { problem: error.message }
    throw error
  }
}

/** From the artifact on disk, and it has to still be what the plan hashed. */
export function buildZip(storeRoot: string, projectRoot: string, artifactPath: string, artifactHash: string): BuiltZip | { problem: string } {
  let bytes: Buffer
  if (artifactPath.startsWith(SNAPSHOT)) {
    try {
      bytes = readFileSync(snapshotFile(storeRoot, projectRoot, artifactPath.slice(SNAPSHOT.length)))
    } catch {
      return { problem: 'That rollback snapshot is not on this machine.' }
    }
    if (sha256(bytes) !== artifactHash) return { problem: 'That rollback snapshot changed since the plan, so nothing was validated. Write a new plan.' }
    return factsOf(bytes)
  }
  const placed = placeArtifact(projectRoot, artifactPath)
  if ('problem' in placed) return placed
  if (hashArtifactAt(placed.real).hash !== artifactHash) return { problem: 'That artifact changed since the plan, so nothing was validated. Write a new plan.' }
  if (statSync(placed.real).isDirectory()) return factsOf(writeZip(folderEntries(placed.real)))
  return factsOf(readFileSync(placed.real))
}

/** The stored zip, re-read and re-checked against the plan's hash. A swapped file stops here. */
export function readStoredZip(storeRoot: string, projectRoot: string, planId: string, artifactHash: string, zipHash: string): BuiltZip | { problem: string } {
  let bytes: Buffer
  try {
    bytes = readFileSync(zipFile(storeRoot, projectRoot, planId))
  } catch {
    return { problem: 'The zip that was validated is not on this machine. Validate again.' }
  }
  if (sha256(bytes) !== zipHash) return { problem: 'The zip on disk is not the one that was validated, so nothing shipped. Validate again.' }
  const facts = factsOf(bytes)
  if ('problem' in facts) return facts
  if (sha256(bytes) !== artifactHash && contentHashOf(facts.entries) !== artifactHash) return { problem: "The zip on disk doesn't hold what the plan hashed, so nothing shipped. Validate again." }
  return facts
}

export type AcceptExpected = { userId: string; members: readonly string[]; destructive: readonly string[]; ignoreWarnings: boolean; now: number; production?: boolean }

/**
 * Contract section 8, read from what the org says about the job, and never from a
 * file. An empty list means it counts. It says nothing about later deployments, which
 * void all validations: there's no way to see those coming, so a refusal is how they
 * show up, and a refusal means validate again.
 */
/** Decided, and the docs say the same. No test run means no quick deploy, and there's no other way to production. */
const NO_TESTS_ON_PRODUCTION = "The job completed no tests. This org may have no local Apex tests. Production ships only by quick deploy of a validation that ran tests, and a full deploy is banned, so nothing can ship until tests run. Add a test class, in the org or in this deploy, then validate again."

export function acceptValidation(job: DeployStatus, expected: AcceptExpected): string[] {
  const problems: string[] = []
  if (!job.checkOnly) problems.push('The job is not check-only.')
  if (job.status !== 'Succeeded' || !job.success || !job.done) problems.push(`The job did not succeed. Its status is ${plainText(job.status, 40)}.`)
  if (job.exit !== 0) problems.push(`The CLI exited ${job.exit} on the job.`)
  if (!job.runTestsEnabled) problems.push('The job ran with tests turned off.')
  if (job.numberTestsCompleted <= 0) problems.push(expected.production === true ? NO_TESTS_ON_PRODUCTION : 'The job completed no tests, so it proves nothing about them.')
  if (job.numberTestErrors !== 0 || job.testFailures !== 0) problems.push(`${Math.max(job.numberTestErrors, job.testFailures)} tests failed in the job.`)
  if (job.numberComponentErrors !== 0 || job.failures.length > 0) problems.push(`${Math.max(job.numberComponentErrors, job.failures.length)} components failed in the job.`)
  if (!job.rollbackOnError) problems.push('The job does not roll back on error.')
  if (job.ignoreWarnings !== expected.ignoreWarnings) problems.push(expected.ignoreWarnings ? 'The plan names --ignore-warnings, and the job did not use it.' : 'The job ignored warnings, and the plan does not name that.')
  if (job.createdBy === null || !sameId(job.createdBy, expected.userId)) problems.push('The job was started by another user.')
  const started = Date.parse(job.startDate ?? job.createdDate ?? '')
  if (Number.isNaN(started)) problems.push('The job says nothing about when it started, so its age is unknown.')
  else if (expected.now - started >= VALIDATION_MAX_AGE_MS) problems.push(`The job is too old: it started over ${Math.round(VALIDATION_MAX_AGE_MS / (24 * 60 * 60 * 1000))} days ago, and Salesforce's limit is 10 days from the start.`)
  else if (started - expected.now > CLOCK_SKEW_MS) problems.push('The job says it started in the future.')
  const shipped = new Set([...expected.members, ...expected.destructive])
  const validated = new Set(job.successes.map(item => `${item.type}:${item.fullName}`))
  const missing = [...shipped].filter(member => !validated.has(member))
  const extra = [...validated].filter(member => !shipped.has(member))
  if (missing.length > 0 || extra.length > 0) problems.push(`The job's component list is not the zip's. ${missing.length} in the zip were not validated, and ${extra.length} validated are not in the zip.`)
  return problems
}

/** The path in the org's terms, with the CLI's wrapper folder off. */
function orgPath(path: string): string {
  return path.replace(/^unpackaged\//, '')
}

export type Baseline = { files: Record<string, string>; fetched: string[] }

export function baselineOf(retrieved: RawRetrieved): Baseline {
  const files: Record<string, string> = {}
  for (const file of retrieved.files) {
    const path = orgPath(file.path)
    if (path !== MANIFEST) files[path] = hashContent(file.bytes)
  }
  return { files, fetched: [...retrieved.fetched].sort() }
}

/** What differs between two reads of the same manifest. Paths only. */
export function driftBetween(left: Baseline, right: Baseline): string[] {
  const out: string[] = []
  for (const path of new Set([...Object.keys(left.files), ...Object.keys(right.files)])) {
    if (left.files[path] !== right.files[path]) out.push(path)
  }
  for (const member of new Set([...left.fetched, ...right.fetched])) {
    if (left.fetched.includes(member) !== right.fetched.includes(member)) out.push(member)
  }
  return out.sort()
}

export function snapshotZip(retrieved: RawRetrieved): Buffer {
  const entries = retrieved.files.filter(file => orgPath(file.path) !== MANIFEST).map(file => ({ path: orgPath(file.path), bytes: file.bytes }))
  return writeZip([{ path: MANIFEST, bytes: Buffer.from(packageXml(retrieved.fetched)) }, ...entries])
}

/** Every file shipped has to read back the same, and every deleted member has to be gone. Paths only. */
export function differencesFromZip(built: { entries: readonly ZipEntry[]; manifest: Manifest }, retrieved: RawRetrieved): string[] {
  const read = baselineOf(retrieved)
  const out: string[] = []
  for (const entry of built.entries) {
    if (entry.path === MANIFEST || DESTRUCTIVE.includes(entry.path)) continue
    if (read.files[entry.path] !== hashContent(entry.bytes)) out.push(entry.path)
  }
  for (const member of built.manifest.destructive) if (read.fetched.includes(member)) out.push(member)
  return out.sort()
}
