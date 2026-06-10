# Pulses — Canonical Inventory

> **Event-driven skill communication** (async pulses in the Topia Nexus). Skills emit pulses when they finish work; other skills listen and auto-trigger. No central orchestrator required.

**Status:** 45 pulses in core · all emitters have listeners · 0 orphans
**Enforced by:** `scripts/validate-signals.js` (run in CI)

## How Pulses Work

```yaml
# skills/fix/SKILL.md
---
metadata:
  emit: code.changed
  listen: bug.diagnosed, review.issues, readiness.blocked
---
```

When `debug` finishes and emits `bug.diagnosed`, the nexus routes the event to every skill listening — `fix` picks it up and runs.

**Naming rule:** `lowercase.dot.separated` segments. Enforced by `SIGNAL_NAME_PATTERN` in `scripts/validate-signals.js`.

## Pulse Catalog

### Workflow lifecycle

| Pulse | Emitted by | Listened by | Meaning |
|--------|-----------|-------------|---------|
| `codebase.scanned` | recon | brainstorm, plan, integrate, architecture-mapper, improve-architecture | Recon finished reading the codebase |
| `architecture.mapped` | architecture-mapper | improve-architecture | Architecture knowledge base created or refreshed under `docs/architecture/` |
| `ideas.ready` | brainstorm | build | Brainstorm produced approach options |
| `plan.ready` | plan | build | Phase plan approved and saved |
| `phase.complete` | build, team | session-bridge | A phase finished; checkpoint state |
| `checkpoint.request` | build | session-bridge, context-lifecycle | Context pressure — save before compact |
| `context.pressure.high` | context-engine | context-lifecycle | ORANGE/RED tool-call pressure (advisory) |
| `context.checkpoint.written` | pre-compact hook, git-push hook | *(observability)* | Headless `.topia/checkpoint.md` written |
| `context.compacted` | context-lifecycle | *(observability)* | Post-compact resume confirmed |
| `project.onboarded` | onboard | plan | First-session setup done |
| `invariants.seeded` | onboard | logic-guardian | `.topia/INVARIANTS.md` populated |
| `invariants.loaded` | session-bridge | logic-guardian | Invariants read at session start |
| `output.density.set` | context-engine | *(orchestrators dynamically)* | Output mode set (e.g. caveman) — orchestrators (build/team/rescue) honor for session/workstream scope |
| `triage.classified` | review-intake | *(observability)* | Issue triaged into state machine (ready-for-agent / ready-for-human / needs-info / wontfix) |
| `agent.brief.ready` | review-intake | *(external — issue tracker)* | AGENT-BRIEF generated and posted to issue tracker comment for AFK pickup |
| `outofscope.recorded` | idea (Step 1.6), review-intake (Phase 4.5) | *(observability — discovered via file scan, not listen)* | New `.out-of-scope/<slug>.md` written; future idea/review-intake invocations find it via Step 1.5 lexical match |

### Code change cycle

| Pulse | Emitted by | Listened by | Meaning |
|--------|-----------|-------------|---------|
| `code.changed` | fix | readiness, guardian, review, test, verification | Code was edited |
| `review.complete` | review | build | Review done, no issues |
| `review.issues` | review | fix | Review found problems |
| `bug.diagnosed` | debug | fix | Root cause identified |
| `readiness.passed` | readiness | build | Quality gate green |
| `readiness.blocked` | readiness | fix | Quality gate blocked |
| `tests.passed` | test | deploy | Test suite green |
| `tests.failed` | test | debug | Test suite red |
| `verification.complete` | verification | build | Lint + types + tests all passed |

### Security & audit

| Pulse | Emitted by | Listened by | Meaning |
|--------|-----------|-------------|---------|
| `security.passed` | guardian | deploy | No security issues found |
| `security.blocked` | guardian | fix, plan | Security gate blocked |
| `audit.complete` | audit | deploy, launch | Full audit finished |

### Data & integration

| Pulse | Emitted by | Listened by | Meaning |
|--------|-----------|-------------|---------|
| `db.migrated` | db | deploy, test | DB migration applied |
| `docs.updated` | docs, architecture-mapper | deploy, review | Docs regenerated |
| `integrate.complete` | integrate | journal | External code ported in |

### Deploy & incident

| Pulse | Emitted by | Listened by | Meaning |
|--------|-----------|-------------|---------|
| `deploy.complete` | deploy | watchdog | Deploy finished |
| `incident.detected` | watchdog | incident | Post-deploy health check failed |

## Validation

Run locally before commit:

```bash
node scripts/validate-signals.js
```

Checks:
- Every `listen:` has a matching `emit:` somewhere in the nexus (no orphan listeners)
- Pulse names follow `a.b.c` naming pattern
- No duplicate emitters for the same pulse
- `INTENTIONAL_BROADCAST_SIGNALS` whitelist for broadcast pulses emitted by core but listened to only in extension packs

CI runs this on every PR (`.github/workflows/ci.yml`).

## Adding a New Pulse

1. Pick a name following `<domain>.<verb>` (e.g. `cache.invalidated`, not `cacheInvalidated`)
2. Add `emit:` to the source skill's frontmatter metadata block
3. Add `listen:` to at least one consumer skill (or add to `INTENTIONAL_BROADCAST_SIGNALS` in `scripts/validate-signals.js` with a comment explaining why)
4. Run `node scripts/validate-signals.js` — must pass
5. Document the pulse in this file under the appropriate section

## Extension Pack Pulses

Extension packs emit additional pulses that are listened to by other skills in the same pack. These are whitelisted in `INTENTIONAL_BROADCAST_SIGNALS` so core validation doesn't flag them as orphans.

See `extensions/*/PACK.md` for pack-specific pulses.
