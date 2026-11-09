import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, utimesSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { readJsonFile, writeJson } from './json-file.js'
import { localDirectory, localFile, safeId } from './paths.js'

/**
 * Contract section 9. What a plan has done, on this machine, in exactly these
 * states: missing means never started, as far as this file knows. Unreadable stops
 * and is never read as not started. `started` goes to reconcile. The ledger can be
 * deleted, so it never stands alone: every run also checks per-record state against
 * the org, in records-state.ts. It's a local file, and it isn't tamper-proof.
 */

export type LedgerState = 'started' | 'done' | 'partial' | 'unknown'

/** `failed`: the org refused it and it's untouched. `changed`: it differs from the plan and from what was intended. */
export type RecordState = 'done' | 'untouched' | 'changed' | 'missing' | 'failed'

export type Attempt = {
  n: number
  ids: string[]
  transport: 'collections' | 'bulk'
  jobId: string | null
  startedAt: string
  /** True once the org gave a definite answer. Until then, a record that looks untouched might still be written. */
  answered: boolean
}

export type RecordsLedger = {
  version: 1
  kind: 'records'
  planId: string
  planHash: string
  orgId: string
  state: LedgerState
  attempts: Attempt[]
  records: Record<string, RecordState>
  errors: Record<string, { code: string; fields: string[] }>
  sideEffects: Record<string, number> | null
  /** How many done records the journal already holds, so a later reconcile doesn't count them twice. */
  journaledDone: number
  updatedAt: string
  note?: string
  wrongOrg?: string
}

export type DeployChecks = {
  components: 'passed' | 'failed' | 'not-run'
  retrieve: 'passed' | 'failed' | 'could-not-check' | 'not-run'
  audit: 'passed' | 'could-not-check' | 'not-run'
  identity: 'passed' | 'failed' | 'could-not-check' | 'not-run'
}

export type DeployLedger = {
  version: 1
  kind: 'deploy'
  planId: string
  planHash: string
  orgId: string
  state: LedgerState
  /** What the org calls the job that applies the change. Null until the CLI gave one back. */
  deployId: string | null
  validationJobId: string | null
  path: 'quick' | 'start'
  startedAt: string
  jobStatus: string | null
  checks: DeployChecks
  /** A refusal of a validation means nothing shipped, and that alone allows a new approval. */
  refused: boolean
  /** Set once a post-deploy check fails, and never cleared. */
  failedChecks: string[]
  canceled: boolean
  updatedAt: string
  note?: string
  wrongOrg?: string
}

export type LedgerEntry = RecordsLedger | DeployLedger

export type LedgerRead = { state: 'missing' } | { state: 'unreadable'; detail: string } | { state: LedgerState; entry: LedgerEntry }

const STATES: readonly string[] = ['started', 'done', 'partial', 'unknown']

function isEntry(value: unknown, planId: string): value is LedgerEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Partial<LedgerEntry>
  if (entry.version !== 1 || entry.planId !== planId || typeof entry.state !== 'string' || !STATES.includes(entry.state) || typeof entry.planHash !== 'string') return false
  if (entry.kind === 'records') return Array.isArray((entry as RecordsLedger).attempts) && typeof (entry as RecordsLedger).records === 'object'
  return entry.kind === 'deploy' && typeof (entry as DeployLedger).checks === 'object'
}

export function ledgerFile(storeRoot: string, projectRoot: string, planId: string): string {
  return localFile(storeRoot, projectRoot, 'ledger', planId)
}

export function readLedger(storeRoot: string, projectRoot: string, planId: string): LedgerRead {
  const read = readJsonFile(ledgerFile(storeRoot, projectRoot, planId))
  switch (read.state) {
    case 'missing':
      return { state: 'missing' }
    case 'unreadable':
      return { state: 'unreadable', detail: read.detail }
    case 'ok':
      return isEntry(read.value, planId) ? { state: read.value.state, entry: read.value } : { state: 'unreadable', detail: 'not a ledger for this plan' }
    default: {
      const exhaustive: never = read
      return exhaustive
    }
  }
}

/** Temp file, fsync, rename. A crash leaves the old entry or the new one, never half of either. */
export function writeLedger(storeRoot: string, projectRoot: string, entry: LedgerEntry): void {
  writeJson(ledgerFile(storeRoot, projectRoot, entry.planId), entry)
}

// ── one run per plan ─────────────────────────────────────────────────────────

export type LockTiming = {
  /** A lock this old, whose holder cannot be shown to be alive, is free. */
  staleMs: number
  /** A live holder touches its lock this often. */
  heartbeatMs: number
  /** A taker-over that died holding the gate must not block everyone for good. */
  gateStaleMs: number
  /** No run lasts this long (the host ends a call at ten minutes), so a holder that does has hung, and its lock is left to age. */
  maxHeldMs: number
}

