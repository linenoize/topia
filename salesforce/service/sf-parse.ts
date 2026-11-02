import type { ApexRun, ApiAnswer, BulkJob, BulkResultFiles, CollectionRow, CollectionsAnswer, DeployComponent, DeployStatus, Failure, FailureKind, FieldDescribe, LiveOrg, LiveUser, ObjectDescribe, OrgDisplay, PicklistValue, QueryRows } from './adapter.js'
import { exitMeaning, type SfRun } from './sf-cli.js'

/**
 * One parser per command. Shapes come from CLI 2.156.8 schemas and source, not
 * from an org: docs/salesforce/LIVE-CHECKLIST.md tracks confirming them. Anything
 * that does not parse is `unknown`. It is never mapped to expired auth, because
 * that one can be acknowledged and this cannot.
 */

export function failure(kind: FailureKind, message: string): Failure {
  return { failure: kind, message }
}

const SHAPE = 'The Salesforce CLI answered in a shape this version does not recognize, so the result is unknown.'

function unknownShape(what: string): Failure {
  return failure('unknown', `${SHAPE} (${what})`)
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const EXPIRED_NAMES = new Set(['INVALID_SESSION_ID', 'invalid_grant', 'RefreshTokenAuthError', 'ExpiredSessionError', 'NamedOrgNotFoundError', 'NoAuthInfoFoundError'])
const RATE_NAMES = new Set(['REQUEST_LIMIT_EXCEEDED', 'ConcurrentRequestLimitExceeded'])
const DENIED_NAMES = new Set([
  'INSUFFICIENT_ACCESS',
  'INSUFFICIENT_ACCESS_OR_READONLY',
  'INVALID_TYPE',
  'INVALID_FIELD',
  'MALFORMED_QUERY',
  'API_DISABLED_FOR_ORG',
  'FUNCTIONALITY_NOT_ENABLED',
  'INVALID_QUERY_FILTER_OPERATOR',
  'FORBIDDEN',
])
const NOT_FOUND_NAMES = new Set(['NOT_FOUND', 'NotFoundError'])

/** Only names this file lists mean anything. Everything else is unknown, whatever its message says. */
function classify(name: unknown, message: unknown): Failure {
  const text = typeof message === 'string' && message.length > 0 ? message : 'The Salesforce CLI failed.'
  if (typeof name === 'string') {
    // The same names come back when the CLI can't open its keychain or trust the network, so a login that works elsewhere isn't blamed alone.
    if (name === 'NamedOrgNotFoundError' || name === 'NoAuthInfoFoundError') return failure('expired-auth', `${text} If this login works in your own terminal, the CLI run from here may not reach the same keychain or certificates.`)
    if (EXPIRED_NAMES.has(name)) return failure('expired-auth', text)
    if (RATE_NAMES.has(name)) return failure('rate-limit', text)
    if (DENIED_NAMES.has(name)) return failure('denied', text)
    if (NOT_FOUND_NAMES.has(name)) return failure('not-found', text)
  }
  return failure('unknown', `The Salesforce CLI failed in a way this version does not recognize: ${text}`)
}

function runFailure(run: Exclude<SfRun, { outcome: 'exited' }>): Failure {
  switch (run.outcome) {
    case 'timeout':
      return failure('unknown', 'The Salesforce CLI timed out, so the result is unknown. Any work it started in the org may still be running.')
    case 'signal':
      return failure('unknown', `The Salesforce CLI was killed (${run.signal}), so the result is unknown.`)
    case 'overflow':
      return failure('unknown', 'The Salesforce CLI wrote more output than this service reads, so the result is unknown.')
    case 'spawn-error':
      return failure('unknown', `The Salesforce CLI did not start: ${run.message}`)
    default: {
      const exhaustive: never = run
      return exhaustive
    }
  }
}

export type Envelope = { result: unknown; warnings: string[] }

/** The {status, result, warnings} wrapper. A failed command has {name, message, exitCode} instead. */
export function readEnvelope(run: SfRun): Envelope | Failure {
  if (run.outcome !== 'exited') return runFailure(run)
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return failure('unknown', `The Salesforce CLI did not print JSON (exit ${run.code}), so the result is unknown.`)
  }
  if (!isObject(parsed)) return unknownShape('not an object')
  switch (exitMeaning('read', run.code)) {
    case 'success':
      if (parsed.status !== 0 || !('result' in parsed)) return unknownShape('no result')
      return { result: parsed.result, warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((item): item is string => typeof item === 'string') : [] }
    case 'failed':
      return classify(parsed.name, parsed.message)
    default:
      return failure('unknown', `The Salesforce CLI exited ${run.code}, so the result is unknown.`)
  }
}

