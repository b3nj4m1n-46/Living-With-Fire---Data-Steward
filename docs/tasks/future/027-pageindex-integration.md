# PageIndex Integration — In-Repo Document Indexing Pipeline

> **Status:** FUTURE
> **Priority:** P2 (normal)
> **Depends on:** None (existing indexes work; this adds the ability to create new ones)
> **Blocks:** None (but enables self-service document ingestion for data stewards)

## Problem

The knowledge base contains 52 research PDFs in `knowledge-base/`, of which **47 have been indexed** into hierarchical JSON structures used by three Genkit tools (`searchDocumentIndex`, `navigateDocumentTree`, `readDocumentPages`). The indexing was done externally using **PageIndexAlt** (`github.com/b3nj4m1n-46/pageindexalt`), a Python tool that extracts document structure via LLM analysis.

Currently:
1. **No way to index new documents** from within this repo — a data steward adding a PDF to `knowledge-base/` has no pipeline to make it searchable by agents
2. **2 PDFs remain unindexed** (`DiabloFiresafe_Fire-Resistant-Flammable-Plant-Lists.pdf`, `Moritz-Svihra_Pyrophytic-vs-Fire-Resistant-Plants_1998.pdf`)
3. **Manifest is manually maintained** — adding new indexes requires hand-editing `manifest.json`
4. **No admin portal integration** — the source pipeline (task 023) can ingest CSVs but not knowledge base PDFs
5. **External tool dependency** — PageIndexAlt must be cloned and run separately, with its own Python environment

The goal is to bring the PageIndex algorithm **into this repository** so that document indexing is a first-class capability, runnable as a CLI script, a Genkit flow, or from the admin portal.

## Current Implementation

### What Exists in This Repo

**Consumers (Genkit tools that READ indexes):**
- `genkit/src/tools/searchDocumentIndex.ts` — keyword search across all indexed documents (flattens node trees, scores by title 3x + summary 1x match)
- `genkit/src/tools/navigateDocumentTree.ts` — drill-down navigation by `node_id` within a single document's tree
- `genkit/src/tools/readDocumentPages.ts` — extract raw PDF text for a page range (uses `pdf-parse`, max 10 pages, 30KB)

**Index storage:**
- `knowledge-base/indexes/manifest.json` — registry of 47 indexed documents with `file`, `doc_name`, `top_level_sections`, `size_bytes`
- `knowledge-base/indexes/*_structure.json` — 47 hierarchical JSON trees

**Index JSON schema (consumed by tools):**
```typescript
interface IndexNode {
  title: string;           // Section heading
  start_index: number;     // First page (1-indexed)
  end_index: number;       // Last page (1-indexed, inclusive)
  node_id: string;         // 4-digit zero-padded hex ID (e.g., "0000", "0001")
  summary: string;         // AI-generated multi-sentence description of section content
  nodes?: IndexNode[];     // Nested child sections (omitted if leaf node)
}

interface DocumentStructure {
  doc_name: string;        // Exact PDF filename (e.g., "FireSafeMarin_Fire-Resistant-Plants-Marin-County_2019.pdf")
  structure: IndexNode[];  // Top-level sections
}

interface ManifestEntry {
  file: string;            // Index filename (e.g., "DocName_structure.json")
  doc_name: string;        // PDF filename
  top_level_sections: number;
  size_bytes: number;
}

interface Manifest {
  total: number;
  indexes: ManifestEntry[];
}
```

### What Exists in PageIndexAlt (`github.com/b3nj4m1n-46/pageindexalt`)

**Core algorithm** (`pageindex/page_index.py` — the main file, ~800 lines):

The PDF indexing pipeline follows this sequence:

1. **TOC Detection** (`find_toc_pages`) — Scans the first N pages (default: 20) using LLM to identify table-of-contents pages. Each page is sent to the LLM with the prompt: "Does this page contain a list of section/chapter TITLES with corresponding PAGE NUMBERS?" Returns list of TOC page indices.

