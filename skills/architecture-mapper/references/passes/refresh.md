> **Runtime context:** Before executing, read `references/detection.md`, select the stack profile, and load hunt hints from `references/stacks/<profile>.md`. Follow `references/conventions.md` for cross-linking. Invoke `topia:recon` if scan context is stale.
---
description: Refresh a repo's docs/architecture + CLAUDE.md against code changed since the docs were last updated. Scoped, stack-neutral; not a full re-map.
---

# architecture-mapper · refresh mode (stack-neutral)

You are updating a repo's architecture docs after code changed. Work
**narrowly** — touch only the docs for what actually changed. Do not rewrite
or reformat docs whose subject didn't change. This is the incremental
counterpart to a full map; teams run it after merging to the default branch.

## 1. Find what changed since the docs were last touched

```
git log -1 --format=%H -- docs/architecture CLAUDE.md     # LAST = last docs commit
git diff --stat <LAST>..HEAD                              # everything since
git diff <LAST>..HEAD -- <source roots>                  # source changes only
```

Detect `<source roots>` from the repo rather than assuming — e.g. `src/`,
`app/`, `lib/`, `pkg/`, `internal/`, or whatever the project's primary code
directories are. If `docs/architecture` has never been committed, treat the
whole source tree as in scope. If there are **no source changes** in the
range, report "docs already current" and stop — make no cosmetic edits.

## 2. Map each change to exactly one doc

| Changed in code | Update |
|---|---|
| routes / handlers / controllers / entry points / boot | `ARCHITECTURE.md` |
| a call to (or from) another repo / service / external API | `connections.md` + the `CLAUDE.md` "connections" section |
| schema / model / migration / job / scheduler / UI surface | the matching domain doc (`data-models` / `background-jobs` / `ui-surface` / `integrations` …) |
| stack, build scripts, run commands, danger zones | `CLAUDE.md` |
| a documented smell that was **fixed** | remove it / mark resolved, and say so in the report |
| a doc added/removed, or the connection summary changed | also update `INDEX.md` |

## 3. Rules (keep the knowledge base intact)

- Preserve file structure, anchor slugs (`{#...}`), confidence labels, and
  the `## Backlinks` section in every file you edit.
- Re-verify every claim you change against **current** source; cite
  `file:line`. Label new claims **confirmed / likely / speculative**.
- Cross-repo references stay as designations (`org/repo`), never relative
  links across repo boundaries.
- Do **not** edit docs for areas that didn't change. Smaller diff = easier
  review.

## 4. Report, don't commit

List the docs you changed with a one-line reason each, plus any smell marked
resolved. Leave committing to the developer (or the calling orchestrator).
