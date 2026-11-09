import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n')

const contract = read('salesforce', 'service', 'contract.ts')
const PROMISE = contract.match(/SALESFORCE_PROMISE =\s*"([^"]+)"/)?.[1]
const readme = read('docs', 'salesforce', 'README.md')
const connect = read('commands', 'sf', 'connect.md')
const enable = read('commands', 'sf', 'enable.md')
const checklist = read('docs', 'salesforce', 'LIVE-CHECKLIST.md')
const design = read('docs', 'plans', '2026-11-01-salesforce-safety-design.md')

test('the promise is the same words everywhere, and the guide leads with it', () => {
  assert.ok(PROMISE, 'the contract holds the promise')
  assert.ok(design.includes(PROMISE), 'the design contract')
  assert.ok(enable.includes(PROMISE), '/topia:sf:enable')
  const firstParagraph = readme.split('\n').find(line => line.length > 0 && !line.startsWith('#'))
  assert.equal(firstParagraph, PROMISE)
})

test('the guide has what it has to have, in the order a person needs it', () => {
  const order = ['## Quickstart', '## Which host can do what', '## How a change goes', '## Production', '## What can be undone', '## What this cannot do']
  let at = -1
  for (const heading of order) {
    const found = readme.indexOf(heading)
    assert.ok(found > at, heading)
    at = found
  }
  assert.match(readme, /Don't install sf-skills' `salesforce-development` plugin alongside Topia/)
  assert.match(readme, /Anonymous Apex is banned/)
  for (const name of ['clarify', 'plan', 'preview', 'approve', 'verify', 'restore']) assert.match(readme, new RegExp(`\\*\\*${name}`, 'i'), name)
  for (const name of ['restorable', 'recycle-bin', 'forward-only', 'access', 'irreversible']) assert.ok(readme.includes(`\`${name}\``), name)
  assert.match(readme, /hasn't run against a live org/i)
})

test('every residual risk in the contract reaches the guide', () => {
  const section = design.split('## 13. Residual risks to tell users')[1]
  const risks = [...section.matchAll(/^\d+\. (.+)$/gm)].map(match => match[1])
  assert.equal(risks.length, 13)
  const part = readme.split('## What this cannot do')[1] ?? ''
  for (const risk of risks) assert.ok(part.includes(risk), risk)
})

test('the guide and the command give the exact steps, for a person to run', () => {
  for (const text of [readme, connect]) {
    assert.match(text, /sf org login web/)
    assert.match(text, /sf org logout --target-org/)
    assert.match(text, /own terminal/)
    assert.match(text, /role writer|role: 'writer'|`role`/)
  }
  assert.match(connect, /Do not run/)
})

test('the two decisions are in the guide, as they are in the code', () => {
  assert.match(readme, /View Setup and Configuration/)
  assert.match(readme, /no local Apex tests/)
  assert.match(readme, /full deploy is banned/)
})

test('the guide names dependency_report as advisory, and it exists', () => {
  assert.match(readme, /`dependency_report`/)
  assert.ok(contract.includes("'dependency_report'"))
})

test('the changelog calls this experimental, and says it has not run live', () => {
  const changelog = read('docs', 'CHANGELOG.md')
  const section = changelog.slice(changelog.indexOf('## [3.11.0]'), changelog.indexOf('## [3.10.3]'))
  assert.match(section, /Experimental/)
  assert.match(section, /Use a sandbox/)
  assert.match(section, /hasn't run against a live org/)
})

test('the install docs and the readme point at the guide', () => {
  for (const file of [['README.md'], ['docs', 'INSTALL.md']]) assert.ok(read(...file).includes('salesforce/README.md'), file.join('/'))
})

test('the checklist runs identity before anything that could write, ends at the release gate, and names the steps', () => {
  const sections = [...checklist.matchAll(/^## (.+)$/gm)].map(match => match[1])
  assert.match(sections.at(-1) ?? '', /release gate/i)
  const at = name => sections.findIndex(item => item.includes(name))
  assert.ok(at('Live identity') >= 0)
  assert.ok(at('A record write, in a sandbox') > at('Live identity'))
  assert.ok(at('A deploy, in a sandbox') > at('Live identity'))
  assert.equal(sections.slice(0, -1).some(item => /production/i.test(item)), false, 'no section before the gate is about production')
  const gate = checklist.split(/^## .*release gate.*$/im)[1]
  for (const step of ['node scripts/bump-version.js <next>', 'new tag', 'skill-topia', 'topia4hermes', 'scripts/sync.mjs', 'hermes-scan', 'redact.ts', 'Node 20']) assert.ok(gate.includes(step), step)
  for (const item of ['MetadataComponentDependency', 'sf org logout']) assert.ok(checklist.includes(item), item)
})

test('the checklist has no decision left open that was already made', () => {
  assert.equal(/Decide whether that's right for a data-only user/.test(checklist), false)
  assert.equal(/Decide what to do for a small sandbox/.test(checklist), false)
})

test('no real host or personal name in the guide', () => {
  for (const text of [readme, checklist, connect]) {
    assert.equal(/login\.salesforce\.com|test\.salesforce\.com|my\.salesforce\.com/.test(text), false)
    assert.equal(/C:\\Users|\/Users\//i.test(text), false)
  }
})

// A claim, as opposed to a disclaimer: the word is not preceded, in its sentence, by a negation.
const CLAIM = /tamper[- ]?(proof|evident|resistant)|immutable|unalterable/gi
const NEGATION = /\b(isn't|is not|aren't|are not|not|never|don't|do not|doesn't|does not|no|can't|cannot|must not|mustn't|without)\b/i

function claimsIn(text) {
  const found = []
  for (const match of text.matchAll(CLAIM)) {
    const sentenceStart = Math.max(text.lastIndexOf('. ', match.index), text.lastIndexOf('\n', match.index)) + 1
    if (!NEGATION.test(text.slice(sentenceStart, match.index + 1))) found.push(text.slice(sentenceStart, match.index + match[0].length + 20).trim())
  }
  return found
}

test('the scan for a tamper-proof claim catches a claim and lets a disclaimer through', () => {
  assert.equal(claimsIn('The journal is tamper-proof.').length, 1)
  assert.equal(claimsIn('Every line is immutable once written.').length, 1)
  assert.equal(claimsIn("The journal isn't tamper-proof, and docs must not call it that.").length, 0)
  assert.equal(claimsIn("Don't describe the journal as tamper-proof.").length, 0)
})

test('no Salesforce doc calls the journal tamper-proof (contract 10.7)', () => {
  const files = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) files.push(path)
    }
  }
  for (const dir of [join(root, 'docs', 'salesforce'), join(root, 'salesforce'), join(root, 'commands', 'sf')]) walk(dir)
  files.push(join(root, 'docs', 'plans', '2026-11-01-salesforce-safety-design.md'))
  assert.ok(files.length > 10, 'the scan found the docs')
  const offenders = files.flatMap(file => claimsIn(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).map(claim => `${file}: ${claim}`))
  assert.deepEqual(offenders, [])
})
