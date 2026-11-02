#!/usr/bin/env node
// A test-only stand-in for the Salesforce CLI. It never reaches a network. The
// adapter spawns it as a real process, the way it spawns the real CLI, through
// the tarball layout (bin/sf, bin/sf.cmd, bin/run.js). A scenario file under the
// isolated HOME drives what it answers, because the adapter's scrubbed
// environment keeps HOME and drops anything named SF_ or SFDX_.
//
// Output shapes follow @salesforce/cli 2.156.8 schemas and source. They have not
// been compared with a real org: see docs/salesforce/LIVE-CHECKLIST.md.
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const argv = process.argv.slice(2)
const parentPid = process.ppid
const home = process.env.HOME || process.env.USERPROFILE || '.'
const state = join(home, '.fake-sf')
const root = dirname(dirname(fileURLToPath(import.meta.url)))

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

const scenario = readJson(join(state, 'scenario.json'), {})
const snapshot = readJson(join(root, '..', 'sf-flags.snapshot.json'), { commands: {} })

function command() {
  const words = []
  for (const word of argv) {
    if (word.startsWith('-')) break
    words.push(word)
    if (snapshot.commands[words.join(' ')]) break
  }
  return words.join(' ')
}

const name = command()
const rest = argv.slice(name.length === 0 ? 0 : name.split(' ').length)
const flags = {}
const positional = []
let badFlag = null
for (const word of rest) {
  if (!word.startsWith('-')) {
    positional.push(word)
    continue
  }
  const match = word.match(/^--([a-z-]+)(?:=(.*))?$/s)
  if (!match) {
    badFlag = word
    continue
  }
  const [, key, value] = match
  if (Array.isArray(flags[key])) flags[key].push(value)
  else if (flags[key] !== undefined) flags[key] = [flags[key], value]
  else flags[key] = value === undefined ? true : value
  const known = snapshot.commands[name]?.flags?.[key]
  if (!known) badFlag = word
  else if (known.type === 'option' && value === undefined) badFlag = word
}

const soql = name === 'data query' && typeof flags.file === 'string' && existsSync(flags.file) ? readFileSync(flags.file, 'utf8') : null

mkdirSync(state, { recursive: true })
appendFileSync(join(state, 'calls.jsonl'), `${JSON.stringify({ argv, command: name, flags, positional, soql, cwd: process.cwd(), env: process.env, execArgv: process.execArgv })}\n`)

function succeed(result, warnings = []) {
  process.stdout.write(`${JSON.stringify({ status: 0, result, warnings })}\n`)
  process.exitCode = 0
}

function fail(error) {
  const exitCode = error.exitCode ?? 1
  process.stdout.write(`${JSON.stringify({ name: error.name, message: error.message, exitCode, status: exitCode, commandName: name, warnings: [], stack: `${error.name}: at the fake`, ...error.extra })}\n`)
  process.exitCode = exitCode
}

const FAILURES = {
  'expired-auth': { name: 'INVALID_SESSION_ID', message: 'Session expired or invalid' },
  'refresh-failed': { name: 'RefreshTokenAuthError', message: 'Error authenticating with the refresh token due to: expired access/refresh token' },
  'no-auth': { name: 'NamedOrgNotFoundError', message: 'No authorization information found for that org.' },
  'rate-limit': { name: 'REQUEST_LIMIT_EXCEEDED', message: 'TotalRequests Limit exceeded.' },
  'denied': { name: 'INSUFFICIENT_ACCESS', message: 'Insufficient access rights on this object.' },
  'unexplained': { name: 'SomethingNewError', message: 'The CLI failed in a way nobody documented.' },
}

// ── an org with state, so a test can count what was really written ─────────

const orgFile = join(state, 'org.json')
const writesFile = join(state, 'writes.jsonl')
const countersFile = join(state, 'counters.json')
const CLI_USER_ID = '00500000000000AAAA'

function loadOrg() {
  const held = readJson(orgFile, null)
  if (held) return held
  return { records: scenario.records ?? {}, metadata: scenario.metadata ?? {}, clock: 1000, serial: 1, jobs: {}, deploys: {} }
}

function saveOrg(org) {
  writeFileSync(orgFile, JSON.stringify(org))
}

function recordWrite(entry) {
  appendFileSync(writesFile, `${JSON.stringify(entry)}\n`)
}

function nextId(org, prefix) {
  org.serial += 1
  return `${prefix}${String(org.serial).padStart(12, '0')}AAA`
}

function counted(key) {
  const counters = readJson(countersFile, {})
  counters[key] = (counters[key] ?? 0) + 1
  writeFileSync(countersFile, JSON.stringify(counters))
  return counters[key]
}

function stamp(org) {
  org.clock += 1
  return new Date(Date.parse('2026-06-01T00:00:00.000Z') + org.clock * 1000).toISOString().replace('Z', '+0000')
}

