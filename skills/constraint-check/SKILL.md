---
name: constraint-check
description: "Old name for completion-gate's process audit. Use when you type /topia:constraint-check out of habit; it checks whether a workflow's hard gates were really followed."
disable-model-invocation: true
metadata:
  author: topia
  version: "1.1.0"
  layer: L3
  model: haiku
  group: validation
  tools: "Read, Glob, Grep"
  merged-into: completion-gate
---

# constraint-check

## Purpose

This skill is now the process audit in `completion-gate`. The audit checks whether hard gates were followed (tests before code, plan approval, guardian run), using the order of tool calls rather than what the agent says.

## How to run it

Read `${CLAUDE_SKILL_DIR}/../completion-gate/SKILL.md` and run its process audit (Step 6) on the current session, using the request that came with this command.

## Calls (outbound)

None. This name only points to `completion-gate`.

## Called By (inbound)

- User: `/topia:constraint-check` (old name, kept so it still works)

## Output Format

Whatever `completion-gate` reports. Add one line at the top: "`constraint-check` is now part of `completion-gate`."

## Constraints

1. Do the work with `completion-gate`'s instructions. Do not use an older copy of this skill.
2. Tell the person once that `/topia:completion-gate` is the name to use from now on.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Treating this stub as the full skill and stopping here | MEDIUM | Read `completion-gate`'s SKILL.md and follow it |

## Done When

- `completion-gate` ran on the request that came with this command

## Cost Profile

One extra file read. The cost is whatever `completion-gate` costs.