const TIMING: LockTiming = { staleMs: 15 * 60 * 1000, heartbeatMs: 10 * 1000, gateStaleMs: 30 * 1000, maxHeldMs: 60 * 60 * 1000 }
/** The locks this process holds, and since when. */
const HELD = new Map<string, number>()

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** What the lock said when it was judged free. Only a lock that still says this may be removed. */
type Verdict = { text: string }

/**
 * Free, or null for held or undecidable. A holder in this process is judged by this process, which knows: age
 * does not free it, because a stalled loop is not a dead run. A holder in another process is free when it is gone.
 * One that is old and still there is a suspended holder, a hung one, or an unrelated process given a dead
 * holder's pid, and a live one touches its lock every heartbeat, so this waits for one before it says which.
 */
function staleVerdict(file: string, timing: LockTiming, waited: boolean): Verdict | null {
  try {
    const text = readFileSync(file, 'utf8')
    const { pid } = JSON.parse(text) as { pid?: unknown }
    if (typeof pid === 'number' && pid === process.pid) {
      const since = HELD.get(file)
      return since === undefined || Date.now() - since >= timing.maxHeldMs ? { text } : null
    }
    const mtime = statSync(file).mtimeMs
    const old = Date.now() - mtime >= timing.staleMs
    if (typeof pid !== 'number') return old ? { text } : null
    if (!pidAlive(pid)) return { text }
    if (!old) return null
    if (!waited) {
      sleep(timing.heartbeatMs + 1000)
      if (statSync(file).mtimeMs > mtime || readFileSync(file, 'utf8') !== text) return null
    }
    return { text }
  } catch {
    // Half written or just removed. It sorts itself out by age or on the next try.
    return null
  }
}

/**
 * Held for a whole run. A runner that died leaves this behind, and a dead pid means it's free.
 * Null means another run holds it, or may. Clearing a stale lock goes through a gate that one
 * run at a time can hold, so two runs that saw the same stale lock can't each clear the
 * other's fresh one. Whatever can't be decided reads as held.
 */
export function acquireRun(storeRoot: string, projectRoot: string, planId: string, timingOver: Partial<LockTiming> = {}): { release: () => void } | null {
  const timing = { ...TIMING, ...timingOver }
  const dir = localDirectory(storeRoot, projectRoot, 'ledger')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${safeId(planId)}.lock`)
  const gate = `${file}.takeover`
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const token = randomUUID()
      const handle = openSync(file, 'wx', 0o600)
      try {
        writeSync(handle, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), token }))
      } finally {
        closeSync(handle)
      }
      const since = Date.now()
      HELD.set(file, since)
      // A long run must not read as a dead one: its age is kept fresh while it lives, and for no longer than a run can last.
      const beat = setInterval(() => {
        if (Date.now() - since >= timing.maxHeldMs) {
          clearInterval(beat)
          return
        }
        try {
          const now = new Date()
          utimesSync(file, now, now)
        } catch {
          // The lock is gone or not ours to touch. The release decides.
        }
      }, timing.heartbeatMs)
      beat.unref()
      return {
        release: () => {
          clearInterval(beat)
          HELD.delete(file)
          if (lockToken(file) === token) rmSync(file, { force: true })
        },
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error
      const verdict = staleVerdict(file, timing, false)
      if (verdict === null) return null
      if (!clearStale(file, gate, verdict, timing)) return null
    }
  }
  return null
}

function lockToken(file: string): string | null {
  try {
    const { token } = JSON.parse(readFileSync(file, 'utf8')) as { token?: unknown }
    return typeof token === 'string' ? token : null
  } catch {
    return null
  }
}

/**
 * Removes the lock only while it still says what it said when it was judged free. A run that was held up inside
 * the gate (a suspended machine, a stopped process) can wake to find another run's fresh lock in the same place,
 * and that one is not its to remove. Two reads of a file are not one atomic step, and the gap is these two calls.
 */
export function removeIfUnchanged(file: string, text: string): boolean {
  try {
    if (readFileSync(file, 'utf8') !== text) return false
    rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}

/** True when the stale lock is gone and this run may try to create its own. */
function clearStale(file: string, gate: string, verdict: Verdict, timing: LockTiming): boolean {
  const mine = randomUUID()
  let handle: number
  try {
    handle = openSync(gate, 'wx', 0o600)
  } catch {
    // Another run is clearing it. If that run died, the gate ages out and a later try gets through.
    try {
      if (Date.now() - statSync(gate).mtimeMs >= timing.gateStaleMs) rmSync(gate, { force: true })
    } catch {
      // Held, or gone already.
    }
    return false
  }
  try {
    writeSync(handle, mine)
    // Look again under the gate: the lock may have been replaced while this run waited.
    const again = staleVerdict(file, timing, true)
    if (again === null || again.text !== verdict.text) return false
    return removeIfUnchanged(file, verdict.text)
  } catch {
    return false
  } finally {
    closeSync(handle)
    // The gate may have been taken from this run while it was held up, and then it is another run's.
    try {
      if (readFileSync(gate, 'utf8') === mine) rmSync(gate, { force: true })
    } catch {
      // It ages out.
    }
  }
}
