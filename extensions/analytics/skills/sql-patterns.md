---
name: "sql-patterns"
pack: "@Topia/analytics"
description: "SQL query patterns for analytics — common aggregations, window functions, CTEs, performance optimization, and safe parameterized queries for analytics workloads."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# sql-patterns

SQL query patterns for analytics — common aggregations, window functions, CTEs, performance optimization, and safe parameterized queries for analytics workloads.

#### Workflow

**Step 1 — Detect database setup**
Use Grep to find database usage: `prisma`, `drizzle`, `knex`, `pg`, `mysql2`, `better-sqlite3`, `sql`, `SELECT`, `INSERT`. Identify: ORM vs raw SQL, database engine (PostgreSQL, MySQL, SQLite), migration tool, and query builder.

**Step 2 — Audit query quality**
Check for: string interpolation in SQL (injection risk), missing indexes on columns used in WHERE/JOIN/ORDER BY, N+1 queries in loops, SELECT * instead of specific columns, no pagination on large result sets, aggregations done client-side instead of database, and missing EXPLAIN ANALYZE on slow queries.

**Step 3 — Emit SQL patterns**
Emit patterns appropriate to the detected database engine.

#### Example

```sql
-- Time-bucketed metrics (PostgreSQL)
-- Use DATE_TRUNC for consistent time buckets
SELECT
  DATE_TRUNC('hour', created_at) AS bucket,
  COUNT(*) AS total_events,
  COUNT(DISTINCT user_id) AS unique_users,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_ms) AS p95_latency
FROM events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY bucket
ORDER BY bucket;

-- Running totals with window functions
SELECT date, daily_revenue,
  SUM(daily_revenue) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) AS cumulative_revenue,
  AVG(daily_revenue) OVER (ORDER BY date ROWS 6 PRECEDING) AS rolling_7d_avg
FROM daily_metrics;

-- Efficient pagination (keyset, not OFFSET)
-- BAD:  SELECT * FROM events ORDER BY id LIMIT 20 OFFSET 10000;
-- GOOD: cursor-based
SELECT * FROM events
WHERE id > $1  -- last seen ID
ORDER BY id
LIMIT 20;

-- Safe parameterized queries (NEVER string interpolation)
-- BAD:  `SELECT * FROM users WHERE id = ${userId}`
-- GOOD: prepared statement
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```
