import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { acquireRun, removeIfUnchanged } from './ledger.js'
import { localDirectory } from './paths.js'

const here = dirname(fileURLToPath(import.meta.url))
const LEDGER = pathToFileURL(join(here, 'ledger.js')).href

const CHILD = `
import { appendFileSync } from 'node:fs'
const [ledger, store, proj, plan, log, go] = process.argv.slice(2)
const { acquireRun } = await import(ledger)
while (Date.now() < Number(go)) {}
let held = null
try { held = acquireRun(store, proj, plan) } catch (error) { appendFileSync(log, 'E ' + (error.code ?? error.message) + String.fromCharCode(10)) }
if (held) {
  appendFileSync(log, 'A ' + process.pid + ' ' + Date.now() + String.fromCharCode(10))
  const end = Date.now() + 300
  while (Date.now() < end) {}
  appendFileSync(log, 'R ' + process.pid + ' ' + Date.now() + String.fromCharCode(10))
  held.release()
}
`

function deadPid(): number {
  return 2_000_000_000
}

test('two runs that find the same dead lock never both hold it, and none dies on the way', async () => {
  const rounds = 12
  for (let round = 0; round < rounds; round += 1) {
    const root = mkdtempSync(join(tmpdir(), 'sf-lock-'))
    try {
      const store = join(root, 'store')
      const project = join(root, 'proj')
      mkdirSync(project)
      const dir = localDirectory(store, project, 'ledger')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'plan-x.lock'), JSON.stringify({ pid: deadPid(), at: new Date().toISOString() }))
      const log = join(root, 'log.txt')
      writeFileSync(log, '')
      const child = join(root, 'child.mjs')
      writeFileSync(child, CHILD)
      const go = Date.now() + 1500
      const kids = Array.from({ length: 6 }, () => spawn(process.execPath, [child, LEDGER, store, project, 'plan-x', log, String(go)], { stdio: 'inherit' }))
      await Promise.all(kids.map(kid => new Promise(resolve => kid.on('close', resolve))))
      const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => line.split(' '))
      assert.deepEqual(lines.filter(line => line[0] === 'E'), [], `round ${round}: a run died with an error`)
      const held = lines.filter(line => line[0] === 'A').map(line => ({ pid: line[1], from: Number(line[2]) }))
      // Someone has to win. A lock nobody can take at all is a stuck project, and would pass the overlap check below.
      assert.ok(held.length >= 1, `round ${round}: nobody took a lock that was free`)
      const released = new Map(lines.filter(line => line[0] === 'R').map(line => [line[1], Number(line[2])]))
      for (const left of held) {
        for (const right of held) {
          if (left.pid >= right.pid) continue
          const overlap = left.from < (released.get(right.pid) ?? Infinity) && right.from < (released.get(left.pid) ?? Infinity)
          assert.equal(overlap, false, `round ${round}: two runs held one plan at once`)
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a lock is released only by the run that took it', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-lock-'))
  try {
    const store = join(root, 'store')
    const project = join(root, 'proj')
    mkdirSync(project)
    const first = acquireRun(store, project, 'plan-y')
    assert.ok(first)
    const file = join(localDirectory(store, project, 'ledger'), 'plan-y.lock')
    // Someone else's lock now stands where ours was.
    writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: 'someone-else' }))
    first.release()
    assert.equal(existsSync(file), true, 'a release must not remove a lock that is not its own')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a live run holds the lock against a second', () => {
  const root = mkdtempSync(join(tmpdir(), 'sf-lock-'))
  try {
    const store = join(root, 'store')
    const project = join(root, 'proj')
    mkdirSync(project)
    const first = acquireRun(store, project, 'plan-z')
    assert.ok(first)
    assert.equal(acquireRun(store, project, 'plan-z'), null)
    first.release()
    const again = acquireRun(store, project, 'plan-z')
    assert.ok(again)
    again.release()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ── holders that are slow, suspended, or hung ──

const HOLDER = `
import { utimesSync, writeFileSync } from 'node:fs'
const [file, mode] = process.argv.slice(2)
writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token: 'held-by-another-process' }))
const old = new Date(Date.now() - 20 * 60 * 1000)
utimesSync(file, old, old)
process.stdout.write('ready\\n')
if (mode === 'beats') setInterval(() => { const now = new Date(); utimesSync(file, now, now) }, 40)
setTimeout(() => process.exit(0), 6000)
`

/** Another process whose lock is 20 minutes old. It touches the lock as a live run does, or it does not. */
async function holder(root: string, file: string, mode: 'beats' | 'silent'): Promise<{ stop: () => void }> {
  const script = join(root, 'holder.mjs')
  writeFileSync(script, HOLDER)
  const child = spawn(process.execPath, [script, file, mode], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>(resolve => {
    child.stdout.once('data', () => resolve())
  })
  return { stop: () => child.kill() }
}

function inRoot(body: (root: string, store: string, project: string, file: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), 'sf-lock-'))
    try {
      const store = join(root, 'store')
      const project = join(root, 'proj')
      mkdirSync(project)
      const dir = localDirectory(store, project, 'ledger')
      mkdirSync(dir, { recursive: true })
      await body(root, store, project, join(dir, 'plan-s.lock'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

test('a run that holds a lock in this process keeps it however old it looks, because a stalled loop is not a dead run', inRoot(async (_root, store, project, file) => {
  const first = acquireRun(store, project, 'plan-s')
  assert.ok(first)
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000)
  utimesSync(file, old, old)
  assert.equal(acquireRun(store, project, 'plan-s'), null, 'a second run in this process must not take a lock this process still holds')
  first.release()
}))

test('a holder in another process that touches its lock within a heartbeat is not taken over, though the lock looked 20 minutes old', inRoot(async (root, store, project, file) => {
  const other = await holder(root, file, 'beats')
  try {
    assert.equal(acquireRun(store, project, 'plan-s', { heartbeatMs: 100 }), null)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).token, 'held-by-another-process', 'its lock is still there')
  } finally {
    other.stop()
  }
}))

test('a live process that never touches its lock holds nothing for long: an old lock is free, so a reused pid cannot stick a project', inRoot(async (root, store, project, file) => {
  const other = await holder(root, file, 'silent')
  try {
    const taken = acquireRun(store, project, 'plan-s', { heartbeatMs: 100 })
    assert.ok(taken, 'the lock was taken after one heartbeat passed with no sign of life')
    taken.release()
  } finally {
    other.stop()
  }
}))

test('a lock is removed only while it still says what it said when it was judged free', inRoot(async (_root, _store, _project, file) => {
  writeFileSync(file, JSON.stringify({ pid: 2_000_000_000, at: 'then', token: 'old' }))
  const judged = readFileSync(file, 'utf8')
  // Another run took the lock while this one was held up inside the gate.
  writeFileSync(file, JSON.stringify({ pid: process.pid, at: 'now', token: 'fresh' }))
  assert.equal(removeIfUnchanged(file, judged), false)
  assert.equal(existsSync(file), true, "a fresh lock is not the removal's to make")
  assert.equal(removeIfUnchanged(file, readFileSync(file, 'utf8')), true)
  assert.equal(existsSync(file), false)
  assert.equal(removeIfUnchanged(file, judged), false, 'a lock that is gone is not an error')
}))

test('a run that lasts longer than any run can stops touching its lock, and the lock then frees', inRoot(async (_root, store, project, file) => {
  const timing = { heartbeatMs: 20, maxHeldMs: 200 }
  const first = acquireRun(store, project, 'plan-s', timing)
  assert.ok(first)
  await new Promise(resolve => setTimeout(resolve, 120))
  const beating = statSync(file).mtimeMs
  assert.ok(Date.now() - beating < 100, 'a run in its time keeps the lock fresh')
  await new Promise(resolve => setTimeout(resolve, 350))
  const frozen = statSync(file).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(statSync(file).mtimeMs, frozen, 'past the longest a run can last, nothing touches it')
  // And nothing in this process keeps it forever either.
  const again = acquireRun(store, project, 'plan-s', timing)
  assert.ok(again, 'a hung run in this process does not hold the plan for good')
  again.release()
}))
