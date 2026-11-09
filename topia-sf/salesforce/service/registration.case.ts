import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { SINGLE_USER_WARNING, UNKNOWN_WRITE_WARNING, WRITE_WARNING } from './contract.js'
import { readJournal } from './journal.js'
import { writeJson } from './json-file.js'
import { activationKey, journalDirectory, orgRecordKey, orgsFile, sessionKey } from './paths.js'
import { listOrgRecords, readOrgsFile, readWriter, removeOrg } from './registry.js'
import { storeGet, storeSet } from './store.js'
import { activate, baseScenario, fakeCalls, fakeHome, INSTANCE, ORG, queryRows, RECORD, registerFake, registerWriterFake, USER_ID, USERNAME, WRITER, writerScenario, writeScenario, type FakeHome } from './test-support.js'

const here = dirname(fileURLToPath(import.meta.url))

function runner(home: FakeHome, command: string, input: Record<string, unknown>, env: Record<string, string> = home.env): Record<string, any> {
  const ran = spawnSync(process.execPath, [join(here, 'runner.js'), command], { input: JSON.stringify({ projectRoot: home.project, ...input }), env, encoding: 'utf8' })
  assert.equal(ran.status, 0, ran.stderr)
  return JSON.parse(ran.stdout) as Record<string, any>
}

function withHome(body: (home: FakeHome) => void | Promise<void>, options: { lock?: boolean; scenario?: Record<string, unknown> } = {}): () => Promise<void> {
  return async () => {
    const home = fakeHome()
    try {
      if (options.lock !== false) activate(home.project, home.store)
      writeScenario(home, baseScenario(options.scenario ?? {}))
      await body(home)
    } finally {
      home.cleanup()
    }
  }
}

function pinned(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    username: USERNAME,
    expect: { orgId: ORG, isSandbox: true },
    instanceUrl: INSTANCE,
    writeAccess: { canWrite: 'no', reasons: [] },
    ...over,
  }
}

// ── resolving ──

test('resolve refuses with no lock, and runs no CLI', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /not on/)
  assert.equal(fakeCalls(home).length, 0)
}, { lock: false }))

test('a token-shaped or default target is refused before anything runs', withHome(home => {
  for (const target of ['00D000000000001!AQEAQSYNTHETIC', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln', 'default', '--flags-dir=/x', '']) {
    const reply = runner(home, 'org-resolve', { target })
    assert.equal(reply.ok, false, target)
  }
  assert.equal(runner(home, 'org-resolve', {}).ok, false)
  assert.equal(fakeCalls(home).length, 0)
}))

test('resolve reads live facts: the alias once, then the username, and no token', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal(reply.live.orgId, ORG)
  assert.equal(reply.live.name, 'Acme Sales')
  assert.equal(reply.live.isSandbox, true)
  assert.equal(reply.live.username, USERNAME)
  assert.equal(reply.live.instanceHost, 'acme.sandbox.example.com')
  assert.equal(reply.writeAccess.canWrite, 'no')
  assert.equal(reply.previous, null)
  assert.equal(reply.requiresTypedName, false)
  const calls = fakeCalls(home).filter(call => call.command !== 'version')
  assert.deepEqual(calls[0]?.flags['target-org'], 'acme-sbx')
  for (const call of calls.slice(1)) assert.equal(call.flags['target-org'], USERNAME)
  assert.equal(JSON.stringify(reply).includes('REDACTED'), false, 'the token field stopped at the adapter')
}))

test('a login that disagrees with the org it reaches is refused', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /disagree/)
}, { scenario: { org: { Id: '00D000000000099AAA' } } }))

for (const [mode, pattern] of [['expired-auth', /log/i], ['malformed', /unknown/i], ['timeout', /unknown|timed/i], ['rate-limit', /limit/i]] as const) {
  test(`resolve reports ${mode} and offers nothing to approve`, withHome(home => {
    writeScenario(home, baseScenario({ mode, modeOn: 'FROM Organization' }))
    const ran = spawnSync(process.execPath, [join(here, 'runner.js'), 'org-resolve'], { input: JSON.stringify({ projectRoot: home.project, target: 'acme-sbx', timeoutMs: 1000 }), env: home.env, encoding: 'utf8' })
    const reply = JSON.parse(ran.stdout) as { ok: boolean; reason: string }
    assert.equal(reply.ok, false, ran.stdout)
    assert.match(reply.reason, pattern)
  }))
}

