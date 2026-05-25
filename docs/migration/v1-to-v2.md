# Migrating Topia v1 → v2.0

Topia v2.0 renames core skills and Nexus terminology. This is a **breaking** release.

## Skill ID changes

| v1 | v2 |
|----|-----|
| `sentinel` | `guardian` |
| `sentinel-env` | `guardian-env` |
| `preflight` | `readiness` |
| `graft` | `integrate` |
| `scout` | `recon` |

`scout` became `recon` (not `pulse`) because **Pulses** are async events between skills.

## Pulse ID changes

| v1 pulse | v2 pulse |
|----------|----------|
| `preflight.passed` | `readiness.passed` |
| `preflight.blocked` | `readiness.blocked` |
| `graft.complete` | `integrate.complete` |

`topia migrate-v1` rewrites these in `.topia/` state files along with skill IDs.

## Terminology

| v1 | v2 |
|----|-----|
| mesh | nexus |
| connections | synapses |
| signals | pulses |

CLI: `topia doctor --nexus` ( `--mesh` deprecated for one release).

## Migrate project state

```bash
node compiler/bin/topia.js migrate-v1
node compiler/bin/topia.js migrate-v1 --dry-run
```

Rewrites v1 skill names in `.topia/` files and writes `.topia/migrated-from-v1.flag`.

## Rebuild compiled output

After upgrading the package:

```bash
node compiler/bin/topia.js build --platform cursor
```

## Hooks

`topia hooks install` wires `readiness` and `guardian`. v1 dispatch names (`preflight`, `sentinel`) still work with a deprecation warning.

## From rune-kit

If you also use rune-kit, run `topia migrate-from-rune` and disable the rune-kit plugin. See [from-rune.md](from-rune.md).
