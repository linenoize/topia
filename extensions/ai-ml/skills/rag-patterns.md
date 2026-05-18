---
name: "rag-patterns"
pack: "@Topia/ai-ml"
description: "RAG pipeline patterns — document chunking, embedding generation, vector store setup, retrieval strategies, reranking."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# rag-patterns

RAG pipeline patterns — document chunking, embedding generation, vector store setup, retrieval strategies, reranking.

#### Workflow

**Step 1 — Detect RAG components**
Use Grep to find vector store usage: `PineconeClient`, `pgvector`, `Weaviate`, `ChromaClient`, `QdrantClient`. Find embedding calls: `embeddings.create`, `embed()`. Read the ingestion pipeline and retrieval logic to map the full RAG flow.

**Step 2 — Audit retrieval quality**
Check for: fixed-size chunking that splits mid-sentence (context loss), no overlap between chunks (boundary information lost), embeddings generated without metadata (no filtering capability), retrieval without reranking (relevance drops after top-3), no chunk deduplication, and context window overflow (retrieved chunks exceed model limit).

**Step 3 — Emit RAG pipeline**
Emit: recursive text splitter with semantic boundaries, embedding generation with metadata, vector upsert with namespace, retrieval with reranking, and context window budget management.

#### Example

```typescript
// RAG pipeline — recursive chunking + pgvector + reranking
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { PGVectorStore } from '@langchain/community/vectorstores/pgvector';

// Ingestion: chunk → embed → store
async function ingestDocument(doc: { content: string; metadata: Record<string, string> }) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n## ', '\n### ', '\n\n', '\n', '. ', ' '],
  });
  const chunks = await splitter.createDocuments(
    [doc.content],
    [doc.metadata],
  );

  const embeddings = new OpenAIEmbeddings({ model: 'text-embedding-3-small' });
  await PGVectorStore.fromDocuments(chunks, embeddings, {
    postgresConnectionOptions: { connectionString: process.env.DATABASE_URL },
    tableName: 'documents',
  });
}

// Retrieval: query → vector search → rerank → top-k
async function retrieve(query: string, topK = 5) {
  const store = await PGVectorStore.initialize(embeddings, pgConfig);
  const candidates = await store.similaritySearch(query, topK * 3); // over-retrieve

  // Rerank with Cohere
  const { results } = await cohere.rerank({
    model: 'rerank-english-v3.0',
    query,
    documents: candidates.map(c => c.pageContent),
    topN: topK,
  });

  return results.map(r => candidates[r.index]);
}
```