2. **TOC Extraction** (`toc_transformer`) — If TOC pages found, sends TOC text to LLM to extract hierarchical JSON with `structure` indices (e.g., "1", "1.1", "1.2"), `title`, and `page_number`. Uses continuation prompts for long TOCs that exceed token limits.

3. **Page Mapping** (`calculate_page_offset`) — Maps logical page numbers from TOC to physical PDF page indices. Calculates the most common offset between TOC page references and where those titles actually appear in the PDF. This handles PDFs where "page 1" is actually the 5th physical page.

4. **Verification** (`verify_toc`) — Samples extracted items and checks if section titles actually appear at the assigned physical pages using fuzzy matching. If accuracy < 60%, falls back to alternative processing.

5. **Fix Incorrect Items** (`fix_incorrect_toc`) — For items that failed verification, searches nearby pages for the missing title using LLM.

6. **No-TOC Fallback** — If no TOC detected, the system generates structure by analyzing the document in chunks, asking the LLM to identify sections directly from content.

7. **Large Node Processing** (`process_large_node_recursively`) — For sections exceeding `max_page_num_each_node` (default: 10) or `max_token_num_each_node` (default: 20,000), recursively subdivides into smaller nodes.

8. **Summary Generation** (`generate_summaries_for_structure`) — Async/concurrent: sends each node's text to LLM with prompt "generate a description of the partial document about what are main points covered." All summaries generated in parallel via `asyncio.gather`.

9. **Node ID Assignment** (`write_node_id`) — Assigns zero-padded 4-digit hex IDs sequentially across the entire tree (pre-order traversal).

10. **Post-Processing** — Cleans up intermediate fields (`text`, `physical_index`, `page_number`, `structure`, `appear_start`), formats the final JSON.

**LLM client** (`pageindex/llm_client.py`):
- Provider-agnostic: supports `ollama`, `anthropic`, `openai`, `google`
- Selected via `PAGEINDEX_LLM_PROVIDER` env var
- Sync `completion()` and async `acompletion()` wrappers
- 10 retries with 1s delay on failures
- For Anthropic: uses `claude-haiku-4-5-20251001`, extracts system message from chat history
- Token estimation: `len(text) // 4` (rough English approximation)

**Configuration** (`pageindex/config.yaml`):
```yaml
model: gemini-2.5-flash
toc_check_page_num: 20       # Pages to scan for TOC
max_page_num_each_node: 10   # Split nodes larger than this
max_token_num_each_node: 20000
if_add_node_id: "yes"
if_add_node_summary: "yes"
if_add_doc_description: "no"
if_add_node_text: "no"       # Strip raw text from output (saves space)
```

**Batch script** (`scripts/index_all.sh`):
- Parallelizes with GNU `parallel` (fallback: `xargs`, then sequential)
- Default 4 concurrent jobs
- Skips already-indexed PDFs (resume-safe)
- Validates JSON output before marking success
- Generates `manifest.json` after completion
- Timestamped logging per run

**Dependencies** (`requirements.txt`):
```
pymupdf>=1.26.0
PyPDF2>=3.0.0
python-dotenv>=1.0.0
pyyaml>=6.0
requests>=2.28.0
# Optional: anthropic, openai, google-generativeai
```

**PDF text extraction:** Uses both PyPDF2 and PyMuPDF for different operations. Page text is tagged with `<physical_index_N>` markers for LLM context. Token counting uses the rough `len(text) // 4` estimate.

**JSON extraction from LLM responses:** Robust parser that handles `\`\`\`json` fences, Python `None` → JSON `null`, doubled braces, trailing commas, unquoted property names, and truncated JSON (tries progressively shorter snippets).

### What Does NOT Exist Yet (The Gap)

