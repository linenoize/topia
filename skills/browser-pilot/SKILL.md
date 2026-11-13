---
name: browser-pilot
description: "Use when a UI change should be checked in a real browser: 'does the login page work now', 'click through the signup flow', 'screenshot the dashboard', 'any console errors?'. Uses whichever browser tools are connected (Playwright, Claude in Chrome) and reports with screenshots."
metadata:
  author: topia
  version: "0.2.0"
  layer: L3
  model: sonnet
  group: media
  tools: "Read, Bash, Glob, Grep"
---

# browser-pilot

## Purpose

Verify a UI change in a real browser. Open the page, read its structure, click through the flow, capture screenshots and console errors, and report what works and what does not.

browser-pilot does not depend on one browser server. It uses whichever browser tools the session has: the Playwright plugin, a Playwright server under another name, or Claude in Chrome.

## Called By (inbound)

- `test` (L2): e2e and visual testing
- `deploy` (L2): verify live deployment
- `debug` (L2): capture browser console errors
- `marketing` (L2): screenshot for assets
- `launch` (L1): verify live site after deployment
- `perf` (L2): Lighthouse / Core Web Vitals measurement
- `audit` (L2): visual verification during quality assessment
- `docs` (L2): screenshots for a show-and-tell walkthrough of a UI change

## Calls (outbound)

None — pure L3 utility using whatever browser MCP tools are connected.

## Executable Instructions

### Step 0: Find the Browser Tools

Tool names carry a server prefix that differs between installs (`mcp__plugin_playwright_playwright__`, `mcp__playwright__`, `mcp__claude-in-chrome__`, and others). Never assume one. Find the tools by what they end with:

1. Look at the tools available in this session. If any are deferred, search for them first (ToolSearch in Claude Code, for example `browser_navigate` or `browser_snapshot`), and load the whole set in one call.
2. Pick one family and stay with it for the whole session:

| Action | Playwright family (any prefix) | Claude in Chrome family |
|---|---|---|
| Open URL | `*browser_navigate` | `*navigate` (open a tab first with `*tabs_create_mcp`; `*tabs_context_mcp` lists tabs) |
| Page structure | `*browser_snapshot` | `*read_page` or `*find` |
| Click / type | `*browser_click`, `*browser_type` | `*computer` |
| Fill form | `*browser_fill_form` | `*form_input` |
| Select option | `*browser_select_option` | `*form_input` |
| Go back | `*browser_navigate_back` | `*navigate` with the previous URL |
| Screenshot | `*browser_take_screenshot` | `*computer` (screenshot action) |
| Console errors | `*browser_console_messages` | `*read_console_messages` |
| Close | `*browser_close` | `*tabs_close_mcp` (close only the tabs you opened) |

3. If Claude in Chrome is the family and a `claude-in-chrome` skill is listed, load it before the first call.
4. If no browser tools exist, stop and report `NO_BROWSER_TOOLS`. Suggest installing the Playwright plugin or connecting Claude in Chrome. Do not fall back to guessing from source code and calling it a browser check.

The steps below use the Playwright names. With Claude in Chrome, use the matching tool from the table.

### Step 1: Receive Task

Accept input from the calling skill or the user:
- `url` — target URL to open (for a local change, the dev server URL)
- `task` — what to check: `screenshot` | `check_elements` | `fill_form` | `test_flow` | `console_errors`
- `interactions` — optional list of actions (click X, type Y into Z, etc.)
- `expected` — what the change should look like or do, so the report can say pass or fail

If the URL is a local dev server, confirm it is running first (for example with `curl -sI <url>`). If it is not, say so and ask how it is started instead of reporting the page as broken.

### Step 2: Navigate

Open the target URL with the navigate tool:

```
browser_navigate({ url: "<url>" })
```

Wait for the page to load. If navigation fails (timeout or error), report UNREACHABLE and stop.

### Step 3: Snapshot

Capture the accessibility tree to understand page structure:

```
browser_snapshot()
```

Use the snapshot to:
- Identify interactive elements (buttons, inputs, links)
- Find the elements the change touched
- Detect accessibility issues (missing labels, roles)

