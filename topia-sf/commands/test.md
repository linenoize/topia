---
name: sf:test
description: "Run the project's Salesforce tests through the tool service after a person approves."
disable-model-invocation: true
---

# /topia:sf:test

<!-- Adapted from forcedotcom/sf-skills skills/platform-apex-test-run/SKILL.md @219a84a, Apache-2.0; modified -->
<!-- Adapted from forcedotcom/sf-skills skills/platform-apex-test-run/references/test-fix-loop.md @219a84a, Apache-2.0; modified -->

Refuse until this project has an activation lock. Paths below start at the Topia plugin folder (`${CLAUDE_PLUGIN_ROOT}`), not this project.

Mode: `validate`. Print the identity block first.

1. The brief is confirmed through `sf_brief_confirm`, per `salesforce/skills/enhance-request.md`. A chat reply isn't confirmation. Settle the org and the test scope.
2. Call `sf_tests_run` with `{orgId, briefId, level}`, adding `classNames` for `RunSpecifiedTests`. A person approves in its dialog, because tests run code in the org. Start with the narrowest scope that answers the question, and widen once it passes.
3. It returns a `runId` right away, and the run goes on in the org. Call `sf_tests_run` with `{orgId, briefId, runId}` to read the result. That's a read, so no dialog opens. If it says the run is still going, say so, and read it again later.
4. Report what ran, how many passed and failed, coverage, and failures with their stack lines. The service stores the result in the project-keyed test-run log for 30 days.
5. Read failures with the table in `salesforce/skills/automation-reviewer.md`. Say whether the failure points at test data, a brittle assertion, or real logic.

A test run isn't a deploy, and it doesn't deploy a fix. A fix is a new plan. Don't loop on fixes here.

What a pass doesn't show:

- Tests don't see real data unless they use `SeeAllData`.
- Coverage without assertions proves nothing.
- These are Apex tests. Flow tests are separate.
- Anonymous Apex isn't a test, and it's banned.

Don't put tokens or session ids in the log.

## Hosts and refusals

`sf_tests_run` exists only on Claude Code, and it's denied inside subagents. Where it doesn't exist, stop and say so. Don't substitute Bash, PowerShell, or `sf` commands.

Don't run `sf` through a shell. If a tool refuses, stop and tell the person; reshaping the command defeats the control.
