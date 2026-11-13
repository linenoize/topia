---
name: context-engine
description: "Old name for context-lifecycle. Use when you type /topia:context-engine out of habit; it saves state and plans the next compact, cost preview or caveman mode through context-lifecycle."
disable-model-invocation: true
metadata:
  author: topia
  version: "1.2.0"
  layer: L3
  model: haiku
  group: state
  tools: "Read, Glob, Grep"
  merged-into: context-lifecycle
---

# context-engine

## Purpose

This skill is now part of `context-lifecycle`. Claude Code compacts on its own, the status line shows real context use, and the context-watch hook warns when a session gets long, so the tool-call counting this skill used to do is gone. The parts that still help (state save before compact, the cost preview, caveman mode) live in context-lifecycle.

## How to run it

Read `${CLAUDE_SKILL_DIR}/../context-lifecycle/SKILL.md` and follow the mode that fits the request that came with this command.

## Calls (outbound)

None. This name only points to `context-lifecycle`.

## Called By (inbound)

- User: `/topia:context-engine` (old name, kept so it still works)

## Output Format

Whatever `context-lifecycle` reports. Add one line at the top: "`context-engine` is now part of `context-lifecycle`."

## Constraints

1. Do the work with `context-lifecycle`'s instructions. Do not use an older copy of this skill.
2. Tell the person once that `/topia:context-lifecycle` is the name to use from now on.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Treating this stub as the full skill and stopping here | MEDIUM | Read `context-lifecycle`'s SKILL.md and follow it |

## Done When

- `context-lifecycle` ran on the request that came with this command

## Cost Profile

One extra file read. The cost is whatever `context-lifecycle` costs.
