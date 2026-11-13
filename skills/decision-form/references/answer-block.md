# decision-form: spec and answer block reference

The generator and parser live in `scripts/decision-form.js`. The page runs the
same `formatAnswerBlock()` the parser is tested against, so the two cannot drift.

## Spec (input)

```json
{
  "id": "auth-rework",
  "title": "Auth rework: 6 calls",
  "intro": "Optional. Blank lines split paragraphs.",
  "decisions": [
    {
      "id": "store",
      "question": "Where do sessions live?",
      "context": "Optional extra line under the question.",
      "group": "Optional section heading",
      "options": [
        { "id": "redis", "label": "Redis", "detail": "Optional second line" },
        { "id": "db", "label": "Postgres table" }
      ],
      "default": "redis",
      "reason": "Already running in prod; no migration."
    }
  ]
}
```

| Field | Rule |
|---|---|
| `id` | Optional. Lowercase letters, digits, `-`, max 64. Defaults to a slug of `title`. Change it when options change. |
| `title` | Required. Becomes the page title. |
| `decisions` | 1–60 items. Split bigger batches into several forms. |
| `decisions[].id` | Optional. Letters, digits, `_`, `.`, `-`. Defaults to `d1`, `d2`, … |
| `decisions[].options` | 2–12 items. A plain string is a label and gets id `a`, `b`, `c`, … More than 6 options render as a dropdown. |
| `decisions[].default` | Required. An option id (or an exact label, which is mapped to its id). |
| `decisions[].reason` | Required. One line. Whitespace runs collapse to one space. |

The generator lists every problem at once (exit 3), so fix them in one pass.

## Answer block (output, v1)

```
TOPIA-DECISIONS v1 form=<form-id> count=<n>
<decision-id> = <option-id> | <status>[ | note: <json-string>]
...
END TOPIA-DECISIONS
```

- `<status>` is `default` (the recommended option) or `changed`.
- `note` is a JSON string literal, so quotes, `|`, newlines (`\n`) and Unicode are safe on one line.
- One line per decision, in form order. `count` equals the number of answer lines.

### Parse rules

1. Find the one line whose trimmed text starts with `TOPIA-DECISIONS`. Zero or several → error.
2. The header must match `TOPIA-DECISIONS v1 form=<id> count=<n>`. Any other version → error.
3. Read lines until a trimmed line equals `END TOPIA-DECISIONS`. No END → error (the paste was cut off).
4. Skip blank lines. Trim each line. Every other line must match
   `<id> = <id> | default|changed [| note: "<json>"]` (spaces around `=` and `|` optional).
5. The same decision twice → error. The number of answers must equal `count`.
6. Text outside the block (chat prose, a ```` ```text ```` fence from the `.md` download) is ignored.

With the spec (`<id>.spec.json`) the parser also checks:

- the form id matches;
- every decision exists and every choice is one of its options;
- no decision is missing;
- `status` matches the choice. A wrong status is corrected and reported as a warning, not an error.

### JSON download

```json
{ "format": "topia-decisions", "version": 1, "form": "auth-rework",
  "answers": [{ "id": "store", "choice": "redis", "status": "default" },
              { "id": "ttl", "choice": "7d", "status": "changed", "note": "Mobile users complained." }] }
```

`--parse` accepts the text block, the `.md` download, or this JSON. The checks are the same.

## Round trip

1. Claude writes the spec and runs `decision-form.js --spec spec.json --root . --json`.
2. The person opens the `url`. Recommended answers are already picked. They may change some and add notes.
3. **Copy answers** puts the block on the clipboard. If the browser blocks that, the page selects the block in a text box for Ctrl+C. **Download .md** and **Download .json** save the same answers.
4. The person pastes the block (or the file contents) into chat.
5. Claude saves the paste to a file and runs `decision-form.js --parse <file> --root . --json`. The saved spec is found by form id.
6. Claude echoes the changed answers and notes, then acts.

Answers also survive a page reload. The page keeps a draft in `localStorage` when the browser allows it, keyed by form id. **Reset to recommended** clears it.

## Browser notes

- The page sets `Content-Security-Policy: default-src 'none'`. It cannot load or send anything over the network.
- `navigator.clipboard` needs a secure context. Chromium treats `file://` as secure. Other browsers may not. The fallback chain is: Clipboard API, then `document.execCommand('copy')`, then a selected text box plus downloads.
- `localStorage` on `file://` differs by browser (shared across files in Chromium, per file or off elsewhere). The page works without it.
