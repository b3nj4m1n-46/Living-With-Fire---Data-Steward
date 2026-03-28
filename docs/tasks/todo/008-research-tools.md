# Research Tools — Dataset Context + PageIndex Knowledge Base Search

> **Status:** TODO
> **Priority:** P2 (normal)
> **Depends on:** 002-genkit-setup (Genkit tools configured)
> **Blocks:** Nothing critical — enhances specialist agents but they can work without it

## Problem

Specialist agents need to understand *why* sources disagree, which often requires reading methodology descriptions from DATA-DICTIONARY.md files and consulting the 52 research documents in `knowledge-base/`. Currently, `getDatasetContext` exists (reads DATA-DICTIONARY.md + README.md), but there's no way to search the knowledge base documents.

The knowledge base has been pre-indexed into hierarchical JSON structures (`knowledge-base/indexes/`) with 45+ document indexes and a `manifest.json`. These indexes contain section titles, summaries, and hierarchical navigation — perfect for RAG without needing vector embeddings.

## Current Implementation

### What Exists
- `getDatasetContext` tool (`genkit/src/tools/datasetContext.ts`) — reads DATA-DICTIONARY.md + README.md for source datasets
- `knowledge-base/indexes/manifest.json` — index of all pre-processed document structures
- `knowledge-base/indexes/*_structure.json` — 45+ hierarchical document indexes with section titles, summaries, and node IDs
- 52 research documents in `knowledge-base/` (PDFs, HTML)
- Genkit framework with tool registration pattern

### What Does NOT Exist Yet
- `searchDocumentIndex` Genkit tool (keyword search across all document indexes)
- `navigateDocumentTree` Genkit tool (drill into specific sections)
- Registration of research tools with agent flows

## Proposed Changes

### 1. Search Document Index Tool

`genkit/src/tools/searchDocumentIndex.ts`:

A Genkit tool that searches across all 45+ document indexes by keyword.

```typescript
// Genkit tool: searchDocumentIndex
// Input: {
//   query: string,               // search terms, e.g. "Ceanothus fire resistance methodology"
//   maxResults?: number           // default 10
// }
// Output: {
//   results: Array<{
//     documentTitle: string,      // e.g. "UC Forest Products Lab — Fire Performance of Landscape Plants"
//     documentFile: string,       // index filename: "UCForestProducts_structure.json"
//     sectionTitle: string,       // matched section heading
//     sectionSummary: string,     // section summary text
//     nodeId: string,             // for navigateDocumentTree drill-down
//     relevanceScore: number,     // keyword match score
//     sourceDocument: string      // original PDF/HTML filename in knowledge-base/
//   }>,
//   totalMatches: number
// }
```

Implementation approach:
1. Load `manifest.json` to get list of all index files
2. For each index file, load the JSON structure
3. Search section titles and summaries for query keywords (case-insensitive, word boundary matching)
4. Score by: number of keyword matches, title match > summary match weighting
5. Sort by relevance, return top N

**Performance note:** Load and cache manifest + all index files on first call (they're small JSON files). Subsequent calls use the cache.

### 2. Navigate Document Tree Tool

`genkit/src/tools/navigateDocumentTree.ts`:

A Genkit tool that drills into a specific document section for more detail.

```typescript
// Genkit tool: navigateDocumentTree
// Input: {
//   indexFile: string,            // e.g. "UCForestProducts_structure.json"
//   nodeId: string                // section node ID from search results
// }
// Output: {
//   title: string,
//   summary: string,
//   children: Array<{
//     nodeId: string,
//     title: string,
//     summary: string,
//     hasChildren: boolean
//   }>,
//   parentTitle: string | null,
//   depth: number
// }
```

This enables agents to progressively drill deeper into a document — read a high-level section, then explore subsections that seem relevant.

### 3. Register Tools with Flows

Update the barrel export to include the new tools, and document which flows should use them:

- **Research Agent** (future) — uses all research tools
- **Specialist agents** (future) — use `searchDocumentIndex` to find methodology context
- **Conflict Classifier** — optionally uses `getDatasetContext` for source context (already available)

### What Does NOT Change

- Knowledge base documents — read-only
- Index files — read-only (pre-generated)
- `getDatasetContext` tool — already exists, unchanged
- DoltgreSQL database — not involved

## Migration Strategy

1. Read `knowledge-base/indexes/manifest.json` to understand the index structure
2. Read 1-2 sample `*_structure.json` files to understand node format
3. Implement `genkit/src/tools/searchDocumentIndex.ts` with caching
4. Implement `genkit/src/tools/navigateDocumentTree.ts`
5. Update `genkit/src/tools/index.ts` — add new exports
6. Test: search "Ceanothus fire resistance methodology"
7. Test: navigate into a matching section, verify children are returned
8. Test: search "deer browse damage" — verify cross-document results

## Files Modified

### New Files
- `genkit/src/tools/searchDocumentIndex.ts` — keyword search across document indexes
- `genkit/src/tools/navigateDocumentTree.ts` — hierarchical section navigation

### Modified Files
- `genkit/src/tools/index.ts` — add new tool exports

### Unchanged
- All existing tools — no modifications
- Knowledge base files — read-only
- Index files — read-only
- DoltgreSQL database — not involved

## Verification

1. **Manifest loads:**
   ```typescript
   // searchDocumentIndex should load manifest.json without errors
   // manifest should contain 45+ document entries
   ```

2. **Search returns relevant results:**
   ```typescript
   const results = await searchDocumentIndex({
     query: 'Ceanothus fire resistance methodology'
   });
   // results.totalMatches > 0
   // Should include hits from Bethke, UC Forest Products Lab, or similar fire research
   ```

3. **Navigation returns section details:**
   ```typescript
   const section = await navigateDocumentTree({
     indexFile: results.results[0].documentFile,
     nodeId: results.results[0].nodeId
   });
   // section.title is not empty
   // section.summary contains relevant text
   // section.children is an array (may be empty for leaf nodes)
   ```

4. **Cross-document search works:**
   ```typescript
   const results = await searchDocumentIndex({ query: 'deer browse damage' });
   // Should return results from multiple documents (Rutgers, CSU, etc.)
   // documentFile values should differ across results
   ```

5. **Cache performance:**
   ```typescript
   // Second call to searchDocumentIndex should be noticeably faster
   // (index files loaded from memory, not disk)
   ```
