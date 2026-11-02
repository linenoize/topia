import { createHash } from 'node:crypto'

import { readJson, UnreadableFileError, writeJson } from './json-file.js'
import { canonical } from './plans.js'
import { localFile } from './paths.js'
import { plainText } from './contract.js'

/**
 * Contract section 3. The code canonicalizes a brief and computes its hash, and
 * the free text stays in the local store, off the repo. The hash is recomputed
 * from what is on disk at every read, so an edit voids a confirmation.
 */

export type BriefSubject = { name: string; status: 'known' | 'assumed' }

export type BriefInput = {
  objective: string
  environment: string
  subjects: BriefSubject[]
  change: string
  blockingQuestions: string[]
}

export type StoredBrief = { briefId: string; briefHash: string; brief: BriefInput; createdAt: string }

function canonicalBrief(input: BriefInput): BriefInput {
  return {
    objective: plainText(input.objective, 2000),
    environment: plainText(input.environment, 300),
    subjects: input.subjects.map(item => ({ name: plainText(item.name, 200), status: item.status })),
    change: plainText(input.change, 2000),
    blockingQuestions: input.blockingQuestions.map(item => plainText(item, 500)),
  }
}

function hashOf(brief: BriefInput): string {
  return createHash('sha256').update(canonical(brief)).digest('hex')
}

export function briefFileFor(storeRoot: string, projectRoot: string, briefId: string): string {
  return localFile(storeRoot, projectRoot, 'briefs', briefId)
}

export function proposeBrief(storeRoot: string, projectRoot: string, input: BriefInput, at: string): { briefId: string; briefHash: string } {
  const brief = canonicalBrief(input)
  const briefHash = hashOf(brief)
  const briefId = `brief-${briefHash.slice(0, 16)}`
  writeJson(briefFileFor(storeRoot, projectRoot, briefId), { brief, createdAt: at })
  return { briefId, briefHash }
}

function isBrief(value: unknown): value is BriefInput {
  if (value === null || typeof value !== 'object') return false
  const brief = value as Partial<BriefInput>
  return (
    typeof brief.objective === 'string' &&
    typeof brief.environment === 'string' &&
    typeof brief.change === 'string' &&
    Array.isArray(brief.subjects) &&
    brief.subjects.every(item => item !== null && typeof item === 'object' && typeof item.name === 'string' && (item.status === 'known' || item.status === 'assumed')) &&
    Array.isArray(brief.blockingQuestions) &&
    brief.blockingQuestions.every(item => typeof item === 'string')
  )
}

/** Null when the brief is missing. Anything unreadable throws, so a caller refuses. */
export function readBrief(storeRoot: string, projectRoot: string, briefId: string): StoredBrief | null {
  const file = briefFileFor(storeRoot, projectRoot, briefId)
  const stored = readJson<{ brief?: unknown; createdAt?: unknown }>(file)
  if (stored === null) return null
  if (typeof stored !== 'object' || !isBrief(stored.brief)) throw new UnreadableFileError(file, 'not a brief')
  return { briefId, briefHash: hashOf(stored.brief), brief: stored.brief, createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : '' }
}

