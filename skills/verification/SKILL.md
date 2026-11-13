---
name: verification
description: "Use when code has changed and you need to know it works before calling it done or committing: runs lint, type-check, tests and build, then (in full mode, before a commit) reviews the diff for logic errors, missing error handling, regressions, incomplete work and org policy. One pre-commit gate with a PASS, WARN or BLOCK verdict."
metadata:
  author: topia
  version: "1.0.0"
  layer: L2
  model: sonnet
  group: validation
  tools: "Read, Bash, Glob, Grep"
  listen: code.changed
  emit: verification.complete, verification.blocked
---

# verification

## Purpose

<HARD-GATE>
A BLOCK verdict stops the pipeline. The calling skill (build, deploy, launch) MUST halt until every BLOCK finding is fixed and verification re-runs clean.
</HARD-GATE>

The one gate between "I changed code" and "it is ready to commit". It has two stages:

1. **Checks** — run lint, type-check, tests and build, and confirm new files are real and wired in. Fast, cheap, mechanical.
2. **Review** — read the diff for what tools miss: code that compiles and passes lint but has logic errors, missing error handling, regressions, or unfinished parts. Also applies the team's org policy. (This stage was the `readiness` skill.)

| Mode | Stages | Use it |
|------|--------|--------|
| `checks` | 1 | After any edit, from fix, test, deploy, dependency-doctor and similar callers |
| `full` (default before commit) | 1 + 2 | build Phase 5a, before a commit, `/topia verification`, `/topia readiness` |

Callers say which mode they want. With no mode given: use `full` if the request mentions commit, merge or "ready", else `checks`.

## Triggers

- `build` Phase 5a (full) and Phase 6 (checks); `fix` after applying a fix
- Any skill that changed code and needs proof it still works (checks)
- `/topia verification` or `/topia:readiness` (old name) — full
- Auto-trigger: staged changes over 100 LOC → full

## Calls (outbound)

- `recon` (L2): find code that depends on the changed files (review stage, regression check)
- `guardian` (L2): security sub-check on changed files (review stage)
- `hallucination-guard` (L3): verify new imports and API references exist (review stage)
- `test` (L2): targeted regression tests for affected code paths (review stage)

## Called By (inbound)

- `build` (L1): Phase 5a pre-commit gate (full) and Phase 6 VERIFY (checks)
- `fix` (L2): validate fix doesn't break existing functionality
- `test` (L2): validate test coverage meets threshold
- `deploy` (L2): post-deploy health checks
- `guardian` (L2): run security audit tools (npm audit, etc.)
- `safeguard` (L2): verify safety net is solid before refactoring
- `db` (L2): run migration in test environment
- `perf` (L2): run benchmark scripts if configured
- `skill-forge` (L2): verify newly created skill passes lint/type/build checks
- `team` (L1): verify each parallel workstream before merge
- `scaffold` (L1): verify scaffolded project builds and passes initial tests
- `launch` (L1): pre-deploy verification gate
- `mcp-builder` (L2): verify generated MCP server compiles and starts
- `logic-guardian` (L2): verify logic invariants hold after changes
- `dependency-doctor` (L3): verify builds pass after dependency updates
- `sast` (L3): run verification alongside static analysis

---

## Stage 1 — Checks

### Phase 1: Detect Project Type

Use `Glob` to find project config files:

1. `package.json` → Node.js/TypeScript
2. `pyproject.toml` or `setup.py` → Python
3. `Cargo.toml` → Rust
4. `go.mod` → Go
5. `pom.xml` or `build.gradle` → Java

`Read` the config to find the project's own lint/test/build scripts. Track the checks as tasks (TaskCreate / TaskUpdate where available): detect, lint, types, tests, build, review (full mode), report.

### Phase 2: Run Lint

Prefer the project's `lint` script.

- **Node.js (npm lint script)**: `npm run lint`
- **Node.js (no script)**: `npx eslint . --max-warnings 0`
- **Python**: `ruff check .` (fallback: `flake8 .`)
- **Rust**: `cargo clippy -- -D warnings`
- **Go**: `golangci-lint run` (fallback: `go vet ./...`)

If lint fails: record the output, mark lint FAIL, continue.

