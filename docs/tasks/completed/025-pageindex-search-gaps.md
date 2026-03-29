# PageIndex Search Gaps — Surface Page Ranges, Add PDF Reading, Add Pagination

> **Status:** COMPLETE — commit `501922d`
> **Priority:** P1 (important)
> **Depends on:** 008-research-tools (existing search/navigate tools)
> **Blocks:** None (but improves accuracy of research, scope, rating, and synthesis agents)

## Problem

The PageIndex system indexes 47 knowledge-base PDFs with `start_index`/`end_index` page ranges on every node in the `_structure.json` files, but the Genkit search tools don't fully surface these capabilities. Three gaps:

1. **Page ranges not returned by tools.** `searchDocumentIndex` and `navigateDocumentTree` both have access to `start_index`/`end_index` on every `IndexNode` but neither includes them in their output schemas. The research agent profile (`docs/planning/agents/research-agent.md:139-146`) expects `pageRange: "pp. 20-30"` in its output, but the agent would have to hallucinate those numbers since the tools never provide them.

2. **No tool to read actual PDF page content.** Even if page ranges were surfaced, agents can only see AI-generated summaries from the index trees — they can never read the source material. When a summary is vague or insufficient, the agent has no way to consult the original document. The 47 source PDFs live in `knowledge-base/` and are readable with standard PDF libraries.

3. **No pagination on search results.** `searchDocumentIndex` accepts `maxResults` but has no `offset` parameter. When a query matches dozens of sections, agents can only see the top N. There's no way to page through remaining results for thorough research.

## Current Implementation

### Tools (`genkit/src/tools/`)

**`searchDocumentIndex.ts`:**
- Loads all 47 `_structure.json` files via `loadIndexCache()`
- Flattens all nodes, scores against keywords (title 3x weight, summary 1x)
- Returns top N results sorted by relevance
- Output schema: `documentTitle`, `documentFile`, `sectionTitle`, `sectionSummary`, `nodeId`, `relevanceScore`, `sourceDocument`
- **Missing:** `startPage`, `endPage` (available on `IndexNode` as `start_index`, `end_index`)
- **Missing:** `offset` parameter for pagination

**`navigateDocumentTree.ts`:**
- Finds a node by `nodeId` within a specific `_structure.json`
- Returns the node's summary and its children
- Output schema: `title`, `summary`, `children[]`, `parentTitle`, `depth`
- **Missing:** `startPage`, `endPage` on both the target node and its children

**`IndexNode` interface** (defined in `searchDocumentIndex.ts:24-31`):
```typescript
export interface IndexNode {
  title: string;
  node_id: string;
  start_index: number;  // <-- exists but never surfaced
  end_index: number;    // <-- exists but never surfaced
  summary: string;
  nodes?: IndexNode[];
}
```

### Agents Using These Tools

| Agent | Flow | Tools Used |
|-------|------|------------|
| Research | `researchConflictFlow.ts` | `searchDocumentIndex`, `navigateDocumentTree`, `getDatasetContext` |
| Scope | `scopeConflictFlow.ts` | `searchDocumentIndex` |
| Rating | `ratingConflictFlow.ts` | `searchDocumentIndex` |
| Synthesis | `synthesizeClaimFlow.ts` | `searchDocumentIndex` |

### What Does NOT Exist Yet
- Page range fields in search/navigate tool outputs
- A `readDocumentPages` tool to extract text from source PDFs
- Pagination (`offset`) on `searchDocumentIndex`

## Proposed Changes

### 1. Surface Page Ranges in `searchDocumentIndex`

**File:** `genkit/src/tools/searchDocumentIndex.ts`

Add `startPage` and `endPage` to the output schema's results array:

```typescript
// Add to the results z.object (line ~118):
startPage: z.number(),
endPage: z.number(),
```

In the scoring/push logic (~line 171), include the values from the node:

```typescript
scored.push({
  // ...existing fields...
  startPage: node.start_index,
  endPage: node.end_index,
});
```

### 2. Surface Page Ranges in `navigateDocumentTree`

**File:** `genkit/src/tools/navigateDocumentTree.ts`

Add page range to both the main node output and each child:

