---
name: "subscription-billing"
pack: "@Topia/ecommerce"
description: "Subscription billing — trial management, proration, dunning (failed payment retry), plan changes mid-cycle, usage-based billing, cancellation flows."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# subscription-billing

Subscription billing — trial management, proration, dunning (failed payment retry), plan changes mid-cycle, usage-based billing, cancellation flows.

#### Workflow

**Step 1 — Detect subscription setup**
Use Grep to find: `stripe.subscriptions`, `subscription`, `recurring`, `billing_cycle`, `trial`, `prorate`, `dunning`. Check for Stripe Billing Portal, customer portal redirect, and subscription lifecycle webhook handlers.

**Step 2 — Audit subscription lifecycle**
Check for:
- Trial-to-paid transition: is payment method collected during trial signup? (If not, 60%+ of trials churn at conversion — Stripe data)
- Proration on plan change: `proration_behavior` defaults to `create_prorations` — mid-cycle upgrade charges immediately. Must explicitly choose behavior and communicate to user
- Failed payment handling: Stripe retries automatically per Smart Retries settings, but app must handle `invoice.payment_failed` webhook to notify user, restrict access, or trigger custom retry
- Cancellation: `cancel_at_period_end` vs immediate cancel — immediate loses remaining period revenue. Most SaaS should use `cancel_at_period_end` and show countdown
- Missing webhook handlers for: `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`
- Usage-based billing: meter events must be sent before invoice finalization (not after) — late events are lost

**Step 3 — Emit subscription patterns**
Emit: subscription creation with trial + payment method upfront, plan change with explicit proration, dunning webhook handler, and cancellation flow.

#### Example

```typescript
// Create subscription with trial — collect payment method upfront
async function createSubscription(customerId: string, priceId: string, trialDays: number) {
  // Verify customer has payment method BEFORE creating subscription
  const paymentMethods = await stripe.paymentMethods.list({
    customer: customerId, type: 'card',
  });
  if (paymentMethods.data.length === 0) {
    throw new Error('Payment method required before starting trial');
  }

  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    trial_period_days: trialDays,
    payment_settings: {
      payment_method_types: ['card'],
      save_default_payment_method: 'on_subscription',
    },
    trial_settings: {
      end_behavior: { missing_payment_method: 'cancel' }, // Auto-cancel if no card at trial end
    },
    expand: ['latest_invoice.payment_intent'],
  });
}

// Plan change with explicit proration
async function changePlan(subscriptionId: string, newPriceId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: subscription.items.data[0].id, price: newPriceId }],
    proration_behavior: 'always_invoice', // Charge/credit immediately
    payment_behavior: 'error_if_incomplete', // Fail if upgrade payment fails
  });
}

// Dunning webhook — restrict access after payment failure
app.post('/webhooks/subscription', async (req, res) => {
  const event = verifyStripeEvent(req);

  switch (event.type) {
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const attempt = invoice.attempt_count;
      if (attempt >= 3) {
        // After 3 failed retries, restrict access (don't cancel yet)
        await userService.setStatus(invoice.customer as string, 'past_due');
        await emailService.send(invoice.customer_email!, 'payment-failed-final');
      } else {
        await emailService.send(invoice.customer_email!, 'payment-failed-retry', { attempt });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await userService.deactivate(sub.customer as string);
      break;
    }
  }
  res.json({ received: true });
});
```
