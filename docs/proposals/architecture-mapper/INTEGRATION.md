# Proposal: bring `architecture-mapper` into Topia as a first-class skill

_Status: **promoted** (2026-06-10). Live skill at `skills/architecture-mapper/`.
This folder retains the original proposal, draft, and refresh spec for reference._

## Why

The `architecture-mapper` workflow currently lives as a standalone user
skill (`~/.claude/skills/architecture-mapper`) that installs 17 slash
commands + a tailored `CLAUDE.md` into a target repo. It works, but it sits
**outside** the toolchain: the commands don't travel with Topia, don't flow
to skill-topia on sync, and don't participate in the nexus (signals,
routing, gates).

Goal: make architecture-mapping a **built-in Topia skill** so the commands
stay with the tools and propagate to skill-topia through the normal
`sync-to-skill-topia` → `port-to-protopia` pipeline — while keeping every
**Protopia-specific** fact out of the generic skill.

## The separation (the important part)

There are two distinct kinds of "Protopia information." Keep them apart:

| Kind | Example | Where it lives | How it reaches skill-topia |
|---|---|---|---|
| **Branding / identifiers** | `linenoize/topia` → `protopia/skill-topia` | nowhere special — it's a transform | already automated by `scripts/port-to-protopia.mjs` during sync |
| **Stack instance / profile** | the 8 repos, their GitHub designations, inter-app connections, confirmed smells, the "local-dev harness is not architecture" rule | the **Protopia workspace** (`dev-stack`), as `protopia-architecture-profile.md` | **never** — it's applied at *runtime* when the skill maps Protopia; it is not plugin content |

So:

- **Generic skill** (this proposal) → goes into `topia/skills/architecture-mapper/`. Stack-neutral scaffold + per-stack "hunt hint" profiles (node-express-mongo, python-web, generic). Reusable for any codebase. Flows to skill-topia via sync; `port-to-protopia` rebrands its identifiers automatically.
- **Protopia stack profile** → stays in `dev-stack` (`docs/_templates/protopia-architecture-profile.md`). It is the *input* you feed the skill when you point it at the Protopia codebase — the way a `--profile` is applied, not code that ships in the plugin.

This is the same scaffold-vs-instance split the standalone skill already
uses internally (`references/stacks/*` are generic hints; the filled-in
`CLAUDE.md` is the instance). We're just relocating the scaffold into Topia
and naming the instance explicitly.

## Topia skill shape

Proposed `skills/architecture-mapper/SKILL.md` frontmatter (full draft in
`SKILL.draft.md`):

```yaml
name: architecture-mapper
metadata:
  layer: L2
  model: opus           # sonnet is fine for the refresh mode
  group: knowledge
  tools: "Read, Glob, Grep, Write, Edit, Bash"
  emit: architecture.mapped, docs.updated
  listen: codebase.scanned
```

- **L2 hub**, not L1: it orchestrates sub-passes but is itself invoked by
  orchestrators/other skills.
- **group: knowledge** — it produces a drillable knowledge base.
- **Reuses existing signals** to wire in cheaply: `listen: codebase.scanned`
  (emitted by `scanner`/`recon`, same as `improve-architecture`) and
  `emit: docs.updated` (already emitted by `docs`). The only **new** signal
  is `architecture.mapped`.
- Mirror agent at `agents/architecture-mapper.md` (read-mostly).

### 17 commands → modes, not 17 plugin commands

The standalone skill exposes 17 slash commands. Do **not** register 17
entries in Topia's command namespace. Fold them into **modes** of one skill:

- `/topia architecture-mapper` — full map (the `run-all` pipeline)
- `/topia architecture-mapper refresh` — **incremental** update after a code change (the post-merge command the dev team runs — see `refresh-arch-docs.md`)
- `/topia architecture-mapper index` / `report` — re-link / re-summarize only

The 16 individual passes (bootstrap, repo-inventory, module-map,
entry-trace, ui-surface-map, request-lifecycle, data-model-map,
background-jobs, integrations-map, steel-threads, workflows, data-flow,
flowchart, critic, index, report) become internal phases, carried as
`references/passes/*.md` rather than top-level commands.

## How it relates to existing skills (avoid overlap)

- **`recon` / `scanner`** — architecture-mapper *calls* these to scan; it
  must not reimplement scanning. (`listen: codebase.scanned`.)
- **`docs`** — generic "keep docs in sync." architecture-mapper's `refresh`
  mode is architecture-specific and must preserve the cross-link
  conventions (anchor slugs, confidence labels, clickable Mermaid,
  Backlinks). **Decision for you:** keep `refresh` as its own mode
  (recommended — `docs` doesn't know these conventions) vs. delegate to
  `docs`. The draft assumes its own mode.
- **`improve-architecture`** — read-only *refactor proposals*;
  architecture-mapper is read-only *mapping*. Complementary: map → improve.
  architecture-mapper should `Feed Into → improve-architecture`.
- **`onboard`** — generates `CLAUDE.md` + `.topia/` context.
  architecture-mapper produces a richer per-repo `CLAUDE.md` + a
  `docs/architecture/` knowledge base. **Decision for you:** have `onboard`
  *call* architecture-mapper when a repo lacks architecture docs, or have
  architecture-mapper feed `onboard`. They should not both author
  `CLAUDE.md` blindly.

## The `refresh` mode (post-merge updater)

`refresh-arch-docs.md` in this folder is the stack-neutral version of the
incremental updater. It scopes itself off git history
(`git log -1 -- docs/architecture` → diff to `HEAD`) and updates only the
docs whose subject actually changed. This is the command teams run **after
merging to the default branch** to keep the docs current without a full
re-map. As a Topia mode it becomes `/topia architecture-mapper refresh`.

## Promotion checklist (the actual integration, when you work on the plugin)

1. [x] Create `skills/architecture-mapper/` and move `SKILL.draft.md` → `SKILL.md`.
2. [x] Import the pass logic + stack profiles from `~/.claude/skills/architecture-mapper`:
       - 17 command bodies → `skills/architecture-mapper/references/passes/*.md`
       - `references/stacks/*.md` (node-express-mongo, python-web, generic) → `references/stacks/`
       - cross-linking conventions → `references/conventions.md`
3. [x] Add `agents/architecture-mapper.md` (mirror; read-mostly).
4. [x] Register the new `architecture.mapped` signal in the nexus so
       `validate-mesh.js` / `validate-nexus.js` pass; confirm
       `codebase.scanned` / `docs.updated` wiring.
5. [x] `node scripts/validate-skills.js && node scripts/validate-nexus.js && npm test`
6. [x] Bump stats (skill count → 71): `README.md`, `docs/index.html`,
       `.claude-plugin/plugin.json` description, `docs/SKILLS.md`, `docs/PULSES.md`.
7. [ ] Sync to the fork: `node scripts/sync-to-skill-topia.mjs --target C:/CodeBase/Protopia/skill-topia`
       (this runs `port-to-protopia.mjs` to rebrand, then verify + commit in the fork).

## Applying the Protopia profile (runtime, not plugin)

When you run the now-built-in skill against the Protopia codebase, feed it
`protopia-architecture-profile.md` from the dev-stack workspace. That file —
**and only that file** — carries the Protopia stack facts (repo map,
connections, smells, the local-dev-harness demarcation). The plugin stays
generic; Protopia is an instance applied on top.
