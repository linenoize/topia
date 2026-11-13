# docs show-and-tell: walkthrough spec

`scripts/build-walkthrough.js` renders this spec as Markdown (default) or one
self-contained HTML file (`--format html`). The HTML matches the decision-form
page style, embeds screenshots as data URIs, and blocks all network access with a
CSP. It needs no JavaScript.

## Spec

```json
{
  "id": "decision-form",
  "title": "Decision forms and show-and-tell",
  "summary": "What changed and why, in two to four sentences. `code` spans render as code.",
  "range": "v3.12.0..HEAD",
  "changes": [
    {
      "what": "New decision-form skill.",
      "why": "Batches of 5+ questions were answered as long numbered replies.",
      "files": ["skills/decision-form/SKILL.md"],
      "commits": ["abc1234"]
    }
  ],
  "tryIt": [
    { "step": "Build the sample form.", "command": "node skills/decision-form/scripts/decision-form.js --spec spec.json", "expect": "Two paths print." }
  ],
  "lookFor": ["The recommended option is already picked."],
  "limits": ["Clipboard copy on file:// depends on the browser; the page falls back to a selected text box."],
  "screenshots": [{ "path": ".topia/screens/form.png", "caption": "The form at phone width" }]
}
```

| Field | Rule |
|---|---|
| `id` | Optional. Lowercase slug. Defaults to a slug of `title`. Names the output file. |
| `summary` | Required. Blank lines split paragraphs. |
| `range` | Optional but preferred. Any `git rev-list` range. Cited commits must fall inside it, and a Commits section is added from `git log`. |
| `changes[]` | Required, non-empty. Each needs `what`, `why`, and at least one of `files` / `commits`. |
| `tryIt[]` | Required, non-empty. A string, or `{ step, command?, expect? }`. Only steps you ran. |
| `lookFor[]` | Required array. May be empty. |
| `limits[]` | Required array. Empty renders "None found while testing". Put untried steps and missing screenshots here. |
| `screenshots[]` | Optional. `png`, `jpg`, `gif` or `webp`, up to 5 MB each, path relative to `--root`. |

## Evidence check

Unless `--skip-verify` is passed, the script fails with exit 3 when:

- a change cites no files and no commits;
- a commit does not resolve in `--root`, or falls outside `range`;
- a file neither exists on disk nor appears in `git diff --name-only <range>` (deleted files count when they are in the diff);
- `range` does not resolve;
- a screenshot is missing or too large.

`--skip-verify` prints a warning. Say so to the person when you share a walkthrough built that way.

## Exit codes

0 ok · 1 could not read or write a file · 2 usage error · 3 invalid spec or evidence check failed.
