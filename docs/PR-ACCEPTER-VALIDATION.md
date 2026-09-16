# PR-Accepter Validation Method (Topia-Native)

Operating procedure for a ~10-person team. The **PR accepter** (org role: `maintainer`) owns Topia gates before merge. Authors still run `/topia build` locally; the accepter does **not** trust that alone.

Policy source: [`.topia/org/org.md`](../.topia/org/org.md). Field reference: [`ORG-CONFIG.md`](ORG-CONFIG.md).

## Ownership and defaults

| Setting | Value |
|---------|--------|
| Accepter role | `maintainer` |
| Governance | **Moderate** |
| Minimum reviewers | 1 |
| Self-merge | **No** |
| Security-tagged paths | Security team + 1 |
| Hotfix (P1/P2) | Single maintainer OK; still run `guardian` + CI |

Maintainers may override `readiness` / `review`; they **cannot** override `guardian` BLOCK.

## Mental model

| Gate | Job | Blocks merge when |
|------|-----|-------------------|
| `guardian` | Security / secrets / OWASP / CVE | BLOCK |
| `readiness` | Logic gaps, missing tests, regressions | BLOCK |
| `completion-gate` | Claims without evidence (esp. agent PRs) | UNCONFIRMED |
| `verification` + CI | Lint / types / tests / build green | Fail |
| `review` | Correctness + blast radius | Any BLOCK/HIGH unfixed |

```
author opens PR + /topia build
        │
        ▼
   CI green (npm run ci)
        │
        ▼
accepter scopes ALL commits (main...HEAD)
        │
        ├─ /topia readiness ──┐
        │                     ├── any BLOCK → request changes
        └─ /topia guardian ───┘
        │
        ▼
   /topia review (full branch)
        │
        ▼
   completion-gate (if agent claims) + CI confirm
        │
        ▼
   approve and merge
```

---

## A. Ongoing — every PR (accepter checklist)

Run on the PR branch before approve/merge. Scope is always the **full branch**, not the tip commit.

### 1. Scope

```bash
git log main...HEAD --oneline
git diff main...HEAD
```

Note authors, security-sensitive paths, and high-blast symbols.

### 2. Hard gates (parallel)

- `/topia readiness` on the PR diff
- `/topia guardian` on the PR diff (OWASP per org policy)

Any BLOCK → request changes; do not merge.

### 3. Judgment

- `/topia review` with scope = full `main...HEAD`
- Require file:line findings or explicit per-file approval (no bare LGTM)
- Blast radius ≥50 callers + behavior change → `/topia adversary` before accept
- Untested business logic → BLOCK; author (or session) runs `/topia test` / `/topia build` — gates do not invent tests by themselves

### 4. Evidence

- If the PR or agent summary claims “tests pass / fixed / done” → run `completion-gate` against those claims
- Confirm CI is green (`.github/workflows/ci.yml` / `npm run ci`)

### 5. Org policy

- Min 1 reviewer; accepter is that reviewer or an additional maintainer
- Auth / crypto / secrets paths → Security team + 1 before accept
- Hotfix: single maintainer OK; still run `guardian` + CI

### 6. Merge

Only after gates clear and review BLOCK/HIGH items are fixed. Authors process feedback with `/topia review-intake`.

**Cadence:** one identical checklist per PR. Rotate maintainers for load; do not add a second committee.

---

## B. Retrospective — validate a commit collection

Same gates, triage first so history stays tractable.

### 1. Define the window

```bash
git log main --since='YYYY-MM-DD' --pretty=format:'%h %an %s'
# or
git log A..B --oneline
```

### 2. Cluster

Prefer group-by-PR:

```bash
gh pr list --state merged --base main --limit 100
```

Fallback: group by author + day if commits were direct-to-main.

### 3. Risk triage (order of work)

| Priority | Signal |
|----------|--------|
| P0 | Secrets / auth / crypto / dependency bumps / CI-red ranges |
| P1 | High blast radius, >200 LOC, or multi-module |
| P2 | Remainder — sample or skip if CI was green and no P0/P1 |

### 4. Per cluster (synthetic PR)

1. Check out the merge commit / PR branch range
2. Run ongoing checklist steps 2–4 (`guardian` ‖ `readiness` → `review` → evidence/CI)
3. Record: cluster id, gate verdicts, BLOCK findings, PASS/FAIL

### 5. Validation report

One row per cluster: `PASS | FAIL | SKIP(risk)`.

FAIL clusters → open fix PRs via `/topia fix` / `/topia build`. Do not rewrite history unless the team explicitly chooses a rewrite policy.

---

## Related skills and docs

| Skill / doc | Role |
|-------------|------|
| [`skills/readiness/SKILL.md`](../skills/readiness/SKILL.md) | Pre-merge quality gate |
| [`skills/guardian/SKILL.md`](../skills/guardian/SKILL.md) | Security hard stop |
| [`skills/review/SKILL.md`](../skills/review/SKILL.md) | Judgment pass + test-gap delegation |
| [`skills/completion-gate/SKILL.md`](../skills/completion-gate/SKILL.md) | Evidence for agent claims |
| [`skills/verification/SKILL.md`](../skills/verification/SKILL.md) | Lint / types / tests / build |
| [`skills/review-intake/SKILL.md`](../skills/review-intake/SKILL.md) | Author response to accepter feedback |
| [`skills/git/SKILL.md`](../skills/git/SKILL.md) | PR scope = all branch commits |
