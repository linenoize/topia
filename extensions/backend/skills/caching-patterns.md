---
name: "caching-patterns"
pack: "@Topia/backend"
description: "Caching strategies for backend applications — in-memory LRU, Redis distributed cache, CDN/edge cache, browser cache headers, invalidation, and stampede prevention."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# caching-patterns

Caching strategies for backend applications — in-memory LRU, Redis distributed cache, CDN/edge cache, browser cache headers, invalidation, and stampede prevention.

#### Workflow

**Step 1 — Identify cacheable endpoints**
Scan routes for: (a) read-heavy endpoints called frequently with the same inputs (user profile, product catalog, config lookups), (b) expensive computations (aggregations, report generation), (c) external API calls that are rate-limited or slow. Flag endpoints that mutate state as NOT cacheable at the response level (cache the data layer instead). Output a cacheable/non-cacheable classification per endpoint.

**Step 2 — Select cache layer**
Choose layer based on access pattern: in-memory (node-cache, LRU-cache) for single-process data with sub-millisecond access and low cardinality; Redis for distributed cache shared across multiple server instances or processes; CDN (Cloudflare, Fastly) for public, user-agnostic responses (marketing pages, public API responses); browser cache (`Cache-Control` headers) for static assets and safe GET responses. Hybrid: in-memory L1 + Redis L2 for hot-path data that justifies two-layer lookup.

**Step 3 — Implement cache pattern**
Cache-aside (most common): application checks cache first, on miss fetches from DB, writes to cache. Write-through: write to cache and DB together on every write (cache always warm, higher write latency). Write-behind (write-back): write to cache immediately, flush to DB asynchronously (lowest write latency, risk of data loss on crash). Read-through: cache sits in front of DB, handles miss transparently (simpler app code, less control). For most web APIs: cache-aside for reads + TTL-based expiry is the correct default.

**Step 4 — Add invalidation strategy**
TTL-based: set appropriate TTL per data type (user session: match auth token TTL; product catalog: 5–15min; config: 1hr). Event-driven: on mutation, publish event to Redis pub/sub, cache subscribers delete affected keys. Versioned keys: `cache:user:v3:{id}` — bump version in config to invalidate all users atomically. Tag-based: associate keys with tags (`tag:user:123`), delete all keys for a tag on mutation. Stale-while-revalidate: serve stale data immediately, refresh in background — valid for data where slight staleness is acceptable (leaderboards, stats). Emit invalidation hook alongside every write operation.

**Step 5 — Monitor hit/miss ratio**
Instrument cache calls to emit metrics: hit count, miss count, eviction count, cache size. Redis provides `INFO stats` — parse `keyspace_hits` and `keyspace_misses`. Target hit ratio > 80% for hot-path caches; < 50% indicates wrong key granularity or TTL too short. Alert on sudden hit ratio drop (invalidation bug) or memory > 80% of `maxmemory` (eviction risk).

#### Example

```typescript
// Redis cache-aside middleware for Express/Fastify
import { Redis } from 'ioredis';
const redis = new Redis(REDIS_URL);

const cacheMiddleware = (ttlSeconds: number, keyFn?: (req) => string) =>
  async (req, res, next) => {
    const key = keyFn ? keyFn(req) : `cache:${req.method}:${req.originalUrl}`;
    const cached = await redis.get(key);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }
    const originalJson = res.json.bind(res);
    res.json = (data) => {
      // Only cache successful responses
      if (res.statusCode < 400) redis.setex(key, ttlSeconds, JSON.stringify(data));
      res.setHeader('X-Cache', 'MISS');
      return originalJson(data);
    };
    next();
  };

// Usage: cache product list for 5 minutes
app.get('/products', cacheMiddleware(300), async (req, res) => { /* handler */ });

// Cache stampede prevention: mutex lock on cache miss
const getWithLock = async <T>(key: string, fetchFn: () => Promise<T>, ttl: number): Promise<T> => {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const lockKey = `lock:${key}`;
  const lock = await redis.set(lockKey, '1', 'EX', 10, 'NX'); // 10s lock
  if (!lock) {
    // Another process is fetching — wait briefly and retry
    await new Promise(r => setTimeout(r, 100));
    return getWithLock(key, fetchFn, ttl); // retry (max ~10 cycles within 10s lock)
  }

  try {
    const data = await fetchFn();
    await redis.setex(key, ttl, JSON.stringify(data));
    return data;
  } finally {
    await redis.del(lockKey);
  }
};

// Event-driven invalidation with Redis pub/sub
const invalidateOnMutation = async (userId: string) => {
  await redis.del(`cache:user:${userId}`);
  await redis.publish('cache:invalidate', JSON.stringify({ type: 'user', id: userId }));
};

// Cache-Control headers for browser/CDN caching
app.get('/products', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  // ^ CDN caches 5min, serves stale for extra 60s while revalidating in background
  res.json(products);
});

app.get('/user/profile', authenticate, (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60'); // user-specific, browser only
  res.json(profile);
});

// In-memory LRU cache for single-process hot data
import LRU from 'lru-cache';
const configCache = new LRU<string, unknown>({ max: 500, ttl: 60_000 }); // 500 entries, 1min TTL

const getConfig = async (key: string) => {
  if (configCache.has(key)) return configCache.get(key);
  const value = await db.config.findUnique({ where: { key } });
  configCache.set(key, value);
  return value;
};
```
