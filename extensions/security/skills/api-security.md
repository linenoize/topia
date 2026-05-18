---
name: "api-security"
pack: "@Topia/security"
description: "API hardening patterns — rate limiting strategies, input sanitization beyond schema validation, CORS configuration, Content Security Policy generation, and security headers middleware. Outputs ready-to-use middleware code for Express, Fastify, and Next.js."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# api-security

API hardening patterns — rate limiting strategies, input sanitization beyond schema validation, CORS configuration, Content Security Policy generation, and security headers middleware. Outputs ready-to-use middleware code for Express, Fastify, and Next.js.

#### Workflow

**Step 1 — Enumerate API Endpoints**
Use Grep to list all route definitions across the codebase. Categorize by: public (unauthenticated), authenticated, admin, and internal (service-to-service). For each endpoint, note: whether it accepts user-controlled input, whether it has rate limiting applied, and whether it can trigger expensive operations (DB writes, external API calls, file I/O).

**Step 2 — Audit Rate Limiting**
Check if rate limiting is applied per-endpoint or only globally. Global rate limits are bypassable — an attacker can flood a single expensive endpoint within the global budget. Verify rate limits are enforced at the infrastructure level (not just in-process) so they survive server restarts and work across horizontally scaled instances. Recommend: Redis-backed sliding window for authenticated endpoints, token bucket for public endpoints. Set tighter limits on auth endpoints (login, password reset, OTP verify) to prevent brute force.

**Step 3 — Audit Input Validation**
Schema validation (Zod, Joi) is necessary but not sufficient. Additionally check:
- **HTML inputs** — is DOMPurify or equivalent used before any user content is rendered as HTML?
- **File uploads** — is MIME type validated from magic bytes (not just the `Content-Type` header)? Is file size capped before reading into memory?
- **Path parameters** — could `req.params.filename` be `../../etc/passwd`? Normalize with `path.resolve` and verify it stays within the allowed base directory.
- **Numeric IDs** — are they validated as integers to prevent NoSQL/ORM injection via object payloads?

**Step 4 — Verify CORS Configuration**
Check that `Access-Control-Allow-Origin` is not `*` for authenticated endpoints. Verify origins are defined per-environment (development allows localhost, production allows only the production domain). Check credentials handling — `credentials: true` must never be paired with `origin: '*'`. Verify preflight caching (`Access-Control-Max-Age`) is set to reduce OPTIONS request overhead without being too long.

**Step 5 — Generate CSP Policy**
Build a Content Security Policy tailored to the application's actual resource origins. Use `script-src 'nonce-{random}'` for inline scripts rather than `'unsafe-inline'`. Generate nonces server-side per request. Define `connect-src` to only allow the actual API and WebSocket origins. Add `upgrade-insecure-requests` for HTTPS-only deployments.

**Step 6 — Emit Security Headers Middleware**
Produce a complete security headers middleware file. Include: HSTS with preload, X-Content-Type-Options, X-Frame-Options, Referrer-Policy (strict-origin-when-cross-origin), and Permissions-Policy to restrict camera/mic/geolocation access. Output the middleware as a ready-to-paste file for the detected framework.

#### Example

```typescript
// EXPRESS: complete security headers middleware
// File to create: src/middleware/security-headers.ts

import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  const nonce = crypto.randomBytes(16).toString('base64')
  res.locals.cspNonce = nonce

  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader(
    'Content-Security-Policy',
    [
      `script-src 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' wss://api.yourdomain.com",
      "img-src 'self' data: https:",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ')
  )
  next()
}

// RATE LIMITING: Redis-backed sliding window (express-rate-limit + ioredis)
import rateLimit from 'express-rate-limit'
import RedisStore from 'rate-limit-redis'
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

// Tight limit on auth endpoints — brute force prevention
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                     // 10 attempts per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  message: { error: 'Too many attempts, please try again later' },
})

// General API limit — per-user sliding window
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 100,              // 100 req/min per IP
  keyGenerator: (req) => req.user?.id ?? req.ip,  // per-user when authenticated
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
})

// INPUT: path traversal prevention for file name parameters
import path from 'path'

function safeFilePath(baseDir: string, userFilename: string): string {
  const normalized = path.resolve(baseDir, userFilename)
  if (!normalized.startsWith(path.resolve(baseDir))) {
    throw new ForbiddenError('Path traversal attempt detected')
  }
  return normalized
}

// CORS: environment-aware origin allowlist
const CORS_ORIGINS: Record<string, string[]> = {
  production:  ['https://app.yourdomain.com'],
  staging:     ['https://staging.yourdomain.com'],
  development: ['http://localhost:3000', 'http://localhost:5173'],
}

export const corsOptions = {
  origin: (origin: string | undefined, cb: Function) => {
    const allowed = CORS_ORIGINS[process.env.NODE_ENV ?? 'development']
    if (!origin || allowed.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
  maxAge: 600,  // cache preflight for 10 minutes
}
```

```typescript
// NEXT.JS: security headers in next.config.ts
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

export default {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}
```
