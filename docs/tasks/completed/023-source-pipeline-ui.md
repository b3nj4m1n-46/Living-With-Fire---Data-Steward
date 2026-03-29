# Source Pipeline UI — Upload, Map, Analyze from the Portal

> **Status:** COMPLETED
> **Commit:** `f6103c0`
> **Priority:** P2 (normal)
> **Depends on:** 021-table-fusion-ui (mapping review UI must exist), 009-first-external-analysis (pipeline scripts)
> **Blocks:** None

## Problem

Adding a new source dataset currently requires:
1. Manually placing CSV files in the correct `database-sources/<category>/` folder
2. Running `npx tsx src/scripts/external-analysis.ts <folder>` from the command line
3. Monitoring console output for progress
4. Manually checking Dolt for results

A data steward who is "botanically knowledgeable but not necessarily a developer" (PRD persona) cannot do this. The full pipeline — upload, match, map, enhance, classify — needs to be triggerable from the admin portal.

From the PRD (P2): "Source Collection Automation — URL queue, auto-download, DATA-DICTIONARY generation."

## Current Implementation

### What Exists
- `genkit/src/scripts/external-analysis.ts` — CLI orchestrator (387 lines) that chains matchPlantFlow → mapSchemaFlow → bulkEnhanceFlow → classifyConflictFlow
- All 4 Genkit flows are production-ready
- `analysis_batches` table tracks pipeline runs with status, counts, timing, and commit hashes
- Dashboard shows batch history
- `data-sources/DATA-PROVENANCE.md` — source ID registry
- Each dataset folder follows a standard structure: `README.md`, `DATA-DICTIONARY.md`, `plants.csv`, `plants.db`

### What Does NOT Exist Yet
- CSV upload endpoint
- AI-generated DATA-DICTIONARY.md from uploaded CSV
- Pipeline trigger from the portal
- Progress tracking UI (the pipeline takes minutes for large datasets)
- Source ID assignment UI

## Proposed Changes

### 1. Upload Page

`admin/src/app/sources/page.tsx`:

**Source Registry:**
- Table of all known source datasets with: source ID, name, category, record count, analysis status
- "Upload New Source" button → opens upload workflow

**Upload Workflow (multi-step):**

**Step 1 — Upload CSV:**
- File upload dropzone (accept `.csv`)
- After upload: show first 10 rows as preview table
- Show column headers, row count, file size

**Step 2 — Source Metadata:**
- Source name (text input)
- Source ID (auto-suggested based on category, e.g., "FIRE-13")
- Category dropdown: fire, deer, water, pollinators, birds, native, invasive, traits, taxonomy
- Source URL (optional)
- Citation (optional)
- Notes (optional)

**Step 3 — AI Data Dictionary:**
- "Generate Data Dictionary" button → sends CSV headers + sample rows to AI
- AI returns: column definitions, data types, rating scale descriptions, suggested merge keys
- Displayed as editable table — steward can correct before saving
- Saved as `DATA-DICTIONARY.md` in the dataset folder

**Step 4 — Run Pipeline:**
- Links to the fusion UI (021) for schema mapping review
- Or "Auto-Run Full Pipeline" button that chains match → map → enhance → classify without manual mapping review
- Progress indicator showing current step and counts

### 2. Progress Tracking

`admin/src/app/sources/[batchId]/page.tsx`:

Live progress page for a running pipeline:

| Step | Status | Details |
|------|--------|---------|
| Match Plants | Complete | 342 matched, 18 unmatched, 2 ambiguous |
| Map Schema | Running... | — |
| Create Warrants | Pending | — |
| Classify Conflicts | Pending | — |

- Auto-refreshes every 5 seconds while pipeline is running
- Shows final summary when complete (same stats as CLI output)
- "View Warrants" and "View Conflicts" buttons link to filtered views

### 3. API Routes

`admin/src/app/api/sources/upload/route.ts`:
- POST (multipart) — receive CSV file, store in temp location, return preview
- Response: `{ uploadId: string, headers: string[], rowCount: number, sampleRows: string[][] }`

