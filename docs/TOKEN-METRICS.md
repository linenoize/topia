# Topia Token Metrics

How Topia tracks token usage, what confidence levels mean, and how to claim savings with evidence.

## Quick start

1. Install hooks on both platforms:

```bash
npx @protopia/skill-topia hooks install --platform all --preset gentle
```

2. Use Topia normally for several agent sessions (Cursor and/or Claude Code).

3. Open the analytics dashboard:

```bash
npx @protopia/skill-topia analytics
```

4. Inspect `.topia/metrics/sessions.jsonl` — each session may include a `tokens` object.

## What gets collected

| Signal | Confidence | Source |
|--------|------------|--------|
| Context peak (`context_peak`) | **measured** | Cursor `preCompact` hook (`context_tokens`, `context_usage_percent`) |
| Tool I/O estimate | **estimated** | `postToolUse` → char count × 0.25 on tool input + output |
| Skill load estimate | **estimated** | Skill/agent file size when `Skill` tool fires |
| Compaction count | **measured** | `preCompact` events per session |

Every session entry includes `tokens.confidence`:

- `measured` — only IDE-reported context data
- `estimated` — only char-based estimates
- `mixed` — both present
- `none` — no token data (hooks not wired or empty session)

**Topia does not read provider billing APIs.** For dollar cost, use Cursor Settings → Usage or the Anthropic usage dashboard.

## Platform setup

### Claude Code

Metrics hooks live in the plugin [`hooks/hooks.json`](../hooks/hooks.json). Install the Topia plugin and run sessions with the plugin active. Session end (`Stop`) flushes data to `.topia/metrics/`.

### Cursor

Run `topia hooks install --platform cursor`. This writes:

- `.cursor/rules/Topia-*.mdc` — discipline rules
- `.cursor/hooks.json` — lifecycle hooks (`sessionStart`, `postToolUse`, `preCompact`, `sessionEnd`)

**Known limitation:** On some Cursor versions, `postToolUse` stdin may be empty. Measured context peaks from `preCompact` remain the reliable path.

Alternatively, enable **Third-party hooks** in Cursor to map the Claude plugin `hooks/hooks.json` — avoid double-installing both native and plugin hooks.

## Baseline A/B (savings evidence)

1. Pick a representative task (e.g. “add validation to X endpoint”).
2. Run it **without** Topia (hooks disabled or rules removed). Record provider token usage or note `total_estimated` if hooks still estimate.
3. Run the **same task with Topia**. Record again.
4. Copy [`docs/templates/metrics-baseline.example.json`](templates/metrics-baseline.example.json) to `.topia/metrics/baseline.json` and set `without_topia_avg_tokens`.

The analytics dashboard shows a **vs Baseline** card when `baseline.json` exists.

## CLI

```bash
# HTML dashboard (default)
topia analytics

# JSON export including tokenOverview, tokenTrend, savingsVsBaseline
topia analytics --json

# Time window
topia analytics --days 7
```

## Files

| Path | Contents |
|------|----------|
| `.topia/metrics/sessions.jsonl` | Per-session summary incl. `platform`, `tokens` |
| `.topia/metrics/tokens.jsonl` | Per-compaction rows |
| `.topia/metrics/skills.json` | Skill totals + `estimated_tokens_total` |
| `.topia/metrics/baseline.json` | Optional A/B baseline (user-created) |

## Interpreting results

**Savings indicators (good):**

- Lower `context_peak` over time (measured)
- Fewer compactions per session
- Lower `estimated_io` for similar task types
- Positive `savingsVsBaseline.delta_percent`

**Cost overrun indicators (investigate):**

- Rising `estimated_skills` (too many skill invocations)
- High compaction rate with flat output quality
- `team` skill chains dominating sessions
- Large `alwaysApply` rule overhead on Cursor

## Troubleshooting

- **Empty metrics:** Run `topia hooks status --platform all`. Cursor needs `.cursor/hooks.json`; Claude needs plugin + Stop hook.
- **No measured peaks:** Compaction must occur in-session, or use Cursor where `preCompact` fires.
- **JSON parse errors on Cursor:** Ensure hooks emit JSON stdout — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §6.
