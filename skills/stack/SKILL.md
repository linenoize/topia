---
name: stack
description: "Use when a project runs on Docker Compose and someone wants to start, stop, rebuild or restart services, read container logs, check health, free disk space, write server.sh / server.ps1 start scripts, check .env against .env.example, or review which ports are published."
metadata:
  author: topia
  version: "0.1.0"
  layer: L2
  model: sonnet
  group: delivery
  tools: "Read, Write, Edit, Bash, Glob, Grep"
---

# stack

## Purpose

Run a local or self-hosted Docker Compose stack the same safe way every time. It finds the compose files, services, profiles and healthchecks. It picks the right command for the job: rebuild one service or all, restart or recreate, bounded logs, health status, safe prune. On request it writes a matching `server.sh` + `server.ps1` pair. It checks `.env` against `.env.example` by key name only. It flags published ports that should stay internal.

`deploy` ships to production behind test and security gates. `guardian-env` only reads the machine. `stack` is the day-to-day operator for a compose project. For writing or hardening Dockerfiles and compose files, the L4 `@Topia/devops` docker skill applies.

## Triggers

- `/topia stack`, `/topia-stack` or `topia:stack` — manual invocation
- Auto-trigger: the user asks to rebuild, restart, start, stop or check "the stack", "the containers" or "compose"
- Auto-trigger: the user pastes container logs, or asks why a service will not start
- Auto-trigger: the user asks for start/stop scripts, or whether `.env` has every key from `.env.example`

## Calls (outbound)

- `guardian-env` (L3): `docker compose` is missing, or a host port is already in use on start
- `debug` (L2): logs show an error or crash loop whose cause is not obvious
- `watchdog` (L3): health needs more than one curl (several endpoints, response times)

## Called By (inbound)

- `debug` (L2): a repro needs container logs, status, or a service restart
- `deploy` (L2): the target is a Docker Compose host (status, logs, rebuild after pull)
- `incident` (L2): containment by restarting one service, and logs for the timeline
- `onboard` (L2): the project has a compose file (detect services, check `.env` keys)
- `scaffold` (L1): the generated project ships a compose file (write the server scripts)
- User: `/topia stack` direct invocation

## Data Flow

### Feeds Into →

- `debug` (L2): bounded log excerpt + service state → root-cause input
- `incident` (L2): container state and restart timestamps → incident timeline
- `watchdog` (L3): published health URL → endpoint to monitor

### Fed By ←

- `guardian-env` (L3): Docker version and ports in use ← pre-flight before start
- `debug` (L2): diagnosis naming a service ← which service to rebuild

### Feedback Loops ↻

- `stack` ↔ `debug`: logs → diagnosis → rebuild one service → fresh logs confirm the fix

## Scripts

Paths below use `{scripts_dir}`. In Claude Code that is `${CLAUDE_SKILL_DIR}/scripts`.

| Script | Does |
|---|---|
| `stack-inspect.js` | Services, profiles, health, ports. Flags internal ports. Never prints env values. |
| `env-sync.js` | `.env` vs `.env.example` by key name. `--fix` appends missing keys with empty values. |
| `templates/server.sh`, `templates/server.ps1` | Start/build/restart/stop/logs/status/prune/env script pair. |

Node 18+, no dependencies. Exit codes: `references/exit-codes.md`. Command details: `references/compose-ops.md`.

## Workflow

### Step 1 — Detect

Run `node {scripts_dir}/stack-inspect.js --root <project>`. It reports compose files, services (image or build), profiles, healthchecks, `depends_on` and published ports. Exit 3 means no compose file. Exit 1 means `docker compose` failed; call `guardian-env` if Docker is missing.

If the project already has `server.sh` / `server.ps1` or a Makefile target, use those. They hold the project's own flags.

### Step 2 — Pick the operation

