# Install Topia

## Claude Code (primary path)

Two steps in chat — **no terminal** for most users.

### Step 1 — Plugin

```text
/plugin marketplace add linenoize/topia
/plugin install topia@linenoize
```

Restart if `/topia:build` does not appear.

**You get:** 71 skills, plugin hooks, `.topia/` file memory.

**You do not get yet:** machine-wide dispatch hooks, customized team policy, agora-code MCP.

### Step 2 — Finalize (recommended)

```text
/topia finalize
```

**You get:** dispatch hooks globally, optional agora-code, optional gitignore, and **org-config interview** for teams.

| If you skip finalize | Effect |
|----------------------|--------|
| Skills | Still work via `/topia:*` |
| Dispatch hooks in other repos | **Not wired** — readiness/guardian won't auto-fire outside active plugin sessions |
| Team policy in gates | **Template only** — run `/topia org-config` later |
| agora-code | Not installed unless you do it manually |

Deep dive: [`INSTALL-CLAUDE-CODE.md`](INSTALL-CLAUDE-CODE.md) · [`commands/finalize.md`](../commands/finalize.md)

### Per project (each application repo)

| Order | Command | Purpose |
|-------|---------|---------|
| 1 | `/topia onboard` | Project context (`CLAUDE.md`, `.topia/` state) |
| 2 | `/topia org-config` | Team policy (if not done in finalize) |
| 3 | `/topia doctor` | Health check |

**Teams:** commit [`.topia/org/org.md`](../.topia/org/org.md) — see [`ORG-CONFIG.md`](ORG-CONFIG.md).

---

## Team policy (`org.md`)

Topia is built for **shared discipline**: one committed policy file drives what `guardian` and `readiness` block or warn on.

| For teams | Action |
|-----------|--------|
| Define reviewers, CVE SLAs, deploy windows | `/topia org-config` or finalize |
| Share across developers | `git add .topia/org/ && git commit` |
| Change policy | Edit `org.md`, re-run finalize or `topia setup --global` |

Without a configured `org.md`, organization checks in guardian/readiness are skipped or use the shipped template.

---

## Other IDEs (secondary)

Cursor, Windsurf, Codex, Antigravity, OpenCode, OpenClaw → **[INSTALL-NON-CLAUDE.md](INSTALL-NON-CLAUDE.md)**

Hybrid (Claude terminal inside Cursor/VS Code) → install plugin in Claude, then `init --platform cursor` in the project.

Install scope (user / project / local): [`INSTALL-SCOPES.md`](INSTALL-SCOPES.md)

---

## Finding the CLI

Only needed for non-Claude compile or contributors. See [INSTALL-NON-CLAUDE.md](INSTALL-NON-CLAUDE.md#finding-topia) or run `node "<path>/compiler/bin/topia.js" where`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Skills work but gates never auto-fire | Run `/topia finalize` (Step 2) |
| Team rules ignored | Run `/topia org-config`, commit `org.md`, refresh hooks |
| Cursor has no rules | `init --platform cursor` — plugin alone is not enough |

More: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)
