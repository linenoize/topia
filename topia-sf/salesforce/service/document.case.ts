import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  decisionPath,
  type DecisionEntry,
  OPAQUE_COMPONENT,
  packageFilePath,
  parsePackageFile,
  parseVendorFinding,
  renderPackageFile,
  renderVendorFinding,
  seedPackageFile,
  type VendorFindingEntry,
  vendorFindingPath,
  vendorFindingProblems,
  writeDecision,
  writePackageFile,
  writeVendorFinding,
} from './document.js'
import { to18 } from './identity.js'
import { type Inventory, LICENSE_HOLDERS_NOTE, MANAGED_CODE_NOTE } from './inventory.js'
import { safeId } from './paths.js'
import { tempPair } from './test-support.js'

function entry(id: string): DecisionEntry {
  return {
    kind: 'decision',
    id,
    scope: 'Sandbox',
    owner: 'Ada',
    evidence: 'Observed',
    lastVerified: '2026-06-01',
    rationale: 'Because',
    dependencies: 'None',
    uncertainty: 'None',
    body: 'Body',
  }
}

test('an entry id cannot leave its folder', () => {
  const pair = tempPair()
  try {
    assert.throws(() => writeDecision(pair.root, entry('../../escape')), /not safe/)
    assert.throws(() => decisionPath(pair.root, entry('a/b')), /not safe/)
    assert.equal(existsSync(join(pair.root, 'docs', 'escape.md')), false)
    assert.ok(existsSync(writeDecision(pair.root, entry('widget-rule'))))
  } finally {
    pair.cleanup()
  }
})

test('a name made only of dots cannot climb out of its folder', () => {
  for (const id of ['.', '..', '...']) assert.throws(() => safeId(id), /not safe/, id)
  assert.equal(safeId('v1.4.2'), 'v1.4.2')
})

const FINDING_ORG = '00D000000000001AAA'

function finding(over: Partial<VendorFindingEntry> = {}): VendorFindingEntry {
  return {
    kind: 'vendor-finding',
    vendor: 'vendorco',
    id: 'delete-blocked',
    scope: 'Widget__c delete in the Acme sandbox',
    owner: 'Salesforce admin team',
    evidence: 'Delete failed in the UI with a package error',
    lastVerified: '2026-06-01',
    rationale: 'Admins keep hitting this during cleanup',
    dependencies: 'None known',
    uncertainty: 'Not reproduced through the API',
    body: 'Steps seen so far.',
    packageName: 'VendorCo Widgets',
    namespace: 'vendorco',
    pinnedVersion: '1.4.2',
    orgs: [],
    standardBehavior: 'Delete All allows the delete',
    observedBehavior: 'A package trigger blocks the delete',
    component: 'ApexTrigger:vendorco__Guard',
    status: 'suspected',
    vendorTicket: '',
    adminImpact: 'Cleanup jobs fail on these rows',
    workaround: 'None known',
    subscriberEditable: 'unknown',
    reverifyOn: ['package upgrade', 'sandbox refresh'],
    ...over,
  }
}

const WHERE = { vendor: 'vendorco', id: 'delete-blocked' }

test('a finding has the seven fields and the vendor ones, and reads back the same', () => {
  const given = finding({ orgs: [FINDING_ORG] })
  const text = renderVendorFinding(given)
  for (const line of [
    'Kind: vendor-finding',
    'Scope: Widget__c delete',
    'Owner: Salesforce admin team',
    'Last verified: 2026-06-01',
    'Package: VendorCo Widgets',
    'Namespace: vendorco',
    'Pinned version: 1.4.2',
    `Orgs: ${FINDING_ORG}`,
    'Standard behavior: Delete All',
    'Observed behavior: A package trigger',
    'Component: ApexTrigger:vendorco__Guard',
    'Status: suspected',
    'Vendor ticket: none',
    'Admin impact: Cleanup',
    'Workaround: None known',
    'Subscriber editable: unknown',
    'Re-verify on: package upgrade, sandbox refresh',
  ]) {
    assert.ok(text.includes(line), line)
  }
  assert.deepEqual(parseVendorFinding(text, WHERE), { entry: given })
})