### Phase 3: Run Type Check

- **TypeScript**: `npx tsc --noEmit`
- **Python**: `mypy .` (fallback: `pyright .`)
- **Rust**: `cargo check`
- **Go**: `go vet ./...`

If it fails: record the error count and first 10 error lines, mark FAIL, continue.

### Phase 4: Run Tests

Prefer the project script.

- **Node.js (npm test script)**: `npm test`
- **Vitest**: `npx vitest run`
- **Jest**: `npx jest --passWithNoTests`
- **Python**: `pytest -v` (fallback: `python -m unittest discover`)
- **Rust**: `cargo test`
- **Go**: `go test ./...`

Record total, passed, failed, and coverage if shown. On failure record the first 20 failing tests, mark FAIL, continue.

### Phase 5: Run Build

- **Node.js**: `npm run build` if the script exists (fallback: `npx tsc`)
- **Python**: with a `[build-system]` in `pyproject.toml`, `python -m build --no-isolation 2>&1 | head -20`; legacy `setup.py`, `python setup.py check --strict`; then `pip install -e . --dry-run` to catch broken entry points. Scripts-only project: SKIP.
- **Rust**: `cargo build`
- **Go**: `go build ./...`

On failure record the first 20 lines, mark FAIL.

### Phase 6: 3-Level File Check

Every file created or modified must pass all 3 levels:

**Level 1 — EXISTS**: on disk and non-empty.

**Level 2 — SUBSTANTIVE**: real logic, not a stub or truncated output.

| Pattern | Meaning |
|---|---|
| Component returns only `<div>Placeholder</div>` / `<div>TODO</div>` | Stub component |
| Route returns `{ message: "Not implemented" }` or `501` | Stub endpoint |
| Body is only `return null` / `return {}` / `return []` / `pass` | Stub function |
| All methods throw `NotImplementedError` | Stub class |
| `// ...`, `// rest of code`, `{ /* same as above */ }`, bare `...` as a statement | Truncated output |
| `[PAUSED]` / `[CONTINUED]` in source | Session marker leaked into code |

Stub → Level 2 FAIL (STUB). Truncation → Level 2 FAIL (TRUNCATED); report the line. If the agent hit an output limit mid-file it must say `[PAUSED — X of Y functions complete]` in its reply (not in the file), finish the file, and re-run verification.

**Level 3 — WIRED**: used by the rest of the system.

| File type | Check |
|---|---|
| Component | `Grep("<ComponentName")` → ≥1 consumer |
| API route | `Grep` for its path in fetch/axios calls → ≥1 caller |
| Hook / utility / style module | `Grep` for its import → ≥1 importer |
| DB model | `Grep` for the model or table name in queries → ≥1 reference |

0 consumers → UNWIRED, Level 3 FAIL. Entry points (main.ts, index.ts, App.tsx, route config) are exempt.

<HARD-GATE name="3-level-verification">
ALL new files must pass Level 1 + Level 2 + Level 3.
EXISTS but STUB = "Existence Theater". EXISTS and SUBSTANTIVE but UNWIRED = dead code.
Report which level failed for each file.
</HARD-GATE>

### Never trust exit 0

Many tools exit 0 when they fail quietly. Confirm the success line in the output:

- **Tests**: Vitest/Jest/Pytest print `X passed` / `X failed`. Exit 0 with no summary line = INCOMPLETE, not PASS.
- **Build**: the output file exists and is larger than 0 bytes (e.g. `Glob("dist/**/*.js")`). Missing output = FAIL even on exit 0.
- **Lint**: ESLint `0 problems` = PASS; Ruff/Flake8 no file:line lines = PASS. Exit 0 with `error` in the output = WARN.
- **Types**: `tsc` `Found 0 errors` or no error lines = PASS (say so explicitly).
- **Generated binaries**: PDF starts with `%PDF`, ZIP/XLSX/DOCX with `PK`; size above a sane minimum.

<HARD-GATE name="artifact-verification">
Check actual command output for success indicators, not just exit codes.
Exit 0 without a confirming output line or artifact = UNVERIFIED.
Quote the line that confirmed success (e.g. "3 passed, 0 failed").
</HARD-GATE>

