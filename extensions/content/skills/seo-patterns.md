---
name: "seo-patterns"
pack: "@Topia/content"
description: "JSON-LD, sitemap generation, canonical URLs, meta tags, Open Graph, Twitter Cards, robots.txt, Core Web Vitals optimization."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# seo-patterns

SEO patterns — structured data (JSON-LD), sitemap generation, canonical URLs, meta tags, Open Graph, Twitter Cards, robots.txt, Core Web Vitals optimization.

#### Workflow

**Step 1 — Detect SEO implementation**
Use Grep to find SEO code: `generateMetadata`, `Head`, `next-seo`, `json-ld`, `sitemap`, `robots.txt`, `og:title`, `twitter:card`. Read the metadata configuration and sitemap generation to understand: current meta tag strategy, structured data presence, and sitemap coverage.

**Step 2 — Audit SEO completeness**
Check for: missing or duplicate `<title>` tags, no meta description (or same description on every page), no Open Graph tags (poor social sharing), missing canonical URL (duplicate content risk), no JSON-LD structured data (no rich snippets in search), sitemap not listing all public pages, robots.txt blocking important paths, missing `alt` text on images, and no Core Web Vitals monitoring (LCP, CLS, INP).

**Step 3 — Emit SEO patterns**
Emit: metadata generator with per-page overrides, JSON-LD templates (Article, Product, FAQ, BreadcrumbList), dynamic sitemap generator, canonical URL helper, and Core Web Vitals reporter.

#### Example

```typescript
// Next.js App Router — metadata + JSON-LD + sitemap
import { type Metadata } from 'next';

// Reusable metadata generator
function createMetadata({ title, description, path, image, type = 'website' }: {
  title: string; description: string; path: string; image?: string; type?: string;
}): Metadata {
  const url = `${process.env.SITE_URL}${path}`;
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type, images: image ? [{ url: image, width: 1200, height: 630 }] : [] },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : [] },
  };
}

// JSON-LD for blog posts
function ArticleJsonLd({ post }: { post: Post }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: { '@type': 'Person', name: post.author.name },
    image: post.ogImage,
    description: post.excerpt,
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />;
}

// Dynamic sitemap — app/sitemap.ts
export default async function sitemap() {
  const posts = await getAllPublishedPosts();
  const staticPages = ['', '/about', '/blog', '/contact'];
  return [
    ...staticPages.map(path => ({ url: `${process.env.SITE_URL}${path}`, lastModified: new Date(), changeFrequency: 'monthly' as const })),
    ...posts.map(post => ({ url: `${process.env.SITE_URL}/blog/${post.slug}`, lastModified: new Date(post.updatedAt || post.publishedAt), changeFrequency: 'weekly' as const })),
  ];
}
```
