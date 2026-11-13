---
name: sequential-thinking
description: "Old name for problem-solver's sequential mode. Use when you type /topia:sequential-thinking out of habit; it runs problem-solver on a decision whose factors depend on each other."
disable-model-invocation: true
metadata:
  author: topia
  version: "0.3.0"
  layer: L3
  model: sonnet
  group: reasoning
  tools: "Read, Glob, Grep"
  merged-into: problem-solver
---

# sequential-thinking

## Purpose

This skill is now the sequential mode of `problem-solver`. That mode handles decisions where several factors depend on each other and the order you settle them in matters.

## How to run it

Read `${CLAUDE_SKILL_DIR}/../problem-solver/SKILL.md` and follow it in sequential mode, using the request that came with this command.

## Calls (outbound)

None. This name only points to `problem-solver`.

## Called By (inbound)

- User: `/topia:sequential-thinking` (old name, kept so it still works)

## Output Format

Whatever `problem-solver` reports. Add one line at the top: "`sequential-thinking` is now part of `problem-solver`."

## Constraints

1. Do the work with `problem-solver`'s instructions. Do not use an older copy of this skill.
2. Tell the person once that `/topia:problem-solver` is the name to use from now on.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Treating this stub as the full skill and stopping here | MEDIUM | Read `problem-solver`'s SKILL.md and follow it |

## Done When

- `problem-solver` ran on the request that came with this command

## Cost Profile

One extra file read. The cost is whatever `problem-solver` costs.
