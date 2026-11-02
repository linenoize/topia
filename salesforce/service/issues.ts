import type { IssueKind, SfIssue } from './contract.js'

/** `unknown` is what a check that could not decide returns. It is never acknowledgeable. */
/** `unknown` is what a check that could not decide returns. It is never acknowledgeable. */
const CONTINUABLE: Record<IssueKind, boolean> = {
  'stale-verification': true,
  'user-changed-on-read': true,
  'expired-auth': true,
  'uncommitted-before-retrieve': true,
  'report-row-cap': true,
  'partial-dependency-coverage': true,
  'vendor-version-drift': true,
  'org-id-mismatch': false,
  'plan-bound-to-different-org': false,
  'production-write-without-elevation': false,
  'missing-approval': false,
  'approval-hash-mismatch': false,
  'destructive-over-ceiling': false,
  unknown: false,
}

export function showsContinue(kind: IssueKind): boolean {
  switch (kind) {
    case 'stale-verification':
    case 'user-changed-on-read':
    case 'expired-auth':
    case 'uncommitted-before-retrieve':
    case 'report-row-cap':
    case 'partial-dependency-coverage':
    case 'vendor-version-drift':
      return CONTINUABLE[kind]
    case 'org-id-mismatch':
    case 'plan-bound-to-different-org':
    case 'production-write-without-elevation':
    case 'missing-approval':
    case 'approval-hash-mismatch':
    case 'destructive-over-ceiling':
    case 'unknown':
      return CONTINUABLE[kind]
    default: {
      // A kind this build doesn't know is not one a person can clear. Nothing here falls open.
      const exhaustive: never = kind
      void exhaustive
      return false
    }
  }
}

/** Not a secret and not a check: only so an acknowledgement of one notice can't clear a different one of the same kind. */
function occurrence(text: string): string {
  let hash = 2166136261
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function issue(partial: Omit<SfIssue, 'id'> & { id?: string }): SfIssue {
  return {
    id: partial.id ?? `${partial.kind}-${occurrence([partial.orgId, partial.user, partial.operationClass, partial.message].join('|'))}`,
    kind: partial.kind,
    orgId: partial.orgId,
    orgName: partial.orgName,
    user: partial.user,
    operationClass: partial.operationClass,
    message: partial.message,
  }
}

export function noticeText(item: SfIssue): string {
  const base = `Salesforce  ${item.orgName}  ${item.orgId}: ${item.message}`
  return showsContinue(item.kind) ? base : `${base} The operation cannot continue.`
}
