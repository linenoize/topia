import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { confirmTypedPath, createLock, disableProject, enableProject, isActivationLock, lockState } from './activation.js'
import { runCli, type CliIo } from './cli-core.js'
import { readJournal } from './journal.js'
import { activationKey, sessionKey, storeFilePath } from './paths.js'
import { storeGet, storeSet } from './store.js'
import { activate, tempPair } from './test-support.js'

const A = 'C:/work/project-a'
const B = 'C:/work/project-b'
const here = dirname(fileURLToPath(import.meta.url))

/** A home folder whose plugin store is the default one, so child processes find it the normal way. */
function homeStore(root: string): { home: string; store: string } {
  const home = join(root, 'home')
  const store = join(home, '.claude', 'plugins', 'store')
  mkdirSync(store, { recursive: true })
  return { home, store }
}

test('a lock for project A leaves project B off', () => {
  const pair = tempPair()
  try {
    enableProject(pair.store, A, 'ada', '2026-06-01T00:00:00.000Z')
    assert.equal(lockState(pair.store, A).state, 'on')
    assert.equal(lockState(pair.store, B).state, 'off')
  } finally {
    pair.cleanup()
  }
})

test('no file in the project can activate anything', () => {
  const pair = tempPair()
  try {
    const file = join(pair.root, '.topia', 'salesforce', 'activation.json')
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(createLock(pair.root, 'ada', '2026-06-01T00:00:00.000Z')))
    assert.equal(lockState(pair.store, pair.root).state, 'off')
  } finally {
    pair.cleanup()
  }
})

test('an unreadable store is unreadable, never off and never on', () => {
  const pair = tempPair()
  try {
    writeFileSync(storeFilePath(pair.store), '{"broken"')
    assert.equal(lockState(pair.store, A).state, 'unreadable')
  } finally {
    pair.cleanup()
  }
})

test('a lock with no user, or for another root, does not count', () => {
  const pair = tempPair()
  try {
    storeSet(pair.store, activationKey(A), { projectRoot: A, timestamp: '2026-06-01T00:00:00.000Z', user: '' })
    assert.equal(lockState(pair.store, A).state, 'off')
    storeSet(pair.store, activationKey(A), { projectRoot: B, timestamp: '2026-06-01T00:00:00.000Z', user: 'ada' })
    assert.equal(lockState(pair.store, A).state, 'off')
    assert.equal(isActivationLock(createLock(A, 'ada', '2026-06-01T00:00:00.000Z'), B), false)
  } finally {
    pair.cleanup()
  }
})

test('turning a project off removes the lock and the session, and journals it', () => {
  const pair = tempPair()
  try {
    activate(pair.root, pair.store)
    storeSet(pair.store, sessionKey(pair.root), { identity: null })
    const correlationId = disableProject(pair.root, pair.store, '2026-06-03T00:00:00.000Z')
    assert.equal(storeGet(pair.store, activationKey(pair.root)), undefined)
    assert.equal(storeGet(pair.store, sessionKey(pair.root)), undefined)
    assert.equal(lockState(pair.store, pair.root).state, 'off')
    assert.deepEqual(readJournal(pair.root, correlationId).map(line => line.event), ['activation.disabled'])
  } finally {
    pair.cleanup()
  }
})

test('turning one project off leaves another on', () => {
  const pair = tempPair()
  const other = tempPair()
  try {
    activate(pair.root, pair.store)
    activate(other.root, pair.store)
    disableProject(pair.root, pair.store, '2026-06-03T00:00:00.000Z')
    assert.equal(lockState(pair.store, other.root).state, 'on')
  } finally {
    pair.cleanup()
    other.cleanup()
  }
})

test('the typed path has to match the project', () => {
  assert.equal(confirmTypedPath(A, B).ok, false)
  assert.equal(confirmTypedPath(A, '').ok, false)
  assert.equal(confirmTypedPath(A, 'c:/work/project-a/').ok, true)
})

function io(pair: { store: string; root: string }, over: Partial<CliIo> & { typed?: string } = {}): CliIo & { out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return {
    stdinIsTty: true,
    readLine: async () => over.typed ?? pair.root,
    write: text => out.push(text),
    writeError: text => err.push(text),
    cwd: pair.root,
    storeRoot: pair.store,
    now: () => Date.parse('2026-06-01T00:00:00.000Z'),
    user: 'ada',
    out,
    err,
    ...over,
  }
}

test('the enable command refuses without a terminal and writes nothing', async () => {
  const pair = tempPair()
  try {
    const shell = io(pair, { stdinIsTty: false })
    assert.equal(await runCli(['enable'], shell), 1)
    assert.match(shell.err.join(''), /terminal/)
    assert.equal(lockState(pair.store, pair.root).state, 'off')
  } finally {
    pair.cleanup()
  }
})

