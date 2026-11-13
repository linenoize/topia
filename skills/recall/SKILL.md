---
name: recall
description: "Read-only memory recall from Topia's files: .topia/ progress, decisions, conventions, and learnings, plus .remember/ when present. Use at session start, when resuming work, or before architecture decisions. Writes go through journal and session-bridge."
metadata:
  author: topia
  version: "1.0.0"
  layer: L3
  model: haiku
  group: state
  tools: "Read, Glob, Grep"
---

# recall

## Purpose

Reads Topia's memory and returns one **Recall Report**. The memory is plain files: `.topia/` project state, plus `.remember/` session notes when that plugin is used. They need no setup, no server, and no API key. This skill is read-only; it never writes to any store.

Use at session start, before architecture decisions, or when resuming work after a break.

## Triggers

- `/topia recall [topic]` — primary user trigger
- `/topia:recall [topic]` — platform alias (Cursor/Windsurf colon syntax)
- Session start, when the session-start hook lists memory sources
- Before `plan` architecture decisions when prior context may exist

## Calls (outbound)

- None. Reads files only (optional backends: see below).

## Called By (inbound)

- `build` (L1): Phase 0 resume — load cross-source context before planning
- `plan` (L2): before architecture decisions on similar problems
- `recon` (L2): when codebase scan benefits from prior session context
- User: `/topia recall` direct invocation
- `context-lifecycle` (L3): minimal recall after post-compact resume
- `rescue` (L1): phase start — past refactoring patterns and decisions
- `retro` (L2): past retro insights for trend comparison

## Workflow

### Step 1 — Gather file-based memories

Run the helper (or equivalent Reads):

```bash
node skills/recall/scripts/gather-memories.js --root <project> --json
```

Sources (skip silently when absent):

| Source | Files |
|--------|-------|
| `.topia/` | `progress.md`, `decisions.md`, `checkpoint.md`, `session-log.md`, `conventions.md`, `cumulative-notes.md`, `instincts.md`, `learnings.jsonl` (tail) |
| `.remember/` | `now.md`, latest `today-*.md`, `recent.md`, `remember.md` |
| `.claude/remember/` | `identity.md` |

The helper keeps the newest part of long logs. Prefer `checkpoint.md` and `now.md` first.

`learnings.jsonl` holds one JSON object per line. The `commit-memory` hook adds a `{"type":"commit"}` row after each commit (subject and files). Skills add `decision`, `error`, and `insight` rows.

### Step 2 — Search for the topic

When a topic is given, Grep for it instead of reading whole files:

```
Grep pattern="<topic words>" path=".topia" output_mode="content" -C=3
Grep pattern="<topic words>" path=".topia/learnings.jsonl"
Glob pattern=".topia/adr/*.md"
```

Also check `git log --oneline -20` for recent work when the files are thin.

### Step 3 — Merge and emit Recall Report

Tag every item with its source. Prefer this precedence when facts conflict:

1. `.topia/decisions.md` and `.topia/conventions.md` — project truth
2. `.remember/now.md` — current session narrative
3. `.topia/learnings.jsonl` — commits and learnings, newest wins per key
4. `.remember/recent.md` — recent session history

## Optional backends

Only if tools named `mcp__<server>__*` are in your tool list; otherwise skip without mentioning it.

| Server | Call | Notes |
|--------|------|-------|
| `neural-memory` | `nmem_recall` for 2–3 topics | Prefix each query with the project name |
| `agora-memory` | `recall_learnings` with the same topics | Dedupe against file results |

Results from these go in the report under their own source tag. Files stay the source of truth.

## Output Format

```
RECALL REPORT — <project-name>
================================
Topic: <topic or "session start">
Sources: .topia (N) | .remember (N)

## Session narrative (.remember)
- ...

## Project state (.topia)
- ...

## Recent commits and learnings (.topia/learnings.jsonl)
- ...

## Gaps
- No memories found for: <topic> (if applicable)

## Suggested next actions
- Continue from: <checkpoint or progress item>
- Record new decisions with: topia:journal
```

## Constraints

1. **Read-only** — MUST NOT write to `.topia/` or `.remember/`; writes go through `journal` or `session-bridge`
2. **MUST NOT block** when any source is missing — emit partial report with source tags
3. **MUST NOT log secrets** — skip `.env`, credentials, or token values if encountered in memory files
4. **MUST NOT ask the user** to set up or confirm memory — use what exists
5. **MUST NOT invoke remember plugin shell hooks** — read files only; hook conflicts with Topia hook install
6. **MUST NOT write to Claude Code's own auto-memory** (`~/.claude/projects/...`) — Claude Code owns it

## Sharp Edges

| Edge | Impact | Mitigation |
|------|--------|------------|
| Stale `.remember/` narrative contradicts `.topia/` decisions | MEDIUM | Precedence rule: `.topia/` wins for decisions/conventions |
| Large `learnings.jsonl` blows token budget | MEDIUM | Script reads the tail only; Grep for older rows |
| Long `progress.md` hides old entries | LOW | Script keeps the newest part; Grep for the rest |
| No memory files yet | LOW | Say so in one line and continue |

## Done When

- All available file sources scanned and tagged in Recall Report
- Topic searched with Grep when one was given
- Actionable summary emitted with suggested continuation point
- User can proceed without running separate recall commands per source

## Cost Profile

Low — haiku for merge/summary. The gather script is local file reads only.
