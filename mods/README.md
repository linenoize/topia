# Claude Code mods

Six Claude Code function-hook features that ship inside the `topia` plugin. `hooks/hooks.json` loads them through `"modules": ["../mods/index.tsx"]`, next to Topia's command hooks. They are Claude Code only and not part of the npm package (`mods/` is outside `files` in `package.json`); a marketplace install clones the repo, so it gets them.

| Mod | `/mods` name · `userConfig` default | What it does | Commands |
|---|---|---|---|
| Git band | `git` · `gitBand` | Row above the prompt with changed / unpushed / behind counts and Commit, Commit & push, Push buttons; hidden when the tree is clean | — |
| Standing orders | `orders` · `standingOrders` | Per-project rules added to the system prompt: fan out to subagents, skipped/deferred ledger, logged hand-off scripts, commit when done. All off until turned on | `/orders [id] [on\|off]` |
| Remote hosts | `hosts` · `remoteHosts` (off by default) | Learns user/host/key path/port/sudo from successful `ssh` calls and lists them to the model. Kept per project, so one repo's hosts never reach another | `/hosts [forget user@host]` |
| Quiet reports | `quiet` · `quietReports` | Keeps Topia's session report, guardian advisory and install/Rune banners out of the model's context; status line with context %, cache %, cost, 5h limit | `/topia-activity` |
| Model preset | `model` · `modelPreset` | Remembers the model last used per project and switches to it at startup | `/model-preset [forget]` |
| Prompt routing | `routing` · `promptRouting`, `promptRoutingHint` | As you type, a row above the prompt names the Topia skills your wording points at (up to three, then the lead skill's usual hand-offs) and underlines the words that matched. After the turn, the row shows predicted vs ran: ✓ ran, ✗ did not, plus any other Topia skills that ran. `promptRoutingHint` also hands that reading to the model beside the prompt, never shown in the transcript | `/routing [on\|off]` |

## Turning mods on and off

`/mods` opens a pane: one row per mod with its switch (digit hotkeys), where its value comes from, and a **Save for** choice between *this project* and *all my projects*. From the prompt:

```text
/mods git off                 # for you, every project
/mods hosts on --project      # for this project only
/mods routing reset --project # drop this project's choice
/mods all reset --user        # back to the /config defaults
/mods forget-project          # forget this project's mod choices, standing orders, SSH hosts and model
```

Which value wins, highest first:

1. **locked**: a `/config` row your organization's policy fixes
2. **this project**: chosen with `--project` or in the pane
3. **you**: chosen with `/mods` for every project (`--user`, the default unless this project already has a choice for that mod)
4. **/config**: the `userConfig` switch, which is also the default

A change takes effect at once, with no reload: a band comes back, a status-line part goes, a system-prompt section is added or dropped (so flipping `orders`, `hosts` or `routing` mid-session changes the prompt and costs a cache miss). `/routing on|off` is kept as a shortcut for `/mods routing`. A mod's own command still answers when it is off, and says how to turn it back on.

**First run and recaps.** The first session in a project, and the first `onboard` run there, show a row above the prompt: one chip per mod (press to switch it for this project), **Keep**, **More…** (the pane) and **Don't ask in new projects**. After that a recap row lists what is on, at most every 10 sessions *and* 14 days, with **Got it** and **Don't remind me**. Neither shows in a non-interactive session or on a hot reload.

**What a value means.** Every value the mods draw (git counts, routing chips, mod switches and their sources, the mods row) carries a one-line description. It appears at the end of its row while the pointer rests on the value (a declarative hover reveal; a terminal that passes no pointer shows nothing) and under the band or pane while the value holds the focus (Tab or the arrows, or a click). Below 60 columns the hover lines are left out and only the focus line shows. The status line is plain text and takes neither, so its parts are explained in the `/mods` and `/topia-activity` panes.

## Where data lives

Everything the mods remember goes through `$.store`: a JSON file of the plugin's own under the user's Claude Code config directory (`~/.claude/plugins/store/`), never the project or the repo. Standing orders, SSH hosts, the model preset and a project's mod choices (`mods:<root>`, with whether it has been asked) are each keyed by project root; your all-projects choices are `mods:user` and the ask and recap preferences `mods:prefs`. `/mods forget-project` deletes everything kept for the current project. Prompt routing keeps no setting of its own; drafts and predictions stay in session memory, and the model hint names skills and matched keywords, never the prompt's text. SSH hosts are host, user, port, the key's *path* (never key material) and whether sudo worked; while `remoteHosts` is on they are sent to the model in that project's system prompt.

Test fixtures use reserved names only (`example.com`, `.test`, `203.0.113.0/24`), never a real host, user or path.

## Prompt routing

The keyword table is `lib/skill-routes.generated.ts`, written by `npm run generate:slash-aliases` from each skill's frontmatter and `compiler/lib/intent-keywords.js` (the one keyword source, shared with the compiled skill index). The same run writes `hooks/lib/skill-routes.json` for the `intent-router` hook, which scores with `hooks/lib/prompt-routing.cjs`, a Node port of `lib/prompt-routing.ts`. Edit the keywords or hand-off chains in `intent-keywords.js` and regenerate; Node tests fail when either checked-in table is stale or the two scorers disagree.

Where this module is loaded, the hook's suggestion block is dropped before the model reads it (whatever the switches), since the band and `promptRoutingHint` stand in for it; the hook's text reaches the model only on hosts without the mods.

Matching is whole words and phrases, case-insensitive, with plain endings (tests, fixed, adding). A keyword scores 3 a word, an L1 orchestrator 1 more, and a skill named outright (`/topia-debug`, `topia:debug`) wins. With no match the row stays hidden; it never guesses.

A chip's skill description shows at the end of the row under a resting pointer, and under the band when the chip takes the focus (ctrl+x tab, the arrows) or is clicked.

## Layout

- `index.tsx` — the hooks module: every `on(...)` and every call on `$`. A plugin registers each event once without a matcher, so `session.start`, `tool.call`, `turn.complete` and `prompt.compose` each run every mod's part in one hook, each part gated on whether its mod is on now. `claude plugin validate` only follows `$` into functions in the same file, which is why the engine-facing code is not split per mod.
- `lib/` — the logic `index.tsx` calls (parsers, prompt text, filters; `mod-settings.ts` for which mods are on, `value-help.ts` for what each drawn value means), with no `$`.
- `types/index.d.ts` — the `$.state` contract, all under the `topia` plugin; `.claude-plugin/plugin.json` names it as `types`.
- `tests/*.test.ts` — run by `claude plugin test`.

## Check

```sh
claude plugin validate .
claude plugin test .
```

The `*.test.ts` files run under `claude plugin test` only; the repo's `npm test` is scoped to `**/*.test.js` so it skips them.

To try local changes in a session: `claude --plugin-dir .` from the repo root.
