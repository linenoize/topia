# Vendored: agora-code

This directory contains a **vendored copy** of [`thebnbrkr/agora-code`](https://github.com/thebnbrkr/agora-code) — persistent memory and codebase intelligence for AI coding agents, exposed as an MCP server.

## Upstream

- **Source**: https://github.com/thebnbrkr/agora-code
- **License**: Apache License 2.0 (see [LICENSE](./LICENSE))
- **Vendored from**: `main` branch
- **Vendored on**: 2026-05-16

## What was vendored

Verbatim copy of the upstream files needed to run the MCP server:

```
agora_code/         # Python package — MCP server implementation
LICENSE             # Apache 2.0 (preserved from upstream)
pyproject.toml      # Python package metadata
pytest.ini          # Test config (kept for upstream parity)
.mcp.json           # MCP server launch config (used as template)
README.md           # Upstream README (for reference)
setup.sh            # Upstream setup script
```

Upstream files **not** vendored (project governance, IDE-specific hooks, screenshots, tests, docs): `CLAUDE.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, `.claude/`, `.cursor/`, `.gemini/`, `.github/`, `tests/`, `assets/`, `docs/`.

## License notice (Apache 2.0)

Per Apache License 2.0 section 4:

- This is a **redistribution** of agora-code with no modifications.
- The full text of the Apache License 2.0 is preserved at [`LICENSE`](./LICENSE).
- Original copyright notices in `agora_code/**.py` are preserved.
- No NOTICE file exists in upstream; none is added here.
- If you modify any file in `agora_code/`, mark the file as "Modified" per Apache 2.0 section 4(b).

## How Topia uses it

Topia treats agora-code as an **optional MCP server**. It is not invoked from the Topia build pipeline directly — instead, individual Topia skills (`journal`, `build`, `idea`, `neural-memory`) cross-reference agora-code's MCP tools when they're a better fit than Topia's built-in state files.

See [`docs/mcp-integrations/agora-code.md`](../../docs/mcp-integrations/agora-code.md) for the integration guide and the list of MCP tools Topia skills may call.

## Updating

To refresh from upstream:

```bash
cd /tmp
git clone --depth 1 https://github.com/thebnbrkr/agora-code.git
# Replace vendored contents (keep this NOTICE-TOPIA.md intact)
rsync -av --delete \
  --exclude=NOTICE-TOPIA.md \
  /tmp/agora-code/{agora_code,LICENSE,pyproject.toml,pytest.ini,.mcp.json,README.md,setup.sh} \
  mcp-servers/agora-code/
```

Record the new vendored date and upstream commit in this file's "Vendored on" line above.