test('a missing CLI is named as the reason', withHome(home => {
  const empty = join(home.root, 'empty')
  mkdirSync(empty)
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' }, { ...home.env, PATH: empty })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /Salesforce CLI/)
}))

// ── the write-permission probe ──

const HOLDS = (over: Record<string, unknown>) => queryRows([{ PermissionSet: { PermissionsModifyAllData: false, PermissionsModifyMetadata: false, PermissionsCustomizeApplication: false, PermissionsAuthorApex: false, ...over } }], 'PermissionSetAssignment')

test('the probe finds a broad permission', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.writeAccess.canWrite, 'yes')
  assert.deepEqual(reply.writeAccess.reasons, ['Modify All Data'])
}, { scenario: { queries: [{ match: '^SELECT PermissionSet[.]', result: HOLDS({ PermissionsModifyAllData: true }) }] } }))

test('the probe finds object write access', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.writeAccess.canWrite, 'yes')
  assert.match(reply.writeAccess.reasons.join(' '), /object/)
}, { scenario: { queries: [{ match: 'FROM ObjectPermissions', result: queryRows([{ SobjectType: 'Widget__c' }], 'ObjectPermissions') }] } }))

test('a read-only user reads as no, and the query used the live user id', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.writeAccess.canWrite, 'no')
  const probe = fakeCalls(home).find(call => call.soql?.includes('FROM PermissionSetAssignment'))
  assert.match(probe?.soql ?? '', new RegExp(`AssigneeId = '${USER_ID}'`))
}))

test('a probe that fails is unknown, which never reads as read-only', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.ok, true)
  assert.equal(reply.writeAccess.canWrite, 'unknown')
}, { scenario: { queries: [{ match: 'FROM ObjectPermissions', error: { name: 'INSUFFICIENT_ACCESS', message: 'No access.' } }] } }))

// ── re-registering ──

test('a new org id for the same username needs the typed name, old beside new', withHome(home => {
  registerFake(home, { orgId: '00D000000000002AAA', name: 'Acme Old' })
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.requiresTypedName, true)
  assert.equal(reply.previous.orgId, '00D000000000002AAA')
  assert.equal(reply.previous.name, 'Acme Old')
}))

test('a class change on the same id needs the typed name', withHome(home => {
  registerFake(home, { isSandbox: false })
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.requiresTypedName, true)
  assert.equal(reply.previous.isSandbox, false)
}))

test('registering the same org again needs only the label', withHome(home => {
  registerFake(home)
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.requiresTypedName, false)
  assert.equal(reply.previous.orgId, ORG)
}))

test('other registered orgs are named on the way in', withHome(home => {
  registerFake(home, { orgId: '00D000000000005AAA', username: 'other@example.com', name: 'Acme Other' })
  const reply = runner(home, 'org-resolve', { target: 'acme-sbx' })
  assert.equal(reply.previous, null)
  assert.deepEqual(reply.others.map((item: { name: string }) => item.name), ['Acme Other'])
}))

// ── registering ──

test('register writes orgs.json with no username, and keeps the username in the store', withHome(home => {
  const reply = runner(home, 'org-register', pinned())
  assert.equal(reply.ok, true, JSON.stringify(reply))
  const file = readFileSync(orgsFile(home.project), 'utf8')
  assert.equal(file.includes(USERNAME), false)
  assert.equal(/username/i.test(file), false)
  assert.deepEqual(readOrgsFile(home.project).map(item => [item.orgId, item.name]), [[ORG, 'Acme Sales']])
  const record = listOrgRecords(home.store, home.project)[0]
  assert.equal(record?.username, USERNAME)
  assert.equal(record?.instanceUrl, INSTANCE)
  assert.equal(record?.isSandbox, true)
}))