In `checks` mode, stop here and report.

---

## Stage 2 — Review (full mode)

Get the diff with `git diff --cached` (staged) or `git diff HEAD`. Read each changed file. If Stage 1 left FAILs, still run the review so the developer gets the complete list in one pass.

### Step R1 — Spec Compliance (plan vs diff)

If the caller passed an approved plan (build does), check each planned change against the diff:

| Plan says | Diff shows | Verdict |
|---|---|---|
| Add function X to file Y | X exists in Y | PASS |
| Add function X to file Y | X missing | BLOCK — incomplete |
| Modify function Z | Z untouched | BLOCK — planned change not applied |
| Nothing about file W | W modified | WARN — out of scope |

No plan (manual run): skip R1.

### Step R2 — Logic

For every modified function, trace input to output:

- Where would `null`, `undefined`, an empty array or 0 cause a crash or a wrong result?
- Every async call is awaited (a missing `await` means a Promise is used as a value). Independent I/O runs in parallel (`Promise.all`), not one after another.
- Off-by-one, out-of-bounds index, division by zero.
- Implicit `==` coercion, unchecked string-to-number conversion.

Flag each with file:line and category (null-deref | missing-await | off-by-one | type-coerce).

### Step R3 — Error Handling

- Async functions catch errors, or their callers do.
- No empty `catch {}` or `except: pass`; every catch logs or rethrows with context.
- HTTP calls check the response status before reading the body.
- Clients never see stack traces or internal names; log internally, return a generic message.
- Route handlers return correct 4xx/5xx codes.

Flag each with file:line and category (bare-catch | missing-status-check | raw-error-exposure).

### Step R4 — Regression

Use `topia:recon` to find files that import or call the changed code. For each dependent: is the changed signature still compatible, and do tests cover the interaction? Run targeted tests through `topia:test` where they exist. Flag untested impact zones with severity (breaking | degraded | untested).

### Step R5 — Completeness and Coherence

New code ships complete:
- New endpoint → input validation (Zod, Pydantic, Joi, …)
- New async UI component → loading and error states
- New feature → at least one test file
- New config option → documented
- Schema change → migration file
- Framework-specific: Next.js Server Actions catch errors and return typed results; FastAPI endpoints have Pydantic models; Django ViewSets set `permission_classes`; Express routes validate input before the handler.

New code matches the project. Read 2-3 neighbouring files and compare naming, file placement, import style, error-handling style (WARN on divergence). A different state-management paradigm or API response/auth pattern is BLOCK. Skip coherence for greenfield projects (<5 files) or when CLAUDE.md says there are no conventions yet.

Missing completeness items are WARN, with what is missing and where.

### Step R6 — Evals

If `.topia/evals/` exists: a failing REG-* eval is BLOCK; CAP-* evals defined but not run, or below threshold, are WARN; a new feature with no eval entry is INFO. Skip if the directory does not exist.

### Step R7 — Domain Checks

Add checks based on the files in the diff. They add to R2-R5; they never replace them. A domain BLOCK makes the verdict BLOCK.

| Files | Domain | Key checks |
|---|---|---|
| `migrations/*.sql`, `*.migration.*` | Database | Rollback present, no bare DROP/DELETE, migration tested |
| `openapi.*`, `*.graphql`, `*.proto` | API contract | Breaking changes flagged, version bumped, deprecations documented |
| `docs/policies/*`, `PRIVACY*`, `TERMS*` | Legal | No placeholder text, review date current |
| `**/billing*`, `**/payment*`, `**/invoice*` | Financial | Decimal precision, locale-aware currency, no hardcoded rates |
| `*.tsx`, `*.jsx`, `*.svelte`, `*.vue` | UI | See below |
| `skills/*/SKILL.md`, `extensions/*/PACK.md` | Topia skill | Frontmatter valid, required sections present |
| `*.test.*`, `*.spec.*`, `__tests__/*` | Tests | No `.skip`/`.only`, assertions present, no hardcoded timeouts |