function table(org, object) {
  org.records[object] = org.records[object] ?? {}
  return org.records[object]
}

const CHECK = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

function id18(id) {
  if (typeof id !== 'string' || id.length !== 15) return id
  let suffix = ''
  for (let block = 0; block < 3; block += 1) {
    let bits = 0
    for (let at = 0; at < 5; at += 1) if (/[A-Z]/.test(id.charAt(block * 5 + at))) bits += 1 << at
    suffix += CHECK.charAt(bits)
  }
  return id + suffix
}

/**
 * What the org keeps, which is not always what was sent. Request bodies may carry
 * 15 character ids, and every response carries 18 (REST API guide, "Salesforce
 * IDs in response bodies are always 18-character IDs"). A multi-select picklist
 * is stored in definition order. An empty string in a text field is stored as null.
 */
function stored(object, field, value) {
  const described = (scenario.describe?.[object]?.fields ?? []).find(item => item.name === field)
  if (!described || value === null || value === undefined) return value
  if ((described.type === 'reference' || described.type === 'id') && typeof value === 'string') return id18(value)
  if (described.type === 'multipicklist' && typeof value === 'string' && value !== '') {
    const order = (described.picklistValues ?? []).map(item => item.value)
    const rank = item => (order.includes(item) ? order.indexOf(item) : order.length)
    return [...new Set(value.split(';'))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).join(';')
  }
  if (typeof value === 'string' && value === '' && ['string', 'textarea', 'email', 'phone', 'url', 'picklist', 'multipicklist', 'combobox'].includes(described.type)) return null
  return value
}

/** One save: the fields, then a new SystemModstamp, then whatever automation does. */
function saveRecord(org, object, record, fields) {
  for (const [field, value] of Object.entries(fields)) record[field] = stored(object, field, value)
  record.SystemModstamp = stamp(org)
  record.__writtenByCli = true
  for (const [field, value] of Object.entries(scenario.automation?.[object] ?? {})) record[field] = value
}

function queryAnswer(records, type) {
  return { records: records.map(record => ({ attributes: { type, url: `/services/data/v66.0/sobjects/${type}/x` }, ...record })), totalSize: records.length, done: true }
}

function pick(record, fields) {
  const out = {}
  for (const field of fields) if (field in record) out[field] = record[field]
  return out
}

/** Answers from the org's state: the frozen-id reads, the access check, the counts, and the automation lists. */
function statefulQuery(text) {
  const org = loadOrg()
  const access = text.match(/FROM UserRecordAccess WHERE .*RecordId IN \((.+)\)/is)
  if (access) {
    const ids = [...access[1].matchAll(/'([^']+)'/g)].map(item => item[1])
    if (ids.length > 200) return fail({ name: 'MALFORMED_QUERY', message: 'UserRecordAccess takes at most 200 ids.' })
    return succeed(queryAnswer(ids.map(id => ({ RecordId: id, HasEditAccess: scenario.access?.[id]?.HasEditAccess ?? true, HasDeleteAccess: scenario.access?.[id]?.HasDeleteAccess ?? true, MaxAccessLevel: 'All' })), 'UserRecordAccess'))
  }
  const entity = text.match(/FROM EntityDefinition WHERE QualifiedApiName = '(\w+)'/i)
  if (entity) {
    const found = scenario.entityIds?.[entity[1]]
    return succeed(queryAnswer(found === undefined ? [] : [{ DurableId: found }], 'EntityDefinition'))
  }
  // TableEnumOrId holds a standard object's name and a custom object's Id. A scenario with triggerObjectId behaves that way.
  if (/FROM ApexTrigger/i.test(text)) {
    const answers = scenario.triggerObjectId === undefined || text.includes(scenario.triggerObjectId)
    return succeed(queryAnswer(answers ? (scenario.triggers ?? []).map(Name => ({ Name, Status: 'Active' })) : [], 'ApexTrigger'))
  }
  if (/FROM FlowDefinitionView/i.test(text)) return succeed(queryAnswer((scenario.flows ?? []).map(ApiName => ({ ApiName, Label: ApiName })), 'FlowDefinitionView'))
  if (/FROM SetupAuditTrail/i.test(text)) return succeed(queryAnswer(scenario.setupAudit ?? [], 'SetupAuditTrail'))
  const count = text.match(/^SELECT COUNT\(\) FROM (\w+) WHERE LastModifiedById/i)
  if (count) {
    const rows = Object.values(table(org, count[1])).filter(record => record.__writtenByCli)
    return succeed({ records: [], totalSize: rows.length, done: true })
  }
  const read = text.match(/^SELECT (.+?) FROM (\w+) WHERE Id IN \((.+)\)\s*$/is)
  if (read) {
    const fields = read[1].split(',').map(item => item.trim())
    const held = table(org, read[2])
    const ids = [...read[3].matchAll(/'([^']+)'/g)].map(item => item[1])
    const rows = ids.flatMap(id => {
      const record = held[id]
      if (!record) return []
      if (record.IsDeleted === true && flags['all-rows'] !== true) return []
      return [pick(record, fields)]
    })
    return succeed(queryAnswer(rows, read[2]))
  }
  return fail({ name: 'INVALID_TYPE', message: `The fake has no answer for: ${text}` })
}

