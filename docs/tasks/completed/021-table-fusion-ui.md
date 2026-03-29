# Table Fusion UI — Visual Schema Mapping for Source Datasets

> **Status:** COMPLETED
> **Priority:** P1 (important)
> **Depends on:** 005-schema-mapper-agent (mapSchemaFlow), 009-first-external-analysis (external-analysis.ts pipeline), 010-portal-scaffold
> **Blocks:** 023-source-pipeline-ui (fusion UI is a prerequisite for the full pipeline UI)
> **Commit:** `fad8ad7` — Add table fusion UI: schema mapping editor, preview, and pipeline execution (021)

## Problem

The `mapSchemaFlow` and `external-analysis.ts` pipeline exist but are CLI-only. A data steward cannot:
- View AI-suggested column mappings in the browser
- Edit or override mappings before creating warrants
- See a preview of what records will be created
- Trigger the match → map → enhance → classify pipeline from the portal

This is the last P1 item from the PRD: "As a data steward, I want to view a source dataset's schema side-by-side with the production schema so I can understand how they relate."

## Current Implementation

### What Exists
- `genkit/src/flows/mapSchemaFlow.ts` — AI-driven column mapping (DIRECT, CROSSWALK, SPLIT, SKIP, etc.) with confidence scores and crosswalk objects
- `genkit/src/flows/matchPlantFlow.ts` — Three-tier plant matching
- `genkit/src/flows/bulkEnhanceFlow.ts` — Warrant creation from mapped data
- `genkit/src/flows/classifyConflictFlow.ts` — Conflict detection
- `genkit/src/scripts/external-analysis.ts` — CLI orchestrator that chains all 4 flows
- `genkit/src/prompts/map-schema.md` — Mapping prompt template
- Production attribute registry: 125 attributes with UUIDs and allowed values
- `admin/src/lib/queries/dashboard.ts` — already tracks `analysis_batches`

### What Does NOT Exist Yet
- Admin UI page for viewing/editing schema mappings
- API route to trigger `mapSchemaFlow` from the portal
- API route to trigger `bulkEnhanceFlow` with an edited mapping config
- Visual crosswalk editor (source value → production value)
- Preview of records that will be created before committing

## Proposed Changes

### 1. Fusion Page

`admin/src/app/fusion/page.tsx`:

Landing page showing:
- Dropdown/selector of available source datasets (read from `database-sources/` folder structure or a config)
- List of previously completed analysis batches with their mapping summaries
- "New Analysis" button → starts the mapping workflow

### 2. Mapping Review Page

`admin/src/app/fusion/[batchId]/page.tsx`:

After `mapSchemaFlow` runs, display the results as an interactive table:

| Source Column | Mapping Type | Target Attribute | Confidence | Crosswalk | Action |
|---------------|-------------|------------------|------------|-----------|--------|
| `fire_rating` | CROSSWALK | Fire Resistance | 0.92 | `{1: "Low", 2: "Moderate", 3: "High"}` | Edit / Skip |
| `sci_name` | DIRECT | Scientific Name | 0.99 | — | Edit / Skip |
| `notes` | SKIP | — | — | — | Map / Skip |

**Features:**
- Color-coded confidence badges (green >0.8, yellow 0.5-0.8, red <0.5)
- Editable mapping type dropdown per row
- Editable target attribute dropdown (searchable, shows all 125 production attributes)
- Crosswalk editor: inline table showing source value → production value mapping
- "Unmapped Columns" section at bottom with option to map or confirm skip
- Sample data preview: show 3-5 source rows with the mapping applied

### 3. API Routes

`admin/src/app/api/fusion/map/route.ts`:
- POST — trigger `mapSchemaFlow` for a source dataset
- Input: `{ datasetFolder: string, csvPath: string }`
- Response: `{ batchId: string, mappings: MappingResult[] }`
- Creates an `analysis_batches` record with `batch_type = 'schema_mapping'`

