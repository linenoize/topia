---
name: context-lifecycle
description: "Use when a long session needs a save point: at a phase end, before or after /compact, after git push, before handing work to a subagent, or before sending a large bundle to another model. Saves state, says when to compact, resumes from the checkpoint, and can switch to terse output."
user-invocable: true
metadata:
  author: topia
  version: "1.1.0"
  layer: L3
  model: haiku
  group: state
  tools: "Read, Glob, Grep"
  emit: context.checkpoint.written, context.compacted, context.preview, output.density.set
  listen: context.pressure.high, checkpoint.request, phase.complete
---

# context-lifecycle

## Purpose

Decide **when** to save state, **when** to recommend `/compact`, and **how** to resume after compaction or a push, so a long task does not lose its place. Hooks write `.topia/checkpoint.md` on their own; this skill handles the agent side.

Claude Code already compacts automatically, the status line shows real context use, and the `context-watch` hook warns when a session runs long. This skill does not estimate context itself. It reads those signals and acts on them.

This skill also holds what used to be `context-engine`: the cost preview before large bundles and caveman output mode.

## Triggers

- Hook message after `pre-compact` or `git push` (checkpoint already on disk)
- Post-compact injection (resume from checkpoint)
- `context-watch` reports YELLOW or worse, or the status line shows the window more than half full
- `build` / `team` at phase boundaries; `checkpoint.request` or `phase.complete` signals
- A caller is about to bundle many files for another model (cost preview)
- User: `/topia context-lifecycle`, "resume after compact", "caveman", "be brief"

## Calls (outbound)

- `session-bridge` (L3): Save Mode, Checkpoint Mode, Load Mode
- `context-pack` (L3): handoff briefings before subagent spawn
- `recall` (L3): minimal unified recall at session start after compact

## Called By (inbound)

- `build` (L1): phase boundaries, ORANGE/RED context
- `team` (L1): before parallel dispatch, after merge, push boundaries; cost preview per worker
- `rescue` (L1): between refactoring sessions
- `session-bridge` (L3): after hook-written checkpoint
- `context-pack` (L3): context budget before deciding packet size
- `adversary` (L2): (oracle-mode) cost preview before bundle build

## Reading context pressure

Use the best signal available, in this order:

1. The status line or `/context` — real tokens used against the window.
2. The `context-watch` hook message — GREEN, YELLOW, ORANGE or RED. It counts tool calls when it cannot measure tokens, so treat its level as a rough guide.
3. Nothing available — assume GREEN unless the session has read many large files.

| Level | What to do |
|-------|------------|
| GREEN | Continue. |
| YELLOW | Load only the files you need. Prefer Grep to whole-file reads. |
| ORANGE | Save at the next safe boundary (Boundary Save), then recommend `/compact`. Caveman mode may switch on. |
| RED | Save now, then recommend `/compact` before more work. |

---

## Mode: Boundary Save (phase end / ORANGE)

1. Read the pressure level (above).
2. If ORANGE or RED, run `topia:session-bridge` (Save Mode) with the current phase, files touched, decisions, and remaining tasks.
3. Write the continuation point into the save (see Handoff Summary below).
4. If RED, recommend `/compact` right after the save.
5. If a subagent is next, read `${CLAUDE_SKILL_DIR}/../context-pack/SKILL.md` and follow it for a handoff under 1500 tokens.
6. Say where the next safe boundary is.

### Safe boundaries

| Transition | Compact? |
|-----------|----------|
| Research → planning | Yes |
| Planning → implementation | Yes. The plan is in `.topia/plan-*.md`. |
| Mid-implementation | Only after a file is fully written and its tests pass. Never mid-edit. |
| Failed approach → new approach | Yes. A fresh context helps. |
| Quality phase → verify | No. Findings point at file:line in the current context. |
| After commit | Yes. The work is in git. |

### Handoff Summary

When saving before a compact, write a short summary (under 500 tokens) that the next context can resume from:

```markdown
## Continuation
- Task: [what we are doing]
- Decisions: [decision — reason — files affected]
- Active thread: [file and function being edited; done vs left in the current step]
- User context: [urgency, preferences stated this session]
- Resume: [one concrete next action, e.g. "add the Zod check in src/auth/validate.ts:47"]
```

The "Resume" line matters most. Without it the next context knows what was discussed but not where to pick up. Give paths and line numbers, never file contents.

## Mode: Hook Resume (pre-compact / git push)

Hooks have already written `.topia/checkpoint.md`.

1. Read `.topia/checkpoint.md` and `.topia/progress.md` before exploring the repo.
2. Check that git state matches the checkpoint. Warn if the branch or commit moved.
3. After a push, recommend `/compact` or a new session. Do not start unrelated work in the same long context.
4. Continue from the checkpoint's **Resume Command**.

## Mode: Post-Compact Resume

After `/compact`, the PostCompact hook re-injects a checkpoint preview.

1. Read the full `.topia/checkpoint.md`.
2. Optionally run `topia:recall` (minimal) for decisions made before the compact.
3. Once resumed, rename the checkpoint to `.topia/checkpoint-[date].resolved.md` (keep the last 3).
4. Emit `context.compacted`.

