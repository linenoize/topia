---
name: "monitoring"
pack: "@Topia/devops"
description: "Production monitoring setup — Prometheus, Grafana, alerting rules, SLO/SLI definitions, log aggregation, distributed tracing."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# monitoring

Production monitoring setup — Prometheus, Grafana, alerting rules, SLO/SLI definitions, log aggregation, distributed tracing.

#### Workflow

**Step 1 — Detect monitoring stack**
Use Grep to find monitoring libraries (`prom-client`, `opentelemetry`, `winston`, `pino`, `morgan`, `dd-trace`, `@sentry/node`). Check for existing Prometheus config, Grafana dashboards, or alerting rules. Read the main server file for existing metrics/logging middleware.

**Step 2 — Audit observability gaps**
Check the four pillars: metrics (RED metrics — Rate, Errors, Duration), logs (structured JSON, correlation IDs), traces (distributed tracing spans), alerts (SLO-based alerting, not just threshold). Flag missing pillars with priority: metrics and alerts first, structured logs second, tracing third.

**Step 3 — Emit monitoring configuration**
Based on detected stack, emit: Prometheus metrics middleware (HTTP request duration histogram, error counter, active connections gauge), structured logger configuration (JSON, request ID, log levels), Grafana dashboard JSON, and Prometheus alerting rules for SLO (99.9% availability = error budget of 43 min/month).

#### Example

```typescript
// Prometheus metrics middleware (prom-client)
import { Counter, Histogram, Gauge, register } from 'prom-client';

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

const httpErrors = new Counter({
  name: 'http_errors_total',
  help: 'Total HTTP errors',
  labelNames: ['method', 'route', 'status'],
});

const metricsMiddleware = (req, res, next) => {
  const end = httpDuration.startTimer({ method: req.method, route: req.route?.path || req.path });
  res.on('finish', () => {
    end({ status: res.statusCode });
    if (res.statusCode >= 400) httpErrors.inc({ method: req.method, route: req.route?.path, status: res.statusCode });
  });
  next();
};

// GET /metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```
