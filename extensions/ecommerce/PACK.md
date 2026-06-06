---
name: "@Topia/ecommerce"
description: E-commerce patterns — Shopify development, payment integration, subscription billing, shopping cart, inventory management, order lifecycle, and tax compliance.
metadata:
  author: topia
  version: "0.3.0"
  layer: L4
  target: E-commerce developers
  format: split
---

# @Topia/ecommerce

## Purpose

E-commerce codebases fail at the seams between systems: payment intents that succeed but order records that don't get created, inventory counts that go negative during flash sales, subscription proration that charges the wrong amount mid-cycle, tax calculations that use cart-time rates instead of checkout-time rates, carts that lose items when users sign in, and webhook handlers that process the same event twice. This pack addresses the full order lifecycle — storefront to payment to fulfillment — with patterns that handle the race conditions, state machines, and distributed system problems that every commerce platform eventually hits.

## Triggers

- Auto-trigger: when `shopify.app.toml`, `*.liquid`, `cart`, `checkout`, `stripe` in payment context, `inventory` schema detected
- `/topia shopify-dev` — audit Shopify theme or app architecture
- `/topia payment-integration` — set up or audit payment flows
- `/topia subscription-billing` — set up or audit recurring billing
- `/topia cart-system` — build or audit cart architecture
- `/topia inventory-mgmt` — audit inventory tracking and stock management
- `/topia order-management` — audit order lifecycle and fulfillment
- `/topia tax-compliance` — set up or audit tax calculation
- Called by `build` (L1) when e-commerce project detected
- Called by `launch` (L1) when preparing storefront for production

## Skills Included

| Skill | Model | Description |
|-------|-------|-------------|
| [shopify-dev](skills/shopify-dev.md) | sonnet | Shopify theme, Hydrogen, app architecture — Liquid templates, Storefront API, metafields, webhook HMAC verification. |
| [payment-integration](skills/payment-integration.md) | sonnet | Stripe, 3DS, webhooks, fraud detection, multi-currency, Vietnamese gateways (SePay, VNPay, MoMo). |
| [subscription-billing](skills/subscription-billing.md) | sonnet | Trials, proration, dunning, plan changes mid-cycle, usage-based billing, cancellation flows. |
| [cart-system](skills/cart-system.md) | sonnet | Persistent carts, guest-to-auth merge, server-authoritative totals, coupon engine. |
| [inventory-mgmt](skills/inventory-mgmt.md) | sonnet | Atomic stock with optimistic locking, reservations, low-stock alerts, backorder handling. |
| [order-management](skills/order-management.md) | sonnet | State machine, fulfillment, refund/return flows, reconciliation, webhook fan-out. |
| [tax-compliance](skills/tax-compliance.md) | sonnet | Tax APIs, EU VAT reverse charge, digital goods tax, audit trail per order line item. |

## Common Workflows

| Workflow | Skills Involved | Description |
|----------|----------------|-------------|
| Full checkout | cart-system → tax-compliance → payment-integration → order-management | Complete purchase from cart to confirmation |
| Flash sale | inventory-mgmt → cart-system → payment-integration | High-concurrency stock control |
| Subscription signup | cart-system → payment-integration → subscription-billing | Free trial with payment method upfront |
| Plan upgrade | subscription-billing → payment-integration → tax-compliance | Mid-cycle upgrade with proration invoice |
| Order cancellation | order-management → inventory-mgmt → payment-integration | Cancel + release stock + issue refund |
| New market launch | tax-compliance → payment-integration (multi-currency) → shopify-dev | Localization, VAT, FX pricing |
| Fraud review | payment-integration (fraud patterns) → order-management | Risk scoring before order fulfilment |
| Product catalog | shopify-dev → inventory-mgmt | Variant structure + stock sync |

## Tech Stack Support

| Platform | Framework | Payment | Notes |
|----------|-----------|---------|-------|
| Shopify | Hydrogen 2.x (Remix) | Shopify Payments | Storefront + Admin API |
| Custom | Next.js 16 / SvelteKit | Stripe | Most flexible |
| Headless | Any frontend | Stripe / PayPal | API-first commerce |
| Medusa.js | Next.js | Stripe / PayPal | Open-source alternative |
| Saleor | React / Next.js | Stripe / Braintree | GraphQL-first |

