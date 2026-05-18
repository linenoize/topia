---
name: "ota-updates"
pack: "@Topia/mobile"
description: "OTA update strategy — EAS Update, runtime version management, rollback, staged rollouts, bytecode compatibility."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ota-updates

OTA update strategy — EAS Update, runtime version management, rollback, staged rollouts, bytecode compatibility.

#### Workflow

**Step 1 — Detect OTA setup**
Use Grep to find: `expo-updates`, `Updates.checkForUpdateAsync`, `runtimeVersion` in `app.json`/`app.config.js`, `eas.json` update channel configuration, custom `UpdatesProvider`.

**Step 2 — Audit OTA safety**
Check for:
- **Runtime version match**: OTA update only applies to builds with exactly matching `runtimeVersion`. A native dependency change bumps runtime version and invalidates all pending OTA updates. Verify `runtimeVersion` strategy (semver auto vs manual)
- **Hermes bytecode compatibility**: Each RN version compiles to specific bytecode version. OTA built against RN 0.79 crashes on binary built with RN 0.78. NEVER OTA across RN version boundaries
- **Update timing**: Updates apply on next cold start, NOT instantly. Users with app in background don't receive updates. For emergency fixes, need custom `UpdatesProvider` with in-session check
- **Rollback gaps**: `eas update:rollback` has syntax bugs with specific flag combinations. Use branch-based rollback: republish previous update to same channel
- **Rollout math**: 10% rollout = 10% of cold-start checks, NOT 10% of users. If 80% of users never cold-start in a week, actual reach is ~2%
- **Native code limitation**: OTA ships JS bundle only. Bugs requiring native changes need full App Store submission

**Step 3 — Emit OTA strategy**
Emit: channel-based configuration (production/staging/preview), runtime version strategy, update check implementation with error handling, and rollback procedure.

#### Example

```json
// eas.json — channel-based OTA configuration
{
  "build": {
    "production": {
      "channel": "production",
      "distribution": "store",
      "autoIncrement": true
    },
    "preview": {
      "channel": "preview",
      "distribution": "internal"
    }
  }
}
```

```typescript
// app.config.ts — runtime version strategy
export default {
  expo: {
    runtimeVersion: {
      policy: 'fingerprintExperimental', // Auto-bumps when native deps change
    },
    updates: {
      url: 'https://u.expo.dev/your-project-id',
      fallbackToCacheTimeout: 3000, // Don't block startup > 3s
    },
  },
};
```

```typescript
// Custom update check with error handling and staged rollout
import * as Updates from 'expo-updates';

async function checkForUpdate() {
  if (__DEV__) return; // Skip in development

  try {
    const update = await Updates.checkForUpdateAsync();
    if (!update.isAvailable) return;

    // Download in background — don't block user
    const result = await Updates.fetchUpdateAsync();
    if (!result.isNew) return;

    // Option A: Apply on next cold start (default, safe)
    // User gets update automatically next time they fully close + reopen

    // Option B: Prompt user to restart (for important fixes)
    Alert.alert(
      'Update Available',
      'A new version is ready. Restart to apply?',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Restart', onPress: () => Updates.reloadAsync() },
      ]
    );
  } catch (error) {
    // OTA failures should NEVER crash the app
    // Log to error tracking, don't show to user
    console.error('OTA check failed:', error);
  }
}
```
