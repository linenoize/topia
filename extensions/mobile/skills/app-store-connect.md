---
name: "app-store-connect"
pack: "@Topia/mobile"
description: "App Store Connect API automation — version management, localized store listings, screenshot upload, IAP/subscription creation, review submission, customer review monitoring."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# app-store-connect

App Store Connect API automation — version management, localized store listings, screenshot upload, IAP/subscription creation, review submission, customer review monitoring.

#### Workflow

**Step 1 — Authenticate with ASC API**
App Store Connect uses JWT (ES256) with 20-minute expiry:
```typescript
import jwt from 'jsonwebtoken';
import fs from 'fs';

function generateASCToken(keyId: string, issuerId: string, privateKeyPath: string): string {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  return jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    expiresIn: '20m',
    issuer: issuerId,
    header: {
      alg: 'ES256',
      kid: keyId,
      typ: 'JWT',
    },
    audience: 'appstoreconnect-v1',
  });
}
```
Sharp edge: Token expires in 20 min — must auto-refresh when within 60s of expiry. Rate limit: 200 requests/minute, 429 response requires exponential backoff.

**Step 2 — Version management**
Create new App Store version:
```
POST /v1/appStoreVersions
{
  "data": {
    "type": "appStoreVersions",
    "attributes": {
      "platform": "IOS",
      "versionString": "1.2.0"
    },
    "relationships": {
      "app": { "data": { "type": "apps", "id": "<app-id>" } }
    }
  }
}
```
- Only ONE editable version allowed per platform at a time
- Cannot create version if existing version is "Pending Developer Release"
- Version string must be higher than current live version (semver)

**Step 3 — Localized store listing**
For each locale (`en-US`, `ja`, `de-DE`, etc.):
- `description` (4000 chars max)
- `keywords` (100 chars max, comma-separated)
- `whatsNew` (4000 chars, release notes)
- `promotionalText` (170 chars, can be updated without new version)

**Step 4 — Screenshot upload (chunked reservation)**
ASC uses a 3-step upload process:
1. Reserve upload: `POST /v1/appScreenshots` with `fileName`, `fileSize` → get `uploadOperations` array
2. Upload chunks: PUT each chunk to the returned URLs with correct `Content-Length` and offset headers
3. Commit: `PATCH /v1/appScreenshots/{id}` with `uploaded: true` and SHA-256 `sourceFileChecksum`

Sharp edges:
- Chunk size dictated by API response, NOT configurable client-side
- Must send ALL chunks before commit or upload silently fails
- Screenshot dimensions must EXACTLY match device class (e.g., 1320×2868 for 6.9")
- Maximum 10 screenshots per locale per device class

**Step 5 — In-App Purchase & subscription management**
Create IAP:
```
POST /v1/inAppPurchases
{ "type": "inAppPurchases", "attributes": { "name": "Pro Upgrade", "productId": "com.example.pro", "inAppPurchaseType": "NON_CONSUMABLE" } }
```
For subscriptions: create subscription group first, then subscription within group, then set pricing per territory. Territory pricing requires concurrent requests with retry — ASC rate limits per-territory pricing endpoints aggressively.

**Step 6 — Submission readiness check**
Before submitting for review, verify completeness:
- [ ] App Store version exists with build attached
- [ ] All required locales have description, keywords, screenshots
- [ ] Screenshots uploaded for ALL required device classes (6.9", 6.7", 6.5")
- [ ] Age rating questionnaire completed
- [ ] App review contact info set (first name, last name, phone, email)
- [ ] Privacy policy URL set
- [ ] Export compliance answered
- [ ] Content rights declaration completed (if app has third-party content)

**Step 7 — Submit and monitor**
```
POST /v1/appStoreVersionSubmissions
{ "data": { "relationships": { "appStoreVersion": { "data": { "type": "appStoreVersions", "id": "<version-id>" } } } } }
```
Poll `GET /v1/appStoreVersions/{id}` for `appStoreState` transitions: `WAITING_FOR_REVIEW` → `IN_REVIEW` → `READY_FOR_SALE` (or `REJECTED`). On rejection: fetch `appStoreVersionSubmissions` for reviewer notes.

#### Example

```typescript
// Complete ASC API client pattern
interface ASCClient {
  // Auth
  refreshToken(): string;

  // Apps
  listApps(): Promise<ASCApp[]>;
  getApp(id: string): Promise<ASCApp>;

  // Versions
  createVersion(appId: string, version: string): Promise<ASCVersion>;
  attachBuild(versionId: string, buildId: string): Promise<void>;

  // Localization
  updateLocalization(versionId: string, locale: string, data: LocalizationData): Promise<void>;

  // Screenshots (3-step)
  reserveScreenshot(setId: string, fileName: string, fileSize: number): Promise<UploadOps>;
  uploadChunks(ops: UploadOps, fileBuffer: Buffer): Promise<void>;
  commitScreenshot(screenshotId: string, checksum: string): Promise<void>;

  // IAP
  createIAP(appId: string, name: string, productId: string, type: IAPType): Promise<ASCIAP>;

  // Submission
  checkReadiness(versionId: string): Promise<ReadinessReport>;
  submitForReview(versionId: string): Promise<void>;
  pollReviewStatus(versionId: string, intervalMs?: number): AsyncGenerator<ReviewStatus>;

  // Reviews
  listCustomerReviews(appId: string): Promise<CustomerReview[]>;
  respondToReview(reviewId: string, body: string): Promise<void>;
}

// Pagination helper — ASC uses cursor-based pagination via `next` links
async function* paginate<T>(client: ASCClient, url: string): AsyncGenerator<T> {
  let nextUrl: string | null = url;
  while (nextUrl) {
    const response = await client.request(nextUrl);
    for (const item of response.data) {
      yield item as T;
    }
    nextUrl = response.links?.next ?? null;
  }
}
```
