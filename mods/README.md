# Claude Code mods

Five Claude Code function-hook features that ship inside the `topia` plugin. `hooks/hooks.json` loads them through `"modules": ["../mods/index.tsx"]`, next to Topia's command hooks. They are Claude Code only and not part of the npm package (`mods/` is outside `files` in `package.json`); a marketplace install clones the repo, so it gets them.

| Mod | `userConfig` switch | What it does | Commands |
|---|---|---|---|
| Git band | `gitBand` | Row above the prompt with changed / unpushed / behind counts and Commit, Commit & push, Push buttons; hidden when the tree is clean | — |
| Standing orders | `standingOrders` | Per-project rules added to the system prompt: fan out to subagents, skipped/deferred ledger, logged hand-off scripts, commit when done. All off until turned on | `/orders [id] [on\|off]` |
| Remote hosts | `remoteHosts` (off by default) | Learns user/host/key path/port/sudo from successful `ssh` calls and lists them to the model. Kept per project, so one repo's hosts never reach another | `/hosts [forget user@host]` |
| Quiet reports | `quietReports` | Keeps Topia's session report, guardian advisory and install/Rune banners out of the model's context; status line with context %, cache %, cost, 5h limit | `/topia-activity` |
| Model preset | `modelPreset` | Remembers the model last used per project and switches to it at startup | `/model-preset [forget]` |

Every switch but `remoteHosts` defaults to on. Turn one off in `/config` (the plugin's rows), or in settings under `pluginConfigs.topia.options`; a change reloads the module.

## Where data lives

Everything the mods remember goes through `$.store`: a JSON file of the plugin's own under the user's Claude Code config directory (`~/.claude/plugins/store/`), never the project or the repo. Standing orders, SSH hosts and the model preset are each keyed by project root. SSH hosts are host, user, port, the key's *path* (never key material) and whether sudo worked; while `remoteHosts` is on they are sent to the model in that project's system prompt.

Test fixtures use reserved names only (`example.com`, `.test`, `203.0.113.0/24`), never a real host, user or path.

## Layout

- `index.tsx` — the hooks module: every `on(...)` and every call on `$`. A plugin registers each event once without a matcher, so `session.start`, `tool.call`, `turn.complete` and `prompt.compose` each run the enabled mods' parts in one hook. `claude plugin validate` only follows `$` into functions in the same file, which is why the engine-facing code is not split per mod.
- `lib/` — the logic `index.tsx` calls (parsers, prompt text, filters), with no `$`.
- `types/index.d.ts` — the `$.state` contract, all under the `topia` plugin; `.claude-plugin/plugin.json` names it as `types`.
- `tests/*.test.ts` — run by `claude plugin test`.

## Check

```sh
claude plugin validate .
claude plugin test .
```

The `*.test.ts` files run under `claude plugin test` only; the repo's `npm test` is scoped to `**/*.test.js` so it skips them.

To try local changes in a session: `claude --plugin-dir .` from the repo root.
