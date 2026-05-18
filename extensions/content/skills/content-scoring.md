---
name: "content-scoring"
pack: "@Topia/content"
description: "Engagement and virality scoring for content pieces. Analyze hooks, readability, shareability, and platform fit."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# content-scoring

Engagement and virality scoring for content pieces. Analyze hooks, readability, shareability, and platform fit. Works for both video clips and written articles.

#### Workflow

**Step 1 — Detect content type**
Determine if scoring target is:
- **Video clip** (from video-repurpose pipeline or standalone)
- **Blog post / article** (markdown, MDX, or CMS content)
- **Social post** (short-form text, tweet, thread)

**Step 2 — Score across 4 dimensions**
```typescript
interface ContentScore {
  hook: {
    score: number;        // 0-25
    type: 'question' | 'statistic' | 'story' | 'contrast' | 'bold-claim' | 'how-to';
    assessment: string;   // Why this hook works or doesn't
  };
  engagement: {
    score: number;        // 0-25
    readability: number;  // Flesch-Kincaid grade level
    pacing: string;       // 'too-slow' | 'good' | 'too-fast'
    callToAction: boolean;
  };
  value: {
    score: number;        // 0-25
    teaches: boolean;
    entertains: boolean;
    uniqueInsight: boolean;
  };
  shareability: {
    score: number;        // 0-25
    emotionalTrigger: string | null;  // 'surprise' | 'anger' | 'joy' | 'fear'
    quotable: string[];   // Extract quotable one-liners
    platformFit: Record<Platform, number>;  // 0-10 per platform
  };
  total: number;          // 0-100
  tier: 'viral' | 'strong' | 'average' | 'weak';  // >80 viral, >60 strong, >40 average
}
```

**Step 3 — Platform-specific optimization hints**
Each platform has different engagement patterns:
| Platform | Hook Window | Optimal Length | Key Factor |
|----------|-------------|---------------|------------|
| TikTok | 0-1s | 15-30s | Pattern interrupt, trend audio |
| YouTube | 0-3s | 8-12 min (long), 30-60s (Shorts) | Curiosity gap, retention graph |
| Twitter/X | First line | 280 chars or 4-tweet thread | Hot take, data point |
| LinkedIn | First 2 lines | 150-300 words | Professional insight, personal story |
| Blog | Title + first paragraph | 1500-2500 words | SEO keyword + value promise |

**Step 4 — Emit improvement suggestions**
For each dimension scoring < 20/25, emit specific actionable improvement:
- Hook weak → suggest rewrite with stronger opening pattern
- Engagement low → identify pacing issues, suggest cuts or restructures
- Value low → identify where content is generic, suggest unique angle
- Shareability low → suggest quotable reformulations, emotional triggers

#### Example

```typescript
// Scoring a blog post
const score = await scoreContent({
  type: 'article',
  title: 'How We Cut Our AWS Bill by 60%',
  content: articleMarkdown,
  targetPlatforms: ['blog', 'twitter', 'linkedin'],
});

// Result:
// {
//   hook: { score: 22, type: 'statistic', assessment: 'Strong — specific number creates curiosity' },
//   engagement: { score: 18, readability: 8.2, pacing: 'good', callToAction: true },
//   value: { score: 20, teaches: true, entertains: false, uniqueInsight: true },
//   shareability: {
//     score: 19, emotionalTrigger: 'surprise',
//     quotable: ['We were paying $12K/mo for a service we used 3% of'],
//     platformFit: { blog: 9, twitter: 8, linkedin: 9 }
//   },
//   total: 79, tier: 'strong'
// }

// Improvement suggestions:
// - Shareability: Add a contrarian angle ("Everyone says X, but we found Y")
// - Engagement: Add a visual comparison (before/after cost graph)
```

```typescript
// Scoring a video clip
const clipScore = await scoreContent({
  type: 'video-clip',
  transcript: clipTranscript,
  duration: 28_000,  // 28 seconds
  hookType: 'question',
  targetPlatforms: ['tiktok', 'youtube-shorts', 'instagram-reels'],
});
```
