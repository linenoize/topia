# MCP Integration: agora-code

Topia ships a vendored copy of [agora-code](https://github.com/thebnbrkr/agora-code) — a Python MCP server providing persistent memory, symbol indexing, and session tracking for AI coding agents. It lives at [`mcp-servers/agora-code/`](../../mcp-servers/agora-code/) and is **opt-in** — Topia works without it, but four skills (`journal`, `build`, `idea`, `neural-memory`) gain stronger cross-session memory when it's wired up.

## Why vendor it

| Concern | Topia's built-in approach | What agora-code adds |
|---|---|---|
| Session decisions | `.topia/decisions.md` (markdown append) | SQLite-backed, semantic-recall via embeddings |
| File context | Re-read on every session | Symbol index — function/class locations cached by line |
| Past learnings | Scan `.topia/*.md` files | `recall_learnings` with vector search |
| Large file reads | Read in full, burn context | Explicit `agora-code summarize` from skills when needed |

agora-code is not a replacement — it is an optional extra that `recall` and `journal` call when its tools are present.

## When memory is populated (Topia lifecycle)

| Lifecycle event | Topia action | agora effect |
|-----------------|--------------|--------------|
| `topia install` / `/topia finalize` | `topia memory seed` if `.topia/` exists | Imports prior markdown state into SQLite |
| Session start | `.topia/` inject + `agora-code inject` (Topia SessionStart hook) | Prior checkpoints + learnings in context |
| Session start | `topia:recall` when needed (files first) | Adds MCP results when its tools are present |
| ADR / `journal` | `store_learning` | New row in DB |
| `recall` | `recall_learnings` | Semantic search alongside the files |
| Session end | `complete_session` via `journal` | Archives session |
| Git commit | `commit-memory` hook always appends the commit to `.topia/learnings.jsonl`; it also runs agora if `.topia/agora-commit-learn.flag` is set | `learn-from-commit` (opt-in) |

`.topia/` remains the human-readable source of truth; agora is the searchable cross-session index. `topia memory seed` bridges them once; `journal` keeps them aligned after.

## Install (one-time)

**Prerequisite**: Python 3.10+ and `pip`.

```bash
# From the Topia repo root
pip install ./mcp-servers/agora-code
agora-code --version   # verify
```

Or for upstream-tracking install (skips the vendored copy):

```bash
pip install git+https://github.com/thebnbrkr/agora-code.git
```

## Register the MCP server

Copy the launch config into your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "agora-memory": {
      "command": "agora-code",
      "args": ["memory-server"]
    }
  }
}
```

This is the verbatim contents of [`mcp-servers/agora-code/.mcp.json`](../../mcp-servers/agora-code/.mcp.json). Optional environment variables for semantic search:

```bash
export OPENAI_API_KEY=sk-...       # OpenAI embeddings + LLM scan
# or
export GEMINI_API_KEY=...          # Gemini embeddings
# or local-only (no API key):
pip install "./mcp-servers/agora-code[local]"
```

Without an API key, keyword search still works — only semantic recall degrades.

## MCP tools exposed

| Tool | Purpose | Topia skill that calls it |
|---|---|---|
| `store_learning` | Persist a non-obvious finding (decision, gotcha, fix) | `journal` |
| `recall_learnings` | Search past findings before starting work | `recall` |
| `complete_session` | Archive current session to long-term memory | `journal` (session-end) |
| `get_file_symbols` / `search_symbols` / `recall_file_history` / `list_sessions` / `get_memory_stats` | Symbol index, file history, stats | _(not wired in Topia)_ |

## How Topia uses it

Topia's memory is the `.topia/` files. agora-code is an optional extra. Only two skills mention it, each in one "Optional backends" section:

- `recall` calls `recall_learnings` and merges the results with the file results.
- `journal` calls `store_learning` after an ADR and `complete_session` at session end.

Both use it only if tools named `mcp__agora-memory__*` (or the plugin-scoped equivalent) are in the tool list. Otherwise they skip it without mentioning it. No other skill calls agora directly.

## Graceful degradation

1. **Detect availability**: the tools are in the tool list, or they are not.
2. **Fall back silently**: if unavailable, use the `.topia/` files.
3. **Never block**: do not BLOCK, WARN, or ask the user about a missing server.

## License + attribution

agora-code is Apache 2.0. The vendored copy preserves the upstream LICENSE. See [`mcp-servers/agora-code/NOTICE-TOPIA.md`](../../mcp-servers/agora-code/NOTICE-TOPIA.md) for full attribution and update procedure.

## Hook policy: do not run `agora-code install-hooks`

> **DO NOT run `agora-code install-hooks --claude-code`. Use Topia's hooks only.**

Both packages install handlers into `.claude/settings.json` on the same `PreToolUse` / `PostToolUse` events. Running both produces a fragile, two-owner hook chain that silently breaks when either side updates.

Topia's runtime layer (preflight, sentinel, completion-gate, quarantine) is the canonical hook installer here. agora-code's hooks (large-file auto-summary, prompt-injection of recall context, auto-checkpoint on Stop) are convenience features — useful, but not worth the breakage risk of mixing installers on the same channels.

| Concern | Decision |
|---|---|
| Topia's preflight / sentinel / completion-gate / quarantine | **Keep** (install via `topia hooks install`) |
| agora-code's `install-hooks --claude-code` | **Skip** |
| agora-code's MCP tools (`store_learning`, `recall_learnings`, etc.) | **Use** via the Optional backends sections in `recall` and `journal` |
| agora-code's `inject` on SessionStart | **Topia session-start hook** runs `agora-code inject --quiet` when MCP registered |
| agora-code's `summarize` CLI | **Available** — invoke from skills when reading large files |
| agora-code's `learn-from-commit` | **Opt-in** — `commit-memory` PostToolUse hook also calls it when `.topia/agora-commit-learn.flag` or `TOPIA_AGORA_COMMIT_LEARN=1` |

You avoid agora's full `install-hooks` chain (PreToolUse/PostToolUse collision with Topia discipline hooks). Session context injection and `.topia/` seeding are orchestrated by Topia instead.

## Caveats

- **Python dependency** — Topia is otherwise pure Node.js. Adding this MCP server introduces a Python 3.10+ runtime requirement for users who opt in.
- **Upstream drift** — agora-code is actively developed. Refresh the vendored copy periodically (see NOTICE-TOPIA.md).