test('register re-checks the org right before writing, and refuses if it moved', withHome(home => {
  writeScenario(home, baseScenario({ org: { Id: '00D000000000099AAA' } }))
  const moved = runner(home, 'org-register', pinned())
  assert.equal(moved.ok, false)
  assert.match(moved.reason, /changed/)
  assert.equal(existsSync(orgsFile(home.project)), false)
  writeScenario(home, baseScenario({ org: { IsSandbox: false } }))
  const reclassed = runner(home, 'org-register', pinned())
  assert.equal(reclassed.ok, false)
  assert.equal(listOrgRecords(home.store, home.project).length, 0)
}))

test('register refuses with no lock, and on bad pins', withHome(home => {
  assert.equal(runner(home, 'org-register', pinned()).ok, false)
  activate(home.project, home.store)
  for (const bad of [{ username: '' }, { username: '00D000000000001!AQEA' }, { expect: null }, { expect: { orgId: 'x', isSandbox: true } }, { instanceUrl: 'http://not-https.example.com' }, { writeAccess: { canWrite: 'maybe', reasons: [] } }]) {
    assert.equal(runner(home, 'org-register', pinned(bad)).ok, false, JSON.stringify(bad))
  }
  assert.equal(existsSync(orgsFile(home.project)), false)
}, { lock: false }))

test('re-registering a replacement removes the old org, and a team narrowing survives on the same id', withHome(home => {
  registerFake(home, { orgId: '00D000000000002AAA', name: 'Acme Old' })
  assert.equal(runner(home, 'org-register', pinned({ replaces: '00D000000000002AAA' })).ok, true)
  assert.deepEqual(readOrgsFile(home.project).map(item => item.orgId), [ORG])
  assert.deepEqual(listOrgRecords(home.store, home.project).map(item => item.orgId), [ORG])

  writeJson(orgsFile(home.project), { orgs: [{ orgId: ORG, name: 'Acme Sales', instanceUrl: INSTANCE, verifiedAt: 'x', destructiveCeiling: 5, repo: 'acme/sales', username: 'someone@example.com' }] })
  assert.equal(runner(home, 'org-register', pinned()).ok, true)
  const [entry] = readOrgsFile(home.project)
  assert.equal(entry?.destructiveCeiling, 5)
  assert.equal(entry?.repo, 'acme/sales')
  assert.equal(readFileSync(orgsFile(home.project), 'utf8').includes('someone@example.com'), false, 'a username somebody added does not survive')
}))

test('a successful registration journals it and leaves a live snapshot', withHome(home => {
  const reply = runner(home, 'org-register', pinned({ writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }))
  assert.equal(reply.ok, true)
  const snapshot = storeGet(home.store, sessionKey(home.project)) as { identity: { orgName: string; classification: string }; writeWarning: string }
  assert.equal(snapshot.identity.orgName, 'Acme Sales')
  assert.equal(snapshot.identity.classification, 'sandbox')
  assert.equal(snapshot.writeWarning, WRITE_WARNING)
  const journal = readFileSync(join(journalDirectory(home.project), `${reply.correlationId}.jsonl`), 'utf8')
  assert.match(journal, /org\.registered/)
  assert.equal(journal.includes(USERNAME), false)
  assert.equal(readJournal(home.project, reply.correlationId).length, 1)
}))

// ── the band's status ──

test('status carries the registered count and the permanent warning', withHome(home => {
  registerFake(home, { writeAccess: { canWrite: 'unknown', reasons: ['No access.'] } })
  assert.equal(runner(home, 'identity-check', {}).checked, true)
  const status = runner(home, 'status', {})
  assert.equal(status.registeredOrgs, 1)
  assert.equal(status.session.writeWarning, UNKNOWN_WRITE_WARNING)
  assert.equal(status.session.identity.orgId, ORG)
}))

test('status is one small read: no CLI runs for it', withHome(home => {
  registerFake(home)
  const before = fakeCalls(home).length
  runner(home, 'status', {})
  assert.equal(fakeCalls(home).length, before)
}))

test('identity-check does nothing with no org, or no lock', withHome(home => {
  assert.equal(runner(home, 'identity-check', {}).checked, false)
  assert.equal(fakeCalls(home).length, 0)
}))