```typescript
// Main output schema (line ~50):
startPage: z.number(),
endPage: z.number(),

// Children array items:
children: z.array(z.object({
  nodeId: z.string(),
  title: z.string(),
  summary: z.string(),
  hasChildren: z.boolean(),
  startPage: z.number(),   // new
  endPage: z.number(),     // new
})),
```

Map them from the node data:

```typescript
// Main node (~line 99):
startPage: node.start_index,
endPage: node.end_index,

// Children (~line 92):
const children = (node.nodes ?? []).map((child) => ({
  // ...existing fields...
  startPage: child.start_index,
  endPage: child.end_index,
}));
```

### 3. Add `readDocumentPages` Tool

**New file:** `genkit/src/tools/readDocumentPages.ts`

Extracts text from a knowledge-base PDF for a given page range. Uses `pdf-parse` (Node.js PDF text extraction).

```typescript
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai } from '../config.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const KB_DIR = resolve(REPO_ROOT, 'knowledge-base');

export const readDocumentPages = ai.defineTool(
  {
    name: 'readDocumentPages',
    description:
      'Reads actual text content from a knowledge-base PDF for a specific page range. ' +
      'Use after searchDocumentIndex/navigateDocumentTree to read the original source material ' +
      'when the section summary is insufficient. Returns extracted text for the requested pages.',
    inputSchema: z.object({
      documentFile: z
        .string()
        .describe('PDF filename from the knowledge-base, e.g. "Bethke-UCCE_Literature-Review_2016.pdf"'),
      startPage: z
        .number()
        .int()
        .min(1)
        .describe('First page to read (1-indexed)'),
      endPage: z
        .number()
        .int()
        .min(1)
        .describe('Last page to read (1-indexed, inclusive). Max 10 pages per call.'),
    }),
    outputSchema: z.object({
      documentFile: z.string(),
      startPage: z.number(),
      endPage: z.number(),
      totalPages: z.number(),
      text: z.string(),
      truncated: z.boolean(),
    }),
  },
  async (input) => {
    const maxPages = 10;
    const effectiveEnd = Math.min(input.endPage, input.startPage + maxPages - 1);

    const pdfPath = resolve(KB_DIR, input.documentFile);
    // Use pdf-parse to extract text
    const pdfParse = (await import('pdf-parse')).default;
    const dataBuffer = await readFile(pdfPath);
    const data = await pdfParse(dataBuffer, {
      max: 0, // parse all pages for metadata
    });

    const totalPages = data.numpages;

    // pdf-parse doesn't natively support page ranges, so we parse all and split
    // Pages are separated by form-feed characters in pdf-parse output
    const pages = data.text.split('\f');
    const selectedPages = pages.slice(input.startPage - 1, effectiveEnd);
    let text = selectedPages.join('\n\n--- Page Break ---\n\n').trim();

    const maxChars = 30_000;
    const truncated = text.length > maxChars;
    if (truncated) {
      text = text.slice(0, maxChars) + '\n\n[...truncated at 30,000 characters]';
    }

    return {
      documentFile: input.documentFile,
      startPage: input.startPage,
      endPage: effectiveEnd,
      totalPages,
      text,
      truncated,
    };
  },
);
```

**Constraints:**
- Max 10 pages per call (prevents context blowout)
- Max 30,000 characters output (truncates with notice)
- Reads from `knowledge-base/` directory only (no arbitrary file access)

### 4. Add Pagination to `searchDocumentIndex`

**File:** `genkit/src/tools/searchDocumentIndex.ts`

Add `offset` to the input schema:

```typescript
offset: z
  .number()
  .optional()
  .default(0)
  .describe('Number of results to skip for pagination (default 0)'),
```

Update the slicing logic (line ~188):

```typescript
// Replace: scored.slice(0, input.maxResults)
// With:
scored.slice(input.offset, input.offset + input.maxResults)
```

### 5. Register the New Tool

**File:** `genkit/src/tools/index.ts`

Add export and include in `allTools`:

```typescript
export { readDocumentPages } from './readDocumentPages.js';

// In allTools array:
import { readDocumentPages as _readDocumentPages } from './readDocumentPages.js';
// ...
export const allTools = [
  // ...existing tools...
  _readDocumentPages,
];
```

