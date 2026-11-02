import { closeSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

import { readJsonFile, sleepSync, UnreadableFileError, writeFileAtomic } from './json-file.js'
import { storeFilePath } from './paths.js'

export type StoreData = Record<string, unknown>

/** An empty object only when the file is missing. Unreadable throws, so nobody reads a damaged store as "off". */
export function readStore(storeRoot: string): StoreData {
  const file = storeFilePath(storeRoot)
  const read = readJsonFile(file)
  switch (read.state) {
    case 'missing':
      return {}
    case 'unreadable':
      throw new UnreadableFileError(file, read.detail)
    case 'ok':
      if (read.value !== null && typeof read.value === 'object' && !Array.isArray(read.value)) return read.value as StoreData
      throw new UnreadableFileError(file, 'not a JSON object')
    default: {
      const exhaustive: never = read
      return exhaustive
    }
  }
}

export function storeGet(storeRoot: string, key: string): unknown {
  return readStore(storeRoot)[key]
}

export function storeSet(storeRoot: string, key: string, value: unknown): void {
  updateStore(storeRoot, data => {
    data[key] = value
  })
}

export function storeDelete(storeRoot: string, keys: string[]): void {
  updateStore(storeRoot, data => {
    for (const key of keys) delete data[key]
  })
}

/**
 * Read, change, and write under a lock file. The MCP server and the runner both
 * write this store. Without the lock, a snapshot write could put back a lock
 * that a person had just turned off.
 */
export function updateStore(storeRoot: string, change: (data: StoreData) => void, options: { staleMs?: number } = {}): void {
  const file = storeFilePath(storeRoot)
  mkdirSync(dirname(file), { recursive: true })
  const release = acquire(`${file}.lock`, options.staleMs ?? 10_000)
  try {
    const data = readStore(storeRoot)
    change(data)
    writeFileAtomic(file, `${JSON.stringify(data, null, 2)}\n`)
  } finally {
    release()
  }
}

function acquire(lockFile: string, staleMs: number): () => void {
  const deadline = Date.now() + 15_000
  for (;;) {
    try {
      closeSync(openSync(lockFile, 'wx', 0o600))
      return () => rmSync(lockFile, { force: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // Windows reports EPERM while another process deletes the same lock file.
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error
    }
    if (lockIsStale(lockFile, staleMs)) {
      rmSync(lockFile, { force: true })
      continue
    }
    if (Date.now() > deadline) throw new UnreadableFileError(lockFile, 'the store lock stayed held')
    sleepSync(10)
  }
}

function lockIsStale(lockFile: string, staleMs: number): boolean {
  try {
    return Date.now() - statSync(lockFile).mtimeMs >= staleMs
  } catch {
    return false
  }
}
