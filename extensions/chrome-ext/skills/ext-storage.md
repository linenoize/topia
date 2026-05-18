---
name: "ext-storage"
pack: "@Topia/chrome-ext"
description: "Typed Chrome storage patterns — choose the right storage tier, define schema, implement typed helpers, handle schema migrations, and monitor quota."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ext-storage

Typed Chrome storage patterns — choose the right storage tier, define schema, implement typed helpers, handle schema migrations, and monitor quota. Prevents the #3 MV3 failure: storing state in service worker JS variables that reset on termination.

#### Workflow

**Step 1 — Choose storage type**
| Type | Capacity | Persistence | Sync | Use For |
|------|----------|-------------|------|---------|
| `chrome.storage.local` | 10 MB | Until uninstall | No | User data, large payloads, cached content |
| `chrome.storage.sync` | 100 KB / 8 KB per item | Cross-device | Yes | Settings, small preferences |
| `chrome.storage.session` | 10 MB | Until browser closes | No | Ephemeral state that service worker needs across terminations |
| `chrome.storage.managed` | Read-only | Admin-controlled | No | Enterprise policy |

CRITICAL: `chrome.storage.session` is the correct replacement for service worker JS variables. If you need state to survive a 30-second termination but clear on browser close, use session storage.

**Step 2 — Define TypeScript storage schema**
Create `src/types/storage.ts` with versioned schema interface. Include a `version` field for migration tracking.

**Step 3 — Implement typed get/set helpers**
Create `src/lib/storage.ts` with typed wrappers that preserve the schema type. Avoid `chrome.storage.*.get(null)` which returns `any` — always specify keys.

**Step 4 — Add migration logic**
On `chrome.runtime.onInstalled` with `reason === 'update'`, check stored schema version and run incremental migrations. Each migration transforms data from version N to N+1.

**Step 5 — Implement quota monitoring**
Chrome storage has hard limits that throw `QUOTA_BYTES_PER_ITEM` and `QUOTA_BYTES` errors on write. Wrap all writes with error handling and warn the user or pTopia old data when approaching 80% capacity.

#### Example

```typescript
// src/types/storage.ts — versioned storage schema
export const STORAGE_VERSION = 2;

export interface StorageSchema {
  version: number;
  settings: {
    useBuiltinAI: boolean;
    externalApiKey: string;
    maxLength: number;
    theme: 'light' | 'dark' | 'system';
  };
  cache: {
    lastSummary: string;
    lastUrl: string;
    timestamp: number;
  } | null;
}

export const STORAGE_DEFAULTS: StorageSchema = {
  version: STORAGE_VERSION,
  settings: {
    useBuiltinAI: true,
    externalApiKey: '',
    maxLength: 500,
    theme: 'system',
  },
  cache: null,
};
```

```typescript
// src/lib/storage.ts — typed get/set helpers with quota monitoring

import type { StorageSchema } from '../types/storage';
import { STORAGE_DEFAULTS, STORAGE_VERSION } from '../types/storage';

type StorageKey = keyof StorageSchema;

export async function storageGet<K extends StorageKey>(
  key: K
): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as StorageSchema[K]) ?? STORAGE_DEFAULTS[key];
}

export async function storageSet<K extends StorageKey>(
  key: K,
  value: StorageSchema[K]
): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch (err) {
    const error = err as Error;
    if (error.message.includes('QUOTA_BYTES')) {
      console.warn('[Storage] Quota exceeded — clearing cache');
      await chrome.storage.local.remove('cache');
      // retry once after clearing cache
      await chrome.storage.local.set({ [key]: value });
    } else {
      throw err;
    }
  }
}

// Quota monitoring — warn at 80% capacity
export async function checkStorageQuota(): Promise<void> {
  const bytesUsed = await chrome.storage.local.getBytesInUse(null);
  const quota = chrome.storage.local.QUOTA_BYTES; // 10 MB = 10,485,760 bytes
  const pct = (bytesUsed / quota) * 100;
  if (pct > 80) {
    console.warn(`[Storage] ${pct.toFixed(1)}% of local storage used (${bytesUsed} / ${quota} bytes)`);
  }
}

// Migration runner — call on onInstalled with reason='update'
export async function runMigrations(): Promise<void> {
  const stored = await chrome.storage.local.get('version');
  const currentVersion = (stored['version'] as number | undefined) ?? 1;

  if (currentVersion < 2) {
    // v1 → v2: renamed 'apiKey' to 'externalApiKey'
    const legacy = await chrome.storage.local.get('settings');
    const legacySettings = legacy['settings'] as Record<string, unknown> | undefined;
    if (legacySettings?.['apiKey']) {
      await chrome.storage.local.set({
        settings: { ...legacySettings, externalApiKey: legacySettings['apiKey'], apiKey: undefined },
        version: 2,
      });
    }
  }

  await chrome.storage.local.set({ version: STORAGE_VERSION });
}
```