## Mode: Cost Preview

Before a caller sends a large bundle to another model or worker (adversary oracle-mode, a team worker, a multi-file review, a cross-pack audit), estimate the cost first so an oversized bundle is stopped before it is built.

1. The caller passes its name, the file list with character counts, and the prompt length.
2. Estimate: `estimated_tokens = total_chars × 0.25`. Note the 5 largest files.
3. Look up the caller's thresholds:

| Caller | warn at | block at |
|--------|---------|----------|
| `adversary` oracle-mode | 50k | 100k |
| `team` worker | 30k | 80k |
| `review` multi-file | 40k | 100k |
| `audit` cross-pack | 60k | 120k |

   Override with `Topia_CONTEXT_THRESHOLDS_<CALLER>=warn:N,block:N`.
4. Action: `block` at or above block, `warn` at or above warn, else `proceed`.
5. Emit `context.preview` with `caller`, `estimated_tokens`, `file_count`, `top_5_files_by_size`, `threshold`, `action`. The caller decides what to do; on `block` it narrows scope or aborts.

Payload schema, calibration notes and per-caller handling: `references/preview-gate.md`.

## Mode: Caveman Output
<MUST-READ path="references/caveman-mode.md" trigger="when context reaches ORANGE/RED OR user says 'caveman'/'be brief'/'less tokens'"/>

A terse output mode: drop filler, articles, hedging and pleasantries; keep code, errors, paths and technical terms exactly as they are. Roughly 75% fewer output tokens.

| Trigger | Lasts until |
|---------|-------------|
| Context reaches ORANGE or RED | `/compact` brings it back to GREEN |
| User says "caveman", "/caveman", "be brief", "less tokens" | "stop caveman" or "normal mode" |
| A team worker goes over its output budget | That worker finishes |

On activation, emit `output.density.set` with `{mode: caveman, scope, source}`. Build, team and rescue honor it for their session.

Drop caveman for one response, then resume, for: security warnings, confirming an irreversible action, ordered multi-step instructions, "explain" or a repeated question, and root-cause explanations. Do not start a task in caveman; the first response stays normal.

## Chunking policy

| Stage | Context strategy |
|-------|------------------|
| Research / plan | Separate session or Task; `context-pack` briefing only |
| Implementation | One module per workstream; `team` fork for parallel |
| Review | Fresh Task; `contexts/review.md`; never the same window as implementation |
| Ship (push) | Hook checkpoint → compact or new session |

## Output Format

### Boundary Save
```
## Context Lifecycle — Boundary Save
- Pressure: [GREEN|YELLOW|ORANGE|RED] (source: status line | context-watch)
- Saved: [.topia files updated]
- Compact: [recommended now | at next boundary | not yet]
- Resume: [one concrete next action]
```

### Hook / Post-Compact Resume
```
## Context Lifecycle — Resume
- Source: [.topia/checkpoint.md]
- Next step: [single explicit action]
- Compact: [done | pending]
```

### Cost Preview
```
## Context Preview — [caller]
- Estimated: [N] tokens across [M] files (warn [W], block [B])
- Largest: [path] ([chars]), ...
- Action: proceed | warn | block
```

## Constraints

1. MUST read `.topia/checkpoint.md` before re-exploring the repo after a compact or push
2. MUST run `session-bridge` Save before recommending `/compact` at ORANGE or RED
3. MUST recommend `/compact` at ORANGE only at a safe boundary, never mid-edit
4. MUST NOT present the tool-call level as a measured percentage
5. (preview) MUST emit `context.preview` before the caller builds its bundle
6. Hooks own the checkpoint files; this skill coordinates the agent, not the hook scripts

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Compacting without a checkpoint | CRITICAL | Hooks write one on pre-compact and push; check the file exists |
| Summary without a concrete resume step | HIGH | Handoff Summary "Resume" line names a file and the next action |
| Resuming from a stale checkpoint after large git drift | HIGH | Compare branch and commit in the checkpoint with current git |
| Same context for implementation and review | HIGH | Use a `team` fork plus `context-pack`; never review in the implementation window |
| Treating context-watch's tool-call count as exact | MEDIUM | Prefer the status line; the count is a rough guide |
| Ignoring hook output after push | MEDIUM | Treat a push checkpoint as a hard boundary: compact or start fresh |
| (preview) Caller builds the bundle before asking | HIGH | Constraint 5; reject a preview that arrives after the bundle |
| (preview) Estimate off for non-English text | LOW | Both directions are safe; the caller's dispatch cap still applies |
| Caveman compresses code or error messages | CRITICAL | Caveman strips filler only; code, errors and paths stay verbatim |
| Caveman during a destructive-action confirmation | HIGH | Revert for one response, then resume |

## Done When

- Checkpoint on disk matches current work (or the user acknowledged drift)
- User knows whether to `/compact` or start fresh, and the next action is explicit (file + step)
- (preview) `context.preview` emitted with `action` before the caller bundled
- (caveman) `output.density.set` emitted when the mode turned on

## Cost Profile

~100-300 tokens per boundary check (haiku). Save and recall add a few file reads. Hooks cost no model tokens.
