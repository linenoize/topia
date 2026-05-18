---
name: "ios-build-pipeline"
pack: "@Topia/mobile"
description: "End-to-end iOS build pipeline — certificate generation, provisioning profiles, Xcode archive, IPA export, TestFlight upload, build polling."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ios-build-pipeline

End-to-end iOS build pipeline — certificate generation, provisioning profiles, Xcode archive, IPA export, TestFlight upload, build polling. Covers both React Native and native Swift projects.

#### Workflow

**Step 1 — Detect project type and signing state**
Use Glob to find: `.xcworkspace` or `.xcodeproj` (check `ios/`, `macos/`, `apple/` for RN projects), `Podfile` (needs `pod install` if workspace missing), `project.pbxproj` for current signing config (`DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE`, `PRODUCT_BUNDLE_IDENTIFIER`). Check for existing signing state file (`.topia/signing-state.json`) from previous pipeline runs — if exists, skip completed steps (idempotent pipeline).

**Step 2 — Bundle ID registration**
Check if bundle ID exists on Apple Developer portal. If not:
- Register via App Store Connect API: `POST /v1/bundleIds` with `identifier`, `name`, `platform: IOS`
- Common failure: bundle ID already taken by another team → suggest alternative namespace
- Store `bundleIdResourceId` in signing state for later use

**Step 3 — Distribution certificate**
Generate Apple Distribution certificate:
```bash
# Generate RSA 2048-bit CSR via OpenSSL
openssl req -new -newkey rsa:2048 -nodes \
  -keyout distribution.key \
  -out distribution.csr \
  -subj "/CN=Apple Distribution/O=YourTeam"

# Upload CSR to App Store Connect API
# Download signed certificate (.cer)

# Create .p12 bundle — OpenSSL 3.x requires -legacy flag
openssl pkcs12 -export -legacy \
  -inkey distribution.key \
  -in distribution.cer \
  -out distribution.p12 \
  -passout pass:""

# Import to login keychain
security import distribution.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign
```

Sharp edges:
- OpenSSL 3.x (macOS 14+) changed default encryption — `.p12` without `-legacy` flag silently fails import
- Must import to `login.keychain-db` specifically, not `System.keychain`
- `codesign` needs explicit trust via `-T /usr/bin/codesign` flag

**Step 4 — Provisioning profile**
Create App Store distribution profile via ASC API → download → install:
```bash
# Decode base64 profile content from API response
base64 -d profile_content.b64 > profile.mobileprovision

# Install to standard location
cp profile.mobileprovision ~/Library/MobileDevice/Provisioning\ Profiles/<UUID>.mobileprovision
```

**Step 5 — Patch project.pbxproj**
Update Xcode project build settings:
- `DEVELOPMENT_TEAM` = team ID from ASC
- `CODE_SIGN_STYLE` = `Automatic` for dev, `Manual` for distribution
- `PRODUCT_BUNDLE_IDENTIFIER` = registered bundle ID
- For React Native: detect workspace in `ios/`, run `pod install` if Podfile exists without workspace

**Step 6 — Archive and export**
```bash
# Archive
xcodebuild archive \
  -workspace App.xcworkspace \
  -scheme App \
  -archivePath build/App.xcarchive \
  -destination "generic/platform=iOS" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="Apple Distribution" \
  PROVISIONING_PROFILE_SPECIFIER="<profile-name>"

# Export IPA
xcodebuild -exportArchive \
  -archivePath build/App.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist
```

Sharp edges:
- Archive fails silently if CocoaPods not installed → check for `Pods/` directory
- Export failure diagnostics hidden in `IDEDistribution.standard-log.txt` inside archive — always check this file on failure
- `ExportOptions.plist` must specify `method: app-store`, `teamID`, `signingStyle: manual`, `provisioningProfiles` dict

**Step 7 — Upload to TestFlight**
```bash
# Upload via xcrun altool with API key auth (.p8 file)
xcrun altool --upload-app \
  -f build/export/App.ipa \
  --type ios \
  --apiKey <key-id> \
  --apiIssuer <issuer-id>
```

**Step 8 — Poll build processing**
After upload, poll ASC API every 30s (up to 30 min) for build to transition from `PROCESSING` → `VALID` or `INVALID`. On `VALID`: auto-attach build to pending App Store version. On `INVALID`: fetch `betaBuildLocalizations` for error details.

#### Example

```json
// .topia/signing-state.json — idempotent pipeline state
{
  "bundleId": "com.example.myapp",
  "bundleIdResourceId": "ABC123",
  "certificateId": "DEF456",
  "provisioningProfileUUID": "GHI-789-...",
  "provisioningProfileName": "MyApp Distribution",
  "teamId": "TEAM123",
  "lastArchivePath": "build/App.xcarchive",
  "lastUploadBuildNumber": "42",
  "completedSteps": ["bundleId", "certificate", "profile", "patch"]
}
```

```xml
<!-- ExportOptions.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>TEAM123</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.example.myapp</key>
    <string>MyApp Distribution</string>
  </dict>
</dict>
</plist>
```