**UI checks.** If `.topia/design-system.md` exists, read it once and use its Scale Minimums over these defaults; if not, add a LOW note suggesting `topia:design`.
- WARN: hardcoded colors instead of tokens; animations without a `prefers-reduced-motion` guard; touch targets under 44×44px; primary body text under 16px; hero `<h1>` under 48px; hand-rolled SVG for standard icons (menu, close, chevron, search…); hex-shaded accent variants instead of a token chain; async components missing loading/error/empty states; icons without `aria-hidden` or `aria-label`; inline styles; custom fonts without `font-display: swap`.
- BLOCK: component decisions that contradict `.topia/ui-spec.md`; placeholder content ("Lorem ipsum", "TODO", "placeholder") in rendered markup.
- Secondary text (`<time>`, `<small>`, hints, captions) may be 14px. Logos, charts and illustrations are never flagged as hand-rolled icons. Skip UI checks for diffs with no markup.

**Packs.** If a domain pack is installed (e.g. `@Topia/security`), apply its Hard-Stop Thresholds table to matching staged files.

### Step R8 — Organization Approval Requirements

Read `.topia/org/org.md` directly. On platforms that compile skills, the same rules may also arrive as an injected `<ORG-POLICY>` block (from `compiler/emitter.js#buildOrgPolicyBlock`); use whichever is present.

If `.topia/org/org.md` does not exist and no block was injected, skip and log INFO: "no org config, organization approval check skipped".

From the **Code Review**, **Deployment** and **Approval Flows** sections, apply:

| Requirement | Gate | Verdict on violation |
|---|---|---|
| `minimum_reviewers: N` | Branch/PR shows fewer than N approvals | BLOCK: "Org requires ≥N reviewers; current: <count>" |
| `self-merge_allowed: No` | Commit author is the only approver | BLOCK: "Self-merge prohibited by org policy" |
| `staging_required: Yes` | Production deploy with no prior staging deploy in `.topia/audit/deploys.log` | BLOCK |
| `production_deploy_window` | Current time outside the window | WARN |
| Approval flow steps | Change type needs a named approver chain that is incomplete | BLOCK: "Approval flow `<name>` not satisfied: missing <role>" |

Governance: use the `verification:` line under Governance Level (older files say `readiness:`).
- enforce mode / full checks → violations BLOCK
- warn mode → violations WARN; the change can proceed once acknowledged
- advisory → violations INFO

With enforce mode, org violations are not softened by the score in R10. Report them under `### Organization Approval`, highest severity first.

### Step R9 — Security and Imports

Run `topia:guardian` on the changed files and attach its findings under Security; a guardian BLOCK is a verification BLOCK. Run `topia:hallucination-guard` when the diff adds imports or external API calls.

### Step R10 — Score and Verdict

Score each dimension from its findings: no BLOCK → 100; 1 BLOCK → capped at 30; 1 WARN → capped at 75; each further WARN −10 (floor 40).

```
Score = Logic×0.30 + Error handling×0.20 + Completeness×0.20 + Coherence×0.15 + Regression×0.15
```

| Score | Grade | Verdict |
|---|---|---|
| 90–100 | Excellent | PASS |
| 75–89 | Good | PASS with notes |
| 60–74 | Fair | WARN |
| 40–59 | Poor | WARN (escalate) |
| 0–39 | Critical | BLOCK |

Overall verdict:
- **BLOCK** — any Stage 1 FAIL, any BLOCK finding, a guardian BLOCK, or an org BLOCK.
- **WARN** — missing error handling, untested regression risk, incomplete feature; the developer must acknowledge each item.
- **PASS** — only style or best-practice notes.

Emit `verification.blocked` on BLOCK; emit `verification.complete` otherwise.

---

## Output Format

