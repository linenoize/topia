import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { journalDirectory, localDirectory, logDirectory, type LocalKind, type LogStream } from './paths.js'
import { redactSecrets } from './redact.js'

export const RETENTION_DAYS = 30
export const MS_PER_DAY = 24 * 60 * 60 * 1000

export function retentionCutoff(now: number, days = RETENTION_DAYS): number {
  return now - days * MS_PER_DAY
}

/** Deletes files strictly older than 30 days. A file from 29 days ago stays. */
export function sweepDirectory(dir: string, now: number, days = RETENTION_DAYS): { removed: string[]; kept: string[] } {
  const removed: string[] = []
  const kept: string[] = []
  const cutoff = retentionCutoff(now, days)
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return { removed, kept }
  }
  for (const name of names) {
    const file = join(dir, name)
    let mtime = 0
    try {
      const stat = statSync(file)
      if (!stat.isFile()) continue
      mtime = stat.mtimeMs
    } catch {
      continue
    }
    if (mtime < cutoff) {
      rmSync(file, { force: true })
      removed.push(name)
    } else {
      kept.push(name)
    }
  }
  return { removed, kept }
}

/** Journal files get the same 30-day sweep as logs. */
export function sweepProjectLogs(storeRoot: string, projectRoot: string, now: number): Record<LogStream | 'journal' | LocalKind, { removed: string[]; kept: string[] }> {
  return {
    'plugin-tests': sweepDirectory(logDirectory(storeRoot, projectRoot, 'plugin-tests'), now),
    'sf-test-runs': sweepDirectory(logDirectory(storeRoot, projectRoot, 'sf-test-runs'), now),
    journal: sweepDirectory(journalDirectory(projectRoot), now),
    briefs: sweepDirectory(localDirectory(storeRoot, projectRoot, 'briefs'), now),
    plans: sweepDirectory(localDirectory(storeRoot, projectRoot, 'plans'), now),
    practice: sweepDirectory(localDirectory(storeRoot, projectRoot, 'practice'), now),
    ledger: sweepDirectory(localDirectory(storeRoot, projectRoot, 'ledger'), now),
    preimages: sweepDirectory(localDirectory(storeRoot, projectRoot, 'preimages'), now),
    results: sweepDirectory(localDirectory(storeRoot, projectRoot, 'results'), now),
    validations: sweepDirectory(localDirectory(storeRoot, projectRoot, 'validations'), now),
    zips: sweepDirectory(localDirectory(storeRoot, projectRoot, 'zips'), now),
    snapshots: sweepDirectory(localDirectory(storeRoot, projectRoot, 'snapshots'), now),
  }
}

export type RunLog = {
  command: string
  result: string
  durationMs: number
  correlationId: string
}

export function writeRunLog(dir: string, entry: RunLog, fileName: string): string {
  mkdirSync(dir, { recursive: true })
  const line = JSON.stringify({
    command: redactSecrets(entry.command),
    result: redactSecrets(entry.result),
    durationMs: entry.durationMs,
    correlationId: entry.correlationId,
  })
  const file = join(dir, fileName)
  appendFileSync(file, `${line}\n`, 'utf8')
  return file
}
