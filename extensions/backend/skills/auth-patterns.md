---
name: "auth-patterns"
pack: "@Topia/backend"
description: "Authentication and authorization patterns — JWT, OAuth 2.0 / OIDC, passkeys/WebAuthn, session management, RBAC, API key management, MFA flows."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# auth-patterns

Authentication and authorization patterns — JWT, OAuth 2.0 / OIDC, passkeys/WebAuthn, session management, RBAC, API key management, MFA flows.

#### Workflow

**Step 1 — Detect auth implementation**
Use Grep to find auth-related code: `jwt.sign`, `jwt.verify`, `bcrypt`, `passport`, `next-auth`, `lucia`, `cookie`, `session`, `Bearer`, `x-api-key`, `WebAuthn`, `passkey`. Read auth middleware and login/register handlers to understand the current approach.

**Step 2 — Audit security posture**
Check for: tokens stored in localStorage (XSS risk → use httpOnly cookies), missing refresh token rotation, JWT without expiry, password hashing without salt rounds check, missing CSRF protection on cookie-based auth, hardcoded secrets. Flag each with severity and specific fix.

**Step 3 — Emit secure auth flow**
Based on detected framework (Express, Fastify, Next.js, etc.), emit the corrected auth flow: access token (short-lived, 15min) + refresh token (httpOnly cookie, 7d, rotation on use), proper password hashing (bcrypt rounds ≥ 12), RBAC middleware with role hierarchy.

**Step 4 — OAuth 2.0 / OIDC integration**
Emit OAuth 2.0 authorization code flow with PKCE (required for public clients). Support Google, GitHub, or custom OIDC provider. Key points: validate `state` parameter to prevent CSRF, validate `id_token` signature and `aud`/`iss` claims, exchange code server-side (never client-side), store provider `sub` as stable user identifier. Use `openid-client` (Node.js) or `authlib` (Python) — never hand-roll token exchange.

**Step 5 — API key management and passkeys**
For API keys: generate with `crypto.randomBytes(32).toString('base64url')`, store hashed (`sha256` is sufficient — no need for bcrypt, keys are long), never store plaintext after initial display. Add scopes (read-only vs read-write), per-key rate limits, and rotation endpoint. For passkeys/WebAuthn: emit registration and authentication ceremonies using `@simplewebauthn/server`. WebAuthn is the correct long-term replacement for passwords — emit as opt-in upgrade path. Stateless vs stateful tradeoff: JWT = stateless, easy to scale horizontally, hard to revoke; sessions = stateful, easy to revoke, requires sticky sessions or shared store (Redis). Recommend JWT + token blacklist on logout for most cases; sessions for admin panels where immediate revocation matters.

#### Example

```typescript
// BEFORE: JWT in localStorage, no refresh, no expiry
const token = jwt.sign({ userId: user.id }, SECRET);
res.json({ token });

// AFTER: short-lived access + httpOnly refresh cookie with rotation
const accessToken = jwt.sign(
  { sub: user.id, role: user.role },
  ACCESS_SECRET,
  { expiresIn: '15m' }
);
const refreshToken = jwt.sign(
  { sub: user.id, jti: crypto.randomUUID() },
  REFRESH_SECRET,
  { expiresIn: '7d' }
);
await tokenStore.save(refreshToken, user.id); // rotation tracking — invalidate old on reuse

res.cookie('refresh_token', refreshToken, {
  httpOnly: true, secure: true, sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
res.json({ access_token: accessToken, expires_in: 900 });

// API key management
const generateApiKey = async (userId: string, scopes: string[]): Promise<{ key: string; keyId: string }> => {
  const rawKey = `rk_${crypto.randomBytes(32).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyId = crypto.randomUUID();
  await db.apiKey.create({ data: { id: keyId, userId, keyHash, scopes, createdAt: new Date() } });
  return { key: rawKey, keyId }; // rawKey shown ONCE — never stored plaintext
};

const authenticateApiKey = async (req, res, next) => {
  const raw = req.headers['x-api-key'];
  if (!raw) return next(); // fallback to JWT auth
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const apiKey = await db.apiKey.findUnique({ where: { keyHash: hash } });
  if (!apiKey || apiKey.revokedAt) return res.status(401).json({ error: { code: 'INVALID_API_KEY' } });
  req.user = { id: apiKey.userId, scopes: apiKey.scopes };
  next();
};

// OAuth 2.0 with PKCE (using openid-client)
import { generators, Issuer } from 'openid-client';

const googleIssuer = await Issuer.discover('https://accounts.google.com');
const client = new googleIssuer.Client({ client_id: GOOGLE_CLIENT_ID, redirect_uris: [CALLBACK_URL], response_types: ['code'] });

app.get('/auth/google', (req, res) => {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();
  req.session.codeVerifier = codeVerifier;
  req.session.state = state;
  res.redirect(client.authorizationUrl({ scope: 'openid email profile', code_challenge: codeChallenge, code_challenge_method: 'S256', state }));
});

app.get('/auth/google/callback', async (req, res) => {
  const params = client.callbackParams(req);
  const tokens = await client.callback(CALLBACK_URL, params, { code_verifier: req.session.codeVerifier, state: req.session.state });
  const claims = tokens.claims(); // validated: iss, aud, exp
  const user = await userRepo.upsertByProvider('google', claims.sub, claims.email);
  // issue internal JWT...
});
```