/** A top-level 200 with a failed row in it is what the real thing does. */
function runCollections() {
  const bodyFile = String(flags.body ?? '')
  if (!bodyFile.startsWith('@')) return fail({ name: 'Error', message: 'The fake reads the body from a file.', exitCode: 2 })
  const body = JSON.parse(readFileSync(bodyFile.slice(1), 'utf8'))
  if (body.allOrNone !== true) return fail({ name: 'Error', message: 'The fake expects allOrNone.', exitCode: 2 })
  if (scenario.collections?.reject) {
    const { statusCode, errorCode, message } = scenario.collections.reject
    process.stdout.write(`${JSON.stringify({ status: 1, result: { statusCode, headers: {}, body: [{ errorCode, message }] }, warnings: [] })}\n`)
    process.exitCode = 1
    return undefined
  }
  const org = loadOrg()
  const rows = body.records
  const object = rows[0]?.attributes?.type
  const held = table(org, object)
  const bad = id => scenario.rowFailures?.[id] ?? (held[id] && held[id].IsDeleted !== true ? null : { statusCode: 'ENTITY_IS_DELETED', message: 'entity is deleted', fields: [] })
  let answer
  if (rows.some(row => bad(row.id))) {
    answer = rows.map(row => {
      const failure = bad(row.id)
      if (failure) return { success: false, errors: [failure] }
      return { id: row.id, success: false, errors: [{ statusCode: 'ALL_OR_NONE_OPERATION_ROLLED_BACK', message: 'Record rolled back because not all records were valid and the request was using AllOrNone header', fields: [] }] }
    })
  } else {
    for (const row of rows) {
      const { attributes: _type, id, ...fields } = row
      saveRecord(org, object, held[id], fields)
    }
    saveOrg(org)
    for (const row of rows) recordWrite({ kind: 'collections', object, id: row.id })
    answer = rows.map(row => ({ id: row.id, success: true, errors: [] }))
  }
  if (scenario.collections?.garble) answer = answer.slice(1)
  killParent('after')
  if (scenario.collections?.hangAfter) {
    setTimeout(() => {}, 30_000)
    return undefined
  }
  process.stdout.write(`${JSON.stringify({ status: 0, result: { statusCode: 200, headers: {}, body: answer }, warnings: [] })}\n`)
  process.exitCode = 0
  return undefined
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"'
        at += 1
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') field += char
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function runBulkStart(operation) {
  const [header, ...lines] = parseCsv(readFileSync(String(flags.file), 'utf8'))
  if (header?.[0] !== 'Id') return fail({ name: 'Error', message: 'The first column is not Id.' })
  if (flags['line-ending'] !== 'LF') return fail({ name: 'Error', message: 'The fake expects an explicit line ending.', exitCode: 2 })
  if (flags.wait !== '0') return fail({ name: 'Error', message: 'The fake expects --wait=0.', exitCode: 2 })
  if (flags['hard-delete'] !== undefined) return fail({ name: 'Error', message: 'A hard delete reached the fake.', exitCode: 2 })
  const org = loadOrg()
  const id = nextId(org, '750')
  org.jobs[id] = { id, object: flags.sobject, operation, state: 'InProgress', header, lines, polls: 0, processed: 0, failed: 0, applied: false, createdById: CLI_USER_ID }
  saveOrg(org)
  appendFileSync(join(state, 'jobs.jsonl'), `${JSON.stringify({ id, operation, object: flags.sobject, count: lines.length })}\n`)
  killParent('after')
  return succeed(operation === 'delete' ? { jobInfo: { id, state: 'UploadComplete', operation, object: flags.sobject }, records: { successfulResults: [], failedResults: [], unprocessedRecords: [] } } : { jobId: id })
}

function advanceJob(org, job) {
  job.polls += 1
  if (job.applied || job.polls < (scenario.bulk?.pollsUntilDone ?? 1)) return
  job.applied = true
  const held = table(org, job.object)
  const stopAfter = scenario.bulk?.stopAfter ?? Number.POSITIVE_INFINITY
  job.success = []
  job.failure = []
  job.unprocessed = []
  for (const [index, line] of job.lines.entries()) {
    const id = line[0]
    if (index >= stopAfter) {
      job.unprocessed.push(line)
      continue
    }
    const failure = scenario.rowFailures?.[id]
    if (failure || !held[id] || held[id].IsDeleted === true) {
      job.failure.push({ line, error: failure ? `${failure.statusCode}:${failure.message}:--` : 'ENTITY_IS_DELETED:entity is deleted:--' })
      continue
    }
    if (job.operation === 'delete') {
      held[id].IsDeleted = true
      held[id].SystemModstamp = stamp(org)
    } else {
      const fields = {}
      // Bulk API 2.0: empty values are ignored on update. #N/A is how a field is set to null.
      for (const [column, name] of job.header.entries()) if (column > 0 && line[column] !== '') fields[name] = line[column] === '#N/A' ? null : line[column]
      saveRecord(org, job.object, held[id], fields)
    }
    recordWrite({ kind: 'bulk', jobId: job.id, operation: job.operation, object: job.object, id })
    job.success.push(line)
  }
  job.processed = job.success.length + job.failure.length
  job.failed = job.failure.length
  job.state = scenario.bulk?.endState ?? (job.unprocessed.length > 0 ? 'Failed' : 'JobComplete')
}

function runJobGet(jobId) {
  const org = loadOrg()
  const job = org.jobs[jobId]
  if (!job) {
    process.stdout.write(`${JSON.stringify({ status: 1, result: { statusCode: 404, headers: {}, body: [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }] }, warnings: [] })}\n`)
    process.exitCode = 1
    return undefined
  }
  advanceJob(org, job)
  saveOrg(org)
  process.stdout.write(`${JSON.stringify({ status: 0, result: { statusCode: 200, headers: {}, body: { id: job.id, state: job.state, object: job.object, operation: job.operation, createdById: job.createdById, numberRecordsProcessed: job.processed, numberRecordsFailed: job.failed } }, warnings: [] })}\n`)
  process.exitCode = 0
  return undefined
}

function runBulkResults() {
  const job = loadOrg().jobs[flags['job-id']]
  if (!job) return fail({ name: 'InvalidIdError', message: 'No such job.' })
  if (!job.applied) return fail({ name: 'JobInProgressError', message: 'The job is still in progress.' })
  if (job.processed === 0 && job.unprocessed.length === 0) return fail({ name: 'NoRecordsError', message: 'No records were processed.' })
  const write = (suffix, head, rows) => {
    const file = `${job.id}-${suffix}-records.csv`
    writeFileSync(join(process.cwd(), file), `${[head, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`)
    return file
  }
  const successFilePath = write('success', ['sf__Id', 'sf__Created', ...job.header], job.success.map(line => [line[0], 'false', ...line]))
  const failedFilePath = job.failed > 0 ? write('failed', ['sf__Id', 'sf__Error', ...job.header], job.failure.map(item => ['', item.error, ...item.line])) : undefined
  const unprocessedFilePath = job.state === 'JobComplete' ? undefined : write('unprocessed', job.header, job.unprocessed)
  return succeed({ processedRecords: job.processed, successfulRecords: job.success.length, failedRecords: job.failed, status: job.state, operation: job.operation, object: job.object, successFilePath, failedFilePath, unprocessedFilePath })
}

// ── deploys ──

/** Central directory only: enough to read what the service built. */
function readZipEntries(file) {
  const bytes = readFileSync(file)
  let end = bytes.length - 22
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end -= 1
  if (end < 0) throw new Error('not a zip')
  const count = bytes.readUInt16LE(end + 10)
  let at = bytes.readUInt32LE(end + 16)
  const entries = {}
  for (let index = 0; index < count; index += 1) {
    const method = bytes.readUInt16LE(at + 10)
    const size = bytes.readUInt32LE(at + 20)
    const nameLength = bytes.readUInt16LE(at + 28)
    const extra = bytes.readUInt16LE(at + 30)
    const comment = bytes.readUInt16LE(at + 32)
    const offset = bytes.readUInt32LE(at + 42)
    const path = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28)
    const raw = bytes.subarray(start, start + size)
    entries[path] = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8')
    at += 46 + nameLength + extra + comment
  }
  return entries
}