| Intent | Command | Why |
|---|---|---|
| Code changed in one built service | `build api` then `up -d --no-deps api` | Leaves the database and other services running |
| Code changed in several services | `up -d --build` | One pass |
| Compose file or `.env` changed | `up -d` | `restart` keeps the old config and old env |
| Process hung, config unchanged | `restart api` | Fastest |
| New upstream image | `pull api` then `up -d api` | `build` does not pull images |
| Logs | `logs --tail 200 --since 10m api` | Always bounded; no `-f` from an agent |
| Status / health | `ps --all`, then health (see reference) | `ps` alone hides exited containers |
| Stop | `down` (no `-v`) | Volumes keep the data |
| Free disk | `image prune -f`, `builder prune -f --filter until=24h` | No volume is touched |

All rows are `docker compose …` except the prune row, which is `docker …`. Add `-p`, `-f` and `--profile` flags the project needs.

### Step 3 — Run and verify

Run the command. Then run `docker compose ps --all` and check health. When services define healthchecks, prefer `up -d --wait`. Report what changed and what is healthy. Do not call a stack "up" from the `up` exit code alone.

### Step 4 — Read logs

Read the last 200 lines first, then widen with `--since`. Quote only the lines that matter. Mask anything that looks like a token or password. If the cause is not obvious, hand the excerpt and service name to `debug`.

### Step 5 — Check env keys

Run `node {scripts_dir}/env-sync.js --root <project>`. It prints `missing KEY` and `extra KEY` lines. It never compares values: two files with the same keys and different values are in sync. Only with the user's go-ahead, run it again with `--fix`. That asks first, then appends `KEY=` lines with empty values. Never open `.env` to read it. Never fill in values yourself.

### Step 6 — Apply the ports rule

Treat every `stack-inspect` port finding as WARN. A database, cache, queue, search engine or admin UI published on all interfaces is reachable from the network. On Linux, Docker's own firewall rules also bypass ufw. Propose one of two fixes. Use `expose: ["5432"]` if only other containers need it. Use `"127.0.0.1:5432:5432"` if host tools need it. Show the diff and ask before you edit the compose file. Publish only the ports users need.

### Step 7 — Write the script pair (on request only)

1. Copy `templates/server.sh` and `templates/server.ps1` next to the compose file. Use `STACK_ROOT` if they go in a subfolder.
2. Fill in the settings block: project name, compose files, profiles, health URL. Use what Step 1 found.
3. Run `chmod +x server.sh`. Add `*.sh text eol=lf` to `.gitattributes` so Windows checkouts keep LF.
4. Verify: `bash -n server.sh`. Run the PowerShell parser on `server.ps1` if `pwsh` exists. Run `./server.sh --dry-run build` and `.\server.ps1 build -DryRun`.
5. Tell the user the commands: `start`, `build [svc]`, `restart`, `stop`, `logs`, `status`, `prune`, `env`.

## Output Format

```
## Stack: [project]
- Compose: [files] | Profiles: [list or none]
- Services: [name (image|build, health)] ...
- Ran: [exact command(s)]
- Result: [running/healthy/unhealthy per service]
- Env keys: [in sync | missing: KEY, KEY | extra: KEY]
- Port findings: [none | service bind:host->container — fix]
- Scripts: [written paths + verify results | not requested]
- Next: [one line]
```

## Returns

| Field | Type | Description |
|---|---|---|
| `services` | list | Name, image or build, health, profiles, ports |
| `commands_run` | list | Exact commands, in order |
| `health` | map | Service → running / healthy / unhealthy / exited |
| `env_keys` | object | `missing[]`, `extra[]` key names; never values |
| `port_findings` | list | Service, category, bind, ports, suggested fix |
| `scripts_written` | list | Paths and their syntax-check result |
| `status` | enum | `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` |

## Constraints

1. MUST compare env files by key name only — values are secrets, and two values differing is normal (the user corrected this once already).
2. MUST NOT print `.env` contents, `docker compose config` without `--no-interpolate`, or `docker inspect` env blocks — each one dumps secrets into the transcript.
3. MUST NOT delete volumes (`down -v`, `volume prune`, `system prune --volumes`) unless the user asked for that in this request and named the project — volume data does not come back.
4. MUST bound every log read with `--tail` or `--since`, and MUST NOT use `logs -f` from an agent — unbounded logs flood context and follow mode never returns.
5. MUST rebuild a single changed service with `--no-deps` — rebuilding everything restarts the database for no reason.
6. MUST verify health after start or rebuild — an `up` exit code of 0 does not mean the app answers.
7. MUST ask before editing a compose file to change ports — some published ports are needed on purpose.

