# stack — exit codes

> Follows the Topia script contract (`skill-forge` Phase 5.25). Codes 5+ are skill-specific.

## env-sync.js

| Code | Meaning | Caller response |
|---|---|---|
| 0 | Every example key is in `.env` (extra keys are only reported), or `--fix` added the missing ones | Continue |
| 1 | Unexpected runtime error | Report; retry once |
| 2 | Usage error (bad flag, or `--fix` without a terminal and without `--yes`) | Fix the call; do not retry as is |
| 3 | No example file (`.env.example`, `.env.sample`, `.env.template`, `.env.dist`) | Tell the user; nothing to compare |
| 5 | Keys missing from `.env` (or `.env` absent) | Report the key names; offer `--fix` |

Default stdout: one finding per line (`missing KEY`, `extra KEY`, `duplicate KEY`, `unparsed-line N`). After a successful `--fix`, stdout is the path of the written file. Summary goes to stderr. `--json` prints one JSON object.

## stack-inspect.js

| Code | Meaning | Caller response |
|---|---|---|
| 0 | Stack described, no port findings | Continue |
| 1 | `docker compose config` failed, or Docker is missing | Show the masked error; call `guardian-env` if Docker is missing |
| 2 | Usage error or invalid `--input` JSON | Fix the call |
| 3 | No compose file found | Ask where the stack lives |
| 5 | Port findings | Report each one with its fix; ask before editing |

## server.sh / server.ps1

| Code | Meaning |
|---|---|
| 0 | Done |
| 1 | A docker command failed, or the health URL did not answer 2xx/3xx |
| 2 | Unknown command or option |
| 3 | No compose file next to the script (or under `STACK_ROOT`) |
| 5 | `prune --volumes` refused: the typed project name did not match |
| other | Passed through from `docker compose` |
