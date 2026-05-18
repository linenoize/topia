---
name: "mv3-scaffold"
pack: "@Topia/chrome-ext"
description: "Manifest V3 project scaffolding — detect extension type, generate minimal-permission manifest, scaffold service worker with correct lifecycle patterns, scaffold content script, and generate build config."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# mv3-scaffold

Manifest V3 project scaffolding — detect extension type, generate minimal-permission manifest, scaffold service worker with correct lifecycle patterns, scaffold content script, and generate build config. Prevents the #1 MV3 mistake: carrying MV2 mental models (background pages, remote scripts, setTimeout for keepalive) into an MV3 project.

#### Workflow

**Step 1 — Detect or clarify extension type**
Use `Read` on any existing `manifest.json` or project description to classify the extension type:
- **popup**: user-triggered UI (toolbar button → popup.html)
- **sidebar**: persistent panel (chrome.sidePanel API, Chrome 114+)
- **content-injector**: modifies host pages (content scripts + optional popup)
- **background-only**: no visible UI, reacts to events (alarms, network, tabs)
- **devtools**: extends Chrome DevTools panel

If undetectable from files, ask the user. Extension type determines which APIs, permissions, and scaffold components are generated.

**Step 2 — Generate minimal-permission manifest.json**
Emit `manifest.json` with only the permissions required for the detected type. Flag over-permissioning immediately — requesting `<all_urls>` when only `activeTab` is needed is the #1 CWS rejection cause.

Key MV3 manifest rules:
- `"manifest_version": 3` — mandatory, MV2 deprecated Jan 2023
- `"background"` uses `{ "service_worker": "background.js" }` — NOT `"scripts"` array
- `"action"` replaces `"browser_action"` and `"page_action"`
- No `"content_security_policy"` that relaxes `script-src` (blocks CWS review)
- No `"web_accessible_resources"` with `matches: ["<all_urls>"]` unless justified
- External URLs in `"host_permissions"` require justification in CWS dashboard

**Step 3 — Scaffold service worker (CRITICAL lifecycle patterns)**
Generate `background.ts` / `background.js` with the following non-negotiable patterns:

CRITICAL: service workers terminate after 30 seconds of idle. Every assumption that breaks because of this:
- JS variables reset on termination — use `chrome.storage.session` for ephemeral state
- `setTimeout` / `setInterval` — NOT reliable across terminations, use `chrome.alarms`
- Pending async operations mid-flight get killed — use alarm + storage to resume
- `fetch()` initiated in a response to a non-event call may not complete

All event listeners MUST be registered at the top level synchronously — NOT inside `async` functions, Promises, or conditionals. Chrome only registers listeners present during the initial synchronous execution of the service worker.

**Step 4 — Scaffold content script**
Generate `content.ts` with correct isolation model:
- Runs in an **isolated world** — own JS context, cannot access page's JS variables
- Has access to the DOM but NOT to `chrome.storage`, `chrome.tabs`, most `chrome.*` APIs (exceptions: `chrome.runtime`, `chrome.storage`, `chrome.i18n`)
- Must message the service worker for privileged operations
- Inject only when needed — prefer `"run_at": "document_idle"` over `"document_start"`

**Step 5 — Scaffold popup/sidebar UI**
For popup and sidebar types, generate `popup.html` + `popup.ts`:
- Popup HTML MUST NOT load remote scripts (`<script src="https://...">`) — blocked by CSP
- All scripts must be local and listed in `web_accessible_resources` if loaded from content scripts
- Popup closes when user clicks away — don't depend on popup state for background operations
- For sidebar: register `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`

**Step 6 — Generate build config**
Emit a build configuration based on detected tooling:
- If `vite` in `package.json` → emit `vite.config.ts` using `@crxjs/vite-plugin` (hot-reload for extension dev)
- Otherwise → emit vanilla TypeScript config with `tsc` + file copy script
- Include `web-ext` config for local loading and reload

#### Example

```json
// manifest.json — content-injector type, minimal permissions
{
  "manifest_version": 3,
  "name": "Page Summarizer",
  "version": "1.0.0",
  "description": "Summarize any page using built-in AI or an external API.",
  "permissions": ["activeTab", "storage", "sidePanel"],
  "host_permissions": [],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_title": "Summarize this page",
    "default_icon": { "128": "icons/icon128.png" }
  },
  "side_panel": {
    "default_path": "sidebar.html"
  },
  "icons": { "128": "icons/icon128.png" },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

```typescript
// background.ts — correct MV3 service worker patterns
// CRITICAL: all listeners registered synchronously at top level

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    console.log('[SW] Extension installed');
  }
});

// Use chrome.alarms — NOT setTimeout (alarms survive service worker termination)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('heartbeat', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') {
    // periodic work here — service worker woke up for this
  }
});

// Message handler — registered synchronously, NOT inside async function
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SUMMARIZE_PAGE') {
    // Return true to keep the message channel open for async response
    handleSummarize(message.payload).then(sendResponse);
    return true;
  }
});

async function handleSummarize(payload: { text: string }): Promise<{ summary: string }> {
  // Service worker is alive for the duration of this message handler
  const summary = await callExternalApi(payload.text);
  return { summary };
}
```

```typescript
// content.ts — isolated world, limited chrome.* access
const selectedText = window.getSelection()?.toString() ?? '';

if (selectedText.length > 0) {
  // Content scripts can message service worker
  chrome.runtime.sendMessage(
    { type: 'SUMMARIZE_PAGE', payload: { text: selectedText } },
    (response: { summary: string }) => {
      if (chrome.runtime.lastError) {
        console.error('[Content] Message failed:', chrome.runtime.lastError.message);
        return;
      }
      displaySummary(response.summary);
    }
  );
}

function displaySummary(summary: string): void {
  const panel = document.createElement('div');
  panel.id = 'Topia-summarizer-panel';
  panel.textContent = summary;
  document.body.appendChild(panel);
}
```