test('every field a finding needs is checked, by name', () => {
  for (const [key, value, label] of [
    ['scope', ' ', 'scope'],
    ['owner', '', 'owner'],
    ['evidence', '', 'evidence'],
    ['rationale', '', 'rationale'],
    ['dependencies', '', 'dependencies'],
    ['uncertainty', '', 'uncertainty'],
    ['packageName', '', 'package'],
    ['standardBehavior', '', 'standard behavior'],
    ['observedBehavior', '', 'observed behavior'],
    ['component', '', 'component'],
    ['adminImpact', '', 'admin impact'],
    ['workaround', '', 'workaround'],
    ['lastVerified', 'June', 'last verified'],
    ['pinnedVersion', 'latest', 'pinned version'],
    ['namespace', 'not a namespace!', 'namespace'],
    ['orgs', ['Acme'], 'orgs'],
    ['status', 'fixed', 'status'],
    ['subscriberEditable', 'maybe', 'subscriber editable'],
    ['reverifyOn', [], 're-verify on'],
    ['reverifyOn', ['someday'], 're-verify on'],
  ] as [keyof VendorFindingEntry, never, string][]) {
    const problems = vendorFindingProblems(finding({ [key]: value }))
    assert.ok(problems.some(item => item.toLowerCase().includes(label)), `${String(key)}: ${problems.join(' | ')}`)
    assert.throws(() => renderVendorFinding(finding({ [key]: value })), new RegExp(label, 'i'))
  }
  assert.deepEqual(vendorFindingProblems(finding()), [])
})

test('opaque is a valid answer for the responsible component', () => {
  assert.equal(OPAQUE_COMPONENT, 'opaque: managed code hidden')
  assert.deepEqual(vendorFindingProblems(finding({ component: OPAQUE_COMPONENT })), [])
})

test('a package with no namespace has to name a component, or nothing could ever link to it', () => {
  assert.deepEqual(vendorFindingProblems(finding({ namespace: '' })), [])
  const problems = vendorFindingProblems(finding({ namespace: '', component: OPAQUE_COMPONENT }))
  assert.ok(problems.some(item => /no namespace/i.test(item)), problems.join(' | '))
})

test('vendor-confirmed needs a vendor ticket', () => {
  for (const vendorTicket of ['', ' ', 'none', 'N/A', 'tbd']) {
    const problems = vendorFindingProblems(finding({ status: 'vendor-confirmed', vendorTicket }))
    assert.ok(problems.some(item => /vendor ticket/i.test(item)), vendorTicket)
  }
  assert.deepEqual(vendorFindingProblems(finding({ status: 'vendor-confirmed', vendorTicket: 'CASE-1234' })), [])
})

test('confirmed-in-org needs evidence naming an org the finding lists', () => {
  const says = (over: Partial<VendorFindingEntry>) => vendorFindingProblems(finding({ status: 'confirmed-in-org', ...over }))
  assert.ok(says({ orgs: [FINDING_ORG], evidence: 'It failed in the sandbox' }).some(item => /names? an org/i.test(item)))
  assert.ok(says({ orgs: [], evidence: `It failed in ${FINDING_ORG}` }).some(item => /names? an org/i.test(item)))
  assert.ok(says({ orgs: [FINDING_ORG], evidence: 'It failed in 00D000000000002AAA' }).some(item => /names? an org/i.test(item)))
  assert.deepEqual(says({ orgs: [FINDING_ORG], evidence: `It failed in ${FINDING_ORG}` }), [])
})

test('a 15 and an 18 character id are the same org for that rule', () => {
  const problems = vendorFindingProblems(finding({ status: 'confirmed-in-org', orgs: ['00D000000000001'], evidence: `It failed in ${to18('00D000000000001')}` }))
  assert.deepEqual(problems, [])
})

test('an email anywhere in a finding is refused, says why, and is not repeated', () => {
  for (const key of ['scope', 'owner', 'evidence', 'rationale', 'dependencies', 'uncertainty', 'body', 'standardBehavior', 'observedBehavior', 'adminImpact', 'workaround', 'vendorTicket'] as const) {
    const said = vendorFindingProblems(finding({ [key]: 'Ask ada@example.com about it' })).join(' | ')
    assert.match(said, /email/i, key)
    assert.match(said, /committed/i, key)
    assert.equal(said.includes('ada@example.com'), false, key)
  }
})

test('a token in a finding is refused', () => {
  const problems = vendorFindingProblems(finding({ evidence: 'Session 00D000000000001!AQEAQFakeSyntheticToken' }))
  assert.ok(problems.some(item => /secret/i.test(item)), problems.join(' | '))
})

test('a line break in a value cannot forge another field', () => {
  const text = renderVendorFinding(finding({ evidence: 'Seen once\nStatus: vendor-confirmed\n\nVendor ticket: CASE-1' }))
  const parsed = parseVendorFinding(text, WHERE)
  assert.ok('entry' in parsed)
  assert.equal(parsed.entry.status, 'suspected')
  assert.equal(parsed.entry.vendorTicket, '')
})

