import { pathsMatch } from './contract.js'
import type { ActivationLock } from './contract.js'
import { appendJournal } from './journal.js'
import { UnreadableFileError } from './json-file.js'
import { activationKey, sessionKey } from './paths.js'
import { storeGet, updateStore } from './store.js'

export type LockState =
  | { state: 'off' }
  | { state: 'on'; lock: ActivationLock }
  | { state: 'unreadable'; message: string }

export function isActivationLock(value: unknown, projectRoot?: string): value is ActivationLock {
  if (value === null || typeof value !== 'object') return false
  const lock = value as Partial<ActivationLock>
  if (typeof lock.projectRoot !== 'string' || lock.projectRoot.length === 0) return false
  if (typeof lock.timestamp !== 'string' || lock.timestamp.length === 0) return false
  if (typeof lock.user !== 'string' || lock.user.length === 0) return false
  if (projectRoot !== undefined && !pathsMatch(lock.projectRoot, projectRoot)) return false
  return true
}

export function createLock(projectRoot: string, user: string, timestamp: string): ActivationLock {
  return { projectRoot, timestamp, user }
}

/**
 * The service store is the one source for the lock. There is no project lock
 * file, so no file in a repository can activate anything.
 */
export function lockState(storeRoot: string, projectRoot: string): LockState {
  let stored: unknown
  try {
    stored = storeGet(storeRoot, activationKey(projectRoot))
  } catch (error) {
    if (error instanceof UnreadableFileError) {
      return { state: 'unreadable', message: 'The Salesforce store cannot be read, so Salesforce stays refused until it is fixed.' }
    }
    throw error
  }
  return isActivationLock(stored, projectRoot) ? { state: 'on', lock: stored } : { state: 'off' }
}

export function confirmTypedPath(shownPath: string, typedPath: string): { ok: true } | { ok: false; reason: string } {
  if (typedPath.length === 0 || !pathsMatch(shownPath, typedPath)) {
    return { ok: false, reason: 'That is not this project path. Nothing changed.' }
  }
  return { ok: true }
}

export function enableProject(storeRoot: string, projectRoot: string, user: string, at: string): ActivationLock {
  const lock = createLock(projectRoot, user.length > 0 ? user : 'unknown', at)
  updateStore(storeRoot, data => {
    data[activationKey(projectRoot)] = lock
  })
  return lock
}

/** Turns this project off. Returns the journal correlation id. */
export function disableProject(projectRoot: string, storeRoot: string, at: string): string {
  updateStore(storeRoot, data => {
    delete data[activationKey(projectRoot)]
    delete data[sessionKey(projectRoot)]
  })
  const correlationId = `activation-${Date.parse(at)}`
  appendJournal(projectRoot, {
    event: 'activation.disabled',
    correlationId,
    projectRoot,
    orgId: '',
    mode: '',
    at,
    note: 'Salesforce was turned off for this project.',
  })
  return correlationId
}
