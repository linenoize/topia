# Contributing to Topia

Topia is an internal Topia Nexus. Contributions come from the team — there's no external community PR queue. The rules below keep the nexus disciplined as it grows.

## Ways to contribute

| Task | Location | Effort |
|------|----------|--------|
| **Report a bug** | Internal issue tracker | tiny |
| **Suggest an idea** | Internal issue tracker | tiny |
| **Improve a skill** | PR to `skills/<name>/SKILL.md` + references | medium |
| **Add a new skill** | PR creating `skills/<new-name>/` | large |
| **Improve docs** | PR to `docs/` or `README.md` | small |
| **Fix a compiler bug** | PR to `compiler/` | large |
| **New platform adapter** | PR to `compiler/adapters/hooks/` | large |

## Development process

1. **Clone the repo** locally.
2. **For large changes** — open an issue first to discuss the approach.
3. **Branch from `main`** with a descriptive name (e.g., `feat/new-skill-x` or `fix/compiler-typo`).
4. **Install dependencies**: `npm install`.
5. **Make your changes**.
6. **Run the CI check**: `npm run ci`. This runs:
   - **Linter** (Biome)
   - **Unit tests**
   - **Nexus integrity check** (`Topia doctor`)
7. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/).
8. **Open a PR** against `main`.

## Skill guidelines

Topia skills are more than just prompts. They are **interconnected behavioral specifications**.

1. **Follow the template**: Every skill MUST follow `docs/SKILL-TEMPLATE.md`.
2. **Nexus discipline**:
   - **L1 Orchestrators** handle the full workflow (e.g., `build`).
   - **L2 Workflow Hubs** handle specific domain tasks (e.g., `plan`, `debug`).
   - **L3 Utilities** are stateless and pure (e.g., `research`, `git`).
3. **Connections**: Define `Calls` and `Called By` to document how your skill fits into the nexus.
4. **Signals**: Use `emit` and `listen` for event-driven coordination.
5. **Constraints**: Use `MUST` / `MUST NOT` and `<HARD-GATE>` blocks for enforcement.

## L4 extension packs

Adding a domain pack? Read [`docs/CONTRIBUTING-L4.md`](docs/CONTRIBUTING-L4.md) — it lays out the 2-gate filter (domain coherence + core nexus integration).

## Compiler & adapters

The compiler transforms Markdown skills into platform-native formats (Claude Code, Cursor, Windsurf, etc.).

- **Parser**: Converts `SKILL.md` into an Internal Representation (IR).
- **Transforms**: 8 sequential stages that apply logic (cross-ref resolution, tool name mapping, etc.).
- **Adapters**: Take the transformed IR and write it to the platform's specific directory/file format.

If you are adding a new platform, read `docs/MULTI-PLATFORM.md` first.

## Style guide

- **JavaScript**: ES modules. No external dependencies if possible (Topia is built on Node.js built-ins).
- **Markdown**: GitHub-flavored. Keep `SKILL.md` files concise (< 400 lines).
- **Formatting**: We use Biome. Run `npm run format` before committing.
- **Tone**: Technical, direct, and disciplined. Avoid conversational filler in skills.

## Coding standards

- **ESM only**: Use `import/export`.
- **Pure functions**: Keep utility logic in `L3` stateless.
- **Causal language**: Use "Chose X because Y" in decisions and logs.

## Commit message types

- `feat:` A new feature or skill
- `fix:` A bug fix
- `docs:` Documentation only
- `style:` Formatting, missing semi-colons, etc.
- `refactor:` Refactoring code without functional change
- `perf:` Performance improvement
- `test:` Adding missing tests
- `chore:` Maintenance tasks (v-bumps, CI changes)

## Quality standards

- **Tests**: All logic in `compiler/` must have associated tests in `compiler/__tests__/`.
- **Nexus integrity**: `Topia doctor` must pass with zero errors.
- **Bug fixes**: A regression test proving the bug is fixed is mandatory.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (same as the project).
