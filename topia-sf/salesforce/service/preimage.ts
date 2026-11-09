import { closeSync, fsyncSync, openSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { writeFileAtomic } from './json-file.js'
import { MS_PER_DAY, RETENTION_DAYS } from './log-retention.js'
import { localFile } from './paths.js'
import { sha256 } from './plans.js'

/**
 * Contract section 9: no pre-image, no write. The old values, saved durably on this
 * machine before anything is sent, off the repo. They can hold personal values, so
 * they get the same 30-day sweep as everything else in the local store, and they're
 * never returned to a model.
 */

export type PreImageRecord = { id: string; systemModstamp: string; values: Record<string, unknown> }

export type PreImage = {
  version: 1
  planId: string
  planHash: string
  orgId: string
  object: string
  operation: 'update' | 'delete'
  transport: 'collections' | 'bulk'
  capturedAt: string
  retainUntil: string
  /** Every field captured, targets and the rest, so a later read can tell what else moved. */
  fields: string[]
  records: PreImageRecord[]
}

export type PreImageRead = { state: 'missing' } | { state: 'unreadable'; detail: string } | { state: 'expired'; retainUntil: string } | { state: 'ok'; image: PreImage; hash: string }

export function preImageFile(storeRoot: string, projectRoot: string, planId: string): string {
  return localFile(storeRoot, projectRoot, 'preimages', planId)
}

export function retainUntil(now: number): string {
  return new Date(now + RETENTION_DAYS * MS_PER_DAY).toISOString()
}

/** A rename isn't durable on POSIX until its folder is. Windows can't open a folder this way, and doesn't need to. */
function fsyncFolder(folder: string): void {
  try {
    const handle = openSync(folder, 'r')
    try {
      fsyncSync(handle)
    } finally {
      closeSync(handle)
    }
  } catch {
    // Nothing else can be done here, and the file itself is already synced.
  }
}

/** Temp file, fsync, rename. Returns the hash of what landed, for the journal. */
export function savePreImage(storeRoot: string, projectRoot: string, image: PreImage): string {
  const file = preImageFile(storeRoot, projectRoot, image.planId)
  const text = `${JSON.stringify(image, null, 2)}\n`
  writeFileAtomic(file, text)
  fsyncFolder(dirname(file))
  return sha256(text)
}

function isPreImage(value: unknown, planId: string): value is PreImage {
  if (value === null || typeof value !== 'object') return false
  const image = value as Partial<PreImage>
  return image.version === 1 && image.planId === planId && Array.isArray(image.records) && Array.isArray(image.fields) && typeof image.retainUntil === 'string' && typeof image.object === 'string'
}

export function readPreImage(storeRoot: string, projectRoot: string, planId: string, now: number): PreImageRead {
  let text: string
  try {
    text = readFileSync(preImageFile(storeRoot, projectRoot, planId), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'unreadable', detail: (error as NodeJS.ErrnoException).code ?? 'read failed' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { state: 'unreadable', detail: 'not valid JSON' }
  }
  if (!isPreImage(parsed, planId)) return { state: 'unreadable', detail: 'not a pre-image for this plan' }
  const until = Date.parse(parsed.retainUntil)
  if (Number.isNaN(until) || now >= until) return { state: 'expired', retainUntil: parsed.retainUntil }
  return { state: 'ok', image: parsed, hash: sha256(text) }
}
