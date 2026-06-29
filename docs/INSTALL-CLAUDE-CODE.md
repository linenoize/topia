# Install Topia on Claude Code

**Step 1 + Step 2** in chat. No terminal required for the standard path.

Hub: [`INSTALL.md`](INSTALL.md)

---

## Step 1 — Install the plugin

```text
/plugin marketplace add linenoize/topia
/plugin install topia@linenoize
```

Restart Claude Code if `/topia:build` does not appear.

### What Step 1 gives you

- All 71 skills (`/topia:build`, `/topia:plan`, …) and `/topia` router
- 66 subagents
- 15 **plugin** hooks (session-start, secrets-scan, quarantine, metrics, …)
- File-based memory in `.topia/` after onboard

### What Step 1 does **not** give you

| Missing until Step 2 | Practical impact |
|----------------------|------------------|
| Dispatch hooks in `~/.claude/settings.json` | `readiness` / `guardian` may **not** run automatically in repos where the plugin isn't active |
| Custom `.topia/org/org.md` | Security and review gates use **no org policy** or the generic template |
| agora-code MCP | No cross-project semantic memory (file `.topia/` only) |

You can invoke skills manually; you lose **automatic, cross-repo discipline** and **team-specific gates**.

---

## Step 2 — Finalize (run this next)

```text
/topia finalize
```

Treat this as **part of install**, not an optional extra. Skip only if you are doing a quick trial and accept the gaps above.

Finalize enables (you choose in the prompt):

| Option | Default | What it does |
|--------|---------|--------------|
| System-wide dispatch hooks | **On (recommended)** | `readiness`, `guardian`, `completion-gate`, `dependency-doctor` globally, gentle preset |
| Team org policy | **On for teams** | Runs `/topia org-config` → writes `.topia/org/org.md` |
| agora-code MCP | Off unless you want it | Python 3.10+ persistent memory |
| Project `.gitignore` | Off unless you want it | Topia ignore rules in current repo |

Flags: `--strict`, `--skip-agora`, `--skip-org`, `--all`, `--reset`, `--dismiss`

Contract: [`commands/finalize.md`](../commands/finalize.md)

After finalize, **restart Claude Code** so dispatch hooks load.

---

## Per project (each repo)

Do this **in every codebase** you work on:

```text
/topia onboard
/topia org-config
/topia doctor
```

| Command | When | Output |
|---------|------|--------|
| `/topia onboard` | First time in repo | `CLAUDE.md`, `.topia/conventions.md`, progress, etc. |
| `/topia org-config` | Teams (or if skipped in finalize) | `.topia/org/org.md` — **commit this for teams** |
| `/topia doctor` | After setup or when unsure | Health + nexus report |

If `.rune/` exists: `/topia migrate-from-rune` first.

---

## Teams and `org.md`

[`org.md`](../.topia/org/org.md) is the **committed contract** between your team and Topia's gates:

- Who can override a block?
- How many reviewers on a PR?
- CVE and deploy SLAs?
- Strict vs moderate governance?

`/topia org-config` asks these questions and writes the file. Without it, `guardian` and `readiness` log "no org config" and skip organization enforcement.

Read: [`ORG-CONFIG.md`](ORG-CONFIG.md)

---

## Claude Desktop

Same `/plugin` commands when the marketplace is available. If plugins are unavailable, use Claude Code or [`INSTALL-NON-CLAUDE.md`](INSTALL-NON-CLAUDE.md).

---

## Skill names

| Surface | Example |
|---------|---------|
| Skills | `/topia:build`, `/topia:org-config` |
| Router | `/topia build`, `/topia finalize` |

---

## Advanced (terminal)

Plugin cache CLI, clone install, CI: see previous sections in this file under **CLI from plugin cache** and **CLI alternative (clone)** — unchanged from v3.2.x docs.

**Do not use** `npx @linenoize/topia` unless published to your npm registry.
