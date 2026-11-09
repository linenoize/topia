import type { ToolName } from './contract.js'
import { isWriteTool } from './contract.js'

export type PracticeMeasurements = {
  practice: string
  experience: string
  security: string
  pii: string
  vendorImpact: string
}

export type PracticeReport = PracticeMeasurements & {
  stopRecommendation: boolean
  confirmedChange: string[]
}

const EMPTY = ''

export function measurementsComplete(report: Partial<PracticeMeasurements>): report is PracticeMeasurements {
  return (
    typeof report.practice === 'string' &&
    report.practice.length > 0 &&
    typeof report.experience === 'string' &&
    report.experience.length > 0 &&
    typeof report.security === 'string' &&
    report.security.length > 0 &&
    typeof report.pii === 'string' &&
    report.pii.length > 0 &&
    typeof report.vendorImpact === 'string' &&
    report.vendorImpact.length > 0
  )
}

export function assertPracticeReview(report: Partial<PracticeMeasurements> | null): PracticeMeasurements {
  if (report === null || !measurementsComplete(report)) {
    throw new Error('Practice review reports practice, experience, security, and PII before a recommendation.')
  }
  return report
}

/** A review finding can stop a recommendation. It cannot add to the confirmed change. */
export function reviewAllowsRecommendation(report: PracticeReport, proposed: string[]): { ok: true } | { ok: false; reason: string } {
  assertPracticeReview(report)
  if (report.stopRecommendation) return { ok: false, reason: 'Practice review stopped this recommendation.' }
  const extra = proposed.filter(item => !report.confirmedChange.includes(item))
  if (extra.length > 0) return { ok: false, reason: 'A review finding cannot widen the confirmed change.' }
  return { ok: true }
}

export function assertReviewTool(tool: ToolName | string): void {
  if (isWriteTool(tool)) throw new Error('practice-review cannot call write tools.')
}

export const BLANK_MEASUREMENTS: PracticeMeasurements = {
  practice: EMPTY,
  experience: EMPTY,
  security: EMPTY,
  pii: EMPTY,
  vendorImpact: EMPTY,
}
