---
name: "cart-system"
pack: "@Topia/ecommerce"
description: "Shopping cart architecture — state management, persistent carts, guest checkout, coupon/discount engine, guest-to-auth cart merge."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# cart-system

Shopping cart architecture — state management, persistent carts, guest checkout, coupon/discount engine, guest-to-auth cart merge.

#### Workflow

**Step 1 — Detect cart architecture**
Use Grep to find cart state: `cartStore`, `useCart`, `addToCart`, `localStorage.*cart`, `session.*cart`. Read cart-related components and API routes to understand: client vs server cart, persistence strategy, and discount handling.

**Step 2 — Audit cart integrity**
Check for:
- Cart total calculated client-side only (price manipulation — attacker changes localStorage price)
- No cart TTL (stale carts hold inventory reservations indefinitely)
- Missing guest-to-authenticated cart merge (items lost on login)
- Race conditions on concurrent cart updates (two tabs adding items, last write wins)
- Coupons validated client-side (attacker applies any discount code)
- No stock check at add-to-cart time (user adds 100 items, stock is 3)
- Cart stored in localStorage only (lost on device switch, no cross-device)

**Step 3 — Emit cart patterns**
Emit: server-authoritative cart with client cache, guest-to-auth merge flow, coupon validation middleware, and optimistic UI with server reconciliation.

#### Example

```typescript
// Server-authoritative cart with Zustand client cache
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  addItem: (productId: string, variantId: string, qty: number) => Promise<void>;
  mergeGuestCart: (userId: string) => Promise<void>;
}

const useCart = create<CartStore>()(persist((set, get) => ({
  items: [], cartId: null,

  addItem: async (productId, variantId, qty) => {
    // Optimistic update (show item immediately)
    set(state => ({ items: [...state.items, { productId, variantId, qty, pending: true }] }));
    // Server reconciliation (validates stock, calculates price, applies discounts)
    const cart = await fetch('/api/cart/add', {
      method: 'POST',
      body: JSON.stringify({ cartId: get().cartId, productId, variantId, qty }),
    }).then(r => r.json());
    set({ items: cart.items, cartId: cart.id }); // server is source of truth
  },

  mergeGuestCart: async (userId) => {
    const { cartId } = get();
    if (!cartId) return;
    const merged = await fetch('/api/cart/merge', {
      method: 'POST', body: JSON.stringify({ guestCartId: cartId, userId }),
    }).then(r => r.json());
    set({ items: merged.items, cartId: merged.id });
  },
}), { name: 'cart-storage' }));

// Server — coupon validation (NEVER trust client)
app.post('/api/cart/apply-coupon', async (req, res) => {
  const { cartId, code } = req.body;
  const coupon = await couponService.validate(code); // checks: exists, not expired, usage limit
  if (!coupon) return res.status(400).json({ error: 'INVALID_COUPON' });

  const cart = await cartService.applyCoupon(cartId, coupon);
  // Recalculate totals server-side after discount
  res.json({ cart: cartService.calculateTotals(cart) });
});
```
