---
name: "funnel-analysis"
pack: "@Topia/analytics"
description: "Funnel analysis — conversion tracking, drop-off identification, cohort analysis, retention metrics, LTV calculation, attribution modeling."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# funnel-analysis

Funnel analysis — conversion tracking, drop-off identification, cohort analysis, retention metrics, LTV calculation, attribution modeling.

#### Workflow

**Step 1 — Detect funnel tracking**
Use Grep to find funnel-related code: `funnel`, `conversion`, `step`, `checkout.*step`, `onboarding.*step`, `cohort`, `retention`. Read event tracking calls to understand: which user journey steps are tracked, how step completion is determined, and where drop-off data is collected.

**Step 2 — Audit funnel completeness**
Check for: missing steps in the funnel (gap between "add to cart" and "payment complete" — no "checkout started"), step events not including a session or flow ID (can't link steps to same journey), no timestamp on steps (can't measure time between steps), no segmentation on funnel data (can't compare mobile vs desktop conversion), and no drop-off alerting.

**Step 3 — Emit funnel patterns**
Emit: typed funnel step tracker with flow ID, funnel aggregation query (SQL), drop-off rate calculator, cohort retention matrix, and simple LTV estimation.

#### Example

```typescript
// Funnel step tracker with flow correlation
interface FunnelStep {
  funnelId: string;
  flowId: string;      // ties steps to same user journey
  step: string;
  stepIndex: number;
  userId: string;
  timestamp: number;
  metadata?: Record<string, string | number>;
}

const CHECKOUT_FUNNEL = ['cart_viewed', 'checkout_started', 'shipping_entered', 'payment_entered', 'order_completed'] as const;

function trackFunnelStep(step: typeof CHECKOUT_FUNNEL[number], flowId: string, meta?: Record<string, string | number>) {
  const event: FunnelStep = {
    funnelId: 'checkout',
    flowId,
    step,
    stepIndex: CHECKOUT_FUNNEL.indexOf(step),
    userId: getCurrentUserId(),
    timestamp: Date.now(),
    metadata: meta,
  };
  analytics.track({ name: 'funnel_step', properties: event });
}

// SQL — funnel drop-off analysis (PostgreSQL)
// SELECT step, COUNT(DISTINCT flow_id) as users,
//   LAG(COUNT(DISTINCT flow_id)) OVER (ORDER BY step_index) as prev_users,
//   ROUND(COUNT(DISTINCT flow_id)::numeric /
//     LAG(COUNT(DISTINCT flow_id)) OVER (ORDER BY step_index) * 100, 1) as conversion_pct
// FROM funnel_events
// WHERE funnel_id = 'checkout' AND timestamp > NOW() - INTERVAL '30 days'
// GROUP BY step, step_index ORDER BY step_index;

// Cohort retention matrix
async function cohortRetention(cohortField: string, periods: number) {
  return db.execute(sql`
    WITH cohorts AS (
      SELECT user_id, DATE_TRUNC('week', MIN(created_at)) AS cohort_week
      FROM events WHERE name = 'signup_completed'
      GROUP BY user_id
    ),
    activity AS (
      SELECT user_id, DATE_TRUNC('week', timestamp) AS active_week
      FROM events GROUP BY user_id, DATE_TRUNC('week', timestamp)
    )
    SELECT c.cohort_week, EXTRACT(WEEK FROM a.active_week - c.cohort_week) AS week_number,
      COUNT(DISTINCT a.user_id) AS active_users
    FROM cohorts c JOIN activity a ON c.user_id = a.user_id
    WHERE a.active_week >= c.cohort_week
    GROUP BY c.cohort_week, week_number ORDER BY c.cohort_week, week_number
  `);
}
```
