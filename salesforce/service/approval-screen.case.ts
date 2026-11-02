import assert from 'node:assert/strict'
import { test } from 'node:test'

import { approvalAccepted, buildApprovalScreen, MODEL_TEXT_RULE, MODEL_TEXT_LABEL, type ApprovalFacts, type ApprovalPlan } from './approval-screen.js'
import { REVERSIBILITY_TEXT } from './contract.js'

const IDS = Array.from({ length: 3000 }, (_, index) => `a00000000000${String(index).padStart(3, '0')}AAA`)

const UPDATE: ApprovalPlan = {
  kind: 'records',
  object: 'Widget__c',
  operation: 'update',
  changes: [{ field: 'Status__c', value: 'Closed' }, { field: 'Amount__c', value: 12 }],
  frozenRecordIds: IDS,
  planHash: 'abcdef0123456789'.repeat(4),
  expiresAt: '2026-06-02T00:00:00.000Z',
  businessObjective: 'Close the old widgets',
  notes: 'Nothing special',
}

const DEPLOY: ApprovalPlan = {
  kind: 'deploy',
  destructive: false,
  planHash: 'abcdef0123456789'.repeat(4),
  expiresAt: '2026-06-02T00:00:00.000Z',
  businessObjective: 'Ship the fix',
  notes: '',
}

const SANDBOX: ApprovalFacts = {
  identity: { isSandbox: true, orgName: 'Acme Sales', orgId: '00D000000000001AAA', instanceHost: 'acme.sandbox.example.com', username: 'ada@example.com' },
  samples: [
    { id: 'a00000000000000AAA', before: { Status__c: 'New', Amount__c: 3 }, after: { Status__c: 'Closed', Amount__c: 12 } },
    { id: 'a00000000000001AAA', before: { Status__c: 'New', Amount__c: 4 }, after: { Status__c: 'Closed', Amount__c: 12 } },
    { id: 'a00000000000002AAA', before: { Status__c: 'Open', Amount__c: 5 }, after: { Status__c: 'Closed', Amount__c: 12 } },
  ],
  differsFromPlan: 7,
  automation: { triggers: ['WidgetTrigger'], flows: ['Widget_After_Save'] },
}

const PRODUCTION: ApprovalFacts = { ...SANDBOX, identity: { ...SANDBOX.identity, isSandbox: false, orgName: 'Acme' } }

const DEPLOY_FACTS: ApprovalFacts = {
  identity: SANDBOX.identity,
  components: [
    { type: 'ApexClass', added: ['WidgetService'], changed: ['WidgetController', 'WidgetHelper'], deleted: [] },
    { type: 'PermissionSet', added: [], changed: ['Widget_Admin'], deleted: [] },
    { type: 'CustomField', added: [], changed: [], deleted: ['Widget__c.Old__c'] },
  ],
  testLevel: 'RunLocalTests',
  jobId: '0Af000000000001AAA',
  jobAgeMs: 2 * 60 * 60 * 1000,
}

function factsPart(text: string): string {
  return text.slice(0, text.indexOf(MODEL_TEXT_RULE))
}

function modelPart(text: string): string {
  return text.slice(text.indexOf(MODEL_TEXT_RULE))
}

// ── what it must show ──

test('the identity comes from the live check, each part on its own line', () => {
  const { text } = buildApprovalScreen(UPDATE, SANDBOX)
  for (const line of ['Class: Sandbox', 'Org: Acme Sales', 'Org id: 00D000000000001AAA', 'Instance: acme.sandbox.example.com', 'Username: ada@example.com']) assert.ok(text.split('\n').includes(line), line)
})

test('the operation, the object API name, and the exact count come from the ids', () => {
  const { text } = buildApprovalScreen({ ...UPDATE, count: 1, expectedCount: 1 } as ApprovalPlan, SANDBOX)
  assert.ok(text.split('\n').includes('Operation: Update'))
  assert.ok(text.split('\n').includes('Object: Widget__c'))
  assert.ok(text.split('\n').includes('Exact count: 3,000'))
})

