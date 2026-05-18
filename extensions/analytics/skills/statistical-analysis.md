---
name: "statistical-analysis"
pack: "@Topia/analytics"
description: "Statistical analysis patterns — significance testing, regression basics, distribution analysis, and correlation detection for product metrics."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# statistical-analysis

Statistical analysis patterns — significance testing, regression basics, distribution analysis, and correlation detection for product metrics.

#### Workflow

**Step 1 — Identify analysis need**
Determine what type of analysis is needed: comparing two groups (A/B test significance), finding relationships (correlation), predicting values (regression), understanding distribution (histogram, percentiles), or detecting trends (time series decomposition).

**Step 2 — Select method**

| Question | Method | When to use |
|----------|--------|-------------|
| "Is A different from B?" | Two-sample t-test or Chi-square | Comparing conversion rates, revenue per user |
| "Are these correlated?" | Pearson/Spearman correlation | Feature usage vs retention, price vs conversion |
| "What predicts Y?" | Linear/logistic regression | Churn prediction, revenue forecasting |
| "What's the distribution?" | Histogram + percentiles | Response times, order values, session lengths |
| "Is this trend real?" | Mann-Kendall or linear regression on time | Month-over-month growth, seasonal patterns |

**Step 3 — Emit analysis patterns**

#### Example

```typescript
// Chi-square significance test for A/B conversion rates
function chiSquareTest(
  controlConversions: number, controlTotal: number,
  treatmentConversions: number, treatmentTotal: number
): { chiSquare: number; pValue: number; significant: boolean } {
  const controlRate = controlConversions / controlTotal;
  const treatmentRate = treatmentConversions / treatmentTotal;
  const pooledRate = (controlConversions + treatmentConversions) / (controlTotal + treatmentTotal);

  const expected = [
    [controlTotal * pooledRate, controlTotal * (1 - pooledRate)],
    [treatmentTotal * pooledRate, treatmentTotal * (1 - pooledRate)],
  ];
  const observed = [
    [controlConversions, controlTotal - controlConversions],
    [treatmentConversions, treatmentTotal - treatmentConversions],
  ];

  let chiSq = 0;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      chiSq += Math.pow(observed[i][j] - expected[i][j], 2) / expected[i][j];
    }
  }

  // p-value approximation for 1 degree of freedom
  const pValue = 1 - normalCDF(Math.sqrt(chiSq));
  return { chiSquare: chiSq, pValue, significant: pValue < 0.05 };
}

// Percentile calculation (for response time analysis, order values, etc.)
function percentiles(values: number[], points: number[] = [50, 75, 90, 95, 99]): Record<string, number> {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(
    points.map(p => [`p${p}`, sorted[Math.ceil((p / 100) * sorted.length) - 1]])
  );
}

// SQL — Correlation between two metrics (PostgreSQL)
// SELECT CORR(feature_usage_count, retention_days) AS correlation,
//   CASE
//     WHEN ABS(CORR(feature_usage_count, retention_days)) > 0.7 THEN 'strong'
//     WHEN ABS(CORR(feature_usage_count, retention_days)) > 0.4 THEN 'moderate'
//     ELSE 'weak'
//   END AS strength
// FROM user_metrics;
```
