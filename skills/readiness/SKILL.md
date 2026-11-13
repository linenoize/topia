---
name: readiness
description: "Old name for verification's review stage. Use when you type /topia:readiness out of habit; it runs the pre-commit gate: checks, then the logic, regression and completeness review."
disable-model-invocation: true
metadata:
  author: topia
  version: "1.1.0"
  layer: L2
  model: sonnet
  group: quality
  tools: "Read, Bash, Glob, Grep"
  merged-into: verification
---

# readiness

## Purpose

This skill is now the review stage of `verification`. verification is the one pre-commit gate: it runs lint, types, tests and build, then reviews the diff for logic errors, error handling, regressions and completeness, and applies org policy from `.topia/org/org.md`.

## How to run it

Read `${CLAUDE_SKILL_DIR}/../verification/SKILL.md` and run it in full mode (checks plus review stage), using the request that came with this command.

## Calls (outbound)

None. This name only points to `verification`.

## Called By (inbound)

- User: `/topia:readiness` (old name, kept so it still works)

## Output Format

Whatever `verification` reports. Add one line at the top: "`readiness` is now part of `verification`."

## Constraints

1. Do the work with `verification`'s instructions. Do not use an older copy of this skill.
2. Tell the person once that `/topia:verification` is the name to use from now on.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Treating this stub as the full skill and stopping here | MEDIUM | Read `verification`'s SKILL.md and follow it |

## Done When

- `verification` ran on the request that came with this command

## Cost Profile

One extra file read. The cost is whatever `verification` costs.
