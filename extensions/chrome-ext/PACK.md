---
name: "@Topia/chrome-ext"
description: Chrome extension development patterns — Manifest V3 scaffolding, service worker lifecycle, message passing, storage patterns, Chrome Web Store compliance, and built-in AI integration.
metadata:
  author: topia
  version: "0.1.0"
  layer: L4
  target: Chrome extension developers
  format: split
---

# @Topia/chrome-ext

## Purpose

Chrome extension development has a steep cliff of Manifest V3 gotchas that no other AI coding pack addresses. Service workers terminate silently after 30 seconds of idle, taking all JS-variable state with them. Fifty-eight percent of Chrome Web Store rejections are preventable compliance errors. The new Chrome AI APIs (Gemini Nano, Chrome 138+) require hardware checks, graceful fallbacks, and port-based streaming — none of which are obvious from the docs. This pack groups six tightly-coupled concerns — MV3 scaffolding, message passing, storage, CWS preflight, store listing, and built-in AI — because a gap in any single layer produces a broken, rejected, or battery-draining extension. Activates automatically when `manifest.json` with `manifest_version: 3` or `chrome.*` API usage is detected.

## Triggers

- Auto-trigger: when `manifest.json` containing `"manifest_version": 3` is found in project root or `src/`
- Auto-trigger: when files matching `**/background.ts`, `**/service-worker.ts`, `**/content.ts`, `**/popup.ts` exist alongside a `manifest.json`
- Auto-trigger: when `chrome.*` API calls are found in project source files
- `/topia chrome-ext` — manual invocation
- Called by `build` (L1) when Chrome extension project context is detected
- Called by `scaffold` (L1) when user requests a new browser extension project

## Skills Included

| Skill | Model | Description |
|-------|-------|-------------|
| [mv3-scaffold](skills/mv3-scaffold.md) | sonnet | Manifest V3 project scaffolding — detect extension type, generate minimal-permission manifest, scaffold service worker with correct lifecycle patterns, scaffold content script, and generate build config. |
| [ext-messaging](skills/ext-messaging.md) | sonnet | Typed message passing between popup, service worker, and content script — discriminated union message types, one-shot sendMessage, long-lived port connections for streaming, and Chrome 146+ error handling. |
| [ext-storage](skills/ext-storage.md) | sonnet | Typed Chrome storage patterns — choose the right storage tier, define schema, implement typed helpers, handle schema migrations, and monitor quota. |
| [cws-preflight](skills/cws-preflight.md) | sonnet | Chrome Web Store compliance audit — scan for over-permissioning, remote code execution, CSP violations, missing assets, and generate permission justification text. |
| [cws-publish](skills/cws-publish.md) | sonnet | Chrome Web Store listing preparation and submission guide — store listing copy, screenshot descriptions, permission justifications, visibility settings, and timeline expectations. |
| [ext-ai-integration](skills/ext-ai-integration.md) | sonnet | Chrome built-in AI and external API integration — detect AI type, check hardware requirements, implement Gemini Nano with graceful fallback, wire streaming responses via ports, handle rate limits, and test offline behavior. |

## Tech Stack Support

| Build Tool | Plugin | Hot Reload | Notes |
|------------|--------|------------|-------|
| Vite 5 | @crxjs/vite-plugin | Yes | Best DX — recommended for MV3 |
| Webpack 5 | chrome-extension-webpack | Partial | Mature, more config overhead |
| Parcel 2 | @parcel/config-webextension | Yes | Zero-config option |
| Vanilla tsc | Manual copy scripts | No | Fine for simple extensions |

| API | Min Chrome Version | Notes |
|-----|-------------------|-------|
| chrome.sidePanel | 114 | Sidebar panel (replaces popup for persistent UI) |
| chrome.aiLanguageModel | 138 | Gemini Nano — built-in LLM |
| chrome.aiSummarizer | 138 | Specialized summarization API |
| chrome.offscreen | 109 | Background DOM/audio access workaround |
| chrome.storage.session | 102 | Session storage surviving SW termination |

## Connections

```
Calls → sentinel (L2): security audit on permissions, CSP, and storage patterns
Calls → verification (L3): validate TypeScript types, run extension build
Calls → git (L3): semantic commit after scaffold or publish prep
Called By ← build (L1): when Chrome extension project context detected
Called By ← scaffold (L1): when user requests new browser extension project
Called By ← launch (L1): pre-flight check before CWS submission
Called By ← preflight (L2): runs cws-preflight as part of broader pre-deploy audit
```

## Constraints

1. MUST register `chrome.runtime.onMessage.addListener` at module top level — listeners inside async IIFEs are silently ignored after service worker termination.
2. MUST use `chrome.alarms` for periodic work — never rely on `setTimeout` keepalive hacks (broken Chrome 119+).
3. MUST check `chrome.runtime.lastError` on every `sendMessage` callback — undefined response is not success.
4. MUST run `grep -r "eval(" node_modules/` before Chrome Web Store submission — bundled eval fails review.
5. MUST slice streaming AI deltas (`chunk.slice(prev.length)`) — cumulative chunks duplicate UI content.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Event listener registered inside `addEventListener('load', ...)` or async IIFE — silently ignored after SW termination | CRITICAL | Grep for `onMessage.addListener` not at module top level; scaffold always generates top-level listeners |
| `setTimeout` keepalive hack breaks on Chrome 119+ — Chrome patched the timeout extension trick | HIGH | Use `chrome.alarms` for periodic work; use `chrome.storage.session` for state; never rely on SW staying alive |
| `sendMessage` returns `undefined` when no listener responds — mistaken for success | HIGH | Check `chrome.runtime.lastError` in callback; use typed response interface that includes `error?: string` |
| Streaming AI returns cumulative text (not delta chunks) — UI duplicates content | HIGH | Slice previous from current: `const delta = chunk.slice(prev.length); prev = chunk` |
| `chrome.tabs.sendMessage` throws when content script not yet injected or tab is restricted | HIGH | Wrap in try/catch; check `sender.tab` exists; use `executeScript` to inject first if needed |
| Extension passes local testing but fails CWS review for `eval()` in bundled node_modules | CRITICAL | Run `grep -r "eval(" node_modules/` before submission; replace or patch offending dependency |

## Done When

- `manifest.json` has no declared permissions absent from source code (verified by Grep)
- Service worker registers all listeners synchronously at module top level — no listener inside async function
- `chrome.storage` is used for all state — no JS variables relied upon to survive termination
- No `eval()`, `Function()`, remote `<script>` tags, or external `import()` in any source or bundled file
- `cws-preflight` report shows no FAIL items and WARN items are reviewed
- `chrome.aiLanguageModel.capabilities()` is checked before use and graceful fallback is implemented
- Streaming AI uses port-based messaging and correctly extracts deltas from cumulative chunks
- Store listing copy is under character limits, permission justifications are written in user-facing language
- Extension loads in Chrome via `chrome://extensions → Load unpacked` without errors

## Cost Profile

~1,500–3,000 tokens per skill activation. `haiku` for file scans (Grep, Glob, manifest reading); `sonnet` for scaffold generation, storage schema, and message type definitions; `sonnet` for cws-preflight audit and store listing copy; `sonnet` for AI integration wiring. Full pack activation (all 6 skills) runs ~12,000–18,000 tokens end-to-end. `cws-preflight` is the heaviest single skill (~3,000 tokens) due to multi-pass scanning.
