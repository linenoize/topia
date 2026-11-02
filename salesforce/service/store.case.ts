import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { readJson, readJsonFile, UnreadableFileError, writeJson } from './json-file.js'
import { storeFilePath } from './paths.js'
import { readStore, storeDelete, storeGet, storeSet, updateStore } from './store.js'
import { tempPair } from './test-support.js'

test('readJsonFile tells missing from unreadable', () => {
  const pair = tempPair()
  try {
    const file = join(pair.root, 'a.json')
    assert.deepEqual(readJsonFile(file), { state: 'missing' })
    writeFileSync(file, '{"a":')
    assert.equal(readJsonFile(file).state, 'unreadable')
    writeFileSync(file, '{"a":1}')
    assert.deepEqual(readJsonFile(file), { state: 'ok', value: { a: 1 } })
  } finally {
    pair.cleanup()
  }
})

test('readJson returns null only for a missing file and throws on a corrupt one', () => {
  const pair = tempPair()
  try {
    const file = join(pair.root, 'a.json')
    assert.equal(readJson(file), null)
    writeFileSync(file, 'not json')
    assert.throws(() => readJson(file), UnreadableFileError)
    // A folder where the file should be is unreadable, not missing.
    const folder = join(pair.root, 'b.json')
    mkdirSync(folder)
    assert.throws(() => readJson(folder), UnreadableFileError)
  } finally {
    pair.cleanup()
  }
})

test('a corrupt store refuses, and a later set never overwrites it with one key', () => {
  const pair = tempPair()
  try {
    const file = storeFilePath(pair.store)
    writeFileSync(file, '{"sf:activation:x": {"truncated"')
    assert.throws(() => readStore(pair.store), UnreadableFileError)
    assert.throws(() => storeGet(pair.store, 'k'), UnreadableFileError)
    assert.throws(() => storeSet(pair.store, 'k', 1), UnreadableFileError)
    assert.throws(() => storeDelete(pair.store, ['k']), UnreadableFileError)
    assert.equal(readFileSync(file, 'utf8'), '{"sf:activation:x": {"truncated"')
  } finally {
    pair.cleanup()
  }
})

test('a store that holds something other than an object is unreadable', () => {
  const pair = tempPair()
  try {
    writeFileSync(storeFilePath(pair.store), '[1,2]')
    assert.throws(() => readStore(pair.store), UnreadableFileError)
  } finally {
    pair.cleanup()
  }
})

test('a missing store is empty', () => {
  const pair = tempPair()
  try {
    assert.deepEqual(readStore(pair.store), {})
    assert.equal(storeGet(pair.store, 'k'), undefined)
  } finally {
    pair.cleanup()
  }
})

test('writes go through a temp file and leave nothing beside the target', () => {
  const pair = tempPair()
  try {
    const file = join(pair.root, 'deep', 'a.json')
    writeJson(file, { a: 1 })
    writeJson(file, { a: 2 })
    assert.deepEqual(readdirSync(dirname(file)), ['a.json'])
    assert.deepEqual(readJson(file), { a: 2 })
    storeSet(pair.store, 'k', 'v')
    assert.deepEqual(readdirSync(pair.store), ['topia-salesforce.json'])
  } finally {
    pair.cleanup()
  }
})

test('a stale store lock left by a dead process does not wedge writes', () => {
  const pair = tempPair()
  try {
    const lock = `${storeFilePath(pair.store)}.lock`
    writeFileSync(lock, '')
    updateStore(pair.store, data => {
      data.k = 1
    }, { staleMs: 0 })
    assert.equal(storeGet(pair.store, 'k'), 1)
  } finally {
    pair.cleanup()
  }
})

test('two processes writing at once lose no keys', () => {
  const pair = tempPair()
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const url = pathToFileURL(join(here, 'store.js')).href
    const script = `
      import(${JSON.stringify(url)}).then(({ storeSet }) => {
        for (let i = 0; i < 15; i += 1) storeSet(process.argv[1], process.argv[2] + i, i)
      })`
    const parallel = spawnSync(process.execPath, ['-e', `
      const { spawn } = require('node:child_process')
            for (const name of ['a', 'b', 'c', 'd']) {
        const kid = spawn(process.execPath, ['-e', ${JSON.stringify(script)}, ${JSON.stringify(pair.store)}, name], { stdio: 'inherit' })
        kid.on('close', code => {
          if (code !== 0) process.exitCode = code
        })
      }
    `], { stdio: 'pipe' })
    assert.equal(parallel.status, 0, String(parallel.stderr))
    const data = readStore(pair.store)
    for (const name of ['a', 'b', 'c', 'd']) {
      for (let i = 0; i < 15; i += 1) assert.equal(data[`${name}${i}`], i, `${name}${i}`)
    }
  } finally {
    pair.cleanup()
  }
})
