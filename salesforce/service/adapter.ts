/**
 * Everything the tools read from an org. Each method returns a shape it has
 * validated, or a failure. Output that does not validate is `unknown`, which is
 * never acknowledgeable and never mapped to expired auth. Writes are not here:
 * they arrive in later phases, through the mod and the runner.
 */

export type FailureKind = 'expired-auth' | 'rate-limit' | 'denied' | 'not-found' | 'cli-missing' | 'unknown' | 'in-progress' | 'validation-refused'
export type Failure = { failure: FailureKind; message: string }

export function isFailure(value: unknown): value is Failure {
  return value !== null && typeof value === 'object' && 'failure' in value
}

export type OrgDisplay = { orgId: string; username: string; instanceUrl: string }

/** From SOQL on Organization, which proves the login works. `org display` does not. */
export type LiveOrg = { orgId: string; name: string; isSandbox: boolean; organizationType: string; instanceName: string | null }

export type LiveUser = { id: string; username: string; name: string; isActive: boolean; profileName: string | null }

export type WriteAccess = { canWrite: 'yes' | 'no' | 'unknown'; reasons: string[] }

export type QueryRows = { records: Record<string, unknown>[]; totalSize: number; done: boolean; truncated: boolean }

export type QueryOptions = { tooling?: boolean; allRows?: boolean }

export type PicklistValue = { value: string; label: string; active: boolean }

export type FieldDescribe = {
  name: string
  label: string
  type: string
  custom: boolean
  createable: boolean
  updateable: boolean
  filterable: boolean
  sortable: boolean
  groupable: boolean
  nillable: boolean
  relationshipName: string | null
  referenceTo: string[]
  picklistValues: PicklistValue[]
}

export type ObjectDescribe = { name: string; label: string; custom: boolean; queryable: boolean; updateable?: boolean; deletable?: boolean; fields: FieldDescribe[] }

export type ApiAnswer = { statusCode: number; body: unknown }

export type RetrievedFile = {
  path: string
  bytes: number
  /** Over the raw bytes with line endings normalized, so a diff can compare without keeping secrets. */
  sha256: string
  /** Redacted text, or null for a binary file or one too large to read. */
  text: string | null
  redactions: number
}

export type Retrieved = { files: RetrievedFile[]; problems: { fileName: string; problem: string }[]; missing: string[]; success: boolean; status: string }

export type CollectionRow = { id: string | null; success: boolean; errors: { statusCode: string; message: string; fields: string[] }[] }

/** `rejected` means the API turned the whole call down. `unknown` means nothing here can say what landed. */
export type CollectionsAnswer = { kind: 'answered'; rows: CollectionRow[] } | { kind: 'rejected'; failure: Failure } | { kind: 'unknown'; message: string }

export type BulkJob = { id: string; state: string; object: string | null; operation: string | null; createdById: string | null; processed: number; failed: number }

export type BulkResultFiles = { status: string; processed: number; failed: number; successFile: string | null; failedFile: string | null; unprocessedFile: string | null }

export type DeployComponent = { type: string; fullName: string; success: boolean; changed: boolean; created: boolean; deleted: boolean; problemType: string | null }

export type DeployStatus = {
  id: string
  status: string
  done: boolean
  success: boolean
  checkOnly: boolean
  createdBy: string | null
  startDate: string | null
  createdDate: string | null
  runTestsEnabled: boolean
  numberTestsCompleted: number
  numberTestsTotal: number
  numberTestErrors: number
  numberComponentErrors: number
  ignoreWarnings: boolean
  rollbackOnError: boolean
  /** What the process exited with. Validation acceptance needs 0. */
  exit: number
  successes: DeployComponent[]
  failures: DeployComponent[]
  testFailures: number
  errorStatusCode: string | null
}

export type ApexRun =
  | { kind: 'started'; runId: string }
  | {
      kind: 'finished'
      outcome: string
      testsRan: number
      passing: number
      failing: number
      skipped: number
      testRunId: string | null
      orgWideCoverage: string | null
      testRunCoverage: string | null
      failed: { name: string; message: string; stackTrace: string }[]
    }

export type RawRetrieved = { files: { path: string; bytes: Buffer }[]; problems: { fileName: string; problem: string }[]; fetched: string[]; success: boolean; status: string }

export type Adapter = {
  /** Resolves an alias or username once, at registration. Keeps only these fields, so a token cannot reach a log. */
  display(target: string): Promise<OrgDisplay | Failure>
  liveOrg(username: string): Promise<LiveOrg | Failure>
  liveUser(username: string): Promise<LiveUser | Failure>
  writeAccess(username: string, userId: string): Promise<WriteAccess>
  query(username: string, soql: string, options?: QueryOptions): Promise<QueryRows | Failure>
  count(username: string, soql: string): Promise<{ count: number } | Failure>
  describe(username: string, object: string): Promise<ObjectDescribe | Failure>
  apiGet(username: string, path: string): Promise<ApiAnswer | Failure>
  retrieve(username: string, members: string[]): Promise<Retrieved | Failure>
}

/**
 * What can change an org, or start a check-only job. Only the runner reaches the
 * writes, and the stdio server reaches only the check-only calls.
 */
export type DeployChecks = {
  deployCheck(username: string, kind: 'deploy.validate' | 'deploy.dry-run', zip: string, options: { ignoreWarnings: boolean }): Promise<DeployStatus | Failure>
  deployReport(username: string, jobId: string): Promise<DeployStatus | Failure>
  retrieveManifest(username: string, manifestXml: string): Promise<RawRetrieved | Failure>
  bulkJob(username: string, jobId: string): Promise<BulkJob | Failure>
  bulkResults(username: string, jobId: string, intoDir: string): Promise<BulkResultFiles | Failure>
  apexGet(username: string, runId: string): Promise<ApexRun | Failure>
}

export type OrgWrites = DeployChecks & {
  collectionsUpdate(username: string, body: string, ids: string[]): Promise<CollectionsAnswer>
  bulkStart(username: string, operation: 'update' | 'delete', object: string, csv: string): Promise<{ jobId: string } | Failure>
  deployStart(username: string, zip: string, options: { ignoreWarnings: boolean }): Promise<DeployStatus | Failure>
  deployQuick(username: string, jobId: string): Promise<DeployStatus | Failure>
  deployCancel(username: string, jobId: string): Promise<DeployStatus | Failure>
  apexRun(username: string, level: 'RunLocalTests' | 'RunAllTestsInOrg' | 'RunSpecifiedTests', classNames: string[]): Promise<ApexRun | Failure>
}
