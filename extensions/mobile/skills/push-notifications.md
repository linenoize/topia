---
name: "push-notifications"
pack: "@Topia/mobile"
description: "Push notification setup — FCM v1, APNs, Expo Notifications, permission handling, scheduling, debugging delivery failures."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# push-notifications

Push notification setup — FCM v1, APNs, Expo Notifications, permission handling, scheduling, debugging delivery failures.

#### Workflow

**Step 1 — Detect notification setup**
Use Grep to find: `expo-notifications`, `@react-native-firebase/messaging`, `firebase.messaging`, push token registration, notification listeners. Check `app.json` plugins for `expo-notifications` config. Check for `google-services.json` (Android) and `GoogleService-Info.plist` (iOS).

**Step 2 — Audit FCM v1 migration**
Check for:
- FCM Legacy API usage (server key string instead of service account JSON): Legacy API is fully shut down since June 2024
- `google-services.json` must be FCM v1 version — old files from Legacy API still circulate in repos
- `MismatchSenderId` error: FCM server key and `google-services.json` project_number must match same Firebase project
- Multiple Firebase environments: dev/staging/prod need separate `google-services.json` files with environment-specific project numbers

**Step 3 — Audit iOS-specific gotchas**
Check for:
- `aps-environment` entitlement: works in dev builds but fails in production if `expo-notifications` not in `app.json` plugins array
- `getDevicePushTokenAsync()` race condition: silently never resolves on SDK 53+ for some users (GitHub #37516). Must call after app is fully initialized, not in root layout mount
- iOS requires paid Apple Developer account ($99/yr) for APNs — no way to test push on Simulator or free account
- iOS 18: explicit permission prompt required before scheduling local notifications — call `requestPermissionsAsync()` first
- Push notifications removed from Expo Go on Android (SDK 53+). Must use development build

**Step 4 — Audit permission handling**
Check that permission is requested at contextual moment (not app launch), fallback UI shown when denied, and `Settings.openURL` offered for re-enabling from Settings.

**Step 5 — Emit notification pipeline**
Emit: server-side push via FCM v1 HTTP API with service account auth, client-side token registration with retry, notification listener setup with cleanup, and scheduled notification with proper permission check.

#### Example

```typescript
// Server — FCM v1 push (NOT legacy). Requires service account JSON
import { GoogleAuth } from 'google-auth-library';

const auth = new GoogleAuth({
  keyFile: 'service-account.json', // NOT a server key string
  scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
});

async function sendPush(token: string, title: string, body: string, data?: Record<string, string>) {
  const client = await auth.getClient();
  const projectId = 'your-project-id';

  const response = await client.request({
    url: `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    method: 'POST',
    data: {
      message: {
        token,
        notification: { title, body },
        data: data ?? {},
        android: { priority: 'high' },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
          headers: { 'apns-priority': '10' },
        },
      },
    },
  });
  return response.data;
}
```

```typescript
// Client — Expo Notifications with proper lifecycle
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

// Configure BEFORE any notification arrives
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device');
    return null;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    // Request at contextual moment, NOT app launch
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  // Must be called AFTER app is fully initialized (not in root layout mount)
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId: 'your-expo-project-id', // Required for EAS
  });
  return token;
}
```