function membersOf(xml) {
  const members = []
  for (const types of String(xml ?? '').matchAll(/<types>([\s\S]*?)<\/types>/g)) {
    const typeName = types[1].match(/<name>([^<]+)<\/name>/)?.[1]
    for (const member of types[1].matchAll(/<members>([^<]+)<\/members>/g)) members.push(`${typeName}:${member[1]}`)
  }
  return members
}

function startDeploy(checkOnly) {
  if ((scenario.deploy?.needsProject ?? false) && !existsSync(join(process.cwd(), 'sfdx-project.json'))) return fail({ name: 'InvalidProjectWorkspaceError', message: 'This command is required to run from within a Salesforce project.' })
  if (flags['purge-on-delete'] !== undefined || flags['ignore-errors'] !== undefined || flags['ignore-conflicts'] !== undefined) return fail({ name: 'Error', message: 'A banned deploy flag reached the fake.', exitCode: 2 })
  const zip = String(flags['metadata-dir'])
  const entries = readZipEntries(zip)
  if (!entries['package.xml']) return fail({ name: 'Error', message: 'The zip has no package.xml at its root.' })
  const org = loadOrg()
  const id = nextId(org, '0Af')
  mkdirSync(join(state, 'zips'), { recursive: true })
  copyFileSync(zip, join(state, 'zips', `${id}.zip`))
  const destructive = ['destructiveChanges.xml', 'destructiveChangesPre.xml', 'destructiveChangesPost.xml'].flatMap(path => membersOf(entries[path]))
  org.deploys[id] = {
    id,
    checkOnly,
    status: 'InProgress',
    polls: 0,
    applied: false,
    zipSha: createHash('sha256').update(readFileSync(zip)).digest('hex'),
    members: membersOf(entries['package.xml']),
    destructive,
    existed: Object.keys(org.metadata),
    ignoreWarnings: flags['ignore-warnings'] === true,
    testLevel: flags['test-level'] ?? null,
    startDate: scenario.deploy?.startDate ?? new Date().toISOString(),
    createdBy: scenario.deploy?.createdBy ?? CLI_USER_ID,
  }
  saveOrg(org)
  appendFileSync(join(state, 'deploys.jsonl'), `${JSON.stringify({ id, checkOnly, zipSha: org.deploys[id].zipSha, members: org.deploys[id].members, testLevel: org.deploys[id].testLevel })}\n`)
  killParent('after')
  return succeed({ id, done: false, status: 'Queued', files: [] })
}