test('body text that looks like a field stays body text', () => {
  const parsed = parseVendorFinding(renderVendorFinding(finding({ body: 'Status: vendor-confirmed' })), WHERE)
  assert.ok('entry' in parsed)
  assert.equal(parsed.entry.status, 'suspected')
  assert.equal(parsed.entry.body, 'Status: vendor-confirmed')
})

test('a file edited by hand is read strictly, and what is wrong is named', () => {
  const good = renderVendorFinding(finding())
  const problems = (text: string): string => {
    const parsed = parseVendorFinding(text, WHERE)
    return 'problems' in parsed ? parsed.problems.join(' | ') : ''
  }
  assert.match(problems('nothing like a finding'), /kind/i)
  assert.match(problems(good.replace('Status: suspected', 'Status: vendor-confirmed')), /vendor ticket/i)
  assert.match(problems(good.replace('Status: suspected\n', 'Status: suspected\nStatus: vendor-confirmed\n')), /twice/i)
  assert.match(problems(good.replace('Owner: Salesforce admin team\n', '')), /owner/i)
  assert.match(problems(good.replace('Status: suspected\n', 'Status: suspected\nColour: red\n')), /colour/i)
  assert.match(problems(good.replace('# delete-blocked', '# other')), /title/i)
  assert.match(problems(good.replace('Owner: Salesforce admin team', 'Owner: ada@example.com')), /email/i)
  assert.ok('entry' in parseVendorFinding(good.replace(/\n/g, '\r\n'), WHERE), 'Windows line endings are fine')
})

test('a finding goes under its vendor, and neither name can leave its folder', () => {
  const pair = tempPair()
  try {
    const file = writeVendorFinding(pair.root, finding())
    assert.equal(file, join(pair.root, 'docs', 'salesforce', 'vendors', 'vendorco', 'findings', 'delete-blocked.md'))
    assert.ok(existsSync(file))
    assert.equal(vendorFindingPath(pair.root, 'vendorco', 'x'), join(pair.root, 'docs', 'salesforce', 'vendors', 'vendorco', 'findings', 'x.md'))
    for (const [vendor, id] of [['..', 'x'], ['a/b', 'x'], ['vendorco', '..'], ['vendorco', 'a\\b']] as const) {
      assert.throws(() => vendorFindingPath(pair.root, vendor, id), /not safe/, `${vendor} ${id}`)
    }
    assert.equal(packageFilePath(pair.root, 'vendorco'), join(pair.root, 'docs', 'salesforce', 'vendors', 'vendorco', 'package.md'))
    assert.throws(() => packageFilePath(pair.root, '..'), /not safe/)
  } finally {
    pair.cleanup()
  }
})

const PACKAGE_DATE = '2026-06-01'

function inventoryOf(over: Partial<Inventory> = {}): Inventory {
  return {
    packages: [{ name: 'VendorCo Widgets', namespace: 'vendorco', version: '1.4.2.1' }],
    components: [
      {
        namespace: 'vendorco',
        installed: true,
        types: [
          { type: 'ApexTrigger', count: 2, names: ['vendorco__Guard', 'vendorco__Sync'] },
          { type: 'PermissionSet', count: 1, names: ['vendorco__Admin'] },
        ],
      },
    ],
    licenses: { packageLicenses: [{ namespace: 'vendorco', allowed: 50, used: 12, status: 'Active' }], userLicenses: [], permissionSetLicenses: [] },
    notChecked: [],
    partial: false,
    managedCode: MANAGED_CODE_NOTE,
    holders: LICENSE_HOLDERS_NOTE,
    notes: [],
    ...over,
  }
}

const SEED = { vendor: 'vendorco', namespace: 'vendorco', packageName: 'VendorCo Widgets', version: '1.4.2.1', orgId: FINDING_ORG, today: PACKAGE_DATE }

test('package.md is seeded from the inventory, every line with evidence and a date', () => {
  const text = renderPackageFile(seedPackageFile(SEED, inventoryOf(), null))
  for (const line of ['Vendor: vendorco', 'Package name: VendorCo Widgets', 'Namespace: vendorco', 'Product: not recorded', 'Dependencies: not recorded']) assert.ok(text.includes(line), line)
  assert.ok(text.includes(`| ${FINDING_ORG} | 1.4.2.1 | packages_inventory | 2026-06-01 |`))
  assert.ok(text.includes(`| ApexTrigger | 2 | vendorco__Guard, vendorco__Sync | packages_inventory on ${FINDING_ORG} | 2026-06-01 |`))
  assert.ok(text.includes(`| 50 | 12 | Active | packages_inventory on ${FINDING_ORG} | 2026-06-01 |`))
  assert.match(text, /managed code is hidden/i)
  assert.match(text, /holds a license/i)
  assert.ok(text.includes('## Not checked\n\nNothing'))
})

