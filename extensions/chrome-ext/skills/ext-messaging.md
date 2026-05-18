---
name: "ext-messaging"
pack: "@Topia/chrome-ext"
description: "Typed message passing between popup, service worker, and content script — discriminated union message types, one-shot sendMessage, long-lived port connections for streaming, and Chrome 146+ error handling."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ext-messaging

Typed message passing between popup, service worker, and content script — discriminated union message types, one-shot `sendMessage`, long-lived port connections for streaming, and Chrome 146+ error handling. Prevents the #2 MV3 failure: untyped `any` messages, missing `return true` for async handlers, and ports used for single messages.

#### Workflow

**Step 1 — Identify message flows**
Use `Grep` to find existing `chrome.runtime.sendMessage`, `chrome.tabs.sendMessage`, and `chrome.runtime.connect` calls. Map the full message topology:
- popup → service worker (sendMessage — one-shot)
- service worker → content script (chrome.tabs.sendMessage — requires tab ID)
- content script → service worker (sendMessage — one-shot)
- service worker → popup (port — only if popup is open)
- streaming AI responses → use Port (not sendMessage — ports survive multiple sends)

**Step 2 — Define TypeScript message types**
Create `src/types/messages.ts` with a discriminated union covering all message directions. Each message type has a `type` literal and a strongly-typed `payload`. Response types are paired per message type.

**Step 3 — Implement chrome.runtime.sendMessage patterns**
For one-shot request/response between extension contexts. Key rules:
- Listener must `return true` if the response is sent asynchronously (inside a Promise or async function)
- `chrome.runtime.lastError` MUST be checked in the callback — unhandled errors throw in MV3
- Content scripts cannot receive messages via `chrome.runtime.sendMessage` — use `chrome.tabs.sendMessage` from the service worker with the target tab's ID

**Step 4 — Implement chrome.tabs.sendMessage (service worker → content)**
Service worker must resolve the target tab ID before sending. Use `chrome.tabs.query({ active: true, currentWindow: true })` or receive the tab ID from the content script's original message (sender.tab.id).

**Step 5 — Implement port-based long-lived connections**
Use `chrome.runtime.connect` for streaming scenarios (AI token streaming, progress updates, live data feeds). Ports stay open until explicitly disconnected. Each side must handle `port.onDisconnect` to clean up.

**Step 6 — Add Chrome 146+ error handling**
Chrome 146 changed message listener error behavior: uncaught errors in listeners now reject the Promise returned by `sendMessage` on the sender side. Wrap all listener handlers in try/catch and send structured error responses.

#### Example

```typescript
// src/types/messages.ts — discriminated union message types
export type ExtensionMessage =
  | { type: 'SUMMARIZE_PAGE'; payload: { text: string; tabId: number } }
  | { type: 'GET_SETTINGS'; payload: Record<string, never> }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<Settings> }
  | { type: 'OPEN_SIDEBAR'; payload: { tabId: number } };

export type ExtensionResponse<T extends ExtensionMessage> =
  T extends { type: 'SUMMARIZE_PAGE' } ? { summary: string; error?: string } :
  T extends { type: 'GET_SETTINGS' } ? { settings: Settings } :
  T extends { type: 'UPDATE_SETTINGS' } ? { ok: boolean } :
  T extends { type: 'OPEN_SIDEBAR' } ? { ok: boolean } :
  never;

export interface Settings {
  useBuiltinAI: boolean;
  externalApiKey: string;
  maxLength: number;
}
```

```typescript
// background.ts — typed message handler
import type { ExtensionMessage } from './types/messages';

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse) => {
    // CRITICAL: return true to keep channel open for async response
    (async () => {
      try {
        switch (message.type) {
          case 'SUMMARIZE_PAGE': {
            const summary = await summarize(message.payload.text);
            sendResponse({ summary });
            break;
          }
          case 'GET_SETTINGS': {
            const result = await chrome.storage.sync.get('settings');
            sendResponse({ settings: result['settings'] as Settings });
            break;
          }
          default:
            sendResponse({ error: 'Unknown message type' });
        }
      } catch (err) {
        // Chrome 146+: send error response instead of letting it throw
        sendResponse({ error: String(err) });
      }
    })();
    return true; // MUST return true — async response
  }
);
```

```typescript
// Port-based streaming (service worker → sidebar/popup)
// background.ts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;

  port.onMessage.addListener(async (message: { text: string }) => {
    try {
      const session = await chrome.aiLanguageModel.create();
      const stream = session.promptStreaming(message.text);

      for await (const chunk of stream) {
        port.postMessage({ type: 'CHUNK', content: chunk });
      }
      port.postMessage({ type: 'DONE' });
      session.destroy();
    } catch (err) {
      port.postMessage({ type: 'ERROR', error: String(err) });
    }
  });

  port.onDisconnect.addListener(() => {
    // cleanup — sidebar/popup was closed
  });
});

// sidebar.ts — connect and stream
const port = chrome.runtime.connect({ name: 'ai-stream' });
port.postMessage({ text: selectedText });

port.onMessage.addListener((msg: { type: string; content?: string; error?: string }) => {
  if (msg.type === 'CHUNK') appendToOutput(msg.content ?? '');
  if (msg.type === 'DONE') finalizeOutput();
  if (msg.type === 'ERROR') showError(msg.error ?? 'Unknown error');
});

port.onDisconnect.addListener(() => {
  if (chrome.runtime.lastError) {
    console.error('[Sidebar] Port disconnected with error:', chrome.runtime.lastError.message);
  }
});
```
