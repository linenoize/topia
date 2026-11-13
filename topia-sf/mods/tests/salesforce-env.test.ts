import { expect, test } from 'claude-code/testing'

import {
  acknowledgementApplies,
  acknowledgementGrantsProductionWrite,
  bandParts,
  bandText,
  confirmShownPath,
  noticeText,
  showsContinue,
  viewBand,
} from '../lib/salesforce-env.ts'
import { classLabel, modeLabel, pathsMatch } from '../../salesforce/service/contract.ts'
import { noticeText as serviceNoticeText, showsContinue as serviceShowsContinue } from '../../salesforce/service/issues.ts'
import type { SalesforceIdentity, SalesforceIssue, SalesforceIssueKind, SalesforceSession } from '../types'

const NOW = Date.parse('2026-06-02T00:00:00.000Z')
const IDENTITY: SalesforceIdentity = {
  classification: 'production',
  orgName: 'Acme Sales',
  orgId: '00D…',
  user: 'ada@example.com',
  mode: 'investigate',
}

const CONTINUES: SalesforceIssueKind[] = ['stale-verification', 'user-changed-on-read', 'expired-auth', 'uncommitted-before-retrieve', 'report-row-cap', 'partial-dependency-coverage', 'vendor-version-drift']
const STOPS: SalesforceIssueKind[] = ['org-id-mismatch', 'plan-bound-to-different-org', 'production-write-without-elevation', 'missing-approval', 'approval-hash-mismatch', 'destructive-over-ceiling', 'unknown']

function issue(kind: SalesforceIssueKind): SalesforceIssue {
  return { id: kind, kind, orgId: '00D…', orgName: 'Acme Sales', user: 'ada@example.com', operationClass: 'read', message: kind }
}

function session(over: Partial<SalesforceSession> = {}): SalesforceSession {
  return { identity: IDENTITY, issue: null, orgIdentityHash: 'hash', checkedAt: '2026-06-01T23:00:00.000Z', ...over }
}

const on = (over: Partial<Parameters<typeof viewBand>[0]> = {}) => viewBand({ lock: { state: 'on' }, session: session(), ack: null, registeredOrgs: 1, now: NOW, ...over })

test('the quiet band names class, org, id, user, and mode', async () => {
  expect(bandText(IDENTITY)).toBe('Salesforce  Production — Acme Sales  00D…  ada@example.com  Investigate')
  expect(bandText({ ...IDENTITY, classification: 'sandbox' })).toContain('Sandbox — Acme Sales')
  expect(bandText(IDENTITY).includes('default')).toBe(false)
  expect(bandParts(IDENTITY).map(part => part.key)).toEqual(['sf-class', 'sf-org', 'sf-user', 'sf-mode'])
  expect(on()?.kind).toBe('quiet')
})

test('the mod uses the service copy of the shared logic, not one of its own', async () => {
  for (const kind of [...CONTINUES, ...STOPS]) {
    expect(showsContinue(kind)).toBe(serviceShowsContinue(kind))
    expect(noticeText(issue(kind))).toBe(serviceNoticeText(issue(kind)))
  }
  expect(classLabel('sandbox')).toBe('Sandbox')
  expect(modeLabel('plan')).toBe('Plan')
  expect(pathsMatch('C:\\work\\a\\', 'c:/work/a')).toBe(true)
})

test('recoverable issues can be acknowledged and hard stops cannot', async () => {
  for (const kind of CONTINUES) {
    expect(showsContinue(kind)).toBe(true)
    const view = on({ session: session({ issue: issue(kind) }) })
    expect(view?.kind).toBe('notice')
    if (view?.kind === 'notice') expect(view.canContinue).toBe(true)
    expect(noticeText(issue(kind)).includes('cannot continue')).toBe(false)
  }
  for (const kind of STOPS) {
    expect(showsContinue(kind)).toBe(false)
    const view = on({ session: session({ issue: issue(kind) }) })
    expect(view?.kind).toBe('stop')
    expect(noticeText(issue(kind))).toContain('The operation cannot continue.')
  }
})

test('an unknown check is a stop and an acknowledgement does not clear it', async () => {
  const item = issue('unknown')
  const ack = { issueId: item.id, orgId: item.orgId, user: item.user, operationClass: item.operationClass, payloadHash: '', recordSetHash: '', orgIdentityHash: 'hash' }
  expect(on({ session: session({ issue: item }), ack })?.kind).toBe('stop')
})

test('the band stays hidden until this project is locked', async () => {
  expect(viewBand({ lock: { state: 'off' }, session: session(), ack: null, registeredOrgs: 1, now: NOW })).toBe(null)
})

test('a lock that cannot be read says so and does not read as off', async () => {
  const view = viewBand({ lock: { state: 'unreadable', message: 'The store cannot be read.' }, session: null, ack: null, registeredOrgs: 0, now: NOW })
  expect(view?.kind).toBe('stop')
  expect(view?.text).toContain('cannot be read')
})

test('with no live check yet, the band says so and shows no identity', async () => {
  const none = on({ session: null })
  expect(none?.kind).toBe('notice')
  expect(none?.text).toContain('not been checked')
  const unregistered = on({ session: null, registeredOrgs: 0 })
  expect(unregistered?.text).toContain('/topia-sf:connect')
})

test('an old snapshot is stale, not live', async () => {
  const stale = on({ session: session({ checkedAt: '2026-05-30T00:00:00.000Z' }) })
  expect(stale?.kind).toBe('notice')
  expect(stale?.text).toContain('stale')
  const junk = on({ session: session({ checkedAt: 'not a date' }) })
  expect(junk?.kind).toBe('notice')
})

test('an acknowledgement expires when the org identity changes', async () => {
  const item = issue('report-row-cap')
  const ack = { issueId: item.id, orgId: item.orgId, user: item.user, operationClass: item.operationClass, payloadHash: 'p', recordSetHash: 'r', orgIdentityHash: 'o' }
  expect(acknowledgementApplies(ack, item, { payloadHash: 'p', recordSetHash: 'r', orgIdentityHash: 'o' })).toBe(true)
  expect(acknowledgementApplies(ack, item, { payloadHash: 'other', recordSetHash: 'r', orgIdentityHash: 'o' })).toBe(false)
  expect(acknowledgementApplies(ack, item, { payloadHash: 'p', recordSetHash: 'other', orgIdentityHash: 'o' })).toBe(false)
  expect(acknowledgementApplies(ack, item, { payloadHash: 'p', recordSetHash: 'r', orgIdentityHash: 'other' })).toBe(false)
  expect(acknowledgementGrantsProductionWrite()).toBe(false)
})

test('a button applies only to the path that was shown', async () => {
  expect(confirmShownPath('C:/work/project-a', 'C:/work/project-b').ok).toBe(false)
  expect(confirmShownPath(null, 'C:/work/project-a').ok).toBe(false)
  expect(confirmShownPath('C:/work/project-a', 'c:/work/project-a/').ok).toBe(true)
})
