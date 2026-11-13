# Compose operations — command reference

> Loaded by `stack` when it needs exact flags. Every command below is safe to run
> as written unless marked **destructive**. Add `-p <project>`, `-f <file>` and
> `--profile <name>` when the project needs them.

## Detect

| Need | Command | Note |
|---|---|---|
| Services, profiles, health, ports | `node {scripts_dir}/stack-inspect.js --root .` | Renders with `--no-interpolate --no-env-resolution`; drops env blocks |
| Service names | `docker compose config --services` | Safe: names only |
| Profiles | `docker compose config --profiles` | Safe: names only |
| Named volumes | `docker compose config --volumes` | Safe: names only |
| Full config | `docker compose config --no-interpolate` | Still prints literal `environment:` values from the file. Prefer `stack-inspect` |

Never run plain `docker compose config`. It substitutes `.env` values into the output.

Compose picks up `compose.yaml`, `compose.yml`, `docker-compose.yaml` or `docker-compose.yml`, plus a matching `*.override.*` file. A project with only the old `docker-compose` (v1) binary uses the same subcommands, but has no `--wait`.

## Build and run

| Situation | Command |
|---|---|
| Rebuild one service, leave the rest | `docker compose build api && docker compose up -d --no-deps api` |
| Rebuild from scratch (cache suspected) | `docker compose build --no-cache api` |
| Rebuild everything | `docker compose up -d --build --remove-orphans` |
| Apply compose or `.env` edits | `docker compose up -d` (recreates only changed services) |
| Force a fresh container, same image | `docker compose up -d --force-recreate --no-deps api` |
| Pull newer images | `docker compose pull api && docker compose up -d api` |
| Restart in place | `docker compose restart api` (old config, old env) |
| Wait until healthy | `docker compose up -d --wait` (needs healthchecks; Compose v2.1+) |
| Stop one service | `docker compose stop api` |
| Stop the stack, keep data | `docker compose down --remove-orphans` |

`restart` is not a reload. Changed env vars, ports, images or mounts need `up -d`.

## Logs

| Need | Command |
|---|---|
| Recent lines | `docker compose logs --tail 200 api` |
| Since a time | `docker compose logs --since 10m api` (also `2026-01-31T09:00:00`) |
| With timestamps | `docker compose logs --tail 200 -t api` |
| A crash-looping container | `docker compose ps --all` then `docker compose logs --tail 100 api` |
| Search | pipe `--tail` output through `grep -i error` (bash) or `Select-String error` (PowerShell) |

From an agent, never use `-f` / `--follow`. It never returns. Mask tokens, passwords and cookies before quoting a line back.

## Status and health

| Need | Command |
|---|---|
| All containers, including exited | `docker compose ps --all` |
| Health of one container | `docker inspect --format "{{.State.Health.Status}}" <container>` |
| Why health fails | `docker inspect --format "{{json .State.Health.Log}}" <container>` |
| HTTP check (bash) | `curl -fsS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:8080/health` |
| HTTP check (PowerShell) | `(Invoke-WebRequest http://127.0.0.1:8080/health -UseBasicParsing -TimeoutSec 5).StatusCode` |
| Resource use | `docker stats --no-stream` |

Do not run `docker inspect` without `--format`. The full output includes the container's environment.

A healthcheck in compose looks like this:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  interval: 10s
  timeout: 3s
  retries: 5
  start_period: 20s
```

## Prune

| Level | Command | Removes |
|---|---|---|
| Safe (default) | `docker image prune -f` | Dangling images |
| Safe (default) | `docker builder prune -f --filter until=24h` | Build cache older than a day |
| Wider | `docker image prune -a -f --filter until=168h` | Unused images older than a week, all projects |
| **Destructive**, one project | `docker compose down --volumes` | This project's named volumes (databases) |
| **Destructive**, global | `docker volume prune`, `docker system prune --volumes` | Unused volumes of every project |

Run a destructive row only when the user asked for it in this request and named the project. List the volumes first with `docker compose config --volumes`. Check free space with `docker system df`.

## Ports rule

Published ports (`ports:`) listen on every host interface unless an IP is given. Internal services should not:

| Category | Examples | Container ports |
|---|---|---|
| db | postgres, mysql, mariadb, mongo, mssql, clickhouse | 5432, 3306, 27017, 1433, 8123 |
| cache | redis, valkey, memcached | 6379, 11211 |
| queue | rabbitmq, kafka, nats, zookeeper | 5672, 9092, 4222, 2181 |
| search | elasticsearch, opensearch, solr | 9200, 9300 |
| admin | adminer, pgadmin, phpmyadmin, mongo-express, portainer, rabbitmq management | 15672 and UI ports |

Fix, in order of preference:

```yaml
db:
  expose: ["5432"]              # only other containers need it
# or, when host tools need it:
db:
  ports: ["127.0.0.1:5432:5432"]
```

On Linux, Docker writes its own iptables rules, so ufw and firewalld do not block published ports. Binding to 127.0.0.1 is the reliable fix. A bind to a LAN address such as `192.0.2.10` is still reachable from that network.

## Platform notes

- **macOS** ships bash 3.2. The `server.sh` template avoids bash 4 features.
- **Windows**: use `server.ps1` from PowerShell, or `server.sh` from Git Bash. If PowerShell refuses to run it, use `powershell -ExecutionPolicy Bypass -File .\server.ps1 status` or `Unblock-File .\server.ps1`.
- **Line endings**: add `*.sh text eol=lf` to `.gitattributes`. A CRLF `server.sh` fails with `$'\r': command not found`.
- **WSL**: run Docker commands from the same side (WSL or Windows) that owns the Docker context.
