# Maintenance: which skills and MCP servers earn their place

Every skill description and every MCP server's tool list costs context in every session, whether it is used or not. Once in a while, measure what actually gets used and prune the rest. This page is the playbook for that round.

## 1. Collect the numbers

Both commands are read-only and print counts only: skill ids, MCP server names and totals. No prompt text, file contents or paths.

```bash
# One project: routing hints vs. skill uses, from <dir>/.topia/metrics
node scripts/usage-report.js --project path/to/project

# Every Claude Code transcript on this machine (default ~/.claude/projects)
node scripts/usage-report.js --transcripts

# Options: limit to a window, or get JSON for a spreadsheet or a script
node scripts/usage-report.js --transcripts --since 2026-10-01 --json > usage.json
```

The transcript scan streams files line by line; about 3 GB takes under a minute.

## 2. What the numbers mean

### `--project`

Reads `.topia/metrics/routing.jsonl` (one line per routing hint, written by the `intent-router` hook), `chains.jsonl` (each session's skill uses in order, with time and how they ran), `sessions.jsonl` and `skills.json`.

| Column | Meaning |
|---|---|
| `hinted` | Prompts where the router named this skill (any rank) |
| `top` | ...where it was the first suggestion |
| `used` | Uses recorded in `chains.jsonl`, split by how: `skill` (Skill tool), `agent` (a `topia:*` subagent), `slash` (`/topia:x`), `?` (rows written before the `via` field existed) |
| `followed`, `%` | Hints followed by a use of the same skill in the same session, at or after the hint |
| `med s` | Median seconds from a hint to the first use after it |
| `lifetime` | `total_invocations` from `skills.json` (all time, no dates) |
| Never used / never hinted / neither | Catalog skills missing from the data |

Caveats: the router only logs where Topia's hooks run (not Cursor), and a subagent use is timed when the subagent finishes, so `med s` runs long for agent-heavy skills.

### `--transcripts`

| Field | Meaning |
|---|---|
| Skill tool / slash / agent | Topia skill uses by route: `Skill` tool calls, `<command-name>/topia:x</command-name>` (and `/topia x`), and `Agent` calls with `subagent_type: topia:x` (`topia:x-agent` counts as `x`). Helper agents such as `coder` or `reviewer` show under their own names |
| sessions | Sessions (top-level transcripts, subagents folded in) that used the skill |
| other plugins' Skill calls | Skill tool calls for non-Topia skills, as a yardstick |
| MCP `calls` | `mcp__<server>__<tool>` tool calls per server |
| `sessions listed` | Sessions where the server's tools were offered (deferred-tool listings in attachments or system reminders) |
| Listed but never called | Servers that cost context and did nothing: the first candidates to move |

## 3. Decide

Use the window since the last round. Apply the first rule that fits.

| Signal | Action |
|---|---|
| Used regularly, or hinted and followed most of the time | **Keep.** |
| Hinted often but rarely followed; or used only by slash command although the model should pick it on its own | **Rewrite the description.** Start it with "Use when ..." and name the situation, not the internals. Fix its keywords in `compiler/lib/intent-keywords.js` if the router hints it for the wrong prompts. |
| Only ever run by a person on purpose (setup, tutorials, release steps) | **Hide it from Claude:** `disable-model-invocation: true` in the skill's frontmatter. It drops out of the model's skill list; `/topia:x` still works. |
| Never used, and another skill covers the same ground | **Merge it** into that skill. Leave a stub `SKILL.md` with `disable-model-invocation: true` that points to the new home, so old slash commands and links still land. |
| MCP server listed in many sessions, called in few or none | **Move it to project scope** (`claude mcp add --scope project` in the projects that use it), or park it in the MCP catalog so onboarding can offer it per project. |

Write down what you decided and why in the release notes, with the window and the counts behind it.

## 4. Where the knobs live

| Knob | Where |
|---|---|
| Skill description, `disable-model-invocation`, model, layer | Frontmatter of `skills/<name>/SKILL.md` |
| Words that make the router hint a skill | `compiler/lib/intent-keywords.js`, then `npm run generate:slash-aliases` (regenerates `hooks/lib/skill-routes.json` and the mod's table) |
| Router hook wiring and timeout | `hooks/hooks.json` (`UserPromptSubmit` → `intent-router`) |
| Router log format and size cap | `hooks/lib/routing-log.cjs` |
| Parked MCP servers (installed per project on demand) | `~/.claude/topia/mcp-catalog.json`, managed by `skills/onboard/scripts/mcp-catalog.js` |

The metrics live in each project's `.topia/metrics/` (gitignored). There is no switch that turns them off; delete the folder to reset it.

## 5. Guardrails

The hygiene tests in `npm run ci` keep a pruned catalog from drifting back:

- every skill description starts with "Use when";
- no retired skill names linger in skills, agents, commands or docs;
- no two skills, commands or agents share a slash or agent name.

If one fails after your change, fix the change rather than the test.
