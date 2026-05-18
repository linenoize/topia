---
name: "@Topia/security"
description: Deep security analysis — OWASP audit, penetration testing patterns, secret management, compliance checking, supply chain security, and API hardening.
metadata:
  author: skill-topia
  version: "0.3.0"
  layer: L4
  price: "$15"
  target: Security engineers
  format: split
tools:
  - Read
  - Grep
  - Bash
  - Edit
  - Write
---

# @Topia/security

## Purpose

@Topia/security delivers manual-grade security analysis for teams that need more than an automated gate. Where `sentinel` (L2) runs fast checks on every commit, this pack runs thorough, on-demand audits: threat modeling entire auth flows, mapping real attack surfaces, designing vault strategies, auditing supply chain integrity, hardening API surfaces, enforcing multi-layer validation, and producing compliance audit trails. All seven skills share the same threat mindset — assume breach, prove safety, document evidence.

## Triggers

- `/topia security` — manual invocation, full pack audit
- `/topia owasp-audit` | `/topia pentest-patterns` | `/topia secret-mgmt` | `/topia compliance` | `/topia supply-chain` | `/topia api-security` | `/topia defense-in-depth` — single skill invocation
- Called by `build` (L1) when auth, crypto, payment, or PII-handling code is detected
- Called by `review` (L2) when security-critical patterns are flagged during code review
- Called by `deploy` (L2) before production releases when security scope is active

## Skills Included

| Skill | Model | Description |
|-------|-------|-------------|
| [owasp-audit](skills/owasp-audit.md) | opus | Deep OWASP Top 10 (2021) + API Security Top 10 (2023) audit with manual code review, CI/CD pipeline security, and exploitability-rated findings. |
| [pentest-patterns](skills/pentest-patterns.md) | opus | Attack surface mapping, PoC construction, JWT attack pattern detection, automated fuzzing setup, and GraphQL hardening. |
| [secret-mgmt](skills/secret-mgmt.md) | sonnet | Audit secret handling, design vault/env strategy, implement rotation policies, and verify zero leaks in logs and source history. |
| [compliance](skills/compliance.md) | opus | SOC 2, GDPR, HIPAA, PCI-DSS v4.0 gap analysis, automated evidence collection, and audit-ready evidence packages. |
| [supply-chain](skills/supply-chain.md) | sonnet | Dependency confusion attacks, typosquatting, lockfile injection, manifest confusion, and SLSA provenance verification. |
| [api-security](skills/api-security.md) | sonnet | Rate limiting, input sanitization, CORS, CSP generation, and security headers middleware for Express, Fastify, and Next.js. |
| [defense-in-depth](skills/defense-in-depth.md) | sonnet | Multi-layer validation strategy — add validation at every layer data passes through (entry, business logic, environment, instrumentation). |

## Connections

```
Calls → scout (L2): scan codebase for security patterns before audit
Calls → verification (L3): run security tooling (Semgrep, Trivy, npm audit, gitleaks)
Calls → @Topia/backend (L4): auth pattern overlap — security audits reference backend auth flows
Called By ← review (L2): when security-critical code detected during review
Called By ← build (L1): when auth/input/payment/PII code is in scope
Called By ← deploy (L2): pre-release security gate when security scope active
```

## Constraints

1. MUST use opus model for auth, crypto, and payment code review — these domains require maximum reasoning depth.
2. MUST NOT rely solely on automated tool output — every finding requires manual confirmation of exploitability before reporting.
3. MUST produce actionable findings: each issue includes file:line reference, severity rating, and concrete remediation steps.
4. MUST differentiate scope from sentinel — @Topia/security does deep on-demand analysis; sentinel does fast automated gates on every commit. Never duplicate sentinel's job.
5. MUST generate defensive examples only — no offensive exploit code beyond minimal PoC sufficient to confirm exploitability.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Reporting false positives as confirmed vulnerabilities | HIGH | Always verify exploitability manually before including in final report |
| Auditing only code, missing infra/config attack surface | HIGH | Include Dockerfile, CI/CD yaml, nginx/CDN config, and .npmrc in scope |
| Secret scan misses base64-encoded or env-injected secrets | HIGH | Scan both raw and decoded forms; check CI/CD variable lists |
| Compliance gap analysis based on outdated standard version | MEDIUM | Reference standard version explicitly (e.g., GDPR 2016/679, PCI-DSS v4.0) |
| OWASP audit skips indirect dependencies (transitive vulns) | MEDIUM | Run `npm audit --all` or `pip-audit` to surface transitive CVEs |
| Pentest PoC accidentally run against production | CRITICAL | Confirm target environment before executing any PoC — add env guard to scripts |
| Supply chain: only checking direct deps, missing transitive | HIGH | Use `npm ls --all` or `pip-audit` — transitive deps are equally exploitable |
| Rate limits enforced in-process only (bypassed at scale) | HIGH | Use Redis-backed store; in-process limits don't survive horizontal scaling |
| CSP nonce reuse across requests | CRITICAL | Generate a new `crypto.randomBytes(16)` nonce per request, never cache |
| BOLA check missed on bulk/list endpoints | HIGH | List endpoints that return multiple objects must also filter by authenticated user's scope |

## Difference from sentinel

`sentinel` = lightweight automated gate (every commit, fast, cheap, blocks bad merges)
`@Topia/security` = deep manual-grade audit (on-demand, thorough, expensive, produces audit-ready reports)

sentinel catches: known CVEs in deps, hardcoded secrets, obvious injection patterns.
@Topia/security catches: logic flaws in auth flows, missing authorization on specific routes, supply chain confusion attacks, API rate limiting gaps, compliance gaps, attack chains spanning multiple services.

## Done When

- All OWASP Top 10 (2021) + API Security Top 10 (2023) categories explicitly assessed (confirmed safe or finding raised)
- Every HIGH/CRITICAL finding has a PoC or reproduction steps confirming exploitability
- Secret audit covers source history, not just current HEAD; pre-commit hook configured
- Supply chain report emitted to `.topia/security/supply-chain-report.md` with all collision/typosquatting risks
- Security headers middleware generated and wired into the application
- Compliance report maps each applicable standard requirement to a code location or gap, with remediation roadmap
- Structured security report emitted with severity ratings and remediation steps

## Cost Profile

~10,000–28,000 tokens per full pack audit depending on codebase size and number of skills invoked. opus default for auth/crypto/payment/compliance review — these require maximum reasoning depth. haiku for initial pattern scanning (scout phase) and dependency inventory. sonnet for supply-chain analysis and API hardening code generation. Expect 5–10 minutes elapsed for a mid-size application running the full pack.