export function parseOrgDisplay(envelope: Envelope): OrgDisplay | Failure {
  const result = envelope.result
  if (!isObject(result)) return unknownShape('org display')
  const { id, username, instanceUrl } = result
  if (typeof id !== 'string' || !isSalesforceId(id) || typeof username !== 'string' || username.length === 0 || typeof instanceUrl !== 'string' || !isHttpsUrl(instanceUrl)) {
    return unknownShape('org display')
  }
  // Only these three. The rest of the answer, token field included, stops here.
  return { orgId: id, username, instanceUrl }
}

export function isSalesforceId(value: string): boolean {
  return /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(value)
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export function parseQueryResult(envelope: Envelope, options: { isCount?: boolean } = {}): QueryRows | Failure {
  const result = envelope.result
  if (!isObject(result)) return unknownShape('data query')
  const { records, totalSize, done } = result
  if (!Array.isArray(records) || !records.every(isObject) || typeof totalSize !== 'number' || !Number.isInteger(totalSize) || totalSize < 0 || typeof done !== 'boolean') {
    return unknownShape('data query')
  }
  // The CLI only warns when a result is cut short, so the counts are what tell.
  const truncated = !done || (options.isCount !== true && totalSize > records.length)
  return { records, totalSize, done, truncated }
}

export function parseOrganization(rows: QueryRows): LiveOrg | Failure {
  if (rows.records.length !== 1) return unknownShape('Organization')
  const row = rows.records[0] as Json
  const { Id, Name, IsSandbox, OrganizationType, InstanceName } = row
  if (typeof Id !== 'string' || !isSalesforceId(Id) || typeof Name !== 'string' || typeof IsSandbox !== 'boolean' || typeof OrganizationType !== 'string') {
    return unknownShape('Organization')
  }
  if (InstanceName !== null && InstanceName !== undefined && typeof InstanceName !== 'string') return unknownShape('Organization')
  return { orgId: Id, name: Name, isSandbox: IsSandbox, organizationType: OrganizationType, instanceName: typeof InstanceName === 'string' ? InstanceName : null }
}

export function parseUser(rows: QueryRows): LiveUser | Failure {
  if (rows.records.length !== 1) return failure('unknown', 'The current user could not be read from the org, so identity is unknown.')
  const row = rows.records[0] as Json
  const { Id, Username, Name, IsActive, Profile } = row
  if (typeof Id !== 'string' || !isSalesforceId(Id) || typeof Username !== 'string' || typeof Name !== 'string' || typeof IsActive !== 'boolean') return unknownShape('User')
  const profileName = isObject(Profile) && typeof Profile.Name === 'string' ? Profile.Name : null
  return { id: Id, username: Username, name: Name, isActive: IsActive, profileName }
}

function picklistValues(value: unknown): PicklistValue[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const out: PicklistValue[] = []
  for (const item of value) {
    if (!isObject(item) || typeof item.value !== 'string') return null
    out.push({ value: item.value, label: typeof item.label === 'string' ? item.label : item.value, active: item.active === true })
  }
  return out
}

function parseField(value: unknown): FieldDescribe | null {
  if (!isObject(value) || typeof value.name !== 'string' || typeof value.type !== 'string') return null
  const picklist = picklistValues(value.picklistValues)
  if (picklist === null) return null
  const referenceTo = Array.isArray(value.referenceTo) ? value.referenceTo.filter((item): item is string => typeof item === 'string') : []
  return {
    name: value.name,
    label: typeof value.label === 'string' ? value.label : value.name,
    type: value.type,
    custom: value.custom === true,
    createable: value.createable === true,
    updateable: value.updateable === true,
    filterable: value.filterable === true,
    sortable: value.sortable === true,
    groupable: value.groupable === true,
    nillable: value.nillable === true,
    relationshipName: typeof value.relationshipName === 'string' ? value.relationshipName : null,
    referenceTo,
    picklistValues: picklist,
  }
}

export function parseDescribe(envelope: Envelope): ObjectDescribe | Failure {
  const result = envelope.result
  if (!isObject(result) || typeof result.name !== 'string' || !Array.isArray(result.fields)) return unknownShape('sobject describe')
  const fields: FieldDescribe[] = []
  for (const item of result.fields) {
    const field = parseField(item)
    if (field === null) return unknownShape('sobject describe field')
    fields.push(field)
  }
  return {
    name: result.name,
    label: typeof result.label === 'string' ? result.label : result.name,
    custom: result.custom === true,
    queryable: result.queryable === true,
    updateable: result.updateable === true,
    deletable: result.deletable === true,
    fields,
  }
}

/** `api request rest` exits 1 for a status of 400 or more, with the answer still in `result`. */
export function readApiAnswer(run: SfRun): ApiAnswer | Failure {
  if (run.outcome !== 'exited') return runFailure(run)
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return failure('unknown', `The Salesforce CLI did not print JSON (exit ${run.code}), so the result is unknown.`)
  }
  if (!isObject(parsed)) return unknownShape('api request rest')
  if (!isObject(parsed.result)) return run.code === 0 ? unknownShape('api request rest') : classify(parsed.name, parsed.message)
  const { statusCode, body } = parsed.result
  if (typeof statusCode !== 'number') return unknownShape('api request rest')
  if (statusCode >= 400) {
    const first = Array.isArray(body) ? body[0] : body
    return isObject(first) ? classify(first.errorCode, first.message) : failure('unknown', `The API answered ${statusCode}, so the result is unknown.`)
  }
  if (run.code !== 0) return failure('unknown', `The Salesforce CLI exited ${run.code}, so the result is unknown.`)
  return { statusCode, body }
}

