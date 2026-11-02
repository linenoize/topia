import { createHash } from 'node:crypto'

export { reversibilityOf } from './contract.js'

/**
 * Contract section 7. Pure functions. The tools that read an org and write files
 * are in plan-tools.ts. The hash covers the whole plan minus `approval`, so a field
 * added later is covered without anyone remembering to list it.
 */

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex')
}

export const PLAN_TTL_MS = 24 * 60 * 60 * 1000

export function withoutApproval<T extends object>(plan: T): Omit<T, 'approval'> {
  const { approval: _dropped, ...rest } = plan as T & { approval?: unknown }
  return rest
}

export function planHashOf(plan: object): string {
  return sha256(canonical(withoutApproval(plan)))
}

export function expiryFrom(now: number): string {
  return new Date(now + PLAN_TTL_MS).toISOString()
}

/** A time that can't be read has expired. Nothing here falls open. */
export function planExpired(plan: { expiresAt: string }, now: number): boolean {
  const at = Date.parse(plan.expiresAt)
  return Number.isNaN(at) || now >= at
}

/** The code computes these. A model may well send them, so they are dropped rather than refused, and they mean nothing. */
const COMPUTED = ['approval', 'planHash', 'hash', 'count', 'expectedCount', 'stateHash', 'expiry', 'expiresAt', 'artifactHash', 'reversibility', 'briefHash', 'briefConfirmed', 'createdAt', 'valuesHash', 'id', 'planId']

export function stripComputedPlanFields(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args }
  for (const name of COMPUTED) delete out[name]
  return out
}

export function overDestructiveCeiling(plan: { operation: 'update' | 'delete'; count: number }, ceiling: number): boolean {
  return plan.operation === 'delete' && plan.count > ceiling
}