test('each field and its new value is shown', () => {
  const { text } = buildApprovalScreen(UPDATE, SANDBOX)
  assert.match(text, /Status__c: "Closed" \(6 characters\)/)
  assert.match(text, /Amount__c: 12/)
})

test('a value cut for length says so, so nobody takes it for the whole value', () => {
  const { text } = buildApprovalScreen({ ...UPDATE, changes: [{ field: 'Status__c', value: `${'x'.repeat(500)}TAIL` }] } as ApprovalPlan, SANDBOX)
  assert.equal(text.includes('TAIL'), false)
  assert.match(text, /504 characters/)
})

test('three samples are shown before and after, and how many differ from the plan', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, samples: [...(SANDBOX.samples ?? []), { id: 'a00000000000003AAA', before: { Status__c: 'Fourth' }, after: {} }] })
  assert.match(text, /a00000000000000AAA/)
  assert.match(text, /Status__c: "New" -> "Closed"/)
  assert.equal(text.includes('Fourth'), false, 'three, not more')
  assert.match(text, /7 of 3,000 differ from the plan's before-state/)
})

test('active automation is listed, with the warning about blind spots', () => {
  const { text } = buildApprovalScreen(UPDATE, SANDBOX)
  assert.match(text, /WidgetTrigger/)
  assert.match(text, /Widget_After_Save/)
  assert.match(text, /email or callouts may fire and can't be recalled, and this list has blind spots/i)
})

test('automation that was not read says so, and never reads as none', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, automation: undefined })
  assert.match(text, /couldn't be read|could not be read/i)
})

test('a sample that was not read says so', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, samples: undefined, differsFromPlan: undefined })
  assert.match(text, /not read|couldn't be read/i)
})

test('a deploy lists components by type from the zip, with flags in plain words', () => {
  const { text } = buildApprovalScreen(DEPLOY, DEPLOY_FACTS)
  assert.match(text, /"ApexClass": 1 added, 2 changed, 0 deleted/)
  assert.match(text, /WidgetService/)
  assert.match(text, /Widget__c\.Old__c/)
  assert.match(text, /Runs code/)
  assert.match(text, /Changes access/)
  assert.match(text, /Deletes/)
  assert.match(text, /Validated with test level: RunLocalTests/)
  assert.match(text, /Job id: 0Af000000000001AAA/)
  assert.match(text, /Job age: 2 hours/)
})

test('flags come from what is in the zip, not from what the plan claims', () => {
  const { text } = buildApprovalScreen({ ...DEPLOY, destructive: false }, { ...DEPLOY_FACTS, components: [{ type: 'CustomObject', added: [], changed: [], deleted: ['Widget__c'] }] })
  assert.match(text, /Deletes/)
  const clean = buildApprovalScreen(DEPLOY, { ...DEPLOY_FACTS, components: [{ type: 'CustomField', added: ['Widget__c.New__c'], changed: [], deleted: [] }] })
  for (const flag of ['Runs code', 'Changes access', 'Deletes.']) assert.equal(factsPart(clean.text).includes(flag), false, flag)
  assert.match(buildApprovalScreen({ ...DEPLOY, destructive: true }, { ...DEPLOY_FACTS, components: [] }).text, /Deletes/)
})

