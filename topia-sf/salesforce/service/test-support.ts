import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'

import type { FieldDescribe, ObjectDescribe } from './adapter.js'
import { approvalAccepted, buildApprovalScreen } from './approval-screen.js'
import { proposeBrief } from './brief.js'
import type { OrgRecord, SfMode } from './contract.js'
import { writeJson } from './json-file.js'
import { activationKey, orgRecordKey, orgsFile, orgWriterKey } from './paths.js'
import { prepareRecordsWrite, runRecordsWrite, type ApproveReply, type PinnedWrite, type StepName, type WriteReply } from './records-write.js'
import { SfCliAdapter } from './sf-adapter.js'
import { STAMP_KEY } from './stamp.js'
import { storeSet } from './store.js'
import { callTool, type CallInput } from './tools.js'

export const ORG = '00D000000000001AAA'
export const INSTANCE = 'https://acme.sandbox.example.com'
export const USERNAME = 'ada@example.com'
export const USER_ID = '00500000000000AAAA'
export const WRITER = 'ada-writer@example.com'
export const WRITER_ID = '00500000000000WWWW'

export function tempPair(): { root: string; store: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'sf-proj-'))
  const store = mkdtempSync(join(tmpdir(), 'sf-store-'))
  return {
    root,
    store,
    cleanup() {
      rmSync(root, { recursive: true, force: true })
      rmSync(store, { recursive: true, force: true })
    },
  }
}

export function activate(root: string, store: string, projectRoot = root, user = 'ada'): void {
  const lock = { projectRoot, timestamp: '2026-06-01T00:00:00.000Z', user }
  storeSet(store, activationKey(projectRoot), lock)
}

const here = dirname(fileURLToPath(import.meta.url))

export const FIXTURES = join(here, '..', 'test-fixtures')
export const FAKE_BIN = join(FIXTURES, 'fake-sf', 'bin')
export const FAKE_ENTRY = join(FAKE_BIN, 'run.js')
export const FLAG_SNAPSHOT = join(FIXTURES, 'sf-flags.snapshot.json')

export type FakeHome = {
  root: string
  /** The project under test. */
  project: string
  /** The plugin store under the isolated home, where a child process finds it by default. */
  store: string
  /** An environment that can only reach the fake: its PATH holds nothing else. */
  env: Record<string, string>
  cleanup: () => void
}

/** An isolated home for the fake CLI. Nothing a test runs here can find a real sf. */
export function fakeHome(): FakeHome {
  const root = mkdtempSync(join(tmpdir(), 'sf-fake-'))
  const home = join(root, 'home')
  const project = join(root, 'project')
  const store = join(home, '.claude', 'plugins', 'store')
  mkdirSync(store, { recursive: true })
  mkdirSync(project, { recursive: true })
  const env: Record<string, string> = {
    PATH: FAKE_BIN,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TEMP: tmpdir(),
    TMP: tmpdir(),
  }
  if (process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot
  return {
    root,
    project,
    store,
    env,
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    },
  }
}

export function writeScenario(home: FakeHome, scenario: unknown): void {
  const dir = join(home.env.HOME ?? '', '.fake-sf')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'scenario.json'), JSON.stringify(scenario))
}

export type FakeCall = {
  argv: string[]
  command: string
  flags: Record<string, string | boolean | string[]>
  positional: string[]
  soql: string | null
  cwd: string
  env: Record<string, string | undefined>
  execArgv: string[]
}

export type FakeWrite = { kind: 'collections' | 'bulk' | 'deploy'; object?: string; id: string; jobId?: string; operation?: string; zipSha?: string }

function jsonLines<T>(home: FakeHome, name: string): T[] {
  const file = join(home.env.HOME ?? '', '.fake-sf', name)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as T)
}

/** Every write the fake org took, one line per record, so a double write can't hide in a count. */
export function fakeWrites(home: FakeHome): FakeWrite[] {
  return jsonLines<FakeWrite>(home, 'writes.jsonl')
}

export function fakeJobs(home: FakeHome): { id: string; operation: string; object: string; count: number }[] {
  return jsonLines(home, 'jobs.jsonl')
}

