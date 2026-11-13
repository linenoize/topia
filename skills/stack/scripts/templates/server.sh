#!/usr/bin/env bash
# server.sh — run this project's Docker Compose stack.
# Made from the Topia `stack` skill template. Pair: server.ps1 (Windows).
#
#   ./server.sh start   [service...]                 start (or apply config changes)
#   ./server.sh build   [service...] [--no-cache]    rebuild images, then recreate
#   ./server.sh restart [service...]                 restart containers as they are
#   ./server.sh stop    [service...]                 stop; no service = take the stack down
#   ./server.sh logs    [service...] [--since 10m] [--tail 200] [-f]
#   ./server.sh status                               containers, health, health URL
#   ./server.sh prune   [--volumes]                  free disk; volumes only when asked
#   ./server.sh env                                  .env vs .env.example, keys only
#
# Put --dry-run before the command to print the docker commands without running them.
# Works with bash 3.2+ (macOS), Linux and Git Bash on Windows.
set -euo pipefail

# ---- Settings. Environment variables override these. ------------------------
PROJECT_NAME="${STACK_PROJECT:-}"        # empty = Compose default (folder name)
COMPOSE_FILES="${STACK_COMPOSE_FILES:-}" # space-separated; empty = Compose auto-detect
PROFILES="${STACK_PROFILES:-}"           # space-separated Compose profiles to enable
ROOT="${STACK_ROOT:-.}"                  # compose folder, relative to this script
HEALTH_URL="${STACK_HEALTH_URL:-}"       # e.g. http://127.0.0.1:8080/health
LOG_TAIL="${STACK_LOG_TAIL:-200}"
DOCKER="${STACK_DOCKER:-docker}"
DRY_RUN="${STACK_DRY_RUN:-0}"
# -----------------------------------------------------------------------------

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SELF_DIR/$(basename "$0")"
case "$ROOT" in
  /*) cd "$ROOT" ;;
  *) cd "$SELF_DIR/$ROOT" ;;
esac

say() { printf '%s\n' "$*" >&2; }
die() {
  say "server.sh: $1"
  exit "${2:-1}"
}

usage() {
  sed -n '2,15p' "$SELF" | sed 's/^# \{0,1\}//'
}

compose() {
  local cmd=("$DOCKER" compose)
  local f p
  if [ -n "$PROJECT_NAME" ]; then cmd+=(-p "$PROJECT_NAME"); fi
  for f in $COMPOSE_FILES; do cmd+=(-f "$f"); done
  for p in $PROFILES; do cmd+=(--profile "$p"); done
  run "${cmd[@]}" "$@"
}

run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$*"
    return 0
  fi
  say "+ $*"
  "$@"
}

need_compose_file() {
  local f
  if [ -n "$COMPOSE_FILES" ]; then
    for f in $COMPOSE_FILES; do [ -f "$f" ] || die "compose file not found: $f" 3; done
    return 0
  fi
  for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    [ -f "$f" ] && return 0
  done
  die "no compose file here ($(pwd))" 3
}

# Print KEY names from a dotenv file. Values are never printed.
env_keys() {
  sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_.-]*)[[:space:]]*=.*/\2/p' "$1" | LC_ALL=C sort -u
}

check_env() {
  local example="" f missing
  for f in .env.example .env.sample .env.template; do
    if [ -f "$f" ]; then
      example="$f"
      break
    fi
  done
  [ -n "$example" ] || return 0
  if [ ! -f .env ]; then
    say "warning: .env is missing. Copy $example to .env and fill in the values."
    return 0
  fi
  missing="$(LC_ALL=C comm -23 <(env_keys "$example") <(env_keys .env) | tr '\n' ' ')"
  if [ -n "${missing// /}" ]; then
    say "warning: keys in $example but not in .env: $missing"
  else
    say "env: every key in $example is in .env"
  fi
}

cmd_start() {
  check_env
  compose up -d --remove-orphans "$@"
}

cmd_build() {
  local opts=() svcs=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-cache | --pull) opts+=("$1") ;;
      -*) die "build: unknown option $1" 2 ;;
      *) svcs+=("$1") ;;
    esac
    shift
  done
  check_env
  if [ ${#svcs[@]} -gt 0 ]; then
    # One service: rebuild it and recreate only it, not its dependencies.
    compose build ${opts[@]+"${opts[@]}"} "${svcs[@]}"
    compose up -d --no-deps "${svcs[@]}"
  else
    compose build ${opts[@]+"${opts[@]}"}
    compose up -d --remove-orphans
  fi
}

cmd_restart() {
  # restart keeps the old container config. After editing compose or .env, use start.
  compose restart "$@"
}

cmd_stop() {
  if [ $# -gt 0 ]; then
    compose stop "$@"
  else
    compose down --remove-orphans
  fi
}

cmd_logs() {
  local tail="$LOG_TAIL" since="" follow="" svcs=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --since) since="${2:?--since needs a value like 10m}"; shift ;;
      --tail | -n) tail="${2:?--tail needs a number}"; shift ;;
      -f | --follow) follow="--follow" ;;
      -*) die "logs: unknown option $1" 2 ;;
      *) svcs+=("$1") ;;
    esac
    shift
  done
  local args=(logs --tail "$tail")
  if [ -n "$since" ]; then args+=(--since "$since"); fi
  if [ -n "$follow" ]; then args+=("$follow"); fi
  compose "${args[@]}" ${svcs[@]+"${svcs[@]}"}
}

cmd_status() {
  compose ps --all
  if [ -n "$HEALTH_URL" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      printf 'curl %s\n' "$HEALTH_URL"
    elif command -v curl >/dev/null 2>&1; then
      local code
      code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
      say "health: $HEALTH_URL -> HTTP ${code:-000}"
      case "$code" in 2* | 3*) ;; *) return 1 ;; esac
    else
      say "health: curl not found; skipped $HEALTH_URL"
    fi
  fi
}

cmd_prune() {
  local volumes=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --volumes) volumes=1 ;;
      *) die "prune: unknown option $1" 2 ;;
    esac
    shift
  done
  # Safe by default: dangling images and old build cache. Data volumes stay.
  run "$DOCKER" image prune -f
  run "$DOCKER" builder prune -f --filter until=24h
  if [ "$volumes" = "1" ]; then
    local name="${PROJECT_NAME:-$(basename "$(pwd)")}" answer="${STACK_CONFIRM:-}"
    say "This deletes the named volumes of project '$name'. Their data is gone for good."
    compose config --volumes || true
    if [ -z "$answer" ] && [ -t 0 ]; then
      read -r -p "Type the project name ($name) to delete these volumes: " answer
    fi
    [ "$answer" = "$name" ] || die "volumes kept (confirmation did not match)" 5
    compose down --volumes --remove-orphans
  fi
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run | -n) DRY_RUN=1; shift ;;
      *) break ;;
    esac
  done
  local cmd="${1:-help}"
  if [ $# -gt 0 ]; then shift; fi
  case "$cmd" in
    help | -h | --help) usage; return 0 ;;
    env) check_env; return 0 ;;
    start | build | restart | stop | logs | status | prune) ;;
    *) say "server.sh: unknown command '$cmd'"; usage >&2; exit 2 ;;
  esac
  need_compose_file
  "cmd_$cmd" "$@"
}

main "$@"
