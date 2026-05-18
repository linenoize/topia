---
name: "ab-testing"
pack: "@Topia/analytics"
description: "A/B testing patterns — experiment design, statistical significance, feature flags (LaunchDarkly, Unleash), rollout strategies, result analysis."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ab-testing

A/B testing patterns — experiment design, statistical significance, feature flags (LaunchDarkly, Unleash), rollout strategies, result analysis.

#### Workflow

**Step 1 — Detect experiment setup**
Use Grep to find experiment code: `useFeatureFlag`, `useExperiment`, `LaunchDarkly`, `Unleash`, `GrowthBook`, `variant`, `experiment`. Read feature flag initialization and variant assignment to understand: flag provider, assignment method (random, user-based, percentage), and metric collection.

**Step 2 — Audit experiment validity**
Check for: no sample size calculation (experiment runs indefinitely), peeking at results before significance (inflated false positive rate), no control group definition, variant assignment not persisted across sessions (same user sees different variants), metrics not tracked per-variant (can't measure impact), and feature flags without cleanup (dead flags accumulate).

**Step 3 — Emit experiment patterns**
Emit: experiment setup with sample size calculator, persistent variant assignment (cookie/user-ID based), metric collection per variant, significance calculator, and feature flag lifecycle with cleanup reminder.

#### Example

```typescript
// A/B experiment with persistent assignment and significance check
import { z } from 'zod';

const ExperimentSchema = z.object({
  id: z.string(),
  variants: z.array(z.object({ id: z.string(), weight: z.number() })),
  metrics: z.array(z.string()),
});

// Persistent variant assignment (deterministic hash)
function assignVariant(userId: string, experimentId: string, variants: { id: string; weight: number }[]): string {
  const hash = cyrb53(`${userId}:${experimentId}`);
  const normalized = (hash % 10000) / 10000; // [0, 1)
  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight;
    if (normalized < cumulative) return variant.id;
  }
  return variants[variants.length - 1].id;
}

// Simple hash function (deterministic, fast)
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// Sample size calculator (two-proportion z-test)
function requiredSampleSize(baselineRate: number, mde: number, power = 0.8, alpha = 0.05): number {
  const zAlpha = 1.96; // alpha=0.05 two-tailed
  const zBeta = 0.842; // power=0.8
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + mde);
  const pooled = (p1 + p2) / 2;
  return Math.ceil(
    (2 * pooled * (1 - pooled) * Math.pow(zAlpha + zBeta, 2)) / Math.pow(p2 - p1, 2),
  );
}
```