`admin/src/app/api/fusion/preview/route.ts`:
- POST — dry-run `bulkEnhanceFlow` with the (possibly edited) mapping config
- Input: `{ batchId: string, mappings: EditedMapping[] }`
- Response: `{ warrantCount: number, sampleWarrants: Warrant[], conflictEstimate: number }`
- No DB writes — preview only

`admin/src/app/api/fusion/execute/route.ts`:
- POST — run `bulkEnhanceFlow` + `classifyConflictFlow` with the finalized mapping
- Input: `{ batchId: string, mappings: EditedMapping[] }`
- Response: `{ warrantsCreated: number, conflictsDetected: number, commitHash: string }`
- Creates warrants, detects conflicts, Dolt commits

### 4. Query Functions

`admin/src/lib/queries/fusion.ts`:
- `fetchAvailableDatasets()` — list source dataset folders with metadata (name, source ID, record count from README)
- `fetchMappingBatch(batchId)` — get stored mapping results for review
- `saveMappingEdits(batchId, mappings)` — persist steward's edits before execution

### What Does NOT Change

- Genkit flows — called as-is from API routes, no modifications
- DoltgreSQL schema — reuse `analysis_batches` for tracking
- Existing CLI script — `external-analysis.ts` continues to work independently
- Other admin pages — fusion is a new section

## Migration Strategy

1. Create `admin/src/lib/queries/fusion.ts` with dataset listing and batch queries
2. Create `/api/fusion/map` route that calls `mapSchemaFlow` and stores results
3. Build mapping review page with editable table and crosswalk editor
4. Create `/api/fusion/preview` route for dry-run warrant preview
5. Create `/api/fusion/execute` route that runs enhance + classify
6. Build fusion landing page with dataset selector and batch history
7. Add "Fusion" to sidebar nav
8. Test: select dataset → view mappings → edit a crosswalk → preview → execute → verify warrants created

## Files Modified

### New Files
- `admin/src/app/fusion/page.tsx` — fusion landing page
- `admin/src/app/fusion/[batchId]/page.tsx` — mapping review page
- `admin/src/app/fusion/[batchId]/fusion-client.tsx` — client component for interactive editing
- `admin/src/app/api/fusion/map/route.ts` — trigger schema mapping
- `admin/src/app/api/fusion/preview/route.ts` — dry-run preview
- `admin/src/app/api/fusion/execute/route.ts` — execute pipeline
- `admin/src/lib/queries/fusion.ts` — fusion query functions

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — add "Fusion" nav item
- `admin/src/components/summary-cards.tsx` — optionally add "Datasets Mapped" card

## Verification

1. **Dataset selector shows available sources:**
   - Fusion page lists datasets from `database-sources/`
   - Each shows source ID, name, and record count

2. **Mapping flow produces reviewable results:**
   - Select a dataset → "Map Schema" → mappings table appears
   - Column count matches source CSV headers
   - Confidence scores render with color badges

3. **Crosswalk editing persists:**
   - Edit a crosswalk value → save → reload page → edit persists
   - Change mapping type from CROSSWALK to SKIP → target attribute clears

4. **Preview shows accurate warrant count:**
   - POST `/api/fusion/preview` with mapping config
   - `warrantCount` should approximate: matched_plants x mapped_columns
   - Sample warrants show correct source → production value transformation

5. **Execute creates real records:**
   ```sql
   SELECT COUNT(*) FROM warrants WHERE batch_id = $1;
   SELECT COUNT(*) FROM conflicts WHERE batch_id = $1;
   SELECT * FROM analysis_batches WHERE id = $1;
   -- Warrant count, conflict count, and batch record should all exist
   ```

6. **Dolt commit recorded:**
   ```sql
   SELECT message FROM dolt_log ORDER BY date DESC LIMIT 1;
   -- Should reference the source dataset and record counts
   ```
