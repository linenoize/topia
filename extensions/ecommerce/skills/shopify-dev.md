---
name: "shopify-dev"
pack: "@Topia/ecommerce"
description: "Shopify development patterns — Liquid templates, Shopify API, Hydrogen/Remix storefronts, metafields, theme architecture, webhook HMAC verification."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# shopify-dev

Shopify development patterns — Liquid templates, Shopify API, Hydrogen/Remix storefronts, metafields, theme architecture, webhook HMAC verification.

#### Workflow

**Step 1 — Detect Shopify architecture**
Use Glob to find `shopify.app.toml`, `*.liquid`, `remix.config.*`, `hydrogen.config.*`. Use Grep to find Storefront API queries (`#graphql`), Admin API calls, metafield references, and API version strings. Classify: theme app extension, custom app, or Hydrogen storefront.

**Step 2 — Audit theme and API usage**
Check for:
- Liquid templates without `| escape` filter on user-generated metafield content (XSS vulnerability)
- Storefront API queries without pagination (`first: 250` max — cursor-based pagination required for larger sets)
- Hardcoded product IDs or variant IDs (break when products are recreated)
- Missing metafield type validation (metafield can be deleted/recreated with different type)
- Theme sections without `schema` blocks (limits merchant customization)
- Deprecated API version usage (Shopify deprecates versions on a rolling 12-month cycle)
- Webhook handlers without HMAC signature verification (anyone can POST fake events)

**Step 3 — Emit optimized patterns**
For Hydrogen: emit typed Storefront API loader with proper caching and pagination. For theme: emit section schema with metafield integration. For apps: emit webhook handler with HMAC verification and idempotency.

#### Example

```typescript
// Hydrogen — typed Storefront API loader with caching + pagination
import { json, type LoaderFunctionArgs } from '@shopify/remix-oxygen';

const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title
        variants(first: 10) {
          nodes { id title price { amount currencyCode } availableForSale }
        }
        metafield(namespace: "custom", key: "care_instructions") { value type }
      }
    }
  }
` as const;

export async function loader({ context }: LoaderFunctionArgs) {
  const { products } = await context.storefront.query(PRODUCTS_QUERY, {
    variables: { first: 24 },
    cache: context.storefront.CacheLong(),
  });
  return json({ products });
}

// Webhook handler with HMAC verification (Express)
import crypto from 'crypto';

function verifyShopifyWebhook(req: Request, secret: string): boolean {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  const body = (req as any).rawBody; // Must capture raw body before JSON parse
  const hash = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac));
}
```