- No Python environment or PageIndex code in this repo
- No Genkit flow for document indexing
- No CLI script to index a single PDF or batch
- No admin portal UI for PDF upload + indexing
- No manifest auto-update logic
- No integration between source pipeline (task 023) and knowledge base indexing

## Proposed Changes

### Phase 1: Port PageIndex to This Repo (Python)

Create `scripts/pageindex/` as a self-contained Python package ported from PageIndexAlt, configured to use the Anthropic API (consistent with the rest of the project).

#### New Files

**`scripts/pageindex/requirements.txt`:**
```
pymupdf>=1.26.0
PyPDF2>=3.0.0
python-dotenv>=1.0.0
pyyaml>=6.0
requests>=2.28.0
anthropic>=0.40.0
```

**`scripts/pageindex/config.yaml`:**
```yaml
model: claude-haiku-4-5-20251001
toc_check_page_num: 20
max_page_num_each_node: 10
max_token_num_each_node: 20000
if_add_node_id: "yes"
if_add_node_summary: "yes"
if_add_doc_description: "no"
if_add_node_text: "no"
```

**`scripts/pageindex/__init__.py`** — Package init, re-exports `page_index_main`
**`scripts/pageindex/page_index.py`** — Core algorithm (ported from PageIndexAlt)
**`scripts/pageindex/llm_client.py`** — Simplified to Anthropic-only (consistent with project's cloud-only strategy per ARCHITECTURE.md)
**`scripts/pageindex/utils.py`** — Utility functions (ported from PageIndexAlt)
**`scripts/pageindex/page_index_md.py`** — Markdown indexing (optional, lower priority)

**`scripts/index_pdf.py`** — CLI entry point for single PDF indexing:
```bash
python scripts/index_pdf.py --pdf knowledge-base/NewDocument.pdf
# Outputs: knowledge-base/indexes/NewDocument_structure.json
# Updates: knowledge-base/indexes/manifest.json
```

**`scripts/index_all_pdfs.sh`** — Batch indexing (ported from PageIndexAlt's `scripts/index_all.sh`):
```bash
bash scripts/index_all_pdfs.sh knowledge-base/ knowledge-base/indexes/ 4
# Indexes all unindexed PDFs with 4 concurrent jobs
# Updates manifest.json
```

#### Key Modifications from PageIndexAlt

1. **LLM client simplified to Anthropic-only** — Remove ollama, openai, google providers. Use `anthropic` SDK directly. Model: `claude-haiku-4-5-20251001` (cheap, fast, consistent with project's bulk agent model).
2. **Output directory changed** — Write to `knowledge-base/indexes/` instead of `./results/`
3. **Auto-update manifest** — After generating an index, automatically update `manifest.json` with the new entry
4. **Config path resolution** — Resolve config.yaml relative to the script, not CWD
5. **Env var** — Use existing `ANTHROPIC_API_KEY` (already in project)

### Phase 2: Genkit Flow Wrapper (TypeScript)

Create a Genkit flow that calls the Python indexing script via subprocess, following the same bridge pattern used for `fusion-bridge.ts`.

**`genkit/src/flows/indexDocumentFlow.ts`:**
- Input: `{ pdfPath: string, outputDir?: string }`
- Calls `python scripts/index_pdf.py --pdf <path> --output <dir>` via `execFile`
- Parses the output JSON
- Returns: `{ docName: string, topLevelSections: number, nodeCount: number, indexFile: string }`

**`genkit/src/scripts/index-bridge.ts`** — JSON stdin/stdout bridge (like fusion-bridge):
- Action `index-pdf`: accepts `{ pdfPath }`, runs the Python indexer, returns result
- Action `reindex-all`: runs batch indexing, returns summary
- Action `update-manifest`: regenerates manifest from existing index files

### Phase 3: Admin Portal Integration

Add document upload and indexing to the admin portal, extending the Sources section.

**`admin/src/app/sources/documents/page.tsx`** — Knowledge base document registry:
- Table of all PDFs in `knowledge-base/` with: filename, indexed status, section count, size
- "Upload PDF" button → file upload
- "Index" button per unindexed document
- "Re-index" button per indexed document
- Bulk "Index All Unindexed" button

**`admin/src/app/api/sources/documents/upload/route.ts`** — PDF upload:
- Accept PDF via multipart form
- Store in `knowledge-base/`
- Return: `{ filename, size, pages }`

**`admin/src/app/api/sources/documents/index/route.ts`** — Trigger indexing:
- POST with `{ filename }` → spawn Python indexer asynchronously
- Return: `{ status: "indexing" }`
- Poll via GET for completion

**`admin/src/app/api/sources/documents/status/route.ts`** — Poll indexing status:
- Check if `_structure.json` exists for the given document
- Return index stats if complete

### What Does NOT Change

- Existing 47 index files — not modified or regenerated
- `searchDocumentIndex.ts`, `navigateDocumentTree.ts`, `readDocumentPages.ts` — consume the same JSON format
- `manifest.json` — only appended to, never rewritten from scratch (unless `reindex-all`)
- Genkit flow registry — new flow added but existing flows untouched
- Admin portal existing pages — documents is a new sub-section under Sources

## Migration Strategy

1. **Port Python package:** Copy core files from PageIndexAlt, simplify LLM client to Anthropic-only, adjust paths
2. **Write CLI entry point:** `scripts/index_pdf.py` with manifest auto-update
3. **Port batch script:** `scripts/index_all_pdfs.sh` targeting `knowledge-base/` paths
4. **Test on unindexed PDFs:** Index the 2 remaining PDFs (`DiabloFiresafe`, `Moritz-Svihra`) to validate
5. **Test on a known PDF:** Re-index one already-indexed PDF, compare output structure to existing index
6. **Create Genkit bridge:** `index-bridge.ts` following fusion-bridge pattern
7. **Create Genkit flow:** `indexDocumentFlow` wrapping the bridge
8. **Build admin UI:** Document registry page + upload + index trigger
9. **Wire up API routes:** Upload, index, status polling
10. **Update manifest handling:** Auto-append on successful index, validate totals
11. **Update documentation:** Add to CLAUDE.md repo structure, README scripts section, ARCHITECTURE.md

## Files Modified

### New Files — Phase 1 (Python)
- `scripts/pageindex/__init__.py` — Package init
- `scripts/pageindex/page_index.py` — Core indexing algorithm (~800 lines)
- `scripts/pageindex/llm_client.py` — Anthropic-only LLM client
- `scripts/pageindex/utils.py` — Utility functions (PDF extraction, JSON parsing, tree operations)
- `scripts/pageindex/config.yaml` — Default configuration
- `scripts/pageindex/requirements.txt` — Python dependencies
- `scripts/index_pdf.py` — CLI entry point (single PDF)
- `scripts/index_all_pdfs.sh` — Batch indexing script

### New Files — Phase 2 (Genkit)
- `genkit/src/scripts/index-bridge.ts` — JSON bridge for admin portal
- `genkit/src/flows/indexDocumentFlow.ts` — Genkit flow wrapper

### New Files — Phase 3 (Admin Portal)
- `admin/src/app/sources/documents/page.tsx` — Document registry page
- `admin/src/app/api/sources/documents/upload/route.ts` — PDF upload
- `admin/src/app/api/sources/documents/index/route.ts` — Index trigger
- `admin/src/app/api/sources/documents/status/route.ts` — Status polling

### Modified Files
- `knowledge-base/indexes/manifest.json` — auto-updated by indexing scripts
- `admin/src/components/sidebar-nav.tsx` — add "Documents" sub-item under Sources (or separate nav item)
- `CLAUDE.md` — add `scripts/pageindex/` to repo structure
- `README.md` — add indexing scripts to scripts table
- `docs/planning/ARCHITECTURE.md` — add document indexing to agent research context section

## Verification

### Phase 1 — Python Indexing
1. **Single PDF index:**
   ```bash
   cd scripts && pip install -r pageindex/requirements.txt
   python index_pdf.py --pdf ../knowledge-base/DiabloFiresafe_Fire-Resistant-Flammable-Plant-Lists.pdf
   # Verify: knowledge-base/indexes/DiabloFiresafe_Fire-Resistant-Flammable-Plant-Lists_structure.json exists
   # Verify: manifest.json total incremented to 48
   ```

2. **Index quality:**
   - Open the generated `_structure.json`
   - Verify `doc_name` matches the PDF filename exactly
   - Verify `node_id` values are sequential 4-digit hex
   - Verify `start_index` / `end_index` are valid page numbers (1-indexed)
   - Verify `summary` fields are non-empty, coherent descriptions
   - Verify nested `nodes` reflect actual document sub-sections

3. **Existing tool compatibility:**
   ```typescript
   // In Genkit, search for content from the newly indexed document
   const results = await searchDocumentIndex({ query: "fire resistant plants Diablo", maxResults: 5 });
   // Should return results from the new index
   ```

4. **Batch re-run is idempotent:**
   ```bash
   bash scripts/index_all_pdfs.sh ../knowledge-base/ ../knowledge-base/indexes/ 4
   # Should skip all 48 already-indexed PDFs, index only truly new ones
   ```

### Phase 2 — Genkit Bridge
5. **Bridge call:**
   ```bash
   echo '{"action":"index-pdf","pdfPath":"knowledge-base/SomeDoc.pdf"}' | npx tsx src/scripts/index-bridge.ts
   # Returns JSON with docName, topLevelSections, nodeCount
   ```

### Phase 3 — Admin Portal
6. **Upload + Index workflow:**
   - Upload a test PDF via the admin portal
   - Click "Index" → status shows "indexing..."
   - After completion: document shows indexed badge with section count
   - `searchDocumentIndex` returns results from the new document

7. **Document registry accuracy:**
   - All PDFs in `knowledge-base/` appear in the table
   - Indexed column matches actual `_structure.json` existence
   - Section counts match manifest entries

## Cost Estimate

Based on PageIndexAlt's experience indexing 47 PDFs:
- **Model:** Claude Haiku 4.5 ($1/M input, $5/M output)
- **Per PDF:** ~20-50 LLM calls (TOC detection, extraction, verification, summaries)
- **Estimated cost:** ~$0.02-0.10 per PDF depending on length
- **Full batch (50 PDFs):** ~$1-5 total
- **Time:** ~2-5 minutes per PDF (dominated by LLM latency), parallelizable

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Scanned PDFs with no extractable text | Pre-check: if PyPDF2 extracts <100 chars per page, warn user that OCR is needed |
| Dense tabular PDFs that confuse the LLM | Allow manual structure override: upload a hand-written `_structure.json` |
| LLM rate limiting with parallel indexing | Default to 2 concurrent jobs for Anthropic (vs. 4 for Gemini) |
| Python environment management | Document `pip install` in README; consider `venv` setup script |
| Index quality regression | Compare re-indexed output to existing indexes for 2-3 known documents |
| Large PDFs (>100 pages) | Already handled by `process_large_node_recursively` — splits into sub-nodes |

## Reference: PageIndexAlt Repository

**URL:** `https://github.com/b3nj4m1n-46/pageindexalt`

Key files to port:
- `pageindex/page_index.py` — Core algorithm (TOC detection → extraction → mapping → verification → summary generation)
- `pageindex/llm_client.py` — Multi-provider LLM client (simplify to Anthropic-only)
- `pageindex/utils.py` — PDF extraction, JSON parsing, tree operations, config loading
- `pageindex/config.yaml` — Default parameters
- `run_pageindex.py` — CLI entry point
- `scripts/index_all.sh` — Batch script with parallel processing
