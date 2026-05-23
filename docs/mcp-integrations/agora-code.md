# MCP Integration: agora-code

Topia ships a vendored copy of [agora-code](https://github.com/thebnbrkr/agora-code) — a Python MCP server providing persistent memory, symbol indexing, and session tracking for AI coding agents. It lives at [`mcp-servers/agora-code/`](../../mcp-servers/agora-code/) and is **opt-in** — Topia works without it, but four skills (`journal`, `build`, `idea`, `neural-memory`) gain stronger cross-session memory when it's wired up.

## Why vendor it

| Concern | Topia's built-in approach | What agora-code adds |
|---|---|---|
| Session decisions | `.topia/decisions.md` (markdown append) | SQLite-backed, semantic-recall via embeddings |
| File context | Re-read on every session | Symbol index — function/class locations cached by line |
| Past learnings | Scan `.topia/*.md` files | `recall_learnings` with vector search |
| Large file reads | Read in full, burn context | Auto-summarize before Read fires (via hooks) |

agora-code is not a replacement — it's a **back-end upgrade** that 4 Topia skills can call when available.

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
| `recall_learnings` | Search past findings before starting work | `build`, `idea`, `neural-memory` |
| `get_file_symbols` | Indexed functions/classes for a file with line numbers | `neural-memory` (optional) |
| `search_symbols` | Search across all indexed symbols | `neural-memory` (optional) |
| `recall_file_history` | What changed in a file across past sessions | `neural-memory` (optional) |
| `complete_session` | Archive current session to long-term memory | `journal` (session-end) |
| `list_sessions` | Find past sessions | _(not yet wired in Topia)_ |
| `get_memory_stats` | DB usage stats | _(not yet wired in Topia)_ |

## How each Topia skill uses it

### `journal` — decision logging
When agora-code MCP is available, `journal` SHOULD call `store_learning` in addition to writing ADRs under `.topia/adr/` (and other journal-managed files). This makes the decision retrievable later via `recall_learnings`, not just by reading a file.

### `build` — pre-flight recall
`build` Step 0 SHOULD call `recall_learnings` with the task description before starting. If a similar feature or bug surfaces in past sessions, surface it to the user before re-implementing.

### `idea` — requirements pre-check
`idea` Step 1.2 (Neural Memory Retrieval) SHOULD call `recall_learnings` keyed on the user's prompt keywords. If a related idea, decision, or rejection already exists, surface it before running the 5-question elicitation.

### `neural-memory` — backend swap
`neural-memory` SHOULD prefer agora-code's MCP tools (`store_learning`, `recall_learnings`, `search_symbols`) over file-based fallbacks when the MCP server is registered. The skill's existing API stays the same; only the back-end changes.

## Graceful degradation

Every skill that references agora-code MUST treat the MCP server as **optional**:

1. **Detect availability**: check if `agora-memory` is listed in the active MCP servers before calling its tools.
2. **Fall back silently**: if unavailable, use Topia's built-in `.topia/` file-based persistence.
3. **Never block**: do not BLOCK or WARN if agora-code is missing — it's an upgrade, not a requirement.

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
| agora-code's MCP tools (`store_learning`, `recall_learnings`, etc.) | **Use** via skill cross-refs (already wired in `journal`, `build`, `idea`, `neural-memory`) |
| agora-code's `agora-code inject` / `summarize` CLI | **Available**, but invoke explicitly from skills, not as a hook |

You lose agora-code's automatic large-file summarization and auto-context injection. You gain a predictable, single-owner hook chain. Recall happens through deliberate `recall_learnings` calls from skill `## Triggers` instead of a global PreToolUse interception.

## Caveats

- **Python dependency** — Topia is otherwise pure Node.js. Adding this MCP server introduces a Python 3.10+ runtime requirement for users who opt in.
- **Upstream drift** — agora-code is actively developed. Refresh the vendored copy periodically (see NOTICE-TOPIA.md).