## Connections

```
Calls → sentinel (L2): PCI compliance audit on payment code, webhook security
Calls → db (L2): schema design for orders, inventory, carts, subscriptions
Calls → perf (L2): audit checkout page load, cart update latency
Calls → verification (L3): run payment flow integration tests
Called By ← build (L1): when e-commerce project detected
Called By ← launch (L1): pre-launch checkout verification
Called By ← review (L2): when payment or cart code under review
Called By ← idea (L2): requirements elicitation for e-commerce features
```

## Constraints

1. MUST use idempotency keys derived from cart ID + version — never timestamp-based keys for Payment Intents.
2. MUST use raw request body (`express.raw`) for Stripe webhook signature verification — parsed JSON breaks HMAC.
3. MUST use optimistic locking or serializable isolation for inventory during high-concurrency sales.
4. MUST store webhook `event.id` and check before processing — duplicate events create duplicate orders.
5. MUST wrap payment + order creation in a transaction — money taken without order record is a critical failure.

## Sharp Edges

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Double charge from retried Payment Intent without idempotency key | CRITICAL | Derive idempotencyKey from `cartId-v${version}`, not timestamp; check for existing succeeded intent |
| Webhook signature fails because `req.body` is parsed JSON instead of raw bytes | CRITICAL | Use `express.raw({ type: 'application/json' })` for webhook route; verify with `req.body` as Buffer |
| Overselling during flash sale (stock goes negative) | CRITICAL | Use optimistic locking with version field; serializable isolation for high-contention items |
| Payment succeeded but order creation fails (money taken, no order record) | HIGH | Wrap in transaction; run reconciliation job matching payment intents to orders every hour |
| Same webhook processed twice creates duplicate orders | HIGH | Store `event.id` in database; check before processing; wrap in transaction |
| Guest cart items lost on login (separate cart created for auth user) | HIGH | Implement cart merge in auth callback; prefer server cart state over local |
| Subscription proration charges wrong amount on mid-cycle plan change | HIGH | Explicitly set `proration_behavior`; preview proration with `stripe.invoices.retrieveUpcoming` |
| Trial-to-paid conversion fails silently (no payment method on file) | HIGH | Require payment method at trial signup; set `missing_payment_method: 'cancel'` in trial settings |
| Tax calculated at cart time but rate changed by checkout (wrong amount charged) | MEDIUM | Recalculate tax at payment creation time using shipping address, not cart-add time |
| Liquid template outputs unescaped metafield content (XSS in Shopify theme) | HIGH | Always use `| escape` filter on user-generated metafield values |
| Cancelled order stock not returned to inventory | MEDIUM | Use order state machine with side effects — cancellation always triggers `releaseOrderReservations` |
| Reservation never expires for abandoned checkout (stock locked forever) | MEDIUM | Run reservation expiry job every 5 minutes; default reservation TTL = 15 minutes |
| Stolen card fraud passes payment but triggers chargeback later | HIGH | Apply fraud scoring before confirmation; hold high-risk orders for manual review |
| FX rate stale on multi-currency display — user sees wrong price | MEDIUM | Cache FX rates max 15 minutes; show rate timestamp to user; always charge in store base currency |

## Done When

- Checkout flow completes end-to-end: cart → tax → payment → order confirmation
- Subscription lifecycle handles trial → active → past_due → cancelled with proper dunning
- Inventory accurately tracks stock with no overselling under concurrent load
- Order state machine enforces valid transitions with side effects (stock release, refunds, notifications)
- Webhooks are idempotent, signature-verified, and handle all payment/subscription lifecycle events
- Tax calculated at checkout with audit trail stored per order line item
- Guest-to-authenticated cart merge works without data loss
- All prices, discounts, and coupons validated server-side
- Reconciliation job catches payment/order mismatches
- Fraud scoring applied to all orders; high-risk orders flagged for review
- Multi-currency display works with cached FX rates; charges always in base currency
- Structured report emitted for each skill invoked

## Cost Profile

~14,000–26,000 tokens per full pack run (all 7 skills). Individual skill: ~2,000–4,000 tokens. Sonnet default. Use haiku for detection scans; escalate to sonnet for payment flow, subscription lifecycle, and order state machine generation.
