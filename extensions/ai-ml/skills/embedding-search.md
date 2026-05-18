---
name: "embedding-search"
pack: "@Topia/ai-ml"
description: "Embedding-based search — semantic search, hybrid search (BM25 + vector), similarity thresholds, index optimization."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# embedding-search

Embedding-based search — semantic search, hybrid search (BM25 + vector), similarity thresholds, index optimization.

#### Workflow

**Step 1 — Detect search implementation**
Use Grep to find search code: `similarity_search`, `vector_search`, `fts`, `tsvector`, `BM25`. Read search handlers to understand: query flow, ranking strategy, and result formatting.

**Step 2 — Audit search quality**
Check for: pure vector search without keyword fallback (misses exact matches), no similarity threshold (returns irrelevant results at low scores), missing query embedding cache (repeated queries re-embed), no hybrid scoring (BM25 for exact + vector for semantic), and unoptimized vector index (HNSW parameters not tuned).

**Step 3 — Emit hybrid search**
Emit: combined BM25 + vector search with reciprocal rank fusion, similarity threshold filtering, query embedding cache, and HNSW index tuning.

#### Example

```typescript
// Hybrid search — BM25 + vector with reciprocal rank fusion
async function hybridSearch(query: string, limit = 10) {
  // Parallel: keyword (BM25) + semantic (vector)
  const [keywordResults, vectorResults] = await Promise.all([
    db.execute(sql`
      SELECT id, content, ts_rank(search_vector, plainto_tsquery(${query})) AS bm25_score
      FROM documents
      WHERE search_vector @@ plainto_tsquery(${query})
      ORDER BY bm25_score DESC LIMIT ${limit * 2}
    `),
    db.execute(sql`
      SELECT id, content, 1 - (embedding <=> ${await getEmbedding(query)}) AS vector_score
      FROM documents
      ORDER BY embedding <=> ${await getEmbedding(query)}
      LIMIT ${limit * 2}
    `),
  ]);

  // Reciprocal rank fusion (k=60)
  const scores = new Map<string, number>();
  const K = 60;
  keywordResults.forEach((r, i) => scores.set(r.id, (scores.get(r.id) || 0) + 1 / (K + i + 1)));
  vectorResults.forEach((r, i) => scores.set(r.id, (scores.get(r.id) || 0) + 1 / (K + i + 1)));

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .filter(([_, score]) => score > 0.01); // threshold
}

// Embedding cache (avoid re-embedding repeated queries)
const embeddingCache = new Map<string, number[]>();
async function getEmbedding(text: string): Promise<number[]> {
  const cached = embeddingCache.get(text);
  if (cached) return cached;
  const { data } = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
  embeddingCache.set(text, data[0].embedding);
  return data[0].embedding;
}
```
