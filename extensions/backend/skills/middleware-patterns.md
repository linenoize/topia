---
name: "middleware-patterns"
pack: "@Topia/backend"
description: "Middleware architecture — request validation, error handling, logging, CORS, compression, graceful shutdown, health checks, request ID tracking."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# middleware-patterns

Middleware architecture — request validation, error handling, logging, CORS, compression, graceful shutdown, health checks, request ID tracking.

#### Workflow

**Step 1 — Audit middleware stack**
Read the main server file (app.ts, server.ts, index.ts) to inventory all middleware in registration order. Check for: missing request ID generation, missing structured logging, inconsistent error responses, missing input validation, CORS misconfiguration (`*` in production).

**Step 2 — Detect error handling gaps**
Use Grep to find `catch` blocks, error middleware signatures (`err, req, res, next`), and unhandled promise rejections. Check if errors return consistent format (same envelope for 400, 401, 403, 404, 500). Flag any that leak stack traces or internal details in production.

**Step 3 — Emit middleware improvements**
For each gap, emit the middleware function: request ID (`X-Request-Id` header, UUID per request), structured JSON logger (request method, path, status, duration, request ID), global error handler with consistent envelope, Zod-based request validation middleware.

**Step 4 — Compression strategy**
Emit response compression middleware. Use `brotli` for static assets and pre-compressible responses (better ratio than gzip, supported by all modern clients). Use `gzip` as fallback for older clients. Conditional compression: skip for already-compressed content types (`image/*`, `video/*`, `application/zip`) — compressing these wastes CPU. In Express: use `compression` package with a `filter` function. In Fastify: `@fastify/compress` with `encodings: ['br', 'gzip']`. Minimum size threshold: do not compress responses < 1KB (overhead exceeds benefit).

**Step 5 — Graceful shutdown and health checks**
Graceful shutdown: on `SIGTERM`/`SIGINT`, stop accepting new connections, wait for in-flight requests to complete (timeout 30s), then close DB pools and exit. Emit the shutdown handler for Express (`server.close()`), Fastify (`fastify.close()`), and worker processes. Health check endpoints: `/health/live` (liveness — is the process alive? return 200 always unless process is broken), `/health/ready` (readiness — can it serve traffic? check DB connection, Redis connection, return 503 if dependencies are down). In Kubernetes: map liveness to `livenessProbe`, readiness to `readinessProbe`. Do NOT check external third-party APIs in readiness — only your own dependencies.

#### Example

```typescript
// Request ID middleware
const requestId = (req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

// Structured error handler — consistent envelope, no stack leak
const errorHandler = (err, req, res, _next) => {
  const status = err.status || 500;
  const message = status < 500 ? err.message : 'Internal server error';
  logger.error({ err, requestId: req.id, path: req.path });
  res.status(status).json({
    error: { code: err.code || 'INTERNAL_ERROR', message },
    request_id: req.id,
  });
};

// Zod validation middleware
const validate = (schema: z.ZodSchema) => (req, res, next) => {
  const result = schema.safeParse({ body: req.body, query: req.query, params: req.params });
  if (!result.success) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: result.error.flatten() } });
  }
  Object.assign(req, result.data);
  next();
};

// Compression with conditional skip (Express)
import compression from 'compression';
app.use(compression({
  filter: (req, res) => {
    const contentType = res.getHeader('Content-Type') as string || '';
    if (/image|video|audio|zip|gz|br/.test(contentType)) return false;
    return compression.filter(req, res);
  },
  threshold: 1024, // skip responses < 1KB
}));

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      await redis.quit();
      console.log('All connections closed. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
  // Force exit after 30s if still not done
  setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, 30_000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Health check endpoints
app.get('/health/live', (req, res) => res.json({ status: 'ok' }));

app.get('/health/ready', async (req, res) => {
  const checks = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,   // DB check
    redis.ping(),                  // Redis check
  ]);
  const results = { db: checks[0].status, redis: checks[1].status };
  const allHealthy = checks.every(c => c.status === 'fulfilled');
  res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? 'ready' : 'degraded', checks: results });
});
```