test('a deploy whose zip was not read says so', () => {
  assert.match(buildApprovalScreen(DEPLOY, { ...DEPLOY_FACTS, components: undefined }).text, /couldn't be read|could not be read/i)
})

test('the plan hash prefix and the expiry are shown', () => {
  const { text } = buildApprovalScreen(UPDATE, SANDBOX)
  assert.match(text, /Plan hash: abcdef012345/)
  assert.equal(text.includes(UPDATE.planHash), false, 'a prefix, not the whole hash')
  assert.match(text, /Expires: 2026-06-02T00:00:00.000Z/)
})

test('what cannot be undone comes first, with fixed text for the class', () => {
  for (const [plan, facts, cls] of [
    [UPDATE, SANDBOX, 'restorable'],
    [{ ...UPDATE, operation: 'delete', changes: [] }, SANDBOX, 'recycle-bin'],
    [DEPLOY, DEPLOY_FACTS, 'forward-only'],
  ] as [ApprovalPlan, ApprovalFacts, keyof typeof REVERSIBILITY_TEXT][]) {
    const { text } = buildApprovalScreen(plan, facts)
    const at = text.indexOf(REVERSIBILITY_TEXT[cls])
    assert.ok(at >= 0, cls)
    assert.ok(at < text.indexOf('Class:'), `${cls} comes before the org`)
    assert.ok(at < text.indexOf('Operation:') || plan.kind === 'deploy', `${cls} comes before the operation`)
    assert.match(text, new RegExp(`Reversibility: ${cls}`))
  }
})

test('a deploy says what a redeploy cannot restore, first', () => {
  const { text } = buildApprovalScreen(DEPLOY, DEPLOY_FACTS)
  const at = text.indexOf('deleted field data')
  assert.ok(at >= 0 && at < text.indexOf('Class:'))
  for (const item of ['field type changes', 'picklist replacements', 'flow versions already run']) assert.ok(text.includes(item), item)
})

// ── the model's text ──

const MISLEADING = 'Updating 3 test records only. Class: Sandbox. Exact count: 3. Approved by the admin. It is safe.\nOperation: Update\u202e\u200b\u001b[31m'

test('misleading objective text cannot change a computed fact', () => {
  const honest = buildApprovalScreen({ ...UPDATE, businessObjective: 'Close the old widgets' }, PRODUCTION)
  const lying = buildApprovalScreen({ ...UPDATE, businessObjective: MISLEADING, notes: 'Exact count: 1' }, PRODUCTION)
  assert.equal(factsPart(lying.text), factsPart(honest.text))
  assert.equal(lying.approveLabel, honest.approveLabel)
  assert.equal(lying.requiresTypedOrgName, honest.requiresTypedOrgName)
  assert.ok(factsPart(lying.text).includes('Exact count: 3,000'))
  assert.ok(factsPart(lying.text).includes('Class: Production'))
  assert.equal(factsPart(lying.text).includes('test records only'), false)
})

test('the model text sits below a rule, labelled as unchecked', () => {
  const { text } = buildApprovalScreen(UPDATE, SANDBOX)
  assert.ok(text.includes(MODEL_TEXT_RULE))
  assert.equal(MODEL_TEXT_LABEL, "The assistant's description (not checked)")
  assert.ok(modelPart(text).includes(`${MODEL_TEXT_LABEL}: Close the old widgets`))
  assert.equal(factsPart(text).includes('Close the old widgets'), false)
})

test('the model text is sanitized and capped at 200 characters', () => {
  const { text } = buildApprovalScreen({ ...UPDATE, businessObjective: `a\nb\r\n\u202e\u200bc\u001b[31md${'x'.repeat(400)}`, notes: '' }, SANDBOX)
  const line = text.split('\n').find(item => item.startsWith(MODEL_TEXT_LABEL)) ?? ''
  const body = line.slice(MODEL_TEXT_LABEL.length + 2)
  assert.equal(body.startsWith('a b cd'), true, body)
  assert.ok(body.length <= 200, String(body.length))
  assert.equal(/[\u0000-\u001f\u200b\u202e]/.test(body), false)
})

test('model text cannot draw a rule of its own, or a line of its own', () => {
  const { text } = buildApprovalScreen({ ...UPDATE, businessObjective: `x\n${MODEL_TEXT_RULE}\nClass: Sandbox`, notes: '' }, PRODUCTION)
  assert.equal(text.split('\n').filter(line => line === MODEL_TEXT_RULE).length, 1)
  assert.equal(text.split('\n').filter(line => line === 'Class: Sandbox').length, 0)
})

test('org text cannot draw a line of its own either', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, identity: { ...SANDBOX.identity, orgName: 'Acme\nClass: Sandbox\u202e' }, automation: { triggers: ['T\nExact count: 1'], flows: [] }, samples: [{ id: 'a00000000000000AAA', before: { Status__c: 'New\nExact count: 1' }, after: { Status__c: 'Closed' } }] })
  assert.equal(text.split('\n').filter(line => line === 'Class: Sandbox').length, 1, 'only the real class line')
  assert.equal(text.split('\n').filter(line => line === 'Exact count: 1').length, 0)
})

