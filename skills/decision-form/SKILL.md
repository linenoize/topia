---
name: decision-form
description: "Use when five or more related decisions are waiting on the person at once, or when they ask for a form, checklist or one page to answer questions on. Not for one or two questions, which belong in chat."
metadata:
  author: topia
  version: "0.1.0"
  layer: L3
  model: sonnet
  group: reasoning
  tools: "Read, Write, Bash"
---

# decision-form

## Purpose

Turns a batch of open decisions into one HTML file the person answers in a browser. Each decision shows its options with the recommended one already picked and a one-line reason. The person changes what they disagree with, adds notes, and presses **Copy answers**. They paste one short block back into chat, and Claude parses it exactly.

This replaces long numbered replies to long numbered question lists. Accepting every recommendation costs the person one click and one paste.

The `decisions` standing order asks one decision at a time. This skill is the batch path for when there are many.

## Triggers

- Five or more related decisions are open, each with clear options
- The person asks: "give me a form", "put these in a page", "let me pick in a browser"
- `/topia decision-form` (manual)

Below five decisions, ask in chat with a recommended default instead.

## Called By (inbound)

- `idea` (L2): after the 5 Questions, when scope or NFR choices leave 5+ open picks
- `plan` (L2): when a plan has 5+ open choices that block the phase files
- User: `/topia decision-form`

## Calls (outbound)

None. This is a pure L3 utility.

## Data Flow

### Feeds Into →

- `journal` (L3): parsed answers that meet the ADR gate → ADRs (the answers carry the person's notes as rationale)
- `plan` / `idea` (L2): the parsed answer list → the next step of the caller's workflow

### Fed By ←

- `idea` / `plan` (L2): the open decisions, their options, and Claude's recommendation for each

## Workflow

### Step 1: Check it fits

- Count the open decisions. Under 5 and not asked for → ask in chat. Stop here.
- Drop any decision you can answer from the repo, the person's earlier words, or `.topia/` notes. Asking what you can infer wastes their attention.
- Every decision needs 2–12 discrete options. An open question ("what should it be called?") gets options you propose plus an "Other (say in note)" option.

### Step 2: Write the spec

Save a JSON spec to the scratchpad or `.topia/decision-form/`. Shape, in short:

```json
{ "id": "auth-rework", "title": "Auth rework: 6 calls", "intro": "optional",
  "decisions": [{ "id": "store", "question": "Where do sessions live?",
    "options": [{ "id": "redis", "label": "Redis" }, { "id": "db", "label": "Postgres table" }],
    "default": "redis", "reason": "Already running in prod; no migration.", "group": "optional" }] }
```

Full field list and limits: `references/answer-block.md`. Rules that matter:

- `reason` is one specific line. "Best practice" is not a reason. Name the fact that decides it.
- Option ids are short and stable (`redis`, not `option-1-redis-cluster`). Strings become `a`, `b`, `c`.
- Order decisions so dependent ones come after the ones they depend on. Use `group` for sections.

### Step 3: Generate the file

```bash
node {scripts_dir}/decision-form.js --spec <spec.json> --root <project-root> --json
```

`{scripts_dir}` is this skill's `scripts/` folder (`${CLAUDE_SKILL_DIR}/scripts` in Claude Code). It writes `.topia/decision-form/<id>.html` and `<id>.spec.json`. It warns on stderr if git would commit them. If so, tell the person and point them to `topia doctor`. Do not edit their `.gitignore` yourself.

Give the person the `url` from the JSON output and one line: "Recommended answers are picked. Change what you disagree with, then Copy answers and paste here."

### Step 4: Read the answers

When a `TOPIA-DECISIONS` block (or the `.md`/`.json` download) comes back:

```bash
node {scripts_dir}/decision-form.js --parse <file-with-the-paste> --root <project-root> --json
```

It finds `<id>.spec.json` by the form id and checks every id and option. You can also read the block by hand using the grammar in `references/answer-block.md`. If the parser fails, quote its error and ask for a fresh copy. Never guess a cut-off block.

### Step 5: Confirm and act

Reply with one line per **changed** answer and every note, then "All other answers: as recommended." Act on the answers. Hand load-bearing ones to `journal` as ADRs.

## Output Format

Answer block the person pastes (grammar: `references/answer-block.md`):

```
TOPIA-DECISIONS v1 form=auth-rework count=3
store = redis | default
ttl = 7d | changed | note: "Mobile users complained about 24h."
mfa = later | default
END TOPIA-DECISIONS
```

Claude's confirmation:

```
Got 3 answers for auth-rework.
- ttl → 7 days (changed). Note: "Mobile users complained about 24h."
All other answers: as recommended.
```

## Returns

| Artifact | Format | Location |
|----------|--------|----------|
| Decision form | Self-contained HTML | `.topia/decision-form/<id>.html` |
| Normalized spec | JSON | `.topia/decision-form/<id>.spec.json` |
| Parsed answers | JSON (`--parse --json`) | stdout |
| `status` | enum | `FORM_SENT` / `ANSWERS_PARSED` / `ASKED_IN_CHAT` (under 5 decisions) |

## Constraints

1. MUST preselect a recommended option with a one-line reason for every decision. A form without recommendations makes the person do all the work.
2. MUST NOT build a form for fewer than 5 decisions unless the person asked for one. Short lists are faster in chat.
3. MUST parse answers with the shipped parser or its exact grammar. Never infer an answer from a malformed or cut-off block. Ask for a fresh copy.
4. MUST NOT put secrets, credentials or personal data in a spec. The file sits on disk in `.topia/`.
5. MUST NOT edit the project's `.gitignore` from this skill. Report the warning instead.
6. MUST confirm changed answers and notes back to the person before acting on them.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Vague reasons ("recommended", "best practice") so the person cannot judge | HIGH | Step 2 rule: name the deciding fact in the reason |
| Block pasted twice, or cut off by the chat box | HIGH | Parser rejects two blocks, a missing END line, and a wrong `count=` |
| Spec changed after the form was sent | MEDIUM | Same id + changed options → parser rejects unknown option ids. Change the form `id` when options change |
| Clipboard blocked on a `file://` page | MEDIUM | Page falls back to `execCommand('copy')`, then selects the block for Ctrl+C, and offers `.md`/`.json` downloads |
| Form used for decisions Claude could infer | MEDIUM | Step 1: drop inferable decisions first |
| `.topia/` not gitignored, so forms get committed | LOW | Generator warns via `git check-ignore`; point to `topia doctor` |

## Self-Validation

```
SELF-VALIDATION (run before sending the form):
- [ ] 5+ decisions, or the person asked for a form
- [ ] every reason names a concrete fact, not a generic virtue
- [ ] no decision is answerable from the repo or earlier messages
- [ ] generator exited 0; the url points at .topia/decision-form/<id>.html
SELF-VALIDATION (run after answers arrive):
- [ ] --parse exited 0 against the saved spec (or the grammar was applied by hand with no guessing)
- [ ] every changed answer and every note is echoed back
```

## Done When

- Form generated and its path or URL given to the person, or the decisions were asked in chat because there were fewer than 5
- Answer block parsed with no errors and checked against the spec
- Changed answers and notes confirmed back in one short message
- Self-Validation checklist passed

## Cost Profile

~500–1500 tokens to write a spec of 5–15 decisions. Parsing is one script run. The person's reply shrinks from paragraphs to one block of about 40 characters per decision.

**Scope guardrail:** decision-form collects decisions. It does not make them for the person, and it does not act on them before they are confirmed.
