---
name: "data-validation"
pack: "@Topia/analytics"
description: "Data quality patterns — input validation, schema enforcement, data pipeline checks, anomaly detection, and data freshness monitoring."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# data-validation

Data quality patterns — input validation, schema enforcement, data pipeline checks, anomaly detection, and data freshness monitoring.

#### Workflow

**Step 1 — Detect data flows**
Use Grep to find data ingestion points: API endpoints that accept data, CSV/JSON import handlers, webhook receivers, database seed scripts, ETL pipelines. Map: source → transform → destination for each flow.

**Step 2 — Audit data quality**
Check for: missing input validation on data ingestion endpoints, no schema validation on imported files, no null/empty checks on required fields, no data type coercion (string "123" stored as string not number), no anomaly detection (sudden 10x spike in values), no data freshness check ("when was this data last updated?"), and no deduplication on event streams.

**Step 3 — Emit validation patterns**
Emit: schema validation with Zod for API inputs, data pipeline validation middleware, anomaly detection query, data freshness monitor, and deduplication patterns.

#### Example

```typescript
import { z } from 'zod';

// Data pipeline validation schema
const MetricRowSchema = z.object({
  timestamp: z.coerce.date(),
  metric_name: z.string().min(1).max(100),
  value: z.number().finite(),
  source: z.enum(['api', 'webhook', 'import', 'manual']),
  tags: z.record(z.string()).optional(),
});

// Batch validation with error collection (not fail-fast)
function validateBatch(rows: unknown[]): { valid: z.infer<typeof MetricRowSchema>[]; errors: { row: number; error: string }[] } {
  const valid: z.infer<typeof MetricRowSchema>[] = [];
  const errors: { row: number; error: string }[] = [];
  rows.forEach((row, i) => {
    const result = MetricRowSchema.safeParse(row);
    if (result.success) valid.push(result.data);
    else errors.push({ row: i, error: result.error.issues.map(e => e.message).join('; ') });
  });
  return { valid, errors };
}

// Anomaly detection — flag values >3 standard deviations from rolling mean
// SELECT metric_name, value, timestamp,
//   AVG(value) OVER (PARTITION BY metric_name ORDER BY timestamp ROWS 30 PRECEDING) AS rolling_mean,
//   STDDEV(value) OVER (PARTITION BY metric_name ORDER BY timestamp ROWS 30 PRECEDING) AS rolling_std
// FROM metrics
// HAVING ABS(value - rolling_mean) > 3 * rolling_std;

// Data freshness monitor
async function checkFreshness(tables: string[], maxStaleMinutes: number) {
  const stale: string[] = [];
  for (const table of tables) {
    const result = await db.query(
      `SELECT EXTRACT(EPOCH FROM NOW() - MAX(updated_at)) / 60 AS minutes_stale FROM ${table}`
    );
    if (result.rows[0]?.minutes_stale > maxStaleMinutes) stale.push(table);
  }
  return stale;
}
```