### 6. Wire Into Research Agent Flow

**File:** `genkit/src/flows/researchConflictFlow.ts`

Add `readDocumentPages` to the tools list for this flow. The research agent's prompt already instructs it to drill into documents — with page ranges now visible and readable, it will naturally use the new tool when summaries are insufficient.

### 7. Update Agent Profiles

**File:** `docs/planning/agents/research-agent.md`

Add `readDocumentPages` to the Tools table and update the PageIndex Tool Details section to document the new tool and the page range fields now returned by search/navigate.

### What Does NOT Change

- Index file format (`_structure.json`) — no changes to the indexed data
- `manifest.json` — no structural changes
- Knowledge-base PDFs — read-only access
- Existing tool behavior — only additive output fields, no breaking changes
- Non-research agent flows that don't use document search
- `navigateDocumentTree` input schema — same `indexFile` + `nodeId` interface

## Migration Strategy

1. Add `pdf-parse` dependency: `cd genkit && npm install pdf-parse`
2. Add `startPage`/`endPage` to `searchDocumentIndex` output schema and scoring logic
3. Add `startPage`/`endPage` to `navigateDocumentTree` output schema for both node and children
4. Add `offset` parameter to `searchDocumentIndex` input schema and slicing logic
5. Create `genkit/src/tools/readDocumentPages.ts`
6. Register `readDocumentPages` in `genkit/src/tools/index.ts`
7. Add `readDocumentPages` to the tools list in `researchConflictFlow.ts`
8. Update `docs/planning/agents/research-agent.md` to document all three changes
9. Test all three gaps are resolved (see Verification)

## Files Modified

### New Files
- `genkit/src/tools/readDocumentPages.ts` — PDF page text extraction tool

### Modified Files
- `genkit/src/tools/searchDocumentIndex.ts` — add `startPage`/`endPage` to output, `offset` to input
- `genkit/src/tools/navigateDocumentTree.ts` — add `startPage`/`endPage` to output
- `genkit/src/tools/index.ts` — register `readDocumentPages`
- `genkit/src/flows/researchConflictFlow.ts` — add `readDocumentPages` to tool list
- `genkit/package.json` — add `pdf-parse` dependency
- `docs/planning/agents/research-agent.md` — document new tool and updated outputs

## Verification

1. **Page ranges in search results:**
   - Call `searchDocumentIndex({ query: "fire resistance methodology" })`
   - Every result should include `startPage` and `endPage` as integers > 0
   - Values should match the `start_index`/`end_index` in the corresponding `_structure.json` node

2. **Page ranges in navigation:**
   - Call `navigateDocumentTree({ indexFile: "<any>", nodeId: "<any>" })`
   - Response should include `startPage`/`endPage` on the main node
   - Each child should include `startPage`/`endPage`

3. **PDF page reading works:**
   - Pick a document from `manifest.json`, note a section's page range
   - Call `readDocumentPages({ documentFile: "<pdf>", startPage: 1, endPage: 3 })`
   - Should return extracted text, `totalPages` > 0, `truncated: false`
   - Verify text content matches the PDF visually

4. **Page limit enforced:**
   - Call `readDocumentPages({ documentFile: "<pdf>", startPage: 1, endPage: 50 })`
   - Should cap at 10 pages (`endPage` in response should be 10)

5. **Character limit enforced:**
   - Find a text-dense PDF, request 10 pages
   - If text exceeds 30,000 chars, `truncated` should be `true` and text should end with truncation notice

6. **Pagination on search:**
   - Call `searchDocumentIndex({ query: "fire", maxResults: 3, offset: 0 })` → get results A, B, C
   - Call `searchDocumentIndex({ query: "fire", maxResults: 3, offset: 3 })` → get results D, E, F
   - Results should not overlap and should be in descending relevance order
   - `totalMatches` should be the same in both calls

7. **Research agent uses page ranges:**
   - Run `researchConflictFlow` for a known conflict
   - Output `documentFindings[].pageRange` should now contain real page numbers from the tools, not hallucinated values
