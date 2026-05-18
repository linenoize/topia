---
name: skill-topia
description: "Internal team / org configuration for the skill-topia project. Fill in the fields below; `sentinel` and `preflight` consume this at compile time and enforce its rules as runtime gates."
version: "1.0.0"
---

# Organization: skill-topia

> This file is parsed at compile time by `compiler/parser.js#parseOrgConfig` and
> injected as an `<ORG-POLICY>` block into `sentinel` and `preflight`. Edit it to
> match your team's actual policies; do NOT delete sections — the parser expects
> all five (Teams, Roles, Policies, Approval Flows, Governance Level) to exist,
> even if rows are empty.
>
> When you change this file, run `node compiler/bin/topia.js doctor` to confirm
> the compiled hooks still validate.

## Teams

| Team | Lead | Domain Packs | Members |
|------|------|--------------|---------|
| Engineering | _(lead name / role)_ | `@Topia/backend`, `@Topia/devops` | _(github handle or team slug)_ |
| Frontend | _(lead)_ | `@Topia/ui`, `@Topia/chrome-ext` | _(team slug)_ |
| Security | _(lead)_ | `@Topia/security` | _(team slug)_ |

## Roles

| Role | Permissions | Approval Authority |
|------|-------------|--------------------|
| admin | all | Can override any gate (preflight / sentinel / completion-gate) |
| maintainer | write | Approves PRs, runs `/topia deploy`, cannot override `sentinel` BLOCK |
| contributor | write | Opens PRs, runs `/topia build`, cannot self-merge |
| reviewer | read + comment | Reviews PRs; flagged on every `/topia review` finding |

## Policies

### Code Review
- **Minimum reviewers**: 1
- **Self-merge allowed**: No
- **Required reviewers for /topia rescue**: maintainer + 1
- **Required reviewers for security-tagged files**: Security team + 1

### Security
- **Dependency audit frequency**: Weekly (`/topia dependency-doctor`)
- **Secret rotation**: Quarterly
- **CVE response SLA**: 7 days for HIGH / CRITICAL, 30 days for MEDIUM
- **OWASP scan on every PR**: Yes (auto via `sentinel`)
- **Allowed-deps registry**: see `.topia/allowed-deps.json` _(create if needed)_

### Deployment
- **Staging required**: Yes (`/topia deploy --env staging` precedes production)
- **Production deploy window**: Weekdays 09:00–16:00 local
- **Rollback authority**: maintainer (no admin escalation needed)
- **Deploy freeze on incident**: Yes (`/topia incident` blocks `/topia deploy`)

### Branching
- **Default branch**: `main`
- **PR target**: `main`
- **Release branches**: `release/<vX.Y.Z>` (cut from `main` on tag)
- **Long-lived feature branches**: discouraged; prefer worktrees via `/topia team`

## Approval Flows

### Feature launch
```
contributor opens PR → reviewer comments → maintainer approves → /topia deploy
```

### Hotfix
```
on-call opens PR → maintainer approves (single reviewer OK for P1/P2) → /topia deploy
```

### Refactor (>200 LOC or >3 modules)
```
contributor runs /topia rescue → maintainer approves plan → surgeon executes per session
```

### Dependency bump (major version)
```
contributor opens PR → Security team reviews CVE delta → maintainer approves
```

## Governance Level

**Moderate** — balance speed with safety.

Governance levels Topia recognises:

- **Strict** — every gate blocks; no overrides. Suitable for regulated environments (HIPAA, PCI).
- **Moderate** — gates block on HIGH/CRITICAL; advise on MEDIUM. Default for internal teams.
- **Loose** — gates advise only; everything is opt-in. Suitable for prototypes.

For this org:
- `sentinel`: **enforce mode** — BLOCK on secrets, OWASP critical, CVE HIGH+
- `preflight`: **enforce mode** — BLOCK on logic gaps, missing tests, regressions
- `completion-gate`: **enforce mode** — BLOCK if agent claims lack evidence
- `quarantine`: **advisory** — print warnings, do not block
- `scope-guard`: **advisory** — flag drift, do not block
