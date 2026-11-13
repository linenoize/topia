---
name: research
description: "Use when an answer depends on facts outside the repo: how a library or API works in a given version, what an error message means, whether a method is deprecated, or how tools and approaches compare. Checks Context7 docs first for API questions, then official sources, and cites every finding."
metadata:
  author: topia
  version: "0.5.0"
  layer: L3
  model: haiku
  group: knowledge
  tools: "Read, Glob, Grep, WebFetch, WebSearch, ToolSearch"
---

# research

## Purpose

Web research utility. Receives a research question, executes targeted searches, deep-dives into top results, and returns structured findings with sources. Stateless — no memory between calls.

Two modes:

- **API docs** (formerly `docs-seeker`): a library, API, method or error message. Returns the signature, a minimal example, and version or deprecation notes. Use this when the question is "how do I call X" or "what does this error mean".
- **General research** (default): technologies, best practices, comparisons, competitor solutions. Needs several independent sources.

## Calls (outbound)

None — pure L3 utility using `WebSearch`, `WebFetch`, and Context7 tools when present.

## Called By (inbound)

- `plan` (L2): external knowledge for architecture decisions
- `brainstorm` (L2): data for informed ideation
- `marketing` (L2): competitor analysis, SEO data
- `hallucination-guard` (L3): verify package existence on npm/pypi
- `autopsy` (L2): research best practices for legacy patterns
- `idea` (L2): research similar products and integrations
- `integrate` (L2): research source repo patterns before grafting
- `mcp-builder` (L2): research MCP standards and existing implementations
- `scaffold` (L1): research project templates and best practices
- `debug` (L2): API docs mode — look up unclear errors or deprecated APIs
- `fix` (L2): API docs mode — check correct API usage before applying changes
- `review` (L2): API docs mode — verify API usage is current and correct
- `adversary` (L2): API docs mode — verify framework/API assumptions in a plan

## Execution

### Input

```
research_question: string   — what to research
focus: string (optional)    — narrow the scope (e.g., "security", "performance")
mode: string (optional)     — "api-docs" | "general"; inferred if omitted
version: string (optional)  — library version, for API docs mode
```

Pick API docs mode when the input names a library, API, method, or quotes an error message. Otherwise use general research.

## Mode: API docs

### D1 — Identify the target

Extract the library or framework name, the version if given, and the specific API, method or error.

### D2 — Context7 (if available)

Context7 servers go by different names depending on how they are installed (a plugin, Docker MCP, a direct server). Do not assume a name.

1. Look for tools whose names end in `resolve-library-id` and in `get-library-docs` or `query-docs` (for example `mcp__<server>__resolve-library-id`). If they are not loaded yet, search for them with ToolSearch (query `resolve-library-id`).
2. If found: call the `resolve-library-id` tool with the library name. Pick the best match (exact name, then source reputation, then snippet count).
3. Call the `get-library-docs` or `query-docs` tool with that library ID and the specific question as the topic.
4. If the answer includes the signature and an example, go to D5.

If no such tools exist, go straight to D3. Do not report the missing tools as an error.

### D3 — llms.txt

Many projects publish AI-oriented docs:

- GitHub repos: `https://context7.com/{org}/{repo}/llms.txt` (e.g. `context7.com/vercel/next.js/llms.txt`)
- Doc sites: `https://context7.com/websites/{normalized-domain}/llms.txt`
- Append `?topic={query}` for focused results (e.g. `context7.com/shadcn-ui/ui/llms.txt?topic=date-picker`)
- Or the project's own: `WebSearch "[library] llms.txt"`, then common paths such as `docs.[lib].com/llms.txt`

Fetch it with `WebFetch`. If it lists many section URLs, fetch only the sections that match the question.

### D4 — Web search

1. `WebSearch`: "[library] [method] official documentation", "[library] [version] [query]", "[error message] [library]"
2. Prefer official docs, the official repo, and the package registry page.
3. `WebFetch` the top 1-3 official sources.

If docs are thin but the source is available, read the source (or a `npx repomix` dump of it) for signatures and examples.

### D5 — Extract and report

From whichever source answered, extract the exact signature (parameter and return types), a minimal working example, version notes (added, changed, deprecated), and known pitfalls. Always give the source URL. If the API is deprecated, say so and name the replacement.

```
## Documentation: [Library/API]
- **Version**: [requested or "latest"]
- **Source**: [URL or Context7 library ID]

### API Reference
- **Signature**: `fn(param: Type): ReturnType`
- **Parameters**: `param` — description
- **Returns**: description

### Usage Example
[minimal snippet from the docs]

### Known Issues / Deprecations
- [warning, deprecation, or common mistake]
```

API docs mode does not need three independent sources. One official source is enough; say which one.

## Mode: General research

### Step 0 — Prior learnings (optional)

Grep `.topia/` for the research keywords before web search (Recall: `topia:recall` for a fuller pass). No writes.

### Step 1 — Formulate Queries

Generate 2-3 targeted search queries from the research question. Vary phrasing to cover different angles:
- Primary: direct question as search terms
- Secondary: "[topic] best practices 2026" or "[topic] vs alternatives"
- Tertiary: "[topic] example" or "[topic] tutorial" if implementation detail needed

### Step 2 — Search (Minimum 3 Complementary Sources)

<HARD-GATE>
Every research conclusion MUST be backed by at minimum 3 complementary sources from DIFFERENT source types.
Single-source conclusions are flagged as `low` confidence regardless of source authority.
</HARD-GATE>

Call `WebSearch` for each query. Collect result titles, URLs, and snippets. Identify the top 3-5 most relevant URLs prioritizing **source diversity**:

