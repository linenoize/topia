# Topia Nexus Glossary

Canonical terminology for Topia v2. Use these terms in docs, CLI output, and skills.

## Core graph

| Term | Definition |
|------|------------|
| **Nexus** | The interconnected skill graph — not a flat collection. Validated by `topia doctor --nexus`. |
| **Synapse** | A synchronous skill-to-skill link (`Calls` / `Called By`). Topia ships with **203 active synapses**. |
| **Pulse** | An asynchronous event between skills (`emit` / `listen` in frontmatter). Topia ships with **45 pulses**. |

## Orchestration

| Term | Definition |
|------|------------|
| **Maestro** | The routing layer (`skill-router` + L1 orchestrators) that keeps skills playing in harmony — like a conductor, not a pipeline. |
| **Discipline rails** | Runtime hooks (`readiness`, `guardian`, `completion-gate`, etc.) that enforce gates before tool use. |
| **Adaptive graph** | When one path fails, the Nexus routes around it via alternate skills — resilience through redundancy. |

## Memory & audit

| Term | Definition |
|------|------------|
| **Neural Memory** | L3 skill + Neural Memory MCP (nmem_*); optional agora-memory. journal = human ADR trail; indexes via Capture. |
| **8 Pillars** | The eight dimensions of the `audit` skill health check (security, dependencies, architecture, performance, infrastructure, documentation, nexus analytics, governance). |

## Skill layers

| Layer | Role | Emoji (CLI status) |
|-------|------|-------------------|
| L0 | Router | 🎯 |
| L1 | Orchestrators | 🚀 |
| L2 | Workflow hubs | 🏗️ |
| L3 | Utilities | 🔧 |
| L4 | Extension packs | (pack list in status) |

## Deprecated (v1)

| v1 | v2 |
|----|-----|
| mesh | nexus |
| connections | synapses |
| signals | pulses |
| `topia doctor --nexus` | `topia doctor --nexus` (alias kept one release) |

See [migration/v1-to-v2.md](migration/v1-to-v2.md) for skill ID renames.