test('the enable command needs the typed path, and states the promise', async () => {
  const pair = tempPair()
  try {
    const wrong = io(pair, { typed: 'C:/somewhere/else' })
    assert.equal(await runCli(['enable'], wrong), 1)
    assert.equal(lockState(pair.store, pair.root).state, 'off')
    const right = io(pair)
    assert.equal(await runCli(['enable'], right), 0)
    assert.match(right.out.join(''), /can change your org only after you approve the exact change/)
    assert.equal(lockState(pair.store, pair.root).state, 'on')
  } finally {
    pair.cleanup()
  }
})

test('the disable command refuses without a terminal, and needs the typed path', async () => {
  const pair = tempPair()
  try {
    activate(pair.root, pair.store)
    assert.equal(await runCli(['disable'], io(pair, { stdinIsTty: false })), 1)
    assert.equal(lockState(pair.store, pair.root).state, 'on')
    assert.equal(await runCli(['disable'], io(pair, { typed: 'nope' })), 1)
    assert.equal(lockState(pair.store, pair.root).state, 'on')
    assert.equal(await runCli(['disable'], io(pair)), 0)
    assert.equal(lockState(pair.store, pair.root).state, 'off')
  } finally {
    pair.cleanup()
  }
})

test('the old commit paths and the http stub are gone', async () => {
  const pair = tempPair()
  try {
    for (const removed of ['commit-enable', 'commit-disable', 'prepare-enable', 'session-start', 'http']) {
      const shell = io(pair)
      assert.equal(await runCli([removed, '--project', pair.root, '--confirmed', pair.root], shell), 1, removed)
    }
    assert.equal(lockState(pair.store, pair.root).state, 'off')
  } finally {
    pair.cleanup()
  }
})

test('the built cli refuses a piped stdin in a real process', () => {
  const pair = tempPair()
  try {
    const { store, home } = homeStore(pair.root)
    const ran = spawnSync(process.execPath, [join(here, 'cli.js'), 'enable', '--project', pair.root], {
      input: `${pair.root}\n`,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    })
    assert.equal(ran.status, 1, ran.stderr)
    assert.match(ran.stderr, /terminal/)
    assert.equal(existsSync(storeFilePath(store)), false)
  } finally {
    pair.cleanup()
  }
})

function runner(home: string, command: string, input: unknown): { status: number | null; reply: Record<string, unknown> } {
  const ran = spawnSync(process.execPath, [join(here, 'runner.js'), command], {
    input: JSON.stringify(input),
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: 'utf8',
  })
  return { status: ran.status, reply: JSON.parse(ran.stdout || '{}') as Record<string, unknown> }
}

test('the runner reads and changes the lock', () => {
  const pair = tempPair()
  try {
    const { store, home } = homeStore(pair.root)
    const off = runner(home, 'status', { projectRoot: pair.root })
    assert.equal(off.status, 0)
    assert.equal((off.reply.lock as { state: string }).state, 'off')
    const enabled = runner(home, 'enable', { projectRoot: pair.root, user: 'ada' })
    assert.equal(enabled.reply.ok, true)
    assert.equal(lockState(store, pair.root).state, 'on')
    assert.equal((runner(home, 'status', { projectRoot: pair.root }).reply.lock as { state: string }).state, 'on')
    const disabled = runner(home, 'disable', { projectRoot: pair.root })
    assert.equal(disabled.reply.ok, true)
    assert.equal(lockState(store, pair.root).state, 'off')
  } finally {
    pair.cleanup()
  }
})

test('the runner says unreadable for a damaged store, and refuses changes', () => {
  const pair = tempPair()
  try {
    const { store, home } = homeStore(pair.root)
    writeFileSync(storeFilePath(store), '{"broken"')
    assert.equal((runner(home, 'status', { projectRoot: pair.root }).reply.lock as { state: string }).state, 'unreadable')
    assert.equal(runner(home, 'enable', { projectRoot: pair.root, user: 'ada' }).reply.ok, false)
    assert.equal(runner(home, 'disable', { projectRoot: pair.root }).reply.ok, false)
  } finally {
    pair.cleanup()
  }
})

test('the runner refuses a relative project path and an unknown command', () => {
  const pair = tempPair()
  try {
    const { home } = homeStore(pair.root)
    assert.equal(runner(home, 'enable', { projectRoot: 'relative/path', user: 'ada' }).reply.ok, false)
    assert.equal(runner(home, 'nonsense', { projectRoot: pair.root }).status, 2)
  } finally {
    pair.cleanup()
  }
})
