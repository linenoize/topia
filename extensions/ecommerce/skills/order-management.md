---
name: "order-management"
pack: "@Topia/ecommerce"
description: "Order lifecycle — state machine, fulfillment workflows, refund/return flows, email notifications, reconciliation, webhook fan-out."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# order-management

Order lifecycle — state machine, fulfillment workflows, refund/return flows, email notifications, reconciliation, webhook fan-out.

#### Workflow

**Step 1 — Detect order model**
Use Grep to find: `order`, `fulfillment`, `shipment`, `refund`, `return`, `order_status`, `OrderStatus`. Read schema to understand: order states, fulfillment model (self-ship, 3PL, dropship), and refund handling.

**Step 2 — Audit order lifecycle**
Check for:
- No explicit state machine: order status updated with raw string assignment (typos, invalid transitions)
- Missing reconciliation: payment succeeded but order creation failed (payment taken, no order)
- Partial fulfillment not handled: multi-item order with one item backordered
- Refund without inventory return: money refunded but stock not incremented back
- No email notifications on state transitions (customer has no visibility)
- Cancellation after partial fulfillment: must refund only unfulfilled items

**Step 3 — Emit order patterns**
Emit: typed state machine with valid transitions, reconciliation job, partial fulfillment handler, and refund flow with inventory return.

#### Example

```typescript
// Order state machine with valid transitions
type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'partially_shipped' |
                   'shipped' | 'delivered' | 'cancelled' | 'refunded';

const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['partially_shipped', 'shipped', 'cancelled'],
  partially_shipped: ['shipped', 'cancelled'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

async function transitionOrder(orderId: string, newStatus: OrderStatus) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const currentStatus = order.status as OrderStatus;

  if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw new Error(`Invalid transition: ${currentStatus} → ${newStatus}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        statusHistory: { push: { from: currentStatus, to: newStatus, at: new Date() } },
      },
    });

    // Side effects per transition
    if (newStatus === 'cancelled') {
      await releaseOrderReservations(tx, orderId);
    }
    if (newStatus === 'refunded') {
      await processRefund(tx, orderId);
      await returnInventory(tx, orderId);
    }

    return result;
  });

  // Notifications (outside transaction — don't block on email)
  await notificationService.orderStatusChanged(updated);
  return updated;
}

// Reconciliation job — find payments without orders
async function reconcilePayments() {
  const recentIntents = await stripe.paymentIntents.list({
    created: { gte: Math.floor(Date.now() / 1000) - 3600 }, // last hour
    limit: 100,
  });

  for (const intent of recentIntents.data) {
    if (intent.status !== 'succeeded') continue;
    const cartId = intent.metadata.cartId;
    const order = await prisma.order.findFirst({ where: { paymentIntentId: intent.id } });

    if (!order) {
      // Payment succeeded but order not created — create it now
      await orderService.createFromIntent(intent);
      await alertService.trigger('RECONCILED_ORDER', { intentId: intent.id, cartId });
    }
  }
}

// Webhook fan-out for order status changes — notify 3PLs, ERPs, analytics
async function webhookFanOut(payload: Record<string, unknown>, topic: string) {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { topics: { has: topic }, active: true },
  });
  await Promise.allSettled(
    endpoints.map(ep =>
      fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Topia-Signature': signPayload(payload, ep.secret),
          'X-Topia-Topic': topic,
          'X-Topia-Timestamp': String(Date.now()),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      }).catch(err => {
        // Log failure but don't throw — one bad endpoint shouldn't block others
        console.error(`Webhook delivery failed for ${ep.url}:`, err.message);
      })
    )
  );
}
```