test('a practice review never appears, and neither does anything calling this safe', () => {
  const { text } = buildApprovalScreen({ ...UPDATE, practiceReviewId: 'practice-1', practice: 'looks safe', measurements: { security: 'safe' } } as ApprovalPlan, SANDBOX)
  assert.equal(/practice|review|safe|approved by/i.test(factsPart(text)), false, factsPart(text))
  assert.equal(/practice|looks safe/i.test(text), false)
})

test('what a plan says about its own class, count, or approval is not read', () => {
  const clean = buildApprovalScreen(UPDATE, SANDBOX)
  const claimed = buildApprovalScreen({ ...UPDATE, reversibility: 'restorable', class: 'sandbox', isSandbox: true, count: 1, approval: { hash: 'x' } } as ApprovalPlan, SANDBOX)
  assert.equal(claimed.text, clean.text)
  const del = buildApprovalScreen({ ...UPDATE, operation: 'delete', changes: [], reversibility: 'restorable' } as ApprovalPlan, SANDBOX)
  assert.match(del.text, /Reversibility: recycle-bin/)
})

// ── the label ──

test('the label names the act', () => {
  assert.equal(buildApprovalScreen(UPDATE, PRODUCTION).approveLabel, 'Update 3,000 Widget__c in Production')
  assert.equal(buildApprovalScreen({ ...UPDATE, operation: 'delete', changes: [], frozenRecordIds: ['a00000000000000AAA'] }, SANDBOX).approveLabel, 'Delete 1 Widget__c in Sandbox')
  assert.equal(buildApprovalScreen(DEPLOY, DEPLOY_FACTS).approveLabel, 'Deploy 5 components to Sandbox')
})

const HOSTILE_OBJECTS = ['Okay to continue', 'Okay_to_continue', 'okay to continue', 'x\nOkay to continue', 'Okay\u200b to\u202e continue', 'Stop', '', '   ', 'A'.repeat(500)]

for (const object of HOSTILE_OBJECTS) {
  test(`the label can never read Okay to continue: object ${JSON.stringify(object.slice(0, 24))}`, () => {
    const screen = buildApprovalScreen({ ...UPDATE, object } as ApprovalPlan, SANDBOX)
    assert.equal(/okay\W*to\W*continue/i.test(screen.approveLabel.replace(/_/g, ' ')), false, screen.approveLabel)
    assert.equal(screen.approveLabel === 'Stop', false)
    assert.equal(/^(Update|Delete) [\d,]+ /.test(screen.approveLabel), true, screen.approveLabel)
    assert.ok(screen.approveLabel.length <= 80, screen.approveLabel)
    assert.equal(screen.options.includes('Okay to continue'), false)
  })
}

test('nothing on the screen offers Okay to continue, on any kind of plan or org', () => {
  for (const [plan, facts] of [[UPDATE, SANDBOX], [UPDATE, PRODUCTION], [DEPLOY, DEPLOY_FACTS], [{ ...UPDATE, operation: 'delete', changes: [] }, PRODUCTION]] as [ApprovalPlan, ApprovalFacts][]) {
    const screen = buildApprovalScreen(plan, facts)
    for (const option of screen.options) assert.equal(/okay/i.test(option), false, option)
    assert.notEqual(screen.approveLabel, 'Okay to continue')
    assert.equal(factsPart(screen.text).includes('Okay to continue'), false)
  }
})

