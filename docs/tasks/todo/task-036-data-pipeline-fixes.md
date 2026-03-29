# Task 036 — Data Pipeline Page Fixes

> **Status:** TODO
> **Priority:** P1 (important)
> **Depends on:** None
> **Blocks:** None

## Problem

Three issues with the data pipeline pages (Sources, Fusion) in the admin portal:

1. **Page title mismatch** — The Sources page header says "Sources" but should say "Data Set Sources" to distinguish from other source-related concepts (documents, reliability). The sidebar nav label should also update.

2. **Missing record counts** — 17 of 39 datasets show no record count ("—") on the Sources page. The count is parsed from `**Plants:** <number>` in README.md, but many READMEs don't use that exact format. Additionally, 5 datasets have plant data in non-standard CSV filenames (`plant_swaps.csv`, `plants_oregon.csv`, `variables.csv`, etc.) that aren't detected.

3. **Fusion dropdown empty** — The fusion page's dataset selector dropdown shows nothing when the Dolt DB is unavailable. The `fetchAvailableDatasets()` function scans the filesystem successfully but then calls `query()` for batch enrichment. If the DB throws, the page-level `try/catch` in `fusion/page.tsx:14-21` catches everything and returns empty arrays, wiping out the filesystem results.

## Current Implementation

### Sources page
- `admin/src/app/sources/page.tsx:43` — Header: `<h2>Sources</h2>`
- `admin/src/components/sidebar-nav.tsx:25` — Nav label: `{ href: "/sources", label: "Sources" }`

### Record count parsing
- `admin/src/lib/queries/sources.ts:46-47` — Regex: `/\*\*Plants:\*\*\s*(\d[\d,]*)/`
- `admin/src/lib/queries/sources.ts:59-79` — `parseDatasetMeta()` reads README.md and DATA-DICTIONARY.md only
- Same logic duplicated in `admin/src/lib/queries/fusion.ts:72-92`

### Datasets with non-standard CSV names (have plant data but no `plants.csv`)

| Dataset | Actual files | Records |
|---|---|---|
| `fire/FirescapingBook` | `plant_swaps.csv`, `bad_plants.csv`, `replacement_plants.csv` | 999 swaps |
| `fire/FLAMITS` | `flamits.db` (data table: 19,972 rows; taxon table: 1,791 rows) | 1,791 taxa |
| `native/LBJ_Wildflower` | `plants_oregon.csv`, `plants_california.csv`, `plants_ca_wa.csv` | ~540 unique |

### Datasets with no data files at all (reference/placeholder only) — TO BE REMOVED

| Dataset | What it is | Why remove |
|---|---|---|
| `fire/BethkeUCCE2016` | Literature review; plant appendix never located | No plant data; reference material belongs in `knowledge-base/` |
| `fire/SAFELandscapes` | Guidebook; no data extracted | No plant data at all |
| `fire/UF_IFAS_FirewiseShrubs` | Florida extension publication; no data | No plant data; Florida-focused, outside Pacific West scope |
| `native/OrAssocNurseries` | Nursery business directory (`nurseries.csv`), not plant data | Not a plant dataset — it's a company listing |

### Fusion dropdown
- `admin/src/app/fusion/page.tsx:11-22` — `try/catch` wraps both `fetchAvailableDatasets()` and `fetchFusionBatches()`
- `admin/src/lib/queries/fusion.ts:132-153` — Batch enrichment query fires after filesystem scan; if it throws, all datasets are lost

## Proposed Changes

### 1. Rename "Sources" → "Data Set Sources"

- `admin/src/app/sources/page.tsx` — Change `<h2>` from "Sources" to "Data Set Sources"
- `admin/src/components/sidebar-nav.tsx` — Change nav label from "Sources" to "Data Set Sources"

### 2. Add `plants.csv` row-count fallback for record counts

In both `admin/src/lib/queries/sources.ts` and `admin/src/lib/queries/fusion.ts`, update `parseDatasetMeta()`:

