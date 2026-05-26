---
name: recall
description: "Unified cross-source memory recall: .remember/, .topia/, neural-memory, and agora-memory. Use at session start or before architecture decisions. Read-only orchestrator — writes stay on neural-memory Capture and session-bridge Save."
metadata:
  author: skill-topia
  version: "1.0.0"
  layer: L3
  model: haiku
  group: state
  tools: "Read, Glob, Grep"
---

# recall

## Purpose

Aggregates context from every memory layer Topia supports — file-based project state (`.topia/`), Claude Remember session narrative (`.remember/`), semantic graph memory (Neural Memory MCP), and SQLite/vector memory (agora-memory MCP) — into one **Recall Report**. This skill is read-only; it never writes to any store.

Use at session start, before architecture decisions, or when resuming work after a break.

## Triggers

- `/topia recall [topic]` — primary user trigger
- `/topia:recall [topic]` — platform alias (Cursor/Windsurf colon syntax)
- Auto-suggested at session start (see session-start hook checklist)
- Before `plan` architecture decisions when prior context may exist

## Calls (outbound)

- `neural-memory` (L3): MCP recall via `nmem_recall` and optional `recall_learnings` when backends registered

## Called By (inbound)

- `build` (L1): Phase 0 resume — load cross-source context before planning
- `plan` (L2): before architecture decisions on similar problems
- `recon` (L2): when codebase scan benefits from prior session context
- User: `/topia recall` direct invocation
- `context-lifecycle` (L3): minimal recall after post-compact resume

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

Respect token budget: truncate long files; prefer `checkpoint.md` and `now.md` first.

### Step 2 — Query MCP backends (optional)

If `neural-memory` MCP is registered:

- Call `nmem_recall` for 3–5 diverse topics (prefix with project name)
- If topic provided on invocation, include it as primary query

If `agora-memory` MCP is registered:

- Call `recall_learnings` with the same topics
- Merge with nmem results; dedupe by similarity

**Graceful degradation**: missing MCP servers must never block recall. File-based sources alone are valid output.

### Step 3 — Merge and emit Recall Report

Tag every item with its source. Prefer this precedence when facts conflict:

1. `.topia/decisions.md` and `.topia/conventions.md` — project truth
2. `.remember/now.md` — current session narrative
3. MCP semantic memories — cross-project patterns
4. `.remember/recent.md` — recent session history

## Output Format

```
RECALL REPORT — <project-name>
================================
Topic: <topic or "session start">
Sources: .topia (N) | .remember (N) | nmem (N) | agora (N)

## Session narrative (.remember)
- ...

## Project state (.topia)
- ...

## Semantic memories (MCP)
- ...

## Gaps
- No memories found for: <topic> (if applicable)

## Suggested next actions
- Continue from: <checkpoint or progress item>
- Capture new learnings via: /topia remember (neural-memory Capture Mode)
```

## Constraints

1. **Read-only** — MUST NOT write to `.topia/`, `.remember/`, nmem, or agora unless user explicitly requests a different skill
2. **MUST NOT block** when any source is missing — emit partial report with source tags
3. **MUST NOT log secrets** — skip `.env`, credentials, or token values if encountered in memory files
4. **MUST prefix MCP queries with project name** — generic queries return cross-project noise
5. **MUST NOT invoke remember plugin shell hooks** — read files only; hook conflicts with Topia hook install

## Sharp Edges

| Edge | Impact | Mitigation |
|------|--------|------------|
| Stale `.remember/` narrative contradicts `.topia/` decisions | MEDIUM | Precedence rule: `.topia/` wins for decisions/conventions |
| Duplicate content across nmem and agora | LOW | Dedupe by similarity; tag both sources when uncertain |
| Large `learnings.jsonl` blows token budget | MEDIUM | Script reads tail only; truncate per-file snippets |
| No MCP registered | LOW | File-only recall is still valuable — do not fail |

## Done When

- All available file sources scanned and tagged in Recall Report
- MCP backends queried when registered (or explicitly noted as skipped)
- Actionable summary emitted with suggested continuation point
- User can proceed without running separate recall commands per source

## Cost Profile

Low — haiku for merge/summary; MCP recall calls are external. File gather script is local I/O only.
