---
name: "mdx-authoring"
pack: "@Topia/content"
description: "Custom components in markdown, code blocks with syntax highlighting, interactive examples, table of contents generation."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# mdx-authoring

MDX authoring patterns — custom components in markdown, code blocks with syntax highlighting, interactive examples, table of contents generation.

#### Workflow

**Step 1 — Detect MDX setup**
Use Grep to find MDX configuration: `@next/mdx`, `mdx-bundler`, `next-mdx-remote`, `contentlayer`, `rehype`, `remark`. Read the MDX pipeline config to understand: compilation method, custom components registered, and remark/rehype plugin chain.

**Step 2 — Audit MDX pipeline**
Check for: no custom component fallback (missing component crashes build), code blocks without syntax highlighting (plain text), no table of contents generation (long articles hard to navigate), missing image optimization in MDX (raw `<img>` tags), no frontmatter validation (typos in dates or categories silently pass), and no interactive component sandboxing.

**Step 3 — Emit MDX patterns**
Emit: MDX component registry with fallback for missing components, code block with syntax highlighting (Shiki or Prism), auto-generated TOC from headings, frontmatter schema validation, and callout/admonition components.

#### Example — Component Registry

```tsx
// MDX component registry with safe fallback
import { type MDXComponents } from 'mdx/types';
import { Callout } from '@/components/callout';
import { CodeBlock } from '@/components/code-block';
import Image from 'next/image';

export function useMDXComponents(): MDXComponents {
  return {
    img: ({ src, alt, ...props }) => (
      <Image src={src!} alt={alt || ''} width={800} height={400} className="rounded-lg" {...props} />
    ),
    pre: ({ children, ...props }) => <CodeBlock {...props}>{children}</CodeBlock>,
    Callout,
  };
}

// Auto-generated TOC from MDX content
interface TocItem { id: string; text: string; level: number }

function extractToc(raw: string): TocItem[] {
  const headingRegex = /^(#{2,4})\s+(.+)$/gm;
  const items: TocItem[] = [];
  let match;
  while ((match = headingRegex.exec(raw))) {
    const text = match[2].replace(/[`*_~]/g, '');
    items.push({ id: text.toLowerCase().replace(/\s+/g, '-'), text, level: match[1].length });
  }
  return items;
}

// Callout component for MDX
function Callout({ type = 'info', children }: { type?: 'info' | 'warning' | 'error'; children: React.ReactNode }) {
  const styles = { info: 'bg-blue-50 border-blue-400', warning: 'bg-amber-50 border-amber-400', error: 'bg-red-50 border-red-400' };
  return <div className={`border-l-4 p-4 my-4 rounded-r ${styles[type]}`}>{children}</div>;
}
```

#### Example — Shiki Syntax Highlighting

```typescript
// rehype-shiki integration in contentlayer or next.config.mjs
import { rehypeShiki } from '@shikijs/rehype';
import { defineDocumentType, makeSource } from 'contentlayer/source-files';

export default makeSource({
  mdxOptions: {
    rehypePlugins: [
      [rehypeShiki, {
        themes: { light: 'github-light', dark: 'github-dark' },
        addLanguageClass: true,
      }],
    ],
  },
});

// CodeBlock component with copy-to-clipboard
'use client';
import { useState } from 'react';

export function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  const code = typeof children === 'string' ? children : '';

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group">
      <pre className={className}>{children}</pre>
      <button
        onClick={copy}
        aria-label="Copy code"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-xs bg-gray-700 text-white rounded"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
```

#### Example — Frontmatter Validation

```typescript
// contentlayer.config.ts — Zod-like validation via defineDocumentType
import { defineDocumentType } from 'contentlayer/source-files';

export const Post = defineDocumentType(() => ({
  name: 'Post',
  filePathPattern: 'posts/**/*.mdx',
  contentType: 'mdx',
  fields: {
    title:  { type: 'string',  required: true },
    date:   { type: 'date',    required: true },
    status: { type: 'enum',    options: ['draft', 'published'], required: true },
    tags:   { type: 'list',    of: { type: 'string' }, default: [] },
    excerpt:{ type: 'string',  required: false },
    ogImage:{ type: 'string',  required: false },
  },
  computedFields: {
    url:         { type: 'string', resolve: d => `/blog/${d._raw.flattenedPath.replace('posts/', '')}` },
    readingTime: { type: 'string', resolve: d => {
      const words = d.body.raw.split(/\s+/).length;
      return `${Math.ceil(words / 238)} min read`;
    }},
  },
}));
```