1. First try the existing README/DATA-DICTIONARY regex approach
2. If `plantCount` is still `null`, look for `plants.csv` in the dataset folder and count data rows (lines minus header)
3. If no `plants.csv`, look for any `*.csv` file that contains plant-like data (heuristic: has a column matching `scientific_name`, `species`, `taxon`, or similar) and count those rows
4. Deduplicate the shared `parseDatasetMeta()` logic into a single shared helper (both files have identical copies)

### 3. Make batch enrichment non-fatal in fusion

In `admin/src/lib/queries/fusion.ts`, wrap the batch enrichment DB query (lines 132-153) in its own `try/catch` so the filesystem-derived datasets are returned even when the DB is unavailable.

Also apply the same pattern in `admin/src/lib/queries/sources.ts` (lines 128-149) so the Sources page degrades gracefully too.

### 4. Remove non-dataset folders from `database-sources/`

Delete the following 4 folders that are not actual plant datasets:

- `database-sources/fire/BethkeUCCE2016/`
- `database-sources/fire/SAFELandscapes/`
- `database-sources/fire/UF_IFAS_FirewiseShrubs/`
- `database-sources/native/OrAssocNurseries/`

If any of these are referenced in `data-sources/DATA-PROVENANCE.md`, `data-sources/SOURCE-CROSSREF.md`, or the root `README.md` inventory, update those references to note the removal (or move them to a "Reference Only — No Data" section).

### What Does NOT Change
- Fusion execution logic, mapping pipeline, or API routes
- Upload workflow

## Migration Strategy

1. Remove the 4 non-dataset folders (BethkeUCCE2016, SAFELandscapes, UF_IFAS_FirewiseShrubs, OrAssocNurseries) and update provenance/crossref docs
2. Extract `parseDatasetMeta()` into a shared utility (e.g., `admin/src/lib/dataset-meta.ts`) used by both `queries/sources.ts` and `queries/fusion.ts`
3. Add CSV row-count fallback to `parseDatasetMeta()`
4. Wrap batch enrichment queries in both `sources.ts` and `fusion.ts` with individual `try/catch` blocks
5. Rename page header and sidebar nav label

## Files Modified

### New Files
- `admin/src/lib/dataset-meta.ts` — Shared `parseDatasetMeta()` with CSV fallback logic

### Removed Folders
- `database-sources/fire/BethkeUCCE2016/` — Literature review, no plant data
- `database-sources/fire/SAFELandscapes/` — Guidebook, no data extracted
- `database-sources/fire/UF_IFAS_FirewiseShrubs/` — No data, out of scope (Florida)
- `database-sources/native/OrAssocNurseries/` — Business directory, not plant data

### Modified Files
- `admin/src/app/sources/page.tsx` — Header text: "Sources" → "Data Set Sources"
- `admin/src/components/sidebar-nav.tsx` — Nav label: "Sources" → "Data Set Sources"
- `admin/src/lib/queries/sources.ts` — Import shared `parseDatasetMeta()`, wrap batch enrichment in `try/catch`
- `admin/src/lib/queries/fusion.ts` — Import shared `parseDatasetMeta()`, wrap batch enrichment in `try/catch`
- `data-sources/DATA-PROVENANCE.md` — Update to reflect removed datasets
- `data-sources/SOURCE-CROSSREF.md` — Update to reflect removed datasets
- `README.md` — Update inventory counts (41 → 37 databases)

## Verification

1. **Record counts** — Start the admin portal, navigate to Data Set Sources page. Verify:
   - FLAMITS shows 1,791 (from `flamits.db` taxon table or equivalent CSV)
   - FirescapingBook shows a count (from `plant_swaps.csv`)
   - LBJ_Wildflower shows a count (from state CSV files)
   - BethkeUCCE2016, SAFELandscapes, UF_IFAS_FirewiseShrubs, OrAssocNurseries no longer appear (removed)
   - All other datasets that previously showed counts still show the same values

2. **Fusion dropdown** — Stop the Dolt database, navigate to `/fusion`. The dropdown should still list all datasets grouped by category. With DB running, batch status badges should still appear.

3. **Page title** — Header reads "Data Set Sources", sidebar nav reads "Data Set Sources", all `/sources/*` routes still work.