function applyDeploy(org, deploy, zipFile) {
  const entries = readZipEntries(zipFile)
  for (const member of deploy.members) {
    const memberName = member.split(':')[1]
    const files = {}
    for (const [path, text] of Object.entries(entries)) {
      const base = path.split('/').pop() ?? ''
      if (path !== 'package.xml' && base.split('.')[0] === memberName) files[path] = text
    }
    org.metadata[member] = files
  }
  for (const member of deploy.destructive) delete org.metadata[member]
  for (const [member, files] of Object.entries(scenario.deploy?.landsAs ?? {})) org.metadata[member] = files
  recordWrite({ kind: 'deploy', id: deploy.id, zipSha: deploy.zipSha })
}

function advanceDeploy(org, deploy) {
  deploy.polls += 1
  if (deploy.status === 'Canceling') {
    if (!scenario.deploy?.cancelStuck && deploy.polls >= (scenario.deploy?.cancelPolls ?? 1)) deploy.status = 'Canceled'
    return
  }
  if (deploy.status !== 'InProgress' || deploy.polls < (scenario.deploy?.pollsUntilDone ?? 1)) return
  const fails = deploy.checkOnly ? scenario.deploy?.validationFails : scenario.deploy?.applyFails
  deploy.status = scenario.deploy?.endStatus ?? (fails ? 'Failed' : 'Succeeded')
  if (!deploy.checkOnly && (deploy.status === 'Succeeded' || deploy.status === 'SucceededPartial')) applyDeploy(org, deploy, join(state, 'zips', `${deploy.sourceJob ?? deploy.id}.zip`))
}

function deployBody(deploy) {
  const done = !['InProgress', 'Pending', 'Canceling'].includes(deploy.status)
  const succeeded = deploy.status === 'Succeeded'
  const flat = scenario.deploy?.unchanged ?? []
  const successes = !done
    ? []
    : [
        ...deploy.members.map(member => {
          const [componentType, fullName] = member.split(':')
          const untouched = flat.includes(member)
          return { componentType, fullName, success: 'true', changed: !untouched && deploy.existed.includes(member), created: !untouched && !deploy.existed.includes(member), deleted: false, fileName: `${fullName}.x` }
        }),
        ...deploy.destructive.map(member => {
          const [componentType, fullName] = member.split(':')
          return { componentType, fullName, success: 'true', changed: false, created: false, deleted: true, fileName: `${fullName}.x` }
        }),
        { componentType: '', fullName: 'package.xml', success: 'true', changed: true, created: false, deleted: false, fileName: 'package.xml' },
      ]
  const noTests = scenario.deploy?.noTests === true
  const testsRun = deploy.testLevel === null || noTests || scenario.deploy?.zeroTests === true ? 0 : (scenario.deploy?.testsCompleted ?? 7)
  const testErrors = deploy.checkOnly ? (scenario.deploy?.testErrors ?? 0) : 0
  const extra = scenario.deploy?.extraComponents ?? []
  return {
    id: deploy.id,
    status: deploy.status,
    done,
    success: succeeded || deploy.status === 'SucceededPartial',
    checkOnly: scenario.deploy?.pretendNotCheckOnly ? false : deploy.checkOnly,
    createdBy: deploy.createdBy,
    createdByName: 'Ada Example',
    createdDate: deploy.startDate,
    startDate: deploy.startDate,
    lastModifiedDate: deploy.startDate,
    completedDate: done ? new Date().toISOString() : undefined,
    ignoreWarnings: deploy.ignoreWarnings,
    rollbackOnError: true,
    // noTests flips both together. testsOff and zeroTests each flip one, so each check on them is tested alone.
    runTestsEnabled: !noTests && scenario.deploy?.testsOff !== true && deploy.testLevel !== null,
    numberComponentErrors: scenario.deploy?.componentErrors ?? 0,
    numberComponentsDeployed: deploy.members.length,
    numberComponentsTotal: deploy.members.length,
    numberTestErrors: testErrors,
    numberTestsCompleted: testsRun,
    numberTestsTotal: testsRun + testErrors,
    details: {
      componentSuccesses: [...successes, ...extra.map(member => ({ componentType: member.split(':')[0], fullName: member.split(':')[1], success: 'true', changed: true, created: false, deleted: false }))],
      componentFailures: scenario.deploy?.componentFailures ?? [],
      runTestResult: { numTestsRun: testsRun, numFailures: testErrors, failures: [] },
    },
    files: [],
  }
}