test('identity-check stays off in a project with no lock', withHome(home => {
  storeSet(home.store, orgRecordKey(home.project, ORG), RECORD)
  assert.equal(runner(home, 'identity-check', {}).checked, false)
  assert.equal(fakeCalls(home).length, 0)
}, { lock: false }))

test('identity-check writes the failure the band has to show', withHome(home => {
  registerFake(home)
  writeScenario(home, baseScenario({ mode: 'expired-auth', modeOn: 'FROM Organization' }))
  const reply = runner(home, 'identity-check', {})
  assert.equal(reply.checked, true)
  const status = runner(home, 'status', {})
  assert.equal(status.session.identity, null)
  assert.equal(status.session.issue.kind, 'expired-auth')
}))

test('identity-check follows the org last in use when several are registered', withHome(home => {
  registerFake(home)
  storeSet(home.store, orgRecordKey(home.project, '00D000000000002AAA'), { ...RECORD, orgId: '00D000000000002AAA', name: 'Acme Prod' })
  assert.equal(runner(home, 'identity-check', {}).checked, false, 'with no org in use and two registered, it does not guess')
  storeSet(home.store, sessionKey(home.project), { identity: { orgId: ORG }, issue: null, orgIdentityHash: '', checkedAt: '', writeWarning: null })
  assert.equal(runner(home, 'identity-check', {}).checked, true)
}))

test('disable leaves no lock behind for identity-check to use', withHome(home => {
  registerFake(home)
  assert.equal(runner(home, 'disable', {}).ok, true)
  assert.equal(storeGet(home.store, activationKey(home.project)), undefined)
  assert.equal(runner(home, 'identity-check', {}).checked, false)
  writeFileSync(join(home.project, 'marker'), '')
}))

// ── a second user, for writes on production ──

const PROD = { org: { IsSandbox: false, Name: 'Acme Production' } }
const pinnedWriter = (over: Record<string, unknown> = {}) => pinned({ username: WRITER, role: 'writer', expect: { orgId: ORG, isSandbox: false }, writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] }, ...over })

function withProduction(body: (home: FakeHome) => void | Promise<void>, over: { canWrite?: boolean } = {}): () => Promise<void> {
  const writer = writerScenario(over)
  return withHome(home => {
    registerFake(home, { isSandbox: false, name: 'Acme Production' })
    return body(home)
  }, { scenario: { ...PROD, ...writer } })
}

test('a writer resolves against the reader already registered', withProduction(home => {
  const reply = runner(home, 'org-resolve', { target: WRITER, role: 'writer' })
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal(reply.role, 'writer')
  assert.equal(reply.live.username, WRITER)
  assert.equal(reply.reader, USERNAME)
  assert.equal(reply.requiresTypedName, false)
  assert.equal(reply.writeAccess.canWrite, 'yes')
}))

test('a writer needs a reader first', withHome(home => {
  const reply = runner(home, 'org-resolve', { target: WRITER, role: 'writer' })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /read-only user first/)
}, { scenario: { ...PROD, ...writerScenario() } }))

test("a sandbox doesn't take a writer", withHome(home => {
  registerFake(home)
  const reply = runner(home, 'org-resolve', { target: WRITER, role: 'writer' })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /sandbox/i)
}, { scenario: writerScenario() }))

test('a writer has to be a different user from the reader', withProduction(home => {
  const reply = runner(home, 'org-resolve', { target: USERNAME, role: 'writer' })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /different user/)
}))

test('a user with no write permission is not a writer', withProduction(home => {
  const reply = runner(home, 'org-resolve', { target: WRITER, role: 'writer' })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /no write permission/i)
}, { canWrite: false }))

test('the registered writer can not come back as the reader', withProduction(home => {
  registerWriterFake(home, { isSandbox: false })
  const reply = runner(home, 'org-resolve', { target: WRITER })
  assert.equal(reply.ok, false)
  assert.match(reply.reason, /registered as the writer/)
}))