export type RetrieveResult = { success: boolean; status: string; problems: { fileName: string; problem: string }[]; fetched: string[] }

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

export function parseRetrieve(envelope: Envelope): RetrieveResult | Failure {
  const result = envelope.result
  if (!isObject(result) || typeof result.success !== 'boolean' || typeof result.status !== 'string' || result.done !== true) return unknownShape('project retrieve start')
  const problems: { fileName: string; problem: string }[] = []
  for (const item of asList(result.messages)) {
    if (!isObject(item)) return unknownShape('project retrieve start messages')
    problems.push({ fileName: typeof item.fileName === 'string' ? item.fileName : '', problem: typeof item.problem === 'string' ? item.problem : '' })
  }
  const fetched: string[] = []
  for (const item of asList(result.fileProperties)) {
    if (isObject(item) && typeof item.type === 'string' && typeof item.fullName === 'string') fetched.push(`${item.type}:${item.fullName}`)
  }
  return { success: result.success, status: result.status, problems, fetched }
}

export type ReportColumn = { name: string; label: string; dataType: string }

export type ReportDescribe = { name: string; id: string; format: string; columns: ReportColumn[]; filterColumns: string[]; groupings: string[] }

function columnInfo(value: unknown): ReportColumn[] | null {
  if (!isObject(value)) return null
  const out: ReportColumn[] = []
  for (const [name, info] of Object.entries(value)) {
    if (!isObject(info)) return null
    out.push({ name, label: typeof info.label === 'string' ? info.label : name, dataType: typeof info.dataType === 'string' ? info.dataType : 'unknown' })
  }
  return out
}