### Step 4: Interact

Perform the interactions the task needs:

- **Click**: `browser_click({ ref: "<ref>", element: "<description>" })`
- **Type**: `browser_type({ ref: "<ref>", text: "<value>" })`
- **Fill form**: `browser_fill_form({ fields: [...] })`
- **Navigate back**: `browser_navigate_back()`
- **Select option**: `browser_select_option({ ref: "<ref>", values: [...] })`

Argument names differ between families. Read the loaded tool's schema rather than copying these calls.

Limit: max 20 interactions per session. If the task needs more, stop and report partial results.

After each interaction, take a new snapshot to confirm the result before going on.

### Step 5: Screenshot and Console

Capture visual evidence:

```
browser_take_screenshot({ type: "png" })
```

For full-page capture (landing pages, long content), pass the full-page option if the tool has one. Save with a descriptive filename if the tool takes a `filename`.

Read console messages and note errors and warnings that appeared during the flow.

### Step 6: Report

Compile findings into a structured report:

```
## Browser Report: [url]

- **Task**: [task description]
- **Browser tools**: [family used, e.g. Playwright plugin | Claude in Chrome]
- **Status**: SUCCESS | PARTIAL | FAILED | NO_BROWSER_TOOLS

### Page Info
- HTTP Status: [status]
- Load outcome: [loaded | timeout | error]

### Change Check
- Expected: [what the change should do]
- Observed: [what the browser showed] → PASS | FAIL

### Accessibility Findings
- [finding from snapshot — missing labels, broken roles, etc.]

### Interaction Log
- [action taken] → [result: success | element not found | error]

### Console Errors
- [error message — source]

### Screenshots
- [screenshot path or description]

### Summary
- [overall assessment — what works, what failed, any critical issues]
```

### Step 7: Close

Close what you opened when done: the browser for Playwright, or only your own tabs for Claude in Chrome (never the user's other tabs).

This step is mandatory even if earlier steps fail. Treat it as a try-finally.

## Output Format

Structured Browser Report with tool family, task status, page info, change check, accessibility findings, interaction log, console errors, screenshots, and summary. See Step 6 for the full template.

## Constraints

1. MUST find the browser tools by suffix or tool search — never hardcode a server prefix
2. MUST close what it opened when done — Step 7 is non-optional even if earlier steps fail
3. MUST NOT exceed 20 interactions per session
4. MUST NOT store credentials or sensitive data in interaction logs
5. MUST take screenshot evidence before reporting visual findings

## Sharp Edges

Known failure modes for this skill. Check these before declaring done.

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Calling a hardcoded tool name that this install does not have | HIGH | Step 0: find tools by suffix (`browser_navigate`, `browser_snapshot`, …) or tool search |
| Reporting a UI check as done when no browser tools exist | HIGH | Step 0: report NO_BROWSER_TOOLS instead of guessing from source |
| Not closing the browser or tabs when done (including on error) | CRITICAL | Constraint 2: Step 7 is mandatory — treat as try-finally |
| Closing the user's own Chrome tabs | HIGH | Close only tabs this session opened |
| Storing credentials or tokens in interaction logs | HIGH | Constraint 4: redact all sensitive values before logging |
| Exceeding 20 interactions without stopping and reporting partial | MEDIUM | Constraint 3: stop at 20, report what was tested and what remains |
| Reporting visual findings without screenshot evidence | MEDIUM | Constraint 5: screenshot before reporting — "looks broken" without a screenshot is invalid |

## Done When

- Browser tool family identified (or NO_BROWSER_TOOLS reported)
- URL navigated successfully (or UNREACHABLE reported)
- Page snapshot captured for accessibility context
- All requested interactions completed (or partial with reason if >20)
- Screenshot taken as visual evidence
- Console errors captured
- Browser or opened tabs closed (Step 7 executed)
- Browser Report emitted with status, change check, findings, and screenshot reference

## Cost Profile

~500-1500 tokens input, ~300-800 tokens output. Sonnet for interaction logic.