export function fakeDeploys(home: FakeHome): { id: string; checkOnly: boolean; zipSha: string; quickOf?: string; members?: string[]; testLevel?: string | null }[] {
  return jsonLines(home, 'deploys.jsonl')
}

export type FakeOrgState = { records: Record<string, Record<string, Record<string, unknown>>>; metadata: Record<string, Record<string, string>>; clock: number; serial: number; jobs: Record<string, unknown>; deploys: Record<string, Record<string, unknown>> }

export function fakeOrg(home: FakeHome): FakeOrgState {
  return JSON.parse(readFileSync(join(home.env.HOME ?? '', '.fake-sf', 'org.json'), 'utf8')) as FakeOrgState
}

/** A change someone else makes in the org. Starts the state file when no write has yet. */
export function changeFakeOrg(home: FakeHome, change: (org: FakeOrgState) => void): void {
  const file = join(home.env.HOME ?? '', '.fake-sf', 'org.json')
  const scenario = JSON.parse(readFileSync(join(home.env.HOME ?? '', '.fake-sf', 'scenario.json'), 'utf8')) as { records?: FakeOrgState['records']; metadata?: FakeOrgState['metadata'] }
  const org: FakeOrgState = existsSync(file) ? fakeOrg(home) : { records: scenario.records ?? {}, metadata: scenario.metadata ?? {}, clock: 1000, serial: 1, jobs: {}, deploys: {} }
  change(org)
  writeFileSync(file, JSON.stringify(org))
}

