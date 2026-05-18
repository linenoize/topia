---
name: "compliance"
pack: "@Topia/security"
description: "Compliance checking — identify applicable standards (SOC 2, GDPR, HIPAA, PCI-DSS v4.0), map requirements to code patterns, perform gap analysis, automate evidence collection, and generate audit-ready evidence packages."
model: opus
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# compliance

Compliance checking — identify applicable standards (SOC 2, GDPR, HIPAA, PCI-DSS v4.0), map requirements to code patterns, perform gap analysis, automate evidence collection, and generate audit-ready evidence packages.

#### Workflow

**Step 1 — Identify Applicable Standards**
Read project README, data model, and infrastructure config to determine which standards apply: does the app handle health data (HIPAA), payment card data (PCI-DSS v4.0), EU personal data (GDPR 2016/679), or serve enterprise customers (SOC 2 Type II)? Output a compliance scope document before analysis. Reference standard versions explicitly to prevent stale guidance.

**Step 2 — Map Requirements to Code**
Use Grep to locate data retention logic, consent flows, access logging, encryption at rest/transit, and data deletion endpoints. Cross-reference each requirement against actual implementation. For each gap, record: requirement (with section number), current state, risk level, and remediation effort estimate.

**Step 3 — Generate Audit Trail**
Use Read to verify logging coverage on sensitive operations (login, data export, admin actions, PII access). Confirm logs are tamper-evident, include actor identity and timestamp, and are retained for required duration. Emit a structured compliance report suitable for auditor review.

**Step 4 — Automated Evidence Collection**
For SOC 2 / PCI-DSS audits: automate evidence gathering rather than manual screenshots. Export access logs covering the audit period. Generate a cryptographically signed summary of security controls in place (encryption algorithms, TLS versions, auth mechanisms). For PCI-DSS v4.0 specifically: document Targeted Risk Analysis (TRA) for each customized approach control, verify MFA is enforced on ALL access to the cardholder data environment (not just admin accounts — PCI v4.0 requires it universally), and document compensating controls where requirements cannot be met natively.

**Step 5 — Gap Report and Remediation Roadmap**
For each compliance gap: assign severity (blocker for certification vs. advisory), estimated remediation effort (hours), and owner. Output a prioritized remediation roadmap with estimated time-to-compliance.

#### Example

```typescript
// PATTERN: GDPR-compliant audit trail for PII access
interface AuditEvent {
  eventId:    string      // UUID, immutable
  actor:      string      // userId or serviceAccount
  action:     string      // 'READ_PII' | 'EXPORT_DATA' | 'DELETE_USER'
  resource:   string      // 'users/{id}'
  timestamp:  string      // ISO 8601 UTC
  ip:         string      // requestor IP for breach tracing
  outcome:    'SUCCESS' | 'DENIED'
}

// Log to append-only store — never DELETE or UPDATE audit rows
async function logAuditEvent(event: AuditEvent): Promise<void> {
  await db.auditLog.create({ data: event })
  // Also emit to SIEM (Splunk, Datadog) for real-time alerting
}

// PATTERN: PCI-DSS v4.0 — MFA enforcement check at login
// Verify ALL users (not just admin) are challenged with MFA
// Gap example: MFA only on /admin routes → FAIL for PCI v4.0 Req 8.4.2
async function authenticateUser(credentials: LoginDto): Promise<AuthResult> {
  const user = await verifyPassword(credentials)
  // PCI v4.0 Req 8.4.2: MFA required for ALL interactive logins to CDE
  const mfaRequired = isInCDE(user) // must be true for any CDE-touching user
  if (mfaRequired && !credentials.mfaToken) {
    throw new UnauthorizedError('MFA required')
  }
  return issueSession(user)
}

// EVIDENCE COLLECTION: export access log summary for SOC 2 auditor
// bash: aws cloudtrail lookup-events \
//   --start-time $(date -d '90 days ago' +%s) \
//   --query 'Events[*].{Time:EventTime,User:Username,Action:EventName}' \
//   --output json > soc2-evidence-access-log.json
```