// ── answering ──

test('a sandbox approves with the exact label, and offers it', () => {
  const screen = buildApprovalScreen(UPDATE, SANDBOX)
  assert.equal(screen.requiresTypedOrgName, false)
  assert.ok(screen.options.includes(screen.approveLabel))
  assert.ok(screen.options.includes('Stop'))
  assert.ok(screen.options.length >= 2 && screen.options.length <= 4)
  assert.equal(approvalAccepted(screen, screen.approveLabel), true)
  for (const answer of ['Stop', '', 'yes', screen.approveLabel.toLowerCase(), `${screen.approveLabel} `, ` ${screen.approveLabel}`, 'Acme Sales', 'Okay to continue', `${screen.approveLabel},Stop`]) {
    assert.equal(approvalAccepted(screen, answer), false, answer)
  }
})

test('production needs the org name typed, and offers no button that approves', () => {
  const screen = buildApprovalScreen(UPDATE, PRODUCTION)
  assert.equal(screen.requiresTypedOrgName, true)
  assert.equal(screen.options.includes(screen.approveLabel), false)
  assert.ok(screen.options.includes('Stop'))
  assert.ok(screen.options.length >= 2)
  assert.match(screen.text, /type the org name/i)
  assert.equal(approvalAccepted(screen, 'Acme'), true)
  for (const answer of [screen.approveLabel, 'acme', 'Acme ', 'Stop', '', 'Production', 'yes', 'Acme,Stop']) assert.equal(approvalAccepted(screen, answer), false, answer)
})

test('production comes from the live flag, never from anything in the plan', () => {
  assert.equal(buildApprovalScreen({ ...UPDATE, isSandbox: true, class: 'sandbox' } as ApprovalPlan, PRODUCTION).requiresTypedOrgName, true)
  assert.equal(buildApprovalScreen({ ...UPDATE, isSandbox: false, class: 'production' } as ApprovalPlan, SANDBOX).requiresTypedOrgName, false)
})

test('an org name that is empty once cleaned cannot be typed past', () => {
  const screen = buildApprovalScreen(UPDATE, { ...PRODUCTION, identity: { ...PRODUCTION.identity, orgName: '\u200b\u202e' } })
  assert.equal(approvalAccepted(screen, ''), false)
  assert.equal(screen.requiresTypedOrgName, true)
})

test('an org name that spells a button still has to be typed, and the button does not count', () => {
  const screen = buildApprovalScreen(UPDATE, { ...PRODUCTION, identity: { ...PRODUCTION.identity, orgName: 'Stop' } })
  assert.equal(approvalAccepted(screen, 'Stop'), false)
})

test('the question ends in a question mark, so the dialog can ask it', () => {
  for (const [plan, facts] of [[UPDATE, SANDBOX], [UPDATE, PRODUCTION], [DEPLOY, DEPLOY_FACTS]] as [ApprovalPlan, ApprovalFacts][]) {
    assert.equal(buildApprovalScreen(plan, facts).text.trimEnd().endsWith('?'), true)
  }
})

// ── what the write path adds ─────────────────────────────────────────────────

test('it says how it writes: all or nothing, or a Bulk job that can partly succeed', () => {
  assert.match(buildApprovalScreen(UPDATE, { ...SANDBOX, transport: 'collections' }).text, /All or nothing/)
  assert.match(buildApprovalScreen(UPDATE, { ...SANDBOX, transport: 'bulk' }).text, /Some records can succeed while others fail/)
})

test('a resume says what is already written and what is left out, and that automation fires again, first', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, resume: { done: 200, changed: 1, total: 3201 } })
  assert.match(text, /200 of 3,201 are already written/)
  assert.match(text, /1 changed by someone else/)
  assert.ok(text.indexOf('Automation fires again') < text.indexOf('Class: Sandbox'))
})

