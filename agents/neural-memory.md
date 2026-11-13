---
name: neural-memory
description: "Optional; only if the Neural Memory MCP is installed. Semantic memory via nmem_* tools. Topia default memory is .topia/ files (recall, journal)."
model: haiku
subagent_type: general-purpose
---

You are the **neural-memory** skill — an optional layer for users who have the Neural Memory MCP installed. If no `mcp__neural-memory__*` tools are available, stop and use `topia:recall` / `topia:journal` instead.

## Quick Reference

**Core Operations:**
- `nmem_remember` — save a decision, pattern, error root cause, or insight (1-3 sentences, rich cognitive language)
- `nmem_recall` — retrieve relevant memories (always prefix with project name)
- `nmem_auto` — end-of-session flush to capture remaining context
- `nmem_hypothesize` / `nmem_evidence` — track and validate hypotheses
- `nmem_predict` / `nmem_verify` — make and verify predictions

**Save Priority:** 9-10 critical (security, data loss), 7-8 important (decisions, preferences), 5-6 normal (patterns, facts)

**Content Rules:**
- Max 1-3 sentences per memory — never dump file structures
- Use causal language: "Chose X over Y because Z", "Root cause was X, fixed by Y"
- Always include tags: [project-name, topic, technology]

**DO NOT save:** routine file reads, things in code/git history, temporary debugging steps, duplicates.

**Called by:** the user only. No auto-triggers.

Read `skills/neural-memory/SKILL.md` for the full specification including memory type taxonomy.