```
VERIFICATION REPORT (mode: checks | full)
=========================================
Lint:      [PASS/FAIL/SKIP] ([details])
Types:     [PASS/FAIL/SKIP] ([X errors])
Tests:     [PASS/FAIL/SKIP] ([passed]/[total], [coverage]%)
Build:     [PASS/FAIL/SKIP]

### 3-Level File Check
| File | L1 Exists | L2 Substantive | L3 Wired | Verdict |
|------|-----------|----------------|----------|---------|
| src/auth/login.ts | ✓ | ✓ | ✓ (imported by routes.ts) | PASS |
| src/auth/reset.ts | ✓ | STUB (returns null) | — | FAIL L2 |

### Review (full mode)
- Logic: `src/api.ts:85` — missing-await: database call not awaited
- Error handling: `src/handler.ts:20` — bare-catch
- Regression: `utils/format.ts` — used by 5 modules, 3 untested (WARN)
- Completeness: `api/users.ts` — POST endpoint without input validation
- Coherence: `api/users.ts` — uses `res.json()`; project uses `sendResponse()`
- Domain: `migrations/003.sql` — BLOCK: DROP TABLE without rollback
- Organization Approval: [findings or "no org config, organization approval check skipped"]
- Security (guardian): [findings]
- Score: [value] → [grade]

### Failures (if any)
- [check]: [first 5 errors with file:line]

Verdict: PASS | WARN | BLOCK — [one line: count of blocking and must-acknowledge items]
```

## Evidence Before Claims

<HARD-GATE>
Never claim "done", "fixed", "passing" or "verified" without the command output that proves it.
"I ran the tests and they pass" without stdout = UNVERIFIED CLAIM = REJECTED.
The verification report is the evidence. No report = no verification happened.
</HARD-GATE>

- Every check's stdout/stderr appears in the report; empty output is noted ("0 errors, 0 warnings").
- PASS means the tool ran and its output shows zero errors.
- If only some checks ran, Overall is INCOMPLETE, not PASS.

| Claim | Without | Verdict |
|---|---|---|
| "All tests pass" | Test runner stdout with counts | REJECTED — re-run and show output |
| "No lint errors" / "Build succeeds" | The command's stdout | REJECTED |
| "I verified it" | A Verification Report | REJECTED |

## Error Recovery

- Project type unknown: report it and skip Stage 1 checks
- Tool not installed: mark SKIP with the reason (not PASS)
- Command hangs over 60 seconds: stop it, mark TIMEOUT, continue

## Constraints

1. MUST run all four checks (lint, types, tests, build) — not just tests, and not skipped because "the change is small"
2. MUST show actual command output; mark Overall INCOMPLETE if a check was skipped without a valid reason (tool missing is valid)
3. MUST give file:line for every failure and finding
4. (full) MUST NOT accept "happy path works" — edge cases and error paths are checked for every changed function
5. (full) MUST run guardian on changed files; security relevance is guardian's call, not this skill's
6. (full) MUST read `.topia/org/org.md` when it exists and apply its governance level
7. (full) MUST collect all findings before reporting — not stop at the first BLOCK

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Claiming "all passed" without output | CRITICAL | Evidence Before Claims gate |
| Trusting exit 0 | CRITICAL | Confirm the success line or output artifact |
| Skipping build because "changes are small" | HIGH | Constraint 1 |
| Tool not installed marked PASS | MEDIUM | Mark SKIP with reason |
| Stopping at the first failure or first BLOCK | MEDIUM | Run everything; report the full list |
| Existence Theater — file is a stub | HIGH | Level 2 stub patterns |
| Dead code — file never imported | MEDIUM | Level 3 consumer check |
| Truncated code from an output limit | HIGH | Level 2 truncation patterns; finish the file and re-run |
| Plan available but R1 skipped | HIGH | R1 is mandatory when the caller passes a plan |
| Domain checks replacing the generic review | HIGH | R7 adds to R2-R5; never replaces them |
| Org policy ignored in Claude Code because no block was injected | HIGH | R8 reads `.topia/org/org.md` directly |
| Running full mode after every small edit | LOW | Callers mid-task use `checks`; full runs before commit |

## Done When

- Project type detected; lint, types, tests and build run (or SKIP with reason), each with its output shown
- 3-level check reported for every new or modified file
- (full) Every changed function traced for null-deref, missing-await and off-by-one; error handling and regression impact checked
- (full) Org policy applied from `.topia/org/org.md`, or "no org config" logged; guardian findings attached
- Report emitted with PASS / WARN / BLOCK and file:line for every finding

## Cost Profile

Checks mode: ~$0.01-0.03 per run, mostly Bash. Full mode: ~2000-4000 tokens input, ~500-1500 output (sonnet for the logic review), plus guardian.