/** A report's filter values can hold anyone's data, so only the columns they apply to come back. */
export function parseReportDescribe(answer: ApiAnswer): ReportDescribe | Failure {
  const body = answer.body
  if (!isObject(body) || !isObject(body.reportMetadata)) return unknownShape('report describe')
  const metadata = body.reportMetadata
  if (typeof metadata.name !== 'string' || typeof metadata.id !== 'string') return unknownShape('report describe')
  const extended = isObject(body.reportExtendedMetadata) ? columnInfo(body.reportExtendedMetadata.detailColumnInfo) : null
  const filterColumns = asList(metadata.reportFilters).flatMap(item => (isObject(item) && typeof item.column === 'string' ? [item.column] : []))
  const groupings = asList(metadata.groupingsDown).flatMap(item => (isObject(item) && typeof item.name === 'string' ? [item.name] : []))
  const detail = asList(metadata.detailColumns).filter((item): item is string => typeof item === 'string')
  return {
    name: metadata.name,
    id: metadata.id,
    format: typeof metadata.reportFormat === 'string' ? metadata.reportFormat : 'unknown',
    columns: extended ?? detail.map(name => ({ name, label: name, dataType: 'unknown' })),
    filterColumns,
    groupings,
  }
}

export type ReportRun = {
  /** False, or missing, means the org did not return every row. */
  allData: boolean | null
  /** The report could not be read as a complete result. It counts as partial. */
  malformed: boolean
  columns: ReportColumn[]
  rows: unknown[][]
  rowCount: number | null
  aggregateNames: string[]
}

const MALFORMED: ReportRun = { allData: null, malformed: true, columns: [], rows: [], rowCount: null, aggregateNames: [] }

/** Never throws and never fails: a run that does not parse is a partial result with nothing in it. */
export function parseReportRun(answer: ApiAnswer): ReportRun {
  const body = answer.body
  if (!isObject(body) || !isObject(body.factMap) || !isObject(body.reportMetadata) || !isObject(body.reportExtendedMetadata)) return MALFORMED
  const columns = columnInfo(body.reportExtendedMetadata.detailColumnInfo)
  if (columns === null) return MALFORMED
  const order = asList(body.reportMetadata.detailColumns).filter((item): item is string => typeof item === 'string')
  const ordered = order.length > 0 ? order.flatMap(name => columns.filter(column => column.name === name)) : columns
  if (ordered.length !== columns.length) return MALFORMED
  const aggregateNames = asList(body.reportMetadata.aggregates).filter((item): item is string => typeof item === 'string')
  const rows: unknown[][] = []
  for (const fact of Object.values(body.factMap)) {
    if (!isObject(fact)) return MALFORMED
    for (const row of asList(fact.rows)) {
      if (!isObject(row) || !Array.isArray(row.dataCells) || row.dataCells.length !== ordered.length) return MALFORMED
      rows.push(row.dataCells.map(cell => (isObject(cell) ? cell.value : undefined)))
    }
  }
  const total = body.factMap['T!T']
  const countAt = aggregateNames.indexOf('RowCount')
  const aggregates = isObject(total) && Array.isArray(total.aggregates) ? total.aggregates : []
  const counted = countAt >= 0 && isObject(aggregates[countAt]) ? (aggregates[countAt] as Json).value : undefined
  const allData = typeof body.allData === 'boolean' ? body.allData : null
  return { allData, malformed: allData === null, columns: ordered, rows, rowCount: typeof counted === 'number' ? counted : null, aggregateNames }
}