function runDeployReport() {
  const id = flags['job-id']
  const org = loadOrg()
  const deploy = org.deploys[id]
  if (!deploy) return fail({ name: 'InvalidDeployId', message: `No deploy ${id}.` })
  advanceDeploy(org, deploy)
  saveOrg(org)
  const exit = scenario.deploy?.reportExit ?? 0
  process.stdout.write(`${JSON.stringify({ status: exit, result: deployBody(deploy), warnings: [] })}\n`)
  process.exitCode = exit
  return undefined
}

function runDeployQuick() {
  if (scenario.deploy?.quickRefused) return fail({ name: 'CannotQuickDeployError', message: 'The deployment has not been validated, has already been deployed, or the validation expired.' })
  const org = loadOrg()
  const source = org.deploys[flags['job-id']]
  if (!source || !source.checkOnly || source.status !== 'Succeeded') return fail({ name: 'CannotQuickDeployError', message: 'That job cannot be quick deployed.' })
  const id = nextId(org, '0Af')
  org.deploys[id] = { ...source, id, checkOnly: false, status: 'InProgress', polls: 0, sourceJob: source.id, existed: Object.keys(org.metadata), testLevel: null }
  saveOrg(org)
  appendFileSync(join(state, 'deploys.jsonl'), `${JSON.stringify({ id, checkOnly: false, quickOf: source.id, zipSha: source.zipSha })}\n`)
  killParent('after')
  return succeed({ id, done: false, status: 'Queued', files: [] })
}

function runDeployCancel() {
  const org = loadOrg()
  const deploy = org.deploys[flags['job-id']]
  if (!deploy) return fail({ name: 'InvalidDeployId', message: 'No such deploy.' })
  if (deploy.status === 'InProgress') {
    deploy.status = 'Canceling'
    deploy.polls = 0
  }
  saveOrg(org)
  return succeed({ id: deploy.id, done: false, status: deploy.status, files: [] })
}

function runRetrieveManifest() {
  const org = loadOrg()
  const members = membersOf(readFileSync(String(flags.manifest), 'utf8'))
  const out = join(String(flags['target-metadata-dir']), String(flags['zip-file-name']).replace(/\.zip$/, ''), 'unpackaged')
  mkdirSync(out, { recursive: true })
  const found = []
  for (const member of members) {
    const files = org.metadata[member]
    if (!files) continue
    found.push(member)
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(out, path)), { recursive: true })
      writeFileSync(join(out, path), text)
    }
  }
  writeFileSync(join(out, 'package.xml'), readFileSync(String(flags.manifest), 'utf8'))
  if (scenario.retrieveLeavesNoFiles) rmSync(join(String(flags['target-metadata-dir']), String(flags['zip-file-name']).replace(/\.zip$/, '')), { recursive: true, force: true })
  return succeed({
    done: true,
    fileProperties: [...found.map(member => ({ type: member.split(':')[0], fullName: member.split(':')[1] })), { type: 'Package', fullName: 'unpackaged/package.xml' }],
    id: '09S000000000001AAA',
    status: 'Succeeded',
    success: true,
    messages: [],
    zipFilePath: join(String(flags['target-metadata-dir']), String(flags['zip-file-name'])),
    files: [],
  })
}

// ── tests ──