| Source Type | Examples | Why |
|-------------|----------|-----|
| **Official docs** | Framework docs, API reference, RFC | Authoritative but may lag behind reality |
| **Community** | Stack Overflow, GitHub Issues, Reddit | Real-world pain points, edge cases |
| **Technical blogs** | Dev.to, Medium engineering blogs, personal blogs | Practical experience, tutorials |
| **Repositories** | GitHub repos, npm packages, example code | Working implementations |

**Selection rules:**
- Source authority (official docs > major blogs > personal blogs)
- Recency (prefer 2025-2026)
- Relevance to the query
- **Diversity: never select 3+ URLs from the same domain** — spread across source types


### Step 2b — Diminishing Returns Detection

After each WebSearch call, evaluate whether additional searches are productive:

**Track across search results**:
- **Entity set**: Extract key entities from each result set (library names, API names, version numbers, technique names, company names)
- **New entity ratio**: `new_entities_in_this_search / total_entities_found_so_far`
- **Result overlap**: How many URLs from this search were already seen in previous searches

| Signal | Threshold | Action |
|--------|-----------|--------|
| New entity ratio < 10% | Last search added almost nothing new | Skip remaining queries, proceed to Step 3 with existing results |
| Result overlap > 60% | Most URLs already fetched or seen | Skip this query's results entirely |
| All 3 queries return same top 3 URLs | Search space is exhausted | Proceed directly to Step 3 — more queries won't help |

**Report when triggered**:
```
Note: Research saturation reached after [N] searches — [M] unique entities found.
Additional queries showed <10% new information. Proceeding with synthesis.
```

**Why**: Research skills commonly waste 2-3 WebFetch calls on pages that repeat information already gathered. Saturation detection saves tool calls and context tokens while preserving research quality — the first 3 sources typically contain 90%+ of available information.

### Step 3 — Deep Dive

Call `WebFetch` on the top 3-5 URLs identified in Step 2. Hard limit: **max 5 WebFetch calls** per research invocation. For each fetched page:
- Extract key facts, API signatures, code examples
- Note the source URL and publication date if visible
- Tag the source type (official/community/blog/repo) for Step 4 triangulation

### Step 4 — Synthesize (Triangulation)

Across all fetched content, **triangulate** — don't just aggregate:
- Identify points of consensus across sources (≥3 sources = strong signal)
- Flag any conflicting information explicitly (e.g., "Source A says X, Source B says Y")
- Check if conflicts are temporal (old vs new info) or genuine disagreement
- Assign confidence using source diversity:

| Confidence | Criteria |
|------------|----------|
| `high` | 3+ sources from different types agree |
| `medium` | 2 sources agree, or 3+ from same type |
| `low` | Single source, or sources conflict without resolution |
| `unverified` | No sources found — report this explicitly, NEVER fabricate |

### Step 5 — Report

Return structured findings in the output format below.

## Constraints

- Always cite source URL for every finding
- Flag conflicting information — never silently pick one side
- Max 5 WebFetch calls per invocation
- If no useful results found, report that explicitly rather than fabricating
- (API docs) Try Context7 tools first when present, then llms.txt, then web search; never hardcode a Context7 server prefix
- (API docs) If the requested version's docs are not available, say so

## Output Format

```
## Research Results: [Query]
- **Sources fetched**: [n]
- **Confidence**: high | medium | low

### Key Findings
- [finding] — [source URL]
- [finding] — [source URL]

### Conflicts / Caveats
- [Source A] says X. [Source B] says Y. Recommend verifying against [authority].

### Code Examples
```[lang]
[relevant snippet]
```

### Recommendations
- [actionable suggestion based on findings]
```

## Sharp Edges

Known failure modes for this skill. Check these before declaring done.

| Failure Mode | Severity | Mitigation |
|---|---|---|
| Fabricating findings when no useful results found | CRITICAL | Constraint: report "no useful results found" explicitly — never invent citations |
| Reporting conflicting sources without flagging the conflict | HIGH | Constraint: flag conflicting information explicitly, never silently pick one side |
| Assigning "high" confidence from a single source | MEDIUM | High = 3+ sources agree; 1-2 sources = medium confidence |
| Exceeding 5 WebFetch calls per invocation | MEDIUM | Hard limit: prioritize top 3-5 URLs from search, fetch only the most relevant |
| Single-source conclusions presented as fact | HIGH | HARD-GATE: minimum 3 complementary sources from different source types. Single source = `low` confidence |
| All sources from same domain (e.g., 3 Stack Overflow links) | MEDIUM | Source diversity rule: never 3+ URLs from the same domain. Spread across official/community/blog/repo |
| (API docs) Calling a Context7 tool by a guessed server name | MEDIUM | D2: find tools by name suffix or ToolSearch; skip Context7 if none exist |
| (API docs) Deprecated API returned without saying so | HIGH | D5: state "deprecated in X, use Y" with a link |
| (API docs) Docs for the wrong version | HIGH | Check the version; say so when version-specific docs are missing |

## Done When

API docs mode:
- Context7 tried when available, else llms.txt or official docs fetched
- Signature, minimal example, version/deprecation notes and source URL reported

General research:
- 2-3 search queries formulated and executed
- Top 3-5 URLs identified and fetched (max 5 WebFetch calls)
- Conflicting information between sources explicitly flagged
- Confidence level assigned (high/medium/low) with rationale
- Research Results emitted with source URLs for every key finding

## Cost Profile

~300-800 tokens input, ~200-500 tokens output. Haiku. Fast and cheap.