const BULK_ID = /^750[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/
const DEPLOY_ID = /^0Af[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/
const TEST_RUN_ID = /^707[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/

function parseCollectionRow(value: unknown): CollectionRow | null {
  if (!isObject(value) || typeof value.success !== 'boolean') return null
  if (value.id !== undefined && value.id !== null && typeof value.id !== 'string') return null
  const errors: CollectionRow['errors'] = []
  for (const item of asList(value.errors)) {
    if (!isObject(item) || typeof item.statusCode !== 'string') return null
    errors.push({ statusCode: item.statusCode, message: typeof item.message === 'string' ? item.message : '', fields: asList(item.fields).filter((field): field is string => typeof field === 'string') })
  }
  return { id: typeof value.id === 'string' ? value.id : null, success: value.success, errors }
}

/**
 * A top-level 200 can hide failed rows, so every row is read. Rows come back in the
 * order sent, and a failed row may have no id. Anything that doesn't line up with
 * what was sent is unknown, because it can't say what landed.
 */
export function parseCollections(run: SfRun, sent: string[]): CollectionsAnswer {
  if (run.outcome !== 'exited') return { kind: 'unknown', message: runFailure(run).message }
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return { kind: 'unknown', message: `The Salesforce CLI did not print JSON (exit ${run.code}), so the result is unknown.` }
  }
  if (!isObject(parsed)) return { kind: 'unknown', message: 'The answer to the write was not an object, so the result is unknown.' }
  if (!isObject(parsed.result)) {
    const failed = classify(parsed.name, parsed.message)
    // A rate limit or a lost login before the request left. Anything else can't say.
    return failed.failure === 'unknown' ? { kind: 'unknown', message: failed.message } : { kind: 'rejected', failure: failed }
  }
  const { statusCode, body } = parsed.result
  if (typeof statusCode !== 'number') return { kind: 'unknown', message: 'The answer to the write had no status, so the result is unknown.' }
  if (statusCode >= 500 || statusCode < 200) return { kind: 'unknown', message: `The API answered ${statusCode}, so the result is unknown.` }
  // An all-or-none failure may come back as a 400 that still carries one result per record. Then the rows say which one was refused.
  const perRecord = statusCode === 400 && Array.isArray(body) && body.length === sent.length && body.every(item => parseCollectionRow(item) !== null && (item as { success: boolean }).success === false)
  if (statusCode >= 400 && !perRecord) {
    const first = Array.isArray(body) ? body[0] : body
    const failed = isObject(first) ? classify(first.errorCode, first.message) : failure('unknown', `The API answered ${statusCode}.`)
    return { kind: 'rejected', failure: failed }
  }
  if ((statusCode !== 200 && !perRecord) || !Array.isArray(body) || body.length !== sent.length) return { kind: 'unknown', message: 'The answer to the write did not have one row per record, so the result is unknown.' }
  const rows: CollectionRow[] = []
  for (const [index, item] of body.entries()) {
    const row = parseCollectionRow(item)
    if (row === null) return { kind: 'unknown', message: 'A row of the answer could not be read, so the result is unknown.' }
    if (row.id !== null && !sameRecordId(row.id, sent[index] as string)) return { kind: 'unknown', message: 'A row of the answer named a record that was not in that position, so the result is unknown.' }
    rows.push({ ...row, id: sent[index] as string })
  }
  return { kind: 'answered', rows }
}

function sameRecordId(left: string, right: string): boolean {
  return left.slice(0, 15) === right.slice(0, 15)
}

/** `data update bulk` answers {jobId}. `data delete bulk` answers {jobInfo: {id}, records}. */
export function parseBulkStart(envelope: Envelope): { jobId: string } | Failure {
  const result = envelope.result
  if (!isObject(result)) return unknownShape('bulk start')
  const jobId = typeof result.jobId === 'string' ? result.jobId : isObject(result.jobInfo) && typeof result.jobInfo.id === 'string' ? result.jobInfo.id : null
  if (jobId === null || !BULK_ID.test(jobId)) return unknownShape('bulk start')
  return { jobId }
}

export function parseBulkJob(answer: ApiAnswer): BulkJob | Failure {
  const body = answer.body
  if (!isObject(body) || typeof body.id !== 'string' || !BULK_ID.test(body.id) || typeof body.state !== 'string') return unknownShape('bulk job')
  const processed = typeof body.numberRecordsProcessed === 'number' ? body.numberRecordsProcessed : 0
  const failed = typeof body.numberRecordsFailed === 'number' ? body.numberRecordsFailed : 0
  return {
    id: body.id,
    state: body.state,
    object: typeof body.object === 'string' ? body.object : null,
    operation: typeof body.operation === 'string' ? body.operation : null,
    createdById: typeof body.createdById === 'string' ? body.createdById : null,
    processed,
    failed,
  }
}

/** Throws in-progress and no-records as failures with their own names, which callers treat as "nothing to read yet". */
export function parseBulkResults(run: SfRun): BulkResultFiles | Failure {
  if (run.outcome !== 'exited') return runFailure(run)
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return failure('unknown', `The Salesforce CLI did not print JSON (exit ${run.code}), so the result is unknown.`)
  }
  if (!isObject(parsed)) return unknownShape('data bulk results')
  if (run.code !== 0) {
    if (parsed.name === 'JobInProgressError') return failure('in-progress', 'That bulk job is still running.')
    if (parsed.name === 'NoRecordsError') return { status: 'no-records', processed: 0, failed: 0, successFile: null, failedFile: null, unprocessedFile: null }
    return classify(parsed.name, parsed.message)
  }
  const result = parsed.result
  if (!isObject(result) || typeof result.status !== 'string') return unknownShape('data bulk results')
  const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null)
  return {
    status: result.status,
    processed: typeof result.processedRecords === 'number' ? result.processedRecords : 0,
    failed: typeof result.failedRecords === 'number' ? result.failedRecords : 0,
    successFile: text(result.successFilePath),
    failedFile: text(result.failedFilePath),
    unprocessedFile: text(result.unprocessedFilePath),
  }
}