function runApexGet() {
  const apex = scenario.apex ?? {}
  const failing = apex.failing ?? 0
  const result = {
    summary: { outcome: apex.outcome ?? (failing > 0 ? 'Failed' : 'Passed'), testsRan: apex.testsRan ?? 3, passing: apex.passing ?? 3 - failing, failing, skipped: 0, testRunId: flags['test-run-id'], orgWideCoverage: '81%', testRunCoverage: '90%', orgId: '00D000000000001AAA', username: 'ada@example.com' },
    tests: failing > 0 ? [{ FullName: 'WidgetTest.closes', MethodName: 'closes', Outcome: 'Fail', Message: 'Expected Closed', StackTrace: 'Class.WidgetTest.closes: line 9' }] : [{ FullName: 'WidgetTest.opens', MethodName: 'opens', Outcome: 'Pass', Message: null, StackTrace: null }],
  }
  const exit = failing > 0 ? 100 : 0
  process.stdout.write(`${JSON.stringify({ status: exit, result, warnings: [] })}\n`)
  process.exitCode = exit
  return undefined
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** True once the runner that started this call is gone. The pid is read at start, because a dead parent hands its children to init. */
function parentIsGone(limitMs) {
  const end = Date.now() + limitMs
  while (Date.now() < end) {
    try {
      process.kill(parentPid, 0)
    } catch {
      return true
    }
    sleep(10)
  }
  return false
}

/**
 * Dies the way a runner does: nothing it was doing gets to finish, and the ledger stays as it was.
 * A signal can take a while to land (WSL 1 under load took longer than any fixed wait), so this waits for the
 * runner to be gone, and never goes on to answer or to do the work while it might still be alive.
 * `before` then leaves without doing the call, so the call did not leave. With `survive`, the call
 * goes on after the runner has gone, as a request already on the wire does. It lands when the test
 * creates the `release` file, so the test can look at both sides of the landing without a race.
 */
function killParent(when) {
  const kill = scenario.killParent
  if (!kill || kill.when !== when) return
  if (kill.on && !new RegExp(kill.on, 'i').test(`${name} ${soql ?? ''} ${positional.join(' ')}`)) return
  if (counted(`kill:${kill.on ?? ''}`) !== (kill.nth ?? 1)) return
  process.kill(parentPid, 'SIGKILL')
  const gone = parentIsGone(10_000)
  if (when === 'before' && kill.survive !== true) process.exit(gone ? 0 : 3)
  if (when === 'before' && kill.survive === true) {
    const release = join(state, 'release')
    const end = Date.now() + 30_000
    while (!existsSync(release) && Date.now() < end) sleep(20)
  }
}

function applyMode() {
  const mode = scenario.mode
  if (!mode || mode === 'normal') return false
  if (scenario.modeOn && !new RegExp(scenario.modeOn, 'i').test(`${name} ${soql ?? ''} ${positional.join(' ')}`)) return false
  if (name === 'version' && !scenario.modeOnVersion) return false
  // Lets a test fail the third identity check and not the first.
  if (scenario.modeAfter !== undefined && counted(`mode:${scenario.modeOn ?? ''}`) <= scenario.modeAfter) return false
  switch (mode) {
    case 'malformed':
      process.stdout.write('{"status":0,"result":{"records":[{"Id":"00')
      process.exitCode = 0
      return true
    case 'not-json':
      process.stdout.write('\u001b[31mnot json at all\u001b[0m\n')
      process.exitCode = 0
      return true
    case 'empty':
      process.exitCode = 0
      return true
    case 'wrong-shape':
      succeed({ unexpected: true })
      return true
    case 'exit-68':
      process.stdout.write('{"status":68,"result":{}}\n')
      process.exitCode = 68
      return true
    case 'exit-3':
      process.exitCode = 3
      return true
    case 'timeout':
      // Lives long enough for the caller's timeout, and ends by itself so a test
      // that fails cannot leave it behind.
      setTimeout(() => {}, 30_000)
      return true
    case 'flood':
      process.stdout.write('x'.repeat(4 * 1024 * 1024))
      setTimeout(() => {}, 30_000)
      return true
    default: {
      const failure = FAILURES[mode]
      if (!failure) throw new Error(`Unknown fake mode ${mode}`)
      fail(failure)
      return true
    }
  }
}

/** jsforce sends a query as GET <base>/query?q=<encoded soql>, and the REST API refuses a URI over 16,384 bytes. */
const URI_LIMIT = 16384
const QUERY_PATH = '/services/data/v66.0/query?q='

function runQuery() {
  if (soql === null) return fail({ name: 'Error', message: 'The fake needs --file with a SOQL file.', exitCode: 2 })
  if (QUERY_PATH.length + encodeURIComponent(soql).length > URI_LIMIT) return fail({ name: 'URL_TOO_LONG', message: 'The length of the URI exceeds the 16,384-byte limit.' })
  const tooling = flags['use-tooling-api'] === true
  for (const entry of scenario.queries ?? []) {
    if (!new RegExp(entry.match, 'is').test(soql)) continue
    // An object on one API is not on the other, so an entry can say which it answers.
    if (entry.tooling !== undefined && entry.tooling !== tooling) continue
    if (entry.error) return fail(entry.error)
    // A list answers in turn and then repeats its last, so a later read can see a different org.
    if (entry.results) return succeed(entry.results[Math.min(counted(`query:${entry.match}`) - 1, entry.results.length - 1)], entry.warnings ?? [])
    return succeed(entry.result, entry.warnings ?? [])
  }
  return statefulQuery(soql)
}

function runDescribe() {
  const described = scenario.describeFor?.[flags['target-org']]?.[flags.sobject] ?? scenario.describe?.[flags.sobject]
  if (!described) return fail({ name: 'NOT_FOUND', message: `The requested resource does not exist: ${flags.sobject}` })
  return succeed(described)
}

function runRest() {
  const url = positional[0] ?? ''
  if (flags.method === 'PATCH' && url === '/services/data/v66.0/composite/sobjects') return runCollections()
  const job = url.match(/\/jobs\/ingest\/(750\w+)$/)
  if (flags.method === 'GET' && job) return runJobGet(job[1])
  const answer = scenario.rest?.[url]
  if (flags.method !== 'GET') return fail({ name: 'Error', message: 'The fake answers GET and the one Collections PATCH only.', exitCode: 2 })
  if (!answer) {
    process.stdout.write(`${JSON.stringify({ status: 1, result: { statusCode: 404, headers: {}, body: [{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }] }, warnings: [] })}\n`)
    process.exitCode = 1
    return undefined
  }
  const statusCode = answer.statusCode ?? 200
  process.stdout.write(`${JSON.stringify({ status: statusCode >= 400 ? 1 : 0, result: { statusCode, headers: { 'set-cookie': 'sid=00D000000000001!SYNTHETICSESSIONTOKEN' }, body: answer.body }, warnings: [] })}\n`)
  process.exitCode = statusCode >= 400 ? 1 : 0
  return undefined
}

function runRetrieve() {
  if (!existsSync(join(process.cwd(), 'sfdx-project.json'))) return fail({ name: 'InvalidProjectWorkspaceError', message: 'This command is required to run from within a Salesforce project.' })
  if (flags.manifest !== undefined) return runRetrieveManifest()
  const answer = scenario.retrieve ?? { files: {} }
  const out = flags['target-metadata-dir']
  const zipName = flags['zip-file-name'] ?? 'unpackaged.zip'
  const extract = join(out, zipName.replace(/\.zip$/, ''))
  for (const [path, text] of Object.entries(answer.files ?? {})) {
    const file = join(extract, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  const members = [flags.metadata].flat()
  return succeed({
    done: true,
    fileProperties: members.filter(member => !(answer.missing ?? []).includes(member)).map(member => ({ type: String(member).split(':')[0], fullName: String(member).split(':')[1] })),
    id: '09S000000000001AAA',
    status: answer.status ?? 'Succeeded',
    success: answer.success ?? true,
    messages: answer.messages ?? [],
    zipFilePath: join(out, zipName),
    files: [],
  })
}

function main() {
  if (badFlag !== null) {
    return fail({ name: 'NonExistentFlagsError', message: `Nonexistent or malformed flag: ${badFlag}`, exitCode: 2 })
  }
  if (applyMode()) return undefined
  // `sf org logout` removes a login, so every later call for that user fails the same way.
  if (typeof flags['target-org'] === 'string' && (scenario.loggedOut ?? []).includes(flags['target-org'])) return fail(FAILURES['no-auth'])
  killParent('before')
  switch (name) {
    case 'version':
      process.stdout.write(`${JSON.stringify({
        architecture: 'x64',
        cliVersion: scenario.cliVersion ?? '@salesforce/cli/2.156.8',
        nodeVersion: `node-${process.version}`,
        osVersion: 'fake',
        pluginVersions: [],
        rootPath: scenario.rootPath ?? root,
        shell: 'fake',
      })}\n`)
      return undefined
    case 'org display':
      if (scenario.displayFails) return fail(FAILURES[scenario.displayFails])
      return succeed(scenario.displays?.[flags['target-org']] ?? scenario.display ?? {}, scenario.displayWarnings ?? [])
    case 'data query':
      return runQuery()
    case 'sobject describe':
      return runDescribe()
    case 'api request rest':
      return runRest()
    case 'project retrieve start':
      return runRetrieve()
    case 'data update bulk':
      return runBulkStart('update')
    case 'data delete bulk':
      return runBulkStart('delete')
    case 'data bulk results':
      return runBulkResults()
    case 'project deploy validate':
      return startDeploy(true)
    case 'project deploy start':
      return startDeploy(flags['dry-run'] === true)
    case 'project deploy quick':
      return runDeployQuick()
    case 'project deploy report':
      return runDeployReport()
    case 'project deploy cancel':
      return runDeployCancel()
    case 'apex run test':
      return succeed({ testRunId: '707000000000001AAA' })
    case 'apex get test':
      return runApexGet()
    default:
      return fail({ name: 'CommandNotFound', message: `The fake has no command: ${name}`, exitCode: 127 })
  }
}

main()
