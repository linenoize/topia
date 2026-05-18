---
name: "dashboard-patterns"
pack: "@Topia/analytics"
description: "Analytics dashboard design — KPI cards, time series charts, comparison views, drill-down navigation, export functionality, real-time counters."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# dashboard-patterns

Analytics dashboard design — KPI cards, time series charts, comparison views, drill-down navigation, export functionality, real-time counters.

#### Workflow

**Step 1 — Detect dashboard components**
Use Grep to find dashboard code: `Chart`, `recharts`, `chart.js`, `d3`, `tremor`, `KPI`, `metric`, `dashboard`. Read dashboard pages and data fetching to understand: charting library, data source (API, database, analytics provider), refresh strategy, and component structure.

**Step 2 — Audit dashboard performance**
Check for: all data fetched on page load (no lazy loading for off-screen charts), no time range selector (stuck on one period), raw data sent to client for aggregation (should aggregate server-side), no loading states (charts pop in), missing comparison period (no "vs last week"), no data export, and charts re-rendering on unrelated state changes.

**Step 3 — Emit dashboard patterns**
Emit: KPI card with comparison indicator, time series chart with range selector, server-side aggregation endpoint, lazy-loaded chart sections, and CSV export utility.

#### Example

```tsx
// Dashboard KPI card with comparison
interface KpiProps {
  label: string;
  value: number;
  previousValue: number;
  format: 'number' | 'currency' | 'percent';
}

function KpiCard({ label, value, previousValue, format }: KpiProps) {
  const change = previousValue ? ((value - previousValue) / previousValue) * 100 : 0;
  const formatted = format === 'currency'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
    : format === 'percent'
    ? `${value.toFixed(1)}%`
    : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(value);

  return (
    <div className="rounded-lg border bg-card p-6">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold font-mono mt-1">{formatted}</p>
      <p className={`text-sm mt-1 ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
        {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs previous period
      </p>
    </div>
  );
}

// Server-side aggregation endpoint — app/api/metrics/route.ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || '7d';
  const interval = range === '24h' ? 'hour' : range === '7d' ? 'day' : 'week';

  const metrics = await db.execute(sql`
    SELECT DATE_TRUNC(${interval}, timestamp) AS period,
      COUNT(*) AS page_views,
      COUNT(DISTINCT user_id) AS unique_visitors,
      COUNT(*) FILTER (WHERE name = 'signup_completed') AS signups
    FROM events
    WHERE timestamp > NOW() - ${range}::interval
    GROUP BY period ORDER BY period
  `);
  return Response.json(metrics);
}

// CSV export utility
function exportCsv(data: Record<string, unknown>[], filename: string) {
  const headers = Object.keys(data[0]);
  const csv = [headers.join(','), ...data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
```
