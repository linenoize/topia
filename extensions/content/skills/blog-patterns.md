---
name: "blog-patterns"
pack: "@Topia/content"
description: "Post management, categories/tags, pagination, RSS feeds, reading time, related posts, comment systems."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# blog-patterns

Blog system patterns — post management, categories/tags, pagination, RSS feeds, reading time, related posts, comment systems.

#### Workflow

**Step 1 — Detect blog architecture**
Use Glob to find blog-related files: `blog/`, `posts/`, `articles/`, `*.mdx`, `*.md` in content directories. Use Grep to find blog utilities: `getStaticPaths`, `generateStaticParams`, `allPosts`, `contentlayer`, `reading-time`. Read the post listing page and individual post page to understand: data source, routing strategy, and rendering pipeline.

**Step 2 — Audit blog completeness**
Check for: missing RSS feed (`feed.xml` or `/api/rss`), no reading time estimation, pagination absent on listing pages (all posts loaded at once), no category/tag filtering, missing related posts, no draft/published state, and OG images not generated per-post.

**Step 3 — Emit blog patterns**
Emit: typed post schema with frontmatter validation, paginated listing with category filter, RSS feed generator, reading time calculator, and related posts by tag similarity.

#### Example

```typescript
// Next.js App Router — blog listing with pagination and categories
import { allPosts, type Post } from 'contentlayer/generated';

function getPublishedPosts(category?: string): Post[] {
  return allPosts
    .filter(p => p.status === 'published')
    .filter(p => !category || p.category === category)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Reading time utility
function readingTime(content: string): string {
  const words = content.trim().split(/\s+/).length;
  const minutes = Math.ceil(words / 238);
  return `${minutes} min read`;
}

// RSS feed — app/feed.xml/route.ts
export async function GET() {
  const posts = getPublishedPosts();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>My Blog</title>
    <link>${process.env.SITE_URL}</link>
    <atom:link href="${process.env.SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    ${posts.slice(0, 20).map(p => `<item>
      <title>${escapeXml(p.title)}</title>
      <link>${process.env.SITE_URL}${p.url}</link>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description>${escapeXml(p.excerpt)}</description>
    </item>`).join('\n')}
  </channel>
</rss>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
}

// Related posts by tag overlap — score by number of shared tags
function getRelatedPosts(current: Post, all: Post[], limit = 3): Post[] {
  const currentTags = new Set(current.tags ?? []);
  return all
    .filter(p => p.slug !== current.slug && p.status === 'published')
    .map(p => ({ post: p, score: (p.tags ?? []).filter(t => currentTags.has(t)).length }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ post }) => post);
}

// Paginated listing
const PAGE_SIZE = 10;
function paginatePosts(posts: Post[], page: number) {
  const start = (page - 1) * PAGE_SIZE;
  return {
    posts: posts.slice(start, start + PAGE_SIZE),
    total: posts.length,
    totalPages: Math.ceil(posts.length / PAGE_SIZE),
    hasNext: start + PAGE_SIZE < posts.length,
    hasPrev: page > 1,
  };
}
```
