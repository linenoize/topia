---
name: "deep-linking"
pack: "@Topia/mobile"
description: "Deep linking setup and debugging — Universal Links (iOS), App Links (Android), deferred deep links, authentication + deep link integration."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# deep-linking

Deep linking setup and debugging — Universal Links (iOS), App Links (Android), deferred deep links, authentication + deep link integration.

#### Workflow

**Step 1 — Detect current deep link setup**
Use Grep to find: `expo-linking`, `Linking.addEventListener`, `useURL`, `expo-router` deep link config, `apple-app-site-association`, `assetlinks.json`, `IntentFilter` in `AndroidManifest.xml`. Check for React Navigation `linking` config or Expo Router file-based deep link handling.

**Step 2 — Audit deep link reliability**
Check for these common failure modes:
- **AASA file redirect**: `.well-known/apple-app-site-association` endpoint must not redirect (HTTP→HTTPS or www→non-www). Any redirect silently breaks Universal Links
- **AASA caching**: Apple CDN caches AASA aggressively (up to 24h). Changes appear correct on server but old version is served to devices
- **SHA-256 mismatch**: Dev/Preview builds use different signing key than Production. `assetlinks.json` must include ALL certificates (upload key + app signing key)
- **Multiple environments**: Staging and production need separate AASA entries with different bundle IDs and team IDs
- **Firebase Dynamic Links dead**: Shut down August 25, 2025. All `page.link` subdomains stopped working. Must migrate to Branch.io, custom server, or standard App Links/Universal Links
- **Simulator limitation**: Universal Links and App Links do not work on simulators. Must test on real physical devices

**Step 3 — Audit authentication + deep link integration**
Check for race condition: deep link arrives before auth state resolves. Pattern: capture initial URL, wait for auth, then navigate. In React Navigation v7, `NAVIGATE` action pushes new screen even for existing routes — deep link handler must check current route before navigating.

**Step 4 — Emit deep link configuration**
For Expo Router: verify file-based route structure matches expected deep link paths. For React Navigation v7: emit typed `linking` config with authentication gate. For server: emit AASA and `assetlinks.json` with correct team ID, bundle ID, and all signing certificates.

#### Example

```typescript
// Expo Router — app/_layout.tsx with auth-gated deep link handling
import { useURL } from 'expo-linking';
import { useRouter, useSegments } from 'expo-router';

export default function RootLayout() {
  const url = useURL();
  const router = useRouter();
  const segments = useSegments();
  const { user, isLoading } = useAuth();
  const pendingDeepLink = useRef<string | null>(null);

  // Capture deep link before auth resolves
  useEffect(() => {
    if (url && isLoading) {
      pendingDeepLink.current = url;
    }
  }, [url, isLoading]);

  // Navigate after auth resolves
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    if (!user && !inAuthGroup) {
      router.replace('/login');
    } else if (user && inAuthGroup) {
      // Process pending deep link or go to home
      if (pendingDeepLink.current) {
        const path = new URL(pendingDeepLink.current).pathname;
        pendingDeepLink.current = null;
        router.replace(path);
      } else {
        router.replace('/');
      }
    }
  }, [user, isLoading, segments]);

  return <Slot />;
}
```

```json
// .well-known/apple-app-site-association — NO redirects on this endpoint
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID.com.example.app", "TEAMID.com.example.app.staging"],
        "components": [
          { "/": "/product/*", "comment": "Product deep links" },
          { "/": "/invite/*", "comment": "Invite deep links" }
        ]
      }
    ]
  }
}
```

```json
// .well-known/assetlinks.json — include BOTH upload key AND app signing key
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.example.app",
      "sha256_cert_fingerprints": [
        "AA:BB:CC:...:upload_key_fingerprint",
        "DD:EE:FF:...:app_signing_key_fingerprint"
      ]
    }
  }
]
```
