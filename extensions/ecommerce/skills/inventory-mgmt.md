---
name: "inventory-mgmt"
pack: "@Topia/ecommerce"
description: "Inventory management — stock tracking with optimistic locking, variant management, low stock alerts, backorder handling, reservation expiry."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# inventory-mgmt

Inventory management — stock tracking with optimistic locking, variant management, low stock alerts, backorder handling, reservation expiry.

#### Workflow

**Step 1 — Detect inventory model**
Use Grep to find stock-related code: `stock`, `inventory`, `quantity`, `variant`, `warehouse`, `sku`. Read schema files to understand: single vs multi-warehouse, variant structure, and reservation model.

**Step 2 — Audit stock integrity**
Check for:
- Stock decremented without transaction (oversell risk under concurrent load)
- No optimistic locking on concurrent updates (version field or `FOR UPDATE` lock)
- Inventory checked at cart-add but not at checkout (stale check — stock sold out between add and pay)
- Missing low-stock alerts (ops team discovers stockout from customer complaints)
- No reservation expiry for abandoned checkouts (stock locked forever)
- No backorder handling for out-of-stock items (zero stock = hard error vs queue)
- Flash sale race condition: 10 users checkout simultaneously with 3 items left = 7 oversold orders

**Step 3 — Emit inventory patterns**
Emit: atomic stock reservation with optimistic locking (version field), reservation expiry job for abandoned checkouts, low-stock alert trigger, and backorder queue.

#### Example

```typescript
// Atomic stock reservation with optimistic locking (Prisma)
async function reserveStock(variantId: string, qty: number, orderId: string) {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const variant = await prisma.variant.findUniqueOrThrow({ where: { id: variantId } });

    if (variant.stock < qty && !variant.allowBackorder) {
      throw new Error(`Insufficient stock: ${variant.stock} available, ${qty} requested`);
    }

    try {
      const updated = await prisma.variant.update({
        where: { id: variantId, version: variant.version }, // optimistic lock
        data: {
          stock: { decrement: qty },
          version: { increment: 1 },
          reservations: { create: { orderId, qty, expiresAt: addMinutes(new Date(), 15) } },
        },
      });

      if (updated.stock <= updated.lowStockThreshold) {
        await alertService.trigger('LOW_STOCK', { variantId, currentStock: updated.stock });
      }
      return updated;
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw new Error('Stock reservation failed: concurrent modification');
    }
  }
}

// Reservation expiry job — release stock from abandoned checkouts
async function releaseExpiredReservations() {
  const expired = await prisma.reservation.findMany({
    where: { expiresAt: { lt: new Date() }, status: 'PENDING' },
  });

  for (const reservation of expired) {
    await prisma.$transaction([
      prisma.variant.update({
        where: { id: reservation.variantId },
        data: { stock: { increment: reservation.qty } },
      }),
      prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'EXPIRED' },
      }),
    ]);
  }
}

// Inventory webhook — push stock changes to external systems (3PL, ERP)
async function emitInventoryWebhook(variantId: string, newStock: number, event: string) {
  const variant = await prisma.variant.findUniqueOrThrow({
    where: { id: variantId },
    include: { product: true },
  });
  const payload = {
    event,                          // 'STOCK_UPDATED' | 'LOW_STOCK' | 'OUT_OF_STOCK'
    sku: variant.sku,
    variantId,
    productId: variant.productId,
    stock: newStock,
    threshold: variant.lowStockThreshold,
    timestamp: new Date().toISOString(),
  };
  // Fan-out to all registered webhook endpoints
  await webhookFanOut(payload, 'inventory.*');
}
```
