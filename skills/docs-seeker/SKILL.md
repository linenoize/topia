---
name: docs-seeker
description: "Old name for research's API docs mode. Use when you type /topia:docs-seeker out of habit; it looks up library or API documentation through research."
disable-model-invocation: true
metadata:
  author: topia
  version: "0.2.0"
  layer: L3
  model: haiku
  group: knowledge
  tools: "Read, Glob, Grep, WebFetch, WebSearch"
  merged-into: research
---

# docs-seeker

## Purpose

This skill is now the API docs mode of `research`. That mode looks up signatures, examples and deprecations for a library, API or error message.

## How to run it

Read `${CLAUDE_SKILL_DIR}/../research/SKILL.md` and follow its API docs mode, using the request that came with this command.

## Calls (outbound)

None. This name only points to `research`.

## Called By (inbound)

- User: `/topia:docs-seeker` (old name, kept so it still works)

## Output Format

Whatever `research` reports. Add one line at the top: "`docs-seeker` is now part of `research`."

## Constraints

1. Do the work with `research`'s instructions. Do not use an older copy of this skill.
2. Tell the person once that `/topia:research` is the name to use from now on.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Treating this stub as the full skill and stopping here | MEDIUM | Read `research`'s SKILL.md and follow it |

## Done When

- `research` ran on the request that came with this command

## Cost Profile

One extra file read. The cost is whatever `research` costs.