## Anti-Rationalization

| Excuse | Reality |
|---|---|
| "I'll diff the two env files to be thorough." | Diffing shows values. Run `env-sync.js`; it reads keys only. |
| "Disk is full, `docker system prune -a --volumes` is fastest." | It deletes databases in every project. Use the safe prune row. |
| "`restart` will pick up the new env var." | It will not. Use `up -d` to recreate. |
| "The port is fine, it's only my dev box." | Laptops join shared Wi-Fi. Bind to 127.0.0.1. |

## Nexus Gates

| Gate | Requires | If Missing |
|---|---|---|
| Stack known | `stack-inspect` ran, or a compose file was read | Run Step 1 first |
| Volume delete | User asked this turn and named the project | Refuse; offer the safe prune |
| Compose edit | User approved the shown diff | Report the finding only |
| Scripts written | User asked for scripts | Skip Step 7 |

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Secrets shown via `docker compose config` or `cat .env` | CRITICAL | Use `stack-inspect.js`; it renders with `--no-interpolate --no-env-resolution` and drops env blocks |
| Volume deleted by a "cleanup" | CRITICAL | Constraint 3; templates need the typed project name for `--volumes` |
| `restart` used after a `.env` change, so nothing changes | HIGH | Step 2 table: `up -d` recreates |
| Profiled services missed (`--profile` not set) | MEDIUM | `stack-inspect` reads all profiles; pass `--profile` when acting on them |
| Legacy `docker-compose` v1 binary only | MEDIUM | Use `docker-compose` with the same subcommands; `--wait` is not there |
| `server.sh` saved with CRLF on Windows | MEDIUM | `.gitattributes` rule in Step 7; test checks LF |
| PowerShell blocks the script (execution policy) | LOW | `powershell -ExecutionPolicy Bypass -File .\server.ps1 …` or `Unblock-File` |
| Multi-line `.env` values confuse a naive key grep | LOW | `env-sync.js` skips quoted multi-line bodies; template check is a quick warning only |

## Security Model

### Trust Boundaries
- Reads compose files, `.env.example`, and `.env` key names only.
- Writes `server.sh` / `server.ps1` and appends empty `KEY=` lines to `.env`, both only on request.
- Runs `docker` / `docker compose` commands for the detected project and the bundled Node scripts.

### This Skill Will NEVER
- Print, log or compare `.env` values.
- Delete volumes without an explicit request naming the project.
- Edit compose files without showing the diff first.

### Threat Surface
| Threat | Mitigated By |
|---|---|
| Secrets in transcript | Keys-only scripts; no `config` without `--no-interpolate` |
| Data loss | Safe prune by default; typed confirmation for volumes |
| Exposed internal services | Ports rule flags them; fix binds to 127.0.0.1 or uses `expose` |

## Self-Validation

```
SELF-VALIDATION (run before emitting output):
- [ ] No env value appears anywhere in my output or commands
- [ ] Every log command had --tail or --since; none had -f
- [ ] No volume-deleting command ran without the user's named request
- [ ] Health checked after any start/build/restart
- [ ] Scripts written (if any) passed bash -n, the PowerShell parse (if available) and a dry run
IF ANY check fails → fix before reporting done.
```

## Done When

- Stack detected: compose files, services, profiles, health
- Requested operation ran with the command from the Step 2 table
- Health verified and reported per service
- Env keys and port findings reported (keys only)
- Scripts written and verified, if requested
- Self-Validation checklist passed

## Cost Profile

~1,500–4,000 tokens per run. Most cost is log excerpts; keep them bounded. Sonnet, because command choice needs judgment but no deep design work.

**Scope guardrail**: Do not deploy to production, change application code, or rewrite Dockerfiles. Hand those to `deploy`, `fix` / `build`, or the `@Topia/devops` pack.
