import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const contract = readFileSync(join(here, 'contract.ts'), 'utf8')
const modTypes = readFileSync(join(here, '..', '..', 'mods', 'types', 'index.d.ts'), 'utf8')

function union(source, name) {
  const match = source.match(new RegExp(`export type ${name} =([^=]*?)(?:\\r?\\n\\r?\\n|\\r?\\nexport )`))
  assert.ok(match, `${name} is not declared`)
  return [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]).sort()
}

// claude plugin validate requires mods/types/index.d.ts to stand alone, so it
// cannot import these from the service. Everything else the mod shares with the
// service is imported from one file, not copied.
for (const [service, mod] of [
  ['IssueKind', 'SalesforceIssueKind'],
  ['OrgClass', 'SalesforceOrgClass'],
  ['SfMode', 'SalesforceMode'],
]) {
  test(`${mod} in the mod types matches ${service} in the service`, () => {
    assert.deepEqual(union(modTypes, mod), union(contract, service))
  })
}

test('the mod holds no lock logic of its own', () => {
  const mod = readFileSync(join(here, '..', '..', 'mods', 'index.tsx'), 'utf8')
  const lib = readFileSync(join(here, '..', '..', 'mods', 'lib', 'salesforce-env.ts'), 'utf8')
  for (const source of [mod, lib]) {
    assert.equal(source.includes('activation.json'), false)
    assert.equal(/sf:activation|sf:session|activationKey|sessionKey/.test(source), false)
  }
})

test('what the mod imports from the service needs no Node, and imports siblings by their real name', () => {
  // The mod runs with no Node, and its loader takes a file by the name it is imported under.
  for (const name of ['approval-screen', 'contract', 'digest', 'guard-rules', 'metadata-types', 'identity', 'issues', 'modes', 'org-text', 'stamp', 'tool-schemas']) {
    const source = readFileSync(join(here, `${name}.ts`), 'utf8')
    assert.equal(/from 'node:/.test(source), false, name)
    for (const match of source.matchAll(/^import (?!type )[^\n]*from '(\.[^']+)'/gm)) {
      assert.equal(match[1].endsWith('.ts'), true, `${name} imports ${match[1]}. A value import here has to name the .ts file.`)
    }
  }
})

test('the mod states the stdio prefix and the guards the same way the service names them', () => {
  const mod = readFileSync(join(here, '..', '..', 'mods', 'index.tsx'), 'utf8')
  const lib = readFileSync(join(here, '..', '..', 'mods', 'lib', 'salesforce-env.ts'), 'utf8')
  assert.equal(lib.includes("SALESFORCE_STDIO_PREFIX = 'mcp__plugin_topia-sf_topia-salesforce__'"), true)
  assert.equal(mod.includes('/^mcp__plugin_topia-sf_topia-salesforce__/'), true)
  for (const tools of ["'Bash', 'PowerShell'", "'Read', 'Write', 'Edit'", "'WebFetch', 'WebSearch'"]) assert.equal(mod.includes(tools), true, tools)
  // A guard that fails denies, and none is gated on a mod switch.
  const guards = mod.split('\n').filter(line => /on\('tool\.check'/.test(line))
  assert.equal(guards.length, 4)
  for (const guard of guards) {
    assert.equal(guard.includes("decision: 'deny'"), true, guard)
    assert.equal(guard.includes('isOn'), false, guard)
  }
})