export function fakeCalls(home: FakeHome): FakeCall[] {
  const file = join(home.env.HOME ?? '', '.fake-sf', 'calls.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as FakeCall)
}

function describedField(over: Partial<FieldDescribe> & { name: string; type: string }): FieldDescribe {
  return { label: over.name, custom: false, createable: false, updateable: false, filterable: true, sortable: true, groupable: true, nillable: true, relationshipName: null, referenceTo: [], picklistValues: [], ...over }
}

const EDITABLE = { createable: true, updateable: true }

/** Reserved names only: the fixture object is Widget__c, the person is ada@example.com. */
export const DESCRIBE_WIDGET: ObjectDescribe = {
  name: 'Widget__c',
  label: 'Widget',
  custom: true,
  queryable: true,
  updateable: true,
  deletable: true,
  fields: [
    describedField({ name: 'Id', type: 'id' }),
    describedField({ name: 'OwnerId', type: 'reference', relationshipName: 'Owner', referenceTo: ['User'], ...EDITABLE }),
    describedField({ name: 'WhatId', type: 'reference', relationshipName: 'What', referenceTo: ['Account', 'Contact'], ...EDITABLE }),
    describedField({ name: 'IsDeleted', type: 'boolean' }),
    describedField({ name: 'Status__c', type: 'picklist', custom: true, picklistValues: [{ value: 'New', label: 'New', active: true }, { value: 'Closed', label: 'Closed', active: false }, { value: "O'Brien", label: "O'Brien", active: true }, { value: '50%_off', label: '50% off', active: true }], ...EDITABLE }),
    describedField({ name: 'LastActivityDate', type: 'date' }),
    describedField({ name: 'CreatedDate', type: 'datetime' }),
    describedField({ name: 'SystemModstamp', type: 'datetime' }),
    describedField({ name: 'Due_Date__c', type: 'date', custom: true, ...EDITABLE }),
    describedField({ name: 'Name', type: 'string', ...EDITABLE }),
    describedField({ name: 'Notes__c', type: 'textarea', custom: true, filterable: false, sortable: false, ...EDITABLE }),
    describedField({ name: 'Contact_Email__c', type: 'email', custom: true, ...EDITABLE }),
    describedField({ name: 'Amount__c', type: 'currency', custom: true, ...EDITABLE }),
    describedField({ name: 'Tags__c', type: 'multipicklist', custom: true, picklistValues: [{ value: 'A', label: 'A', active: true }, { value: 'B', label: 'B', active: true }, { value: 'C', label: 'C', active: true }], ...EDITABLE }),
    describedField({ name: 'Secret__c', type: 'encryptedstring', custom: true, sortable: false, ...EDITABLE }),
  ],
}

export const DESCRIBE_USER: ObjectDescribe = {
  name: 'User',
  label: 'User',
  custom: false,
  queryable: true,
  fields: [
    describedField({ name: 'Id', type: 'id' }),
    describedField({ name: 'IsActive', type: 'boolean', ...EDITABLE }),
    describedField({ name: 'Email', type: 'email', ...EDITABLE }),
    describedField({ name: 'Username', type: 'string', ...EDITABLE }),
  ],
}

export const DESCRIBE_CONTACT: ObjectDescribe = {
  name: 'Contact',
  label: 'Contact',
  custom: false,
  queryable: true,
  fields: [describedField({ name: 'Id', type: 'id' }), describedField({ name: 'Birthdate', type: 'date', ...EDITABLE })],
}

function rows(records: Record<string, unknown>[], type: string): { records: Record<string, unknown>[]; totalSize: number; done: boolean } {
  return { records: records.map(record => ({ attributes: { type, url: `/services/data/v66.0/sobjects/${type}/x` }, ...record })), totalSize: records.length, done: true }
}

export function queryRows(records: Record<string, unknown>[], type = 'Widget__c'): { records: Record<string, unknown>[]; totalSize: number; done: boolean } {
  return rows(records, type)
}

export function countRows(total: number): { records: never[]; totalSize: number; done: boolean } {
  return { records: [], totalSize: total, done: true }
}

type FakePackage = { name: string; namespace: string | null; version: [number, number, number, number] }

/** What one vendor package looks like to the inventory. Reserved names only. A test passes what it changes. */
export function inventoryQueries(over: { packages?: FakePackage[]; components?: Record<string, Record<string, unknown>[]> } = {}): unknown[] {
  const packages = over.packages ?? [{ name: 'VendorCo Widgets', namespace: 'vendorco', version: [1, 4, 2, 1] }]
  const components = over.components ?? {
    ApexTrigger: [{ NamespacePrefix: 'vendorco', Name: 'Guard' }],
    ApexClass: [{ NamespacePrefix: 'vendorco', Name: 'Helper' }],
    FlowDefinition: [{ NamespacePrefix: 'vendorco', DeveloperName: 'Intake' }],
    EntityDefinition: [{ NamespacePrefix: 'vendorco', QualifiedApiName: 'vendorco__Gadget__c' }],
    PermissionSet: [{ NamespacePrefix: 'vendorco', Name: 'Admin' }],
  }
  const installed = packages.map(item => ({
    SubscriberPackage: { attributes: { type: 'SubscriberPackage' }, Name: item.name, NamespacePrefix: item.namespace },
    SubscriberPackageVersion: { attributes: { type: 'SubscriberPackageVersion' }, MajorVersion: item.version[0], MinorVersion: item.version[1], PatchVersion: item.version[2], BuildNumber: item.version[3] },
  }))
  const component = (type: string, tooling: boolean) => ({ match: `FROM ${type} `, tooling, result: rows(components[type] ?? [], type) })
  return [
    { match: 'FROM InstalledSubscriberPackage', tooling: true, result: rows(installed, 'InstalledSubscriberPackage') },
    component('ApexTrigger', true),
    component('ApexClass', true),
    component('FlowDefinition', true),
    component('EntityDefinition', true),
    component('PermissionSet', false),
    { match: 'FROM PackageLicense', tooling: false, result: rows(packages.length > 0 ? [{ NamespacePrefix: 'vendorco', AllowedLicenses: 50, UsedLicenses: 12, Status: 'Active' }] : [], 'PackageLicense') },
    { match: 'FROM UserLicense', tooling: false, result: rows([{ Name: 'Salesforce', TotalLicenses: 10, UsedLicenses: 4, Status: 'Active' }], 'UserLicense') },
    { match: 'FROM PermissionSetLicense', tooling: false, result: rows([{ DeveloperName: 'VendorCoUser', TotalLicenses: 5, UsedLicenses: 2 }], 'PermissionSetLicense') },
  ]
}

/** What MetadataComponentDependency answers for WidgetService. Reserved names only, and the shape is unconfirmed: see LIVE-CHECKLIST.md. */
export function dependencyQueries(over: { usedByRows?: number } = {}): unknown[] {
  const row = (name: string, type: string, ref: string, refType: string) => ({ MetadataComponentId: '01p000000000001AAA', MetadataComponentName: name, MetadataComponentNamespace: null, MetadataComponentType: type, RefMetadataComponentId: '01p000000000002AAA', RefMetadataComponentName: ref, RefMetadataComponentNamespace: null, RefMetadataComponentType: refType })
  const usedBy = over.usedByRows === undefined ? [row('WidgetTrigger', 'ApexTrigger', 'WidgetService', 'ApexClass')] : Array.from({ length: over.usedByRows }, (_, index) => row(`WidgetCaller${index}`, 'ApexClass', 'WidgetService', 'ApexClass'))
  return [
    { match: 'FROM MetadataComponentDependency WHERE RefMetadataComponent', tooling: true, result: rows(usedBy, 'MetadataComponentDependency') },
    { match: 'FROM MetadataComponentDependency WHERE MetadataComponent', tooling: true, result: rows([row('WidgetService', 'ApexClass', 'Widget__c', 'CustomObject')], 'MetadataComponentDependency') },
  ]
}

export const LIVE_ORG = { Id: ORG, Name: 'Acme Sales', IsSandbox: true, OrganizationType: 'Developer Edition', InstanceName: 'CS99' }
export const LIVE_USER = { Id: USER_ID, Username: USERNAME, Name: 'Ada Example', IsActive: true, Profile: { attributes: { type: 'Profile' }, Name: 'Read Only' } }

/** The documented shapes, with reserved names. A test passes only what it changes. */
export function baseScenario(over: Record<string, unknown> = {}): Record<string, unknown> {
  const { queries, org, user, ...rest } = over as { queries?: unknown[]; org?: Record<string, unknown>; user?: Record<string, unknown> }
  return {
    display: {
      id: ORG,
      username: USERNAME,
      instanceUrl: INSTANCE,
      apiVersion: '66.0',
      accessToken: "[REDACTED] Use 'sf org auth show-access-token' to view",
      clientId: 'PlatformCLI',
      connectedStatus: 'Connected',
      alias: 'acme-sbx',
    },
    queries: [
      ...(queries ?? []),
      { match: 'FROM Organization', result: rows([{ ...LIVE_ORG, ...org }], 'Organization') },
      { match: 'FROM User WHERE Username', result: rows([{ ...LIVE_USER, ...user }], 'User') },
      { match: '^SELECT PermissionSet[.]', result: rows([{ PermissionSet: { PermissionsModifyAllData: false, PermissionsModifyMetadata: false, PermissionsCustomizeApplication: false, PermissionsAuthorApex: false } }], 'PermissionSetAssignment') },
      { match: 'FROM ObjectPermissions', result: rows([], 'ObjectPermissions') },
    ],
    describe: { Widget__c: DESCRIBE_WIDGET, User: DESCRIBE_USER, Contact: DESCRIBE_CONTACT },
    entityIds: { Widget__c: '01I000000000001' },
    ...rest,
  }
}

export const RECORD: OrgRecord = {
  orgId: ORG,
  username: USERNAME,
  instanceUrl: INSTANCE,
  isSandbox: true,
  name: 'Acme Sales',
  registeredAt: '2026-06-01T00:00:00.000Z',
  writeAccess: { canWrite: 'no', reasons: [] },
}

/** A project that is on and has one org registered, the way the runner leaves it. */
export function registerFake(home: FakeHome, over: Partial<OrgRecord> = {}): OrgRecord {
  const record = { ...RECORD, ...over }
  activate(home.project, home.store)
  storeSet(home.store, orgRecordKey(home.project, record.orgId), record)
  writeJson(orgsFile(home.project), { orgs: [{ orgId: record.orgId, instanceUrl: record.instanceUrl, name: record.name, verifiedAt: record.registeredAt }] })
  return record
}

/** A second login on the same org: the user a person logs in only for a change. */
export function writerScenario(over: { canWrite?: boolean } = {}): Record<string, unknown> {
  return {
    displays: { [WRITER]: { id: ORG, username: WRITER, instanceUrl: INSTANCE, apiVersion: '66.0', accessToken: '[REDACTED]', alias: 'acme-writer' } },
    deploy: { createdBy: WRITER_ID },
    queries: [
      { match: `FROM User WHERE Username = '${WRITER}'`, result: queryRows([{ ...LIVE_USER, Id: WRITER_ID, Username: WRITER }], 'User') },
      { match: `^SELECT PermissionSet[.].*${WRITER_ID}`, result: queryRows([{ PermissionSet: { PermissionsModifyAllData: over.canWrite !== false, PermissionsModifyMetadata: false, PermissionsCustomizeApplication: false, PermissionsAuthorApex: false } }], 'PermissionSetAssignment') },
    ],
  }
}

export const WRITER_RECORD: OrgRecord = { ...RECORD, username: WRITER, role: 'writer', writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }

/** A second user for an org already registered, the way the runner leaves it. */
export function registerWriterFake(home: FakeHome, over: Partial<OrgRecord> = {}): OrgRecord {
  const record = { ...WRITER_RECORD, ...over }
  storeSet(home.store, orgWriterKey(home.project, record.orgId), record)
  return record
}

export function contextFor(home: FakeHome, over: Partial<CallInput> = {}): CallInput {
  return { projectRoot: home.project, storeRoot: home.store, correlationId: 'corr-1', now: Date.parse('2026-06-01T00:00:00.000Z'), ...over }
}

const here_ = dirname(fileURLToPath(import.meta.url))

/** Runs the real runner as a real process, against the fake. A kill from the fake lands on this process. */
export function runRunner(home: FakeHome, command: string, input: Record<string, unknown>, timeout = 60_000): { status: number | null; signal: string | null; reply: Record<string, any> | null } {
  const ran = spawnSync(process.execPath, [join(here_, 'runner.js'), command], { input: JSON.stringify({ projectRoot: home.project, ...input }), env: home.env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  let reply: Record<string, any> | null = null
  try {
    reply = JSON.parse(ran.stdout) as Record<string, any>
  } catch {
    reply = null
  }
  return { status: ran.status, signal: ran.signal, reply }
}

export const WIDGET_MODSTAMP = '2026-05-01T00:00:00.000+0000'

export function widgetIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `a00${String(index + 1).padStart(12, '0')}AAA`)
}

/** Reserved names only. `Amount__c` is the field automation touches, and Status__c is the one a plan changes. */
export function widgetRecords(ids: string[], over: Record<string, unknown> = {}): Record<string, Record<string, unknown>> {
  return Object.fromEntries(ids.map(id => [id, { Id: id, SystemModstamp: WIDGET_MODSTAMP, Status__c: 'New', Name: `Widget ${id.slice(-6, -3)}`, Amount__c: 5, Due_Date__c: null, Contact_Email__c: 'grace@example.com', Notes__c: 'A note', Tags__c: null, OwnerId: '00500000000000BBBB', WhatId: null, ...over }]))
}

export type WriteRigOptions = { scenario?: Record<string, unknown>; ids?: string[]; recordsOver?: Record<string, unknown>; register?: Record<string, unknown> }

export type WriteRig = {
  home: FakeHome
  adapter: SfCliAdapter
  now: () => number
  input: (at?: number) => CallInput
  briefHash: string
  briefId: string
  /** Writes a plan the way /topia-sf:plan does, through the tools. */
  plan: (over?: Record<string, unknown>) => Promise<string>
  prepare: (planId: string, over?: { brief?: string | null; mode?: SfMode; now?: number }) => Promise<WriteReply>
  /** Approves as a person would: the label on the screen, exactly. */
  approve: (planId: string) => Promise<ApproveReply>
  run: (pinned: PinnedWrite, over?: { brief?: string | null; mode?: SfMode; onStep?: (step: StepName) => void; pollBudgetMs?: number; now?: number }) => Promise<WriteReply>
  writesOf: (id: string) => number
  /** A later scenario, keeping what the test doesn't change. */
  rescenario: (change: (scenario: Record<string, unknown>) => Record<string, unknown>) => void
}

export function writeRig(body: (rig: WriteRig) => Promise<void>, options: WriteRigOptions = {}): () => Promise<void> {
  const ids = options.ids ?? widgetIds(3)
  return async () => {
    const home = fakeHome()
    try {
      registerFake(home, (options.register ?? {}) as never)
      writeScenario(home, baseScenario({ records: { Widget__c: widgetRecords(ids, options.recordsOver) }, ...options.scenario }))
      const adapter = new SfCliAdapter({ env: home.env, projectRoot: home.project, timeoutMs: 8000, versionTimeoutMs: 8000, writeTimeoutMs: 3000 })
      const now = () => Date.now()
      const input = (at = now()) => contextFor(home, { hookHost: true, now: at, correlationId: `corr-${at}` })
      const { briefId, briefHash } = proposeBrief(home.store, home.project, { objective: 'Close the old Widget__c', environment: 'Sandbox', subjects: [], change: 'Status__c', blockingQuestions: [] }, new Date(now()).toISOString())
      const planStamp = { mode: 'plan', agentId: null, confirmedBriefHash: briefHash, ack: null }
      const plan: WriteRig['plan'] = async (over = {}) => {
        const review = await callTool(adapter, 'practice_record', { briefId, practice: 'fine', experience: 'fine', security: 'fine', pii: 'none', vendorImpact: 'none', stopRecommendation: false, confirmedChange: ['Status__c', 'Name', 'Amount__c', 'Due_Date__c', 'OwnerId', 'Tags__c', 'Notes__c', 'Contact_Email__c', 'delete'], [STAMP_KEY]: planStamp }, input())
        assert.equal(review.ok, true, JSON.stringify(review))
        const made = await callTool(adapter, 'records_plan_update', { orgId: ORG, briefId, practiceReviewId: (review.data as { practiceReviewId: string }).practiceReviewId, object: 'Widget__c', operation: 'update', changes: [{ field: 'Status__c', value: 'Closed' }], frozenRecordIds: ids, businessObjective: 'Tidy up', notes: 'A note', ...over, [STAMP_KEY]: planStamp }, input())
        assert.equal(made.ok, true, JSON.stringify(made))
        return (made.data as { planId: string }).planId
      }
      const prepare: WriteRig['prepare'] = (planId, over = {}) => prepareRecordsWrite(adapter, input(over.now), { planId }, over.brief === undefined ? briefHash : over.brief, over.mode ?? 'execute')
      const approve: WriteRig['approve'] = async planId => {
        const reply = await prepare(planId)
        assert.equal(reply.ok, true, JSON.stringify(reply))
        assert.equal((reply as ApproveReply).action, 'approve', JSON.stringify(reply))
        const screen = buildApprovalScreen((reply as ApproveReply).screenPlan, (reply as ApproveReply).facts)
        assert.equal(approvalAccepted(screen, screen.requiresTypedOrgName ? (screen.typedOrgName as string) : screen.approveLabel), true)
        return reply as ApproveReply
      }
      const run: WriteRig['run'] = (pinned, over = {}) => runRecordsWrite(adapter, input(over.now), pinned, over.brief === undefined ? briefHash : over.brief, over.mode ?? 'execute', { onStep: over.onStep, pollBudgetMs: over.pollBudgetMs ?? 3000, pollIntervalMs: 10 })
      const writesOf: WriteRig['writesOf'] = id => fakeWrites(home).filter(item => item.id === id).length
      const rescenario: WriteRig['rescenario'] = change => writeScenario(home, change(JSON.parse(readFileSync(join(home.env.HOME as string, '.fake-sf', 'scenario.json'), 'utf8')) as Record<string, unknown>))
      await body({ home, adapter, now, input, briefHash, briefId, plan, prepare, approve, run, writesOf, rescenario })
    } finally {
      home.cleanup()
    }
  }
}

export function refused(reply: WriteReply, shape: RegExp): void {
  assert.equal(reply.ok, false, JSON.stringify(reply))
  assert.match((reply as { reason: string }).reason, shape)
}

export function reported(reply: WriteReply): Record<string, any> {
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal((reply as { action: string }).action, 'report', JSON.stringify(reply))
  return (reply as { data: Record<string, any> }).data
}