`admin/src/app/api/sources/create/route.ts`:
- POST — create dataset folder structure, save metadata, store CSV
- Input: `{ uploadId, name, sourceId, category, url?, citation?, notes? }`
- Creates: `database-sources/<category>/<Name>/plants.csv`, `README.md`
- Response: `{ datasetFolder: string, sourceId: string }`

`admin/src/app/api/sources/dictionary/route.ts`:
- POST — generate DATA-DICTIONARY.md from CSV headers + sample data using AI
- Input: `{ datasetFolder: string }`
- Response: `{ dictionary: string }` (markdown content)
- Uses Anthropic API to analyze column names, sample values, and infer definitions

`admin/src/app/api/sources/run/route.ts`:
- POST — trigger the full external-analysis pipeline
- Input: `{ datasetFolder: string, autoMap?: boolean }`
- Creates `analysis_batches` record, starts pipeline asynchronously
- Response: `{ batchId: string }`
- Pipeline updates `analysis_batches` as it progresses

`admin/src/app/api/sources/[batchId]/status/route.ts`:
- GET — poll pipeline progress
- Response: `{ status: string, step: string, stats: { matched?, mapped?, warrants?, conflicts? } }`

### 4. Query Functions

`admin/src/lib/queries/sources.ts`:
- `fetchSourceRegistry()` — list all known source datasets with analysis status
- `fetchBatchProgress(batchId)` — current pipeline step and intermediate counts
- `createDatasetFolder(metadata)` — write folder structure to disk

### What Does NOT Change

- Genkit flows — called as-is, no modifications
- `external-analysis.ts` CLI script — continues to work independently
- Existing dataset folders — not modified
- DoltgreSQL schema — reuse `analysis_batches` for tracking
- Other admin pages — sources is a new section

## Migration Strategy

1. Create `/api/sources/upload` for CSV reception and preview
2. Create `/api/sources/create` for folder structure generation
3. Create `/api/sources/dictionary` for AI data dictionary generation
4. Create `/api/sources/run` to trigger the pipeline (calls external-analysis logic)
5. Create `/api/sources/[batchId]/status` for progress polling
6. Build upload workflow UI (4-step form)
7. Build progress tracking page with auto-refresh
8. Build source registry page listing all datasets
9. Add "Sources" to sidebar nav
10. Test: upload CSV → fill metadata → generate dictionary → run pipeline → verify warrants + conflicts created

## Files Modified

### New Files
- `admin/src/app/sources/page.tsx` — source registry + upload entry point
- `admin/src/app/sources/upload/page.tsx` — multi-step upload workflow
- `admin/src/app/sources/upload/upload-client.tsx` — client component for file upload + steps
- `admin/src/app/sources/[batchId]/page.tsx` — pipeline progress page
- `admin/src/app/api/sources/upload/route.ts` — CSV upload
- `admin/src/app/api/sources/create/route.ts` — folder creation
- `admin/src/app/api/sources/dictionary/route.ts` — AI dictionary generation
- `admin/src/app/api/sources/run/route.ts` — pipeline trigger
- `admin/src/app/api/sources/[batchId]/status/route.ts` — progress polling
- `admin/src/lib/queries/sources.ts` — source registry queries

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — add "Sources" nav item

## Verification

1. **CSV upload and preview:**
   - Upload a test CSV → preview shows correct headers and row count
   - Upload a non-CSV → error message

2. **Folder structure created correctly:**
   - After create step, verify:
   ```bash
   ls database-sources/<category>/<Name>/
   # Should contain: plants.csv, README.md
   ```

3. **AI dictionary is reasonable:**
   - Generate dictionary for a known dataset (e.g., FIRE-01)
   - Output should identify scientific_name as the merge key
   - Rating columns should be identified with their scales

4. **Pipeline runs end-to-end:**
   - Trigger pipeline → progress page shows steps advancing
   - Final status shows warrant and conflict counts
   ```sql
   SELECT * FROM analysis_batches WHERE id = $1;
   -- status = 'completed', warrants_created > 0
   ```

5. **Progress polling works:**
   - GET `/api/sources/<batchId>/status` returns current step
   - After completion, returns final stats

6. **Source registry shows new dataset:**
   - After pipeline completes, source registry page lists the new dataset
   - Shows source ID, record count, and "Analyzed" badge
