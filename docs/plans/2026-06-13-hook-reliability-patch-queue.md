# Design: Hook Reliability + agora-code Patch Queue (risk-tiered)

- **Status:** Approved (brainstorm) — ready for `topia:plan`
- **Date:** 2026-06-13
- **Source:** `docs/ideation/2026-06-12-topia-improvements-ideation.md` (ideas #1, #5, #6)
- **Mode:** brainstorm Discovery → "design all three as a committed bundle"
- **Chosen decomposition:** Option C — risk-tiered, ship-safe-first (2 waves)

## Problem

Three committed backlog items, two on the **hooks** axis and one on **memory**:

- **#1 Self-Healing Hook Reconciliation** — promote `detectStaleHooks()`
  (`hooks/session-start/index.cjs:183`, warn-only at lines 227–232) from
  warn→repair; add a launcher-shim dispatch ring buffer
  (`.topia/hook-flightrec.jsonl`, ~200 entries: hook name, resolved path, exit
  code, duration); add auto-finalize for installed-but-never-finalized machines.
- **#6 Hook Conformance CI Harness** — spawn all native hooks with per-platform
  fixture payloads, assert exit codes + output shape on windows-latest +
  ubuntu-latest. (`hooks/lib/cursor-io.cjs` and `scripts/scan-mangled-windows-dirs.js`
  exist precisely because these regressions recur; no CI gate fires them today.)
- **#5 agora-code Vendored Patch Queue** — keep the vendored tree
  (`mcp-servers/agora-code/`) pristine; store the Windows asyncio fix as
  committed `.patch` files applied as the sync's last step, failing loudly on
  rejected hunks.

## Keystone insight (drives the decomposition)

**The entire risk surface collapses to one operation: writing to
`~/.claude/settings.json`.** Everything else is additive / low-blast:

| Work | Blast radius |
|------|--------------|
| #1 stale detection | read-only (already exists) |
| #1 flight recorder | append-only to `.topia/` |
| #6 CI harness | pure test code, no runtime effect |
| #5 patch queue | vendored tree + sync path only |
| **#1 auto-repair** | **writes `~/.claude/settings.json`** |
| **#1 auto-finalize** | **writes `~/.claude/settings.json`** (finalize wires hooks) |

The risky write is exactly what #6 (CI conformance) exists to make safe. #1↔#6
also share a contract: the launcher shim's dispatch record schema is both the
flight-recorder format and the conformance harness's assertion target.

## Decomposition: 3 ideas → 2 waves

### Wave 1 — ship-safe (zero/low blast, ship now)
1. **Dispatch record schema** (FIRST task) — define the `hook-flightrec.jsonl`
   line schema so the recorder and the CI harness agree from day one. Designed
   *with* its first consumer (the recorder), not cold.
2. **Flight recorder** — launcher shim appends dispatch records (ring buffer,
   ~200) to `.topia/hook-flightrec.jsonl`.
3. **#6 CI conformance harness** — fixture matrix across native hooks ×
   platform contracts (Claude JSON events, Cursor strict-JSON-stdout,
   CRLF-tainted input, Windows paths); windows-latest + ubuntu-latest.
4. **#5 patch queue** — establish/confirm the sync path (no sync script exists
   in `scripts/` today — see wrinkle below), then apply committed `.patch`
   files as the sync's last step, failing loudly on rejected hunks.

**Wave 1 invariant:** append-only / test-only / vendored-only — **no
settings.json writes.** Keep `detectStaleHooks()` warn-only in Wave 1.

### Wave 2 — gated behind green Wave-1 CI + backup/opt-out design
5. **Auto-repair** — promote `detectStaleHooks()` to compute the desired hook
   set and atomically rewrite stale entries.
6. **Auto-finalize** — for installed-but-never-finalized machines.

**Wave 2 hard gate:** does not ship until Wave 1's CI harness is green.
Required safety design before any write:
- timestamped backup of settings.json before mutation;
- generation marker so user-authored hooks are never touched;
- idempotency (re-running is a no-op when already correct);
- opt-out flag.

## Wrinkle to resolve in plan (#5)

No agora-code sync script was found in `scripts/`. The patch queue presumes a
sync step to bolt onto. Plan must decide whether Wave 1 task #4 is "add patches
to an existing sync" or "build the sync path (even a documented manual rsync
wrapper) + patch-apply-as-last-step." Treat as a scope fork, not a blocker.

## Options considered

- **A — Feature-bundled (2 units):** #1+#6 as one "Hook Reliability" epic, #5
  standalone. Rejected as primary: lumps the high-blast settings.json write with
  zero-blast test code; the whole epic inherits the write's risk.
- **B — Contract-first (3 units):** dispatch schema as a standalone Unit 0 before
  any consumer. Rejected as primary: designing the contract cold (before a
  consumer exercises it) churns. C captures B's benefit by defining the schema
  *with* its first writer in Wave 1.
- **C — Risk-tiered (2 waves): CHOSEN.** Slices across all three by blast radius.
  ~80% of value ships immediately at near-zero risk; the single dangerous write
  is fenced behind the CI harness already on the menu.

**Hedge (when A would win instead):** if #1 must land as one atomic,
headline-able feature in a single release, pick A and gate the whole epic on the
risky write rather than shipping the safe 80% early.

## Risks plan must mitigate

1. **settings.json corruption** (Wave 2) — backup + generation marker +
   idempotency + opt-out; never touch non-Topia / user-authored hook entries.
2. **CI/runtime schema drift** — the dispatch record schema is one source of
   truth shared by recorder and harness; a schema change must update both.
3. **Patch-queue silent failure** (#5) — rejected hunks must fail loudly, not
   skip; this is the data-loss bug being retired, so silent skip = regression.
4. **Ordering violation** — Wave 2 writes must be physically unable to ship
   before Wave 1 CI is green (enforce via the gate, not convention).
