---
name: worktree
description: "Use when work must happen in an isolated copy of the repo: parallel streams that would otherwise edit the same checkout, or an experiment that must not touch the main working tree. Prefers Claude Code's native worktree tools and Agent isolation, with plain git commands as the fallback. Covers create, list and cleanup."
disable-model-invocation: true
metadata:
  author: topia
  version: "2.0.0"
  layer: L3
  model: haiku
  group: utility
  tools: "Read, Bash, Glob, Grep"
---

# worktree

## Purpose

Git worktree lifecycle for any skill that needs an isolated workspace: create it, keep track of it, and clean it up after merge or abort.

Claude Code now handles most of this itself. Use its tools first and fall back to plain `git worktree` only where they are missing (other platforms, older versions, or a worktree that must outlive the session).

In Claude Code this skill is hidden from Claude's skill list. `team` and `build` read this file and follow it; a person can still type `/topia:worktree`.

## Triggers

- `team` (L1) needs isolated parallel streams
- `build` (L1) when the user asks for isolation, or for a hotfix branch
- `/topia:worktree create <name>`, `/topia:worktree cleanup`

## Calls (outbound)

None — Claude Code tools or plain git.

## Called By (inbound)

- `team` (L1): Phase 2 ASSIGN — isolate parallel streams
- `build` (L1): optional isolation for complex features or hotfixes
- User: direct invocation for manual worktree management

## Choose the method

| Need | Claude Code (preferred) | Fallback |
|------|------------------------|----------|
| A subagent works in its own copy | Agent tool with `isolation: "worktree"` | Create a worktree manually, pass its path in the prompt |
| This session moves into an isolated copy | `EnterWorktree`, then `ExitWorktree` when done | `git worktree add`, then work with absolute paths |
| List or clean up | `git worktree list` / cleanup below | Same |

Load `EnterWorktree` / `ExitWorktree` with ToolSearch if they are deferred. If neither they nor Agent isolation exist, use the manual fallback.

## Operations

### Isolate a subagent (parallel streams)

Spawn the Agent with `isolation: "worktree"`. Claude Code creates the worktree and branch, runs the agent there, and removes the worktree automatically if the agent changed nothing. When it did change something, the result names the worktree path and branch. Record both in the stream's state so `team` can merge them.

Tell each agent: commit on its branch, do not push, stay inside its file ownership list.

### Move this session into a worktree

1. `EnterWorktree` (optionally with a name). It creates the worktree under `.claude/worktrees/` and switches the session into it.
2. Do the work and commit there.
3. `ExitWorktree` to return. Choose keep (branch stays for merging) or remove (only if everything is merged or abandoned on purpose).

### Manual fallback (other platforms)

```
Create:
  git worktree add .claude/worktrees/<name> -b topia/<name> [base_branch]
  git worktree list   # confirm it exists
  → { path: ".claude/worktrees/<name>", branch: "topia/<name>" }

List:
  git worktree list --porcelain   # keep only topia/* and Claude-created branches

Cleanup one:
  git branch --merged main | grep topia/<name>
  if merged (or user confirmed force):
    git worktree remove .claude/worktrees/<name>
    git branch -d topia/<name>     # -D only with user confirmation
  else: warn "topia/<name> has unmerged changes"

Cleanup stale:
  git worktree prune               # drops entries whose folder is gone
  then run "Cleanup one" for each merged topia/* branch
```

## Safety Rules

1. Never remove a worktree with uncommitted changes without asking the user.
2. Never force-delete an unmerged branch without asking the user.
3. Keep at most 3 active manual worktrees; Agent-isolated worktrees count while their branch is unmerged.
4. Keep worktrees under `.claude/worktrees/`, not in the project root.
5. Check that `.claude/worktrees/` is gitignored before creating one manually.

## Output Format

```
## Worktree Report
- **Action**: create | cleanup | list
- **Method**: agent-isolation | enter-worktree | manual
- **Worktrees**: [count active]

| Name | Branch | Path | Status |
|------|--------|------|--------|
| stream-a | topia/stream-a | .claude/worktrees/stream-a | active |
| stream-b | topia/stream-b | .claude/worktrees/stream-b | merged |
```

## Constraints

1. MUST prefer Agent `isolation: "worktree"` or `EnterWorktree`/`ExitWorktree` when available
2. MUST keep worktrees under `.claude/worktrees/`
3. MUST check for uncommitted changes before cleanup
4. MUST NOT force-delete unmerged branches without explicit user confirmation
5. MUST record path and branch of every worktree that holds unmerged work

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Hand-rolling worktrees where the native tools exist | MEDIUM | Choose-the-method table: native first |
| Worktree left behind after a failed merge | MEDIUM | Cleanup stale + a pre-merge tag for recovery |
| Agent-isolated worktree removed before its branch is merged | HIGH | Record path and branch from the Agent result; clean up only after merge |
| Branch name collision | LOW | Check the branch exists first; append a short suffix |
| Long paths on Windows | MEDIUM | Short names under `.claude/worktrees/` |
| Deleting a worktree with uncommitted agent work | HIGH | Safety rule 1 |

## Done When

- Worktree created, listed or cleaned up as asked, with the method used stated
- Every worktree holding unmerged work has its path and branch recorded
- No stale worktrees left behind
- Worktree Report emitted

## Cost Profile

~200-500 tokens. Haiku plus a few git commands.
