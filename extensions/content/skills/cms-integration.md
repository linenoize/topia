---
name: "cms-integration"
pack: "@Topia/content"
description: "Sanity, Contentful, Strapi, PocketBase. Content modeling, preview mode, webhook-triggered rebuilds, draft/published workflows."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# cms-integration

CMS integration — Sanity, Contentful, Strapi, PocketBase. Content modeling, preview mode, webhook-triggered rebuilds, draft/published workflows.

#### Workflow

**Step 1 — Detect CMS setup**
Use Grep to find CMS SDK usage: `createClient` (Sanity), `contentful`, `strapi`, `PocketBase`, `GROQ`, `graphql` in content-fetching files. Read the CMS client initialization and content queries to understand: CMS provider, content types, preview mode setup, and caching strategy.

**Step 2 — Audit CMS integration**
Check for: no preview/draft mode (editors can't preview before publish), missing webhook for on-demand ISR (content updates require full rebuild), no content validation (malformed CMS data crashes the page), stale cache without revalidation strategy, images served from CMS without optimization (no next/image or equivalent), and missing error boundary for CMS fetch failures.

**Step 3 — Emit CMS patterns**
For Sanity: emit typed GROQ queries with Zod validation, preview mode toggle, and webhook handler. For Contentful: emit typed GraphQL queries, draft/published content switching. For any CMS: emit ISR revalidation endpoint and image optimization pipeline.

#### Example — Sanity

```typescript
// Sanity — typed client with preview mode and ISR webhook
import { createClient, type QueryParams } from '@sanity/client';
import { z } from 'zod';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID!,
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: true,
});

const previewClient = client.withConfig({ useCdn: false, token: process.env.SANITY_PREVIEW_TOKEN });

const PostSchema = z.object({
  _id: z.string(),
  title: z.string(),
  slug: z.string(),
  body: z.array(z.any()),
  publishedAt: z.string().datetime(),
  author: z.object({ name: z.string(), image: z.string().url().optional() }),
});

export async function getPost(slug: string, preview = false) {
  const query = `*[_type == "post" && slug.current == $slug][0]{
    _id, title, "slug": slug.current, body, publishedAt,
    "author": author->{ name, "image": image.asset->url }
  }`;
  const result = await (preview ? previewClient : client).fetch(query, { slug });
  return PostSchema.parse(result);
}

// Webhook handler for on-demand ISR — app/api/revalidate/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  const secret = req.headers.get('x-sanity-webhook-secret');
  if (secret !== process.env.SANITY_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { revalidatePath } = await import('next/cache');
  revalidatePath(`/blog/${body.slug.current}`);
  return Response.json({ revalidated: true });
}
```

#### Example — Contentful

```typescript
// Contentful — typed GraphQL with draft/published switching
import { createClient } from 'contentful';

const client = createClient({
  space: process.env.CONTENTFUL_SPACE_ID!,
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN!,
});

const previewClient = createClient({
  space: process.env.CONTENTFUL_SPACE_ID!,
  accessToken: process.env.CONTENTFUL_PREVIEW_TOKEN!,
  host: 'preview.contentful.com',
});

export async function getArticle(slug: string, preview = false) {
  const c = preview ? previewClient : client;
  const entries = await c.getEntries({
    content_type: 'article',
    'fields.slug': slug,
    include: 2,
    limit: 1,
  });
  if (!entries.items.length) return null;
  const entry = entries.items[0];
  return {
    title: entry.fields.title as string,
    slug: entry.fields.slug as string,
    body: entry.fields.body,
    publishedAt: entry.sys.createdAt,
  };
}
```

#### Example — Strapi

```typescript
// Strapi v5 — REST with populate and draft/live modes
const STRAPI = process.env.STRAPI_URL ?? 'http://localhost:1337';
const TOKEN = process.env.STRAPI_API_TOKEN!;

async function strapiGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${STRAPI}/api${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Strapi error: ${res.status}`);
  return res.json();
}

export const getArticles = () =>
  strapiGet<{ data: StrapiArticle[] }>('/articles', {
    'filters[publishedAt][$notNull]': 'true',
    'populate': 'cover,author,category',
    'sort': 'publishedAt:desc',
  });
```