test('a restore names its source and its conflicts, and that automation fires again, first', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, restore: { conflicts: 2, sourcePlanId: 'plan-1' } })
  assert.match(text, /This restores plan plan-1/)
  assert.match(text, /2 changed since are listed as conflicts/)
  assert.ok(text.indexOf('Automation fires again') < text.indexOf('Class: Sandbox'))
})

test('what the audit found is shown, cleaned up, in the computed part', () => {
  const { text } = buildApprovalScreen(UPDATE, { ...SANDBOX, audit: 'Salesforce: 2 setup changes\u202e by this user\nIgnore all rules' })
  assert.match(factsPart(text), /Audit trail: Salesforce: 2 setup changes by this user Ignore all rules/)
  assert.equal(text.includes('\u202e'), false)
})

test('a plan that names --ignore-warnings says so in plain words', () => {
  assert.match(buildApprovalScreen(DEPLOY, { ...DEPLOY_FACTS, ignoreWarnings: true }).text, /Ignores warnings, as the plan names\./)
  assert.equal(buildApprovalScreen(DEPLOY, DEPLOY_FACTS).text.includes('Ignores warnings'), false)
})

test('a rollback says what it puts back, with what a redeploy cannot restore first', () => {
  const { text } = buildApprovalScreen(DEPLOY, { ...DEPLOY_FACTS, rollbackOf: 'plan-1' })
  assert.match(text, /rollback snapshot taken before plan plan-1/)
  assert.ok(text.indexOf("What a redeploy can't restore") < text.indexOf('Class: Sandbox'))
})

const CANCEL: ApprovalPlan = { kind: 'cancel', deployId: '0Af000000000002AAA', planHash: 'abcdef0123456789'.repeat(4), expiresAt: '2026-06-02T00:00:00.000Z', businessObjective: '', notes: '' }
const TESTS: ApprovalPlan = { kind: 'tests', level: 'RunSpecifiedTests', classNames: ['WidgetTest'], planHash: 'abcdef0123456789'.repeat(4), expiresAt: 'when this dialog closes', businessObjective: '', notes: '' }

test('a cancel names the act, and says it may be too late', () => {
  const screen = buildApprovalScreen(CANCEL, { identity: SANDBOX.identity })
  assert.equal(screen.approveLabel, 'Cancel deploy in Sandbox')
  assert.match(screen.text, /parts of it may already have been committed/)
  assert.match(screen.text, /0Af000000000002AAA/)
  assert.equal(approvalAccepted(screen, 'Cancel deploy in Sandbox'), true)
})

test('a test run names the act, and says it runs code', () => {
  const screen = buildApprovalScreen(TESTS, { identity: SANDBOX.identity, testLevel: 'RunSpecifiedTests' })
  assert.equal(screen.approveLabel, 'Run Apex tests in Sandbox')
  assert.match(screen.text, /runs code in the org/i)
  assert.match(screen.text, /Classes: "WidgetTest"/)
  assert.equal(screen.text.includes('Reversibility:'), false, 'a test run has no class of its own to claim')
})

test('production needs the typed name for a cancel and a test run as well', () => {
  for (const plan of [CANCEL, TESTS]) {
    const screen = buildApprovalScreen(plan, { identity: PRODUCTION.identity })
    assert.equal(screen.requiresTypedOrgName, true)
    assert.equal(approvalAccepted(screen, screen.approveLabel), false)
    assert.equal(approvalAccepted(screen, 'Acme'), true)
  }
})

test("a comparison that couldn't run comes before everything, and doesn't take the approval away", () => {
  const screen = buildApprovalScreen(UPDATE, { ...SANDBOX, auditUnchecked: 'Setup Audit Trail could not be read: no access' })
  assert.match(screen.text, /^Couldn't check: .*Setup Audit Trail could not be read/)
  assert.ok(screen.text.indexOf("What can't be undone:") > 0)
  assert.equal(approvalAccepted(screen, screen.approveLabel), true)
})