test('a writer stays in the store. It never reaches orgs.json, and it leaves the reader alone', withProduction(home => {
  const before = readFileSync(orgsFile(home.project), 'utf8')
  const reply = runner(home, 'org-register', pinnedWriter())
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal(readFileSync(orgsFile(home.project), 'utf8'), before)
  assert.equal(readFileSync(orgsFile(home.project), 'utf8').includes(WRITER), false)
  const writer = readWriter(home.store, home.project, ORG)
  assert.equal(writer?.username, WRITER)
  assert.equal(writer?.role, 'writer')
  assert.equal(writer?.isSandbox, false)
  assert.deepEqual(listOrgRecords(home.store, home.project).map(item => item.username), [USERNAME])
  assert.equal(runner(home, 'status', {}).registeredOrgs, 1)
  assert.equal(readJournal(home.project, reply.correlationId).at(-1)?.event, 'org.registered')
}))

test('registering a writer refuses when the reader has gone, or the org moved', withHome(home => {
  assert.equal(runner(home, 'org-register', pinnedWriter()).ok, false)
  registerFake(home, { isSandbox: false, name: 'Acme Production' })
  const moved = runner(home, 'org-register', pinnedWriter({ expect: { orgId: '00D000000000099AAA', isSandbox: false } }))
  assert.equal(moved.ok, false)
  assert.equal(readWriter(home.store, home.project, ORG), null)
}, { scenario: { ...PROD, ...writerScenario() } }))

test('removing an org removes its writer too', withProduction(home => {
  registerWriterFake(home, { isSandbox: false })
  removeOrg(home.store, home.project, ORG)
  assert.equal(readWriter(home.store, home.project, ORG), null)
}))

// ── one user that can write ──

test('production with a user that can write offers the acceptance, and a sandbox or a read-only user does not', withHome(home => {
  const writes = { queries: [{ match: '^SELECT PermissionSet[.]', result: queryRows([{ PermissionSet: { PermissionsModifyAllData: true } }], 'PermissionSetAssignment') }] }
  writeScenario(home, baseScenario({ ...PROD, ...writes }))
  assert.equal(runner(home, 'org-resolve', { target: 'acme-prod' }).canAcceptSingleUser, true)
  writeScenario(home, baseScenario(writes))
  assert.equal(runner(home, 'org-resolve', { target: 'acme-sbx' }).canAcceptSingleUser, false)
  writeScenario(home, baseScenario(PROD))
  assert.equal(runner(home, 'org-resolve', { target: 'acme-prod' }).canAcceptSingleUser, false)
}))

test('accepting one user is recorded with the person, and the band keeps saying so', withHome(home => {
  const reply = runner(home, 'org-register', pinned({ singleUser: true, expect: { orgId: ORG, isSandbox: false }, writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } }))
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.equal(typeof listOrgRecords(home.store, home.project)[0]?.singleUserAcceptedAt, 'string')
  assert.equal((storeGet(home.store, sessionKey(home.project)) as { writeWarning: string }).writeWarning, SINGLE_USER_WARNING)
  assert.ok(SINGLE_USER_WARNING.includes(WRITE_WARNING))
}, { scenario: PROD }))

test('the acceptance is refused on a sandbox, and for a user that can not write', withHome(home => {
  assert.equal(runner(home, 'org-register', pinned({ singleUser: true, writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } })).ok, false)
  writeScenario(home, baseScenario(PROD))
  assert.equal(runner(home, 'org-register', pinned({ singleUser: true, expect: { orgId: ORG, isSandbox: false } })).ok, false)
  assert.equal(listOrgRecords(home.store, home.project).length, 0)
}))

test('a plain re-registration clears an acceptance: it holds for the registration that took it', withHome(home => {
  registerFake(home, { isSandbox: false, singleUserAcceptedAt: '2026-06-01T00:00:00.000Z' })
  assert.equal(runner(home, 'org-register', pinned({ expect: { orgId: ORG, isSandbox: false }, writeAccess: { canWrite: 'yes', reasons: ['Modify All Data'] } })).ok, true)
  assert.equal(listOrgRecords(home.store, home.project)[0]?.singleUserAcceptedAt, undefined)
}, { scenario: PROD }))
