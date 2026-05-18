---
name: "tracking-setup"
pack: "@Topia/analytics"
description: "Analytics tracking — Google Analytics 4, Plausible, PostHog, Mixpanel. Event taxonomy design, consent management, server-side tracking, UTM handling."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# tracking-setup

Analytics tracking — Google Analytics 4, Plausible, PostHog, Mixpanel. Event taxonomy design, consent management, server-side tracking, UTM handling.

#### Workflow

**Step 1 — Detect tracking setup**
Use Grep to find analytics code: `gtag`, `posthog.capture`, `mixpanel.track`, `plausible`, `analytics.track`, `useAnalytics`. Read the tracking initialization and event calls to understand: analytics provider, event naming convention, consent flow, and client vs server-side tracking.

**Step 2 — Audit tracking quality**
Check for: inconsistent event naming (mix of `snake_case`, `camelCase`, `kebab-case`), missing consent management (GDPR violation), tracking scripts blocking page load (performance impact), no event taxonomy document (ad-hoc event names), UTM parameters not captured on landing, user identification happening before consent, and no server-side tracking fallback (ad blockers lose 30-40% of events).

**Step 3 — Emit tracking patterns**
Emit: typed event taxonomy with auto-complete, consent-aware analytics wrapper, server-side event proxy for ad-blocker resistance, UTM capture and persistence utility, and page view tracking with proper SPA handling.

#### Example

```typescript
// Type-safe analytics wrapper with consent management
type AnalyticsEvent =
  | { name: 'page_view'; properties: { path: string; referrer: string } }
  | { name: 'signup_started'; properties: { method: 'email' | 'google' | 'github' } }
  | { name: 'feature_used'; properties: { feature: string; plan: string } }
  | { name: 'checkout_started'; properties: { plan: string; billing: 'monthly' | 'annual' } }
  | { name: 'checkout_completed'; properties: { plan: string; revenue: number; currency: string } };

class Analytics {
  private consent: 'granted' | 'denied' | 'pending' = 'pending';
  private queue: AnalyticsEvent[] = [];

  updateConsent(status: 'granted' | 'denied') {
    this.consent = status;
    if (status === 'granted') {
      this.queue.forEach(e => this.send(e));
      this.queue = [];
    } else {
      this.queue = [];
    }
  }

  track<E extends AnalyticsEvent>(event: E) {
    if (this.consent === 'denied') return;
    if (this.consent === 'pending') { this.queue.push(event); return; }
    this.send(event);
  }

  private send(event: AnalyticsEvent) {
    // Client-side (may be blocked)
    window.gtag?.('event', event.name, event.properties);
    // Server-side fallback (ad-blocker resistant)
    navigator.sendBeacon('/api/analytics', JSON.stringify(event));
  }
}

// UTM capture — run on landing page
function captureUtm() {
  const params = new URLSearchParams(window.location.search);
  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const utm: Record<string, string> = {};
  utmKeys.forEach(key => { if (params.has(key)) utm[key] = params.get(key)!; });
  if (Object.keys(utm).length) sessionStorage.setItem('utm', JSON.stringify(utm));
}
```