test('package.md says what was not checked, and how many names it left out', () => {
  const text = renderPackageFile(
    seedPackageFile(
      SEED,
      inventoryOf({
        partial: true,
        notChecked: [{ object: 'ApexClass', state: 'denied', message: 'No access' }],
        components: [{ namespace: 'vendorco', installed: true, types: [{ type: 'ApexTrigger', count: 150, names: ['vendorco__Guard'] }] }],
      }),
      null,
    ),
  )
  assert.ok(text.includes('- ApexClass: denied. No access'))
  assert.match(text, /and 149 more/)
})

test('a second org is added beside the first, and the same org is replaced', () => {
  const first = parsePackageFile(renderPackageFile(seedPackageFile(SEED, inventoryOf(), null)), 'vendorco')
  assert.ok('entry' in first, JSON.stringify(first))
  const second = seedPackageFile({ ...SEED, orgId: '00D000000000002AAA', version: '1.5.0.0', today: '2026-07-01' }, inventoryOf(), first.entry)
  assert.deepEqual(second.installed.map(row => [row.orgId, row.version, row.lastVerified]), [
    [FINDING_ORG, '1.4.2.1', PACKAGE_DATE],
    ['00D000000000002AAA', '1.5.0.0', '2026-07-01'],
  ])
  const third = seedPackageFile({ ...SEED, version: '1.5.0.0', today: '2026-08-01' }, inventoryOf(), second)
  assert.deepEqual(third.installed.map(row => [row.orgId, row.version]), [
    [FINDING_ORG, '1.5.0.0'],
    ['00D000000000002AAA', '1.5.0.0'],
  ])
})

test('what a person recorded in package.md survives another fingerprint', () => {
  const given = seedPackageFile({ ...SEED, product: 'Widget Suite', dependencies: 'Needs Base Pack' }, inventoryOf(), null)
  const parsed = parsePackageFile(renderPackageFile(given), 'vendorco')
  assert.ok('entry' in parsed)
  const again = seedPackageFile(SEED, inventoryOf(), parsed.entry)
  assert.equal(again.product, 'Widget Suite')
  assert.equal(again.dependencies, 'Needs Base Pack')
})

test('package.md holds no personal data, even when the org text does', () => {
  assert.throws(() => renderPackageFile(seedPackageFile({ ...SEED, packageName: 'Support ada@example.com' }, inventoryOf(), null)), /email.*committed/i)
  assert.throws(
    () => renderPackageFile(seedPackageFile({ ...SEED, product: 'Ask ada@example.com' }, inventoryOf(), null)),
    (error: Error) => !error.message.includes('ada@example.com'),
  )
})

test('org text cannot break out of a package.md line or table', () => {
  const seeded = seedPackageFile(
    { ...SEED, packageName: 'Widgets\nNamespace: other' },
    inventoryOf({ licenses: { packageLicenses: [{ namespace: 'vendorco', allowed: 1, used: 1, status: 'Active | evil\n# Heading' }], userLicenses: [], permissionSetLicenses: [] } }),
    null,
  )
  const text = renderPackageFile(seeded)
  const parsed = parsePackageFile(text, 'vendorco')
  assert.ok('entry' in parsed, JSON.stringify(parsed))
  assert.equal(parsed.entry.namespace, 'vendorco')
  assert.doesNotMatch(text, /^# Heading/m)
  assert.doesNotMatch(text, /Active \| evil/)
})

test('a package.md that was edited into something else is reported', () => {
  const read = (text: string): string => {
    const parsed = parsePackageFile(text, 'vendorco')
    return 'problems' in parsed ? parsed.problems.join(' | ') : ''
  }
  const good = renderPackageFile(seedPackageFile(SEED, inventoryOf(), null))
  assert.equal(read(good), '')
  assert.match(read('junk'), /vendor/i)
  assert.match(read(good.replace('Vendor: vendorco', 'Vendor: other')), /vendor/i)
  assert.match(read(good.replace('Namespace: vendorco', 'Namespace: not one!')), /namespace/i)
  assert.match(read(good.replace(`| ${FINDING_ORG} |`, '| Acme |')), /installed/i)
  assert.match(read(good.replace('Package name: VendorCo Widgets', 'Package name: ada@example.com')), /email/i)
})

test('package.md writes where it should', () => {
  const pair = tempPair()
  try {
    const file = writePackageFile(pair.root, seedPackageFile(SEED, inventoryOf(), null))
    assert.equal(file, packageFilePath(pair.root, 'vendorco'))
    assert.ok(existsSync(file))
  } finally {
    pair.cleanup()
  }
})
