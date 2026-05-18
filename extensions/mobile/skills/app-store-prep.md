---
name: "app-store-prep"
pack: "@Topia/mobile"
description: "App store submission preparation — screenshots, metadata, privacy manifests, review guidelines compliance, TestFlight/internal testing."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# app-store-prep

App store submission preparation — screenshots, metadata, privacy manifests, review guidelines compliance, TestFlight/internal testing.

#### Workflow

**Step 1 — Audit submission readiness**
Check for:
- App icon: 1024x1024 for iOS (no alpha, no rounded corners), adaptive icon for Android
- Splash screen configured
- Privacy policy URL in app config
- Required permissions with specific (not generic) usage descriptions — "App requires access to your camera" gets rejected. Must be specific: "Used to scan QR codes for quick login"
- `PrivacyInfo.xcprivacy` present (mandatory since April 2025): Apple requires privacy manifest for apps using file timestamp, boot time, disk space, or UserDefaults APIs. React Native core and many libraries access these APIs. Missing manifest = auto-rejection
- Minimum SDK versions: iOS 18 SDK mandatory (Xcode 16+, April 2025), Android API 34 minimum
- Release signing configured (not debug)
- `.aab` format for Google Play (APK no longer accepted for new apps)

**Step 2 — Generate metadata**
From README and app config, generate: app title (30 chars max), subtitle (30 chars), description (4000 chars), keywords (100 chars), category selection, age rating questionnaire answers, and screenshot specifications per device size.

Current required screenshot sizes:
- iPhone 6.9" (1320×2868) — iPhone 16 Pro Max (NEW, required for new apps)
- iPhone 6.7" (1290×2796)
- iPhone 6.5" (1242×2688)
- iPad 12.9" (2048×2732) — if app supports iPad
- Android: feature graphic 1024×500

**Step 3 — Emit submission checklist**
Output structured checklist covering both platforms with platform-specific gotchas.

#### Example

```markdown
## App Store Submission Checklist

### iOS (Apple App Store Connect)
- [ ] App icon: 1024x1024 PNG, no alpha, no rounded corners
- [ ] Screenshots: 6.9" (1320x2868), 6.7" (1290x2796), 6.5" (1242x2688)
- [ ] Privacy policy URL: https://example.com/privacy
- [ ] `PrivacyInfo.xcprivacy` included (MANDATORY since April 2025)
- [ ] NSCameraUsageDescription: "Used to scan QR codes for quick login" (SPECIFIC, not generic)
- [ ] NSLocationWhenInUseUsageDescription: "Used to show nearby stores on the map"
- [ ] TestFlight build uploaded and tested on physical device
- [ ] Export compliance: Uses HTTPS only (no custom encryption) → select "No"
- [ ] Built with Xcode 16+ / iOS 18 SDK (mandatory since April 2025)

### Android (Google Play Console)
- [ ] Adaptive icon: foreground (108dp) + background layer
- [ ] Feature graphic: 1024x500 PNG
- [ ] App Bundle format (.aab, NOT .apk)
- [ ] Target API 34+ (Android 14)
- [ ] 64-bit native libraries included (32-bit only = rejection)
- [ ] Data safety form: accurately declare ALL collected data (analytics SDKs collect device IDs)
- [ ] `SCHEDULE_EXACT_ALARM` justified if using scheduled notifications
- [ ] Content rating: IARC questionnaire completed
- [ ] Internal testing track: at least 1 build tested
- [ ] Signing: upload key + app signing by Google Play enabled
```
