---
name: "deep-research"
pack: "@Topia/ai-ml"
description: "Iterative AI research loop that converges on comprehensive answers — search, analyze, identify gaps, repeat. Outputs synthesized report with source attribution."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# deep-research

Iterative AI research loop that converges on comprehensive answers. Search → analyze → identify gaps → search again. Bounded by depth, time, and URL limits. Outputs synthesized report with source attribution.

#### Workflow

**Step 1 — Initialize research state**
```typescript
interface ResearchState {
  query: string;
  findings: Finding[];           // max 50 most recent (memory bound)
  gaps: string[];                // what we still don't know
  seenUrls: Set<string>;         // dedup
  failedQueries: number;         // convergence signal
  depth: number;                 // current iteration
  maxDepth: number;              // hard limit (default: 10)
  maxUrls: number;               // hard limit (default: 100)
  maxTimeMs: number;             // hard limit (default: 300_000 = 5 min)
  startedAt: number;
  activityLog: ActivityEntry[];  // for progress streaming
}

interface Finding {
  content: string;
  sourceUrl: string;
  relevance: number;    // 0-1
  extractedAt: number;
}
```

**Step 2 — Generate search queries from current state**
Each iteration, LLM generates 3 search queries based on:
- Original research question
- Current findings (what we know)
- Current gaps (what we don't know)

```typescript
const queryPrompt = `Given the research question: "${state.query}"
Current findings: ${summarizeFindings(state.findings)}
Knowledge gaps: ${state.gaps.join(', ')}

Generate 3 specific search queries that would fill the most important gaps.
Avoid queries similar to: ${state.seenQueries.join(', ')}`;
```

**Step 3 — Search and deduplicate**
Execute queries in parallel → collect URLs → filter against `seenUrls` → scrape new URLs → extract relevant content.

```typescript
async function searchAndExtract(queries: string[], state: ResearchState): Promise<Finding[]> {
  // Parallel search
  const allResults = await Promise.all(queries.map(q => webSearch(q, { limit: 10 })));
  const urls = deduplicateUrls(allResults.flat(), state.seenUrls);

  // Mark as seen immediately (even before scraping)
  for (const url of urls) state.seenUrls.add(url);

  // Scrape and extract in parallel (with concurrency limit)
  const findings = await pMap(urls, async (url) => {
    const content = await scrapeAndClean(url);
    const relevance = await scoreRelevance(content, state.query);
    return { content: summarize(content, 500), sourceUrl: url, relevance, extractedAt: Date.now() };
  }, { concurrency: 5 });

  return findings.filter(f => f.relevance > 0.3);  // threshold
}
```

**Step 4 — Analyze findings and detect gaps**
LLM analyzes new findings against existing knowledge:
```typescript
interface AnalysisResult {
  newInsights: string[];
  updatedGaps: string[];
  shouldContinue: boolean;
  nextSearchTopic: string | null;
  confidence: number;  // 0-1: how complete is our understanding?
}
```

**Step 5 — Check convergence criteria**
Stop when ANY of:
- `depth >= maxDepth`
- `seenUrls.size >= maxUrls`
- `Date.now() - startedAt >= maxTimeMs`
- `gaps.length === 0` (all gaps filled)
- `failedQueries >= 3` consecutive (no new information available)
- `confidence >= 0.9` (LLM believes research is comprehensive)

**Step 6 — Synthesize final report**
```typescript
interface ResearchReport {
  question: string;
  answer: string;              // comprehensive markdown synthesis
  confidence: number;
  sources: Array<{
    url: string;
    title: string;
    relevance: number;
    citedIn: string[];         // which sections cite this source
  }>;
  methodology: {
    totalIterations: number;
    urlsExamined: number;
    findingsCount: number;
    timeElapsed: number;
    remainingGaps: string[];
  };
}
```

Memory management: keep only 50 most recent findings to avoid context explosion. Summarize older findings into a "background knowledge" string before dropping them.

#### Example

```typescript
// Usage
const report = await deepResearch({
  query: 'What are the best practices for implementing RAG in production in 2026?',
  maxDepth: 8,
  maxUrls: 50,
  maxTimeMs: 180_000,  // 3 minutes
  onProgress: (entry) => console.log(`[${entry.depth}] ${entry.action}: ${entry.detail}`),
});

// Output: comprehensive report with 15-30 sources, gap analysis, confidence score
```

#### Sharp Edges

| Failure Mode | Mitigation |
|---|---|
| Research loop runs forever (no convergence) | Hard limits on depth, URLs, and time; monitor `failedQueries` counter |
| LLM generates duplicate search queries | Track seen queries; include exclusion list in prompt |
| Memory explosion from accumulating findings | Cap at 50 findings; summarize oldest into background knowledge string |
| Low-quality sources pollute findings | Relevance threshold (0.3); domain blocklist for known low-quality sites |
| Rate limiting on search API | Per-provider rate limiter; fallback to alternative search provider |
| Circular research (keeps finding same information) | Track `confidence` — if stable for 3 iterations, force stop |
