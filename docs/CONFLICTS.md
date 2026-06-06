# Topia Differentiators (vs Rune-kit)

> **Status: implemented in v2.0.0** (2026-05-19). See [CHANGELOG.md](CHANGELOG.md) and [docs/migration/v1-to-v2.md](docs/migration/v1-to-v2.md).

This document recorded the gap between `topia` and fork-parent `rune-kit`. The v2.0 release addressed the recommendations below.

## Resolution summary

| Recommendation | v2.0 deliverable |
|----------------|------------------|
| Mesh → Nexus | `checkNexusIntegrity`, `--nexus`, [NEXUS-GLOSSARY.md](docs/NEXUS-GLOSSARY.md), branding footer |
| Connections → Synapses | Stats, doctor output, README, package description |
| Signals → Pulses | Stats, doctor output, status CLI |
| Skill renames | `guardian`, `readiness`, `integrate`, `recon`, `guardian-env` |
| Neural Memory emphasis | README, install flow, status memory health |
| 8 Pillars / audit framing | Documented in glossary; audit skill unchanged in scope |
| Maestro / discipline rails | Glossary + README orchestration language |
| CLI identity | Enhanced `topia status`, `topia visualize` in onboarding |
| Rune remnants | Migration docs retain rune-kit references only where needed |

## Original analysis (archived intent)

### 1. Core Terminology & Branding

- **Nexus** — central intelligence graph (was "mesh")
- **Synapses** — 203 synchronous skill links (was "connections")
- **Pulses** — 44 async events (was "signals")
- **Topia tone** — discipline rails, cockpit, Maestro orchestration (not arcane/grimoire)

### 2. Differentiating Features

- **Neural Memory** — agora-code MCP (optional)
- **5-layer architecture** — formal L0–L4 structure
- **8 Pillars** — `audit` eight-dimension health check

### 3. User Experience & CLI

- Richer `topia status` (memory, nexus density, layer emojis)
- `topia visualize` promoted in install/onboarding

### 4. Documentation narrative

- Maestro metaphor (router + orchestrators)
- Self-healing routing via redundant skill paths
- Metrics-driven discipline

### 5. Cleanup

- Skill IDs no longer match rune-kit overlap table (`scout`→`recon`, etc.)
- Non-migration code uses stand-alone Topia voice

## Identity shift (reference)

| Concept | Rune-kit (The Past) | Topia v2 (The Future) |
|---------|---------------------|-----------------------|
| **Core Metaphor** | Arcane/Runes/Ancient | Growth/Infrastructure |
| **Skill Structure** | Collection/Mesh | Nexus/Nervous System |
| **Memory** | Stateless/Ephemeral | Neural/Persistent (Agora) |
| **Logic Gate** | Guidelines | Hard-Gates/Rails |
| **Orchestration** | Pipeline | Adaptive Graph |
| **Tone** | Lean/Interconnected | Disciplined/Resilient |