function deployComponent(value: unknown, success: boolean): DeployComponent | null {
  if (!isObject(value)) return null
  const type = typeof value.componentType === 'string' ? value.componentType : ''
  const fullName = typeof value.fullName === 'string' ? value.fullName : ''
  const flag = (item: unknown) => item === true || item === 'true'
  return { type, fullName, success, changed: flag(value.changed), created: flag(value.created), deleted: flag(value.deleted), problemType: typeof value.problemType === 'string' ? value.problemType : null }
}

/** The manifest shows up as a component of no type. It isn't one. */
function realComponents(value: unknown, success: boolean): DeployComponent[] | null {
  const out: DeployComponent[] = []
  for (const item of asList(value)) {
    const component = deployComponent(item, success)
    if (component === null) return null
    if (component.type.length > 0 && component.fullName !== 'package.xml') out.push(component)
  }
  return out
}

/** The async start answer: {id, done: false, status: 'Queued', files: []}. */
function parseDeployBody(result: unknown, exit: number): DeployStatus | Failure {
  if (!isObject(result) || typeof result.id !== 'string' || !DEPLOY_ID.test(result.id) || typeof result.status !== 'string') return unknownShape('project deploy')
  const details = isObject(result.details) ? result.details : {}
  const successes = realComponents(details.componentSuccesses, true)
  const failures = realComponents(details.componentFailures, false)
  if (successes === null || failures === null) return unknownShape('project deploy components')
  const runTests = isObject(details.runTestResult) ? details.runTestResult : {}
  const count = (value: unknown) => (typeof value === 'number' ? value : 0)
  const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null)
  // A finished job has to say how many tests and components failed, as numbers. A missing or text count is no count, and it must not read as zero.
  if (result.done === true && !['numberTestErrors', 'numberComponentErrors', 'numberTestsCompleted'].every(key => typeof result[key] === 'number' && Number.isFinite(result[key]))) return unknownShape('project deploy counts')
  return {
    id: result.id,
    status: result.status,
    done: result.done === true,
    success: result.success === true,
    checkOnly: result.checkOnly === true,
    createdBy: text(result.createdBy),
    startDate: text(result.startDate),
    createdDate: text(result.createdDate),
    runTestsEnabled: result.runTestsEnabled === true,
    numberTestsCompleted: count(result.numberTestsCompleted),
    numberTestsTotal: count(result.numberTestsTotal),
    numberTestErrors: count(result.numberTestErrors),
    numberComponentErrors: count(result.numberComponentErrors),
    ignoreWarnings: result.ignoreWarnings === true,
    rollbackOnError: result.rollbackOnError === true,
    exit,
    successes,
    failures,
    testFailures: asList(runTests.failures).length,
    errorStatusCode: text(result.errorStatusCode),
  }
}

/**
 * Exit 0 success, 1 failed or canceled, 68 partial, 69 in progress. The status in
 * the body is what's believed, because an async start and `report` both exit 0
 * whatever the job is doing. A timeout or a killed CLI is unknown, never stopped.
 */
export function parseDeployRun(run: SfRun): DeployStatus | Failure {
  if (run.outcome !== 'exited') return runFailure(run)
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return failure('unknown', `The Salesforce CLI did not print JSON (exit ${run.code}), so the result is unknown.`)
  }
  if (!isObject(parsed)) return unknownShape('project deploy')
  if (![0, 1, 68, 69].includes(run.code)) return failure('unknown', `The Salesforce CLI exited ${run.code}, so the result is unknown.`)
  if (isObject(parsed.result) && parsed.result.id !== undefined) return parseDeployBody(parsed.result, run.code)
  // No result: the command itself failed. These names are the ones a person acts on.
  if (typeof parsed.name === 'string' && /CannotQuickDeploy|INVALID_ID_FIELD/.test(parsed.name)) return failure('validation-refused', typeof parsed.message === 'string' ? parsed.message : 'Salesforce refused that validation.')
  return classify(parsed.name, parsed.message)
}

/** `apex get test` exits 100 when a test failed, with the result in the body. */
export function parseApexRun(run: SfRun): ApexRun | Failure {
  if (run.outcome !== 'exited') return runFailure(run)
  let parsed: unknown
  try {
    parsed = JSON.parse(run.stdout)
  } catch {
    return failure('unknown', `The Salesforce CLI did not print JSON (exit ${run.code}), so the result is unknown.`)
  }
  if (!isObject(parsed)) return unknownShape('apex test')
  if (run.code !== 0 && run.code !== 100) return classify(parsed.name, parsed.message)
  const result = parsed.result
  if (!isObject(result)) return unknownShape('apex test')
  if (typeof result.testRunId === 'string' && result.summary === undefined) return TEST_RUN_ID.test(result.testRunId) ? { kind: 'started', runId: result.testRunId } : unknownShape('apex test')
  const summary = result.summary
  if (!isObject(summary) || typeof summary.outcome !== 'string') return unknownShape('apex test')
  const count = (value: unknown) => (typeof value === 'number' ? value : 0)
  const failed = asList(result.tests).flatMap(item => {
    if (!isObject(item) || item.Outcome !== 'Fail') return []
    return [{ name: typeof item.FullName === 'string' ? item.FullName : typeof item.MethodName === 'string' ? item.MethodName : 'unnamed', message: typeof item.Message === 'string' ? item.Message : '', stackTrace: typeof item.StackTrace === 'string' ? item.StackTrace : '' }]
  })
  return {
    kind: 'finished',
    outcome: summary.outcome,
    testsRan: count(summary.testsRan),
    passing: count(summary.passing),
    failing: count(summary.failing),
    skipped: count(summary.skipped),
    testRunId: typeof summary.testRunId === 'string' ? summary.testRunId : null,
    orgWideCoverage: typeof summary.orgWideCoverage === 'string' ? summary.orgWideCoverage : null,
    testRunCoverage: typeof summary.testRunCoverage === 'string' ? summary.testRunCoverage : null,
    failed,
  }
}
