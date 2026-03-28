# First External Analysis — Process FIRE-01 and WATER-01 Through Full Pipeline

> **Status:** COMPLETED
> **Commit:** `e3189ab`
> **Priority:** P0 (critical)
> **Depends on:** 004-matcher-agent, 005-schema-mapper-agent, 006-conflict-classifier-agent
> **Blocks:** Phase 3 admin portal (needs real external warrants + conflicts to display)

## Problem

The internal conflict scan (007) proves the system works on existing data. Now we need to prove the **full pipeline** works end-to-end: take a raw source dataset, match its plants to production, map its schema, create warrants, and detect conflicts against existing production data.

Two datasets are chosen for the first external analysis:
1. **FirePerformancePlants (FIRE-01)** — 541 plants, simple schema, fire-focused. Good first test because many of its plants are already in production (it's a production source), so we expect high match rates and interesting conflicts.
2. **WUCOLS (WATER-01)** — 4,103 plants, complex schema (6 regional columns), water-focused. Stress test for scale and schema complexity.

## Current Implementation

### What Exists
- `matchPlantFlow` from 004-matcher-agent
- `mapSchemaFlow` from 005-schema-mapper-agent
- `classifyConflictFlow` from 006-conflict-classifier-agent
- All shared Genkit tools (queryDolt, getDatasetContext, lookupProductionPlant, etc.)
- 94,903 bootstrapped warrants from production values
- `analysis_batches` table

### Source Datasets

**FirePerformancePlants (FIRE-01):**
- Path: `database-sources/fire/FirePerformancePlants/plants.csv`
- Records: 541
- Key columns: `scientific_name`, `common_name`, `firewise_rating`, `firewise_rating_code`, `firewise_rating_label`, `landscape_zone`, `size_feet`
- Rating scale: 1=Firewise, 2=Moderately Firewise, 3=At Risk, 4=Not Firewise

**WUCOLS (WATER-01):**
- Path: `database-sources/water/WUCOLS/plants.csv`
- Records: 4,103
- Key columns: `scientific_name`, `common_name`, `plant_type`, `region_1_water_use` through `region_6_water_use`, `region_1_et0` through `region_6_et0`, `region_1_plant_factor` through `region_6_plant_factor`
- Water use scale: Very Low, Low, Moderate, High + "Unknown" + "Not Appropriate for this Region"

### What Does NOT Exist Yet
- Bulk Enhancer flow (`bulkEnhanceFlow`) for creating warrants from matched+mapped data
- External analysis orchestration script
- Any external warrants or external conflicts

## Proposed Changes

### 1. Bulk Enhancer Flow

`genkit/src/flows/bulkEnhanceFlow.ts`:

The data pipeline that creates warrant records from a matched and mapped source dataset. This is primarily a data operation — the intelligence comes from the Matcher and Schema Mapper.

```typescript
// Genkit flow: bulkEnhanceFlow
// Model: none (pure data transformation — no LLM calls)
// Input: {
//   sourceDataset: string,         // "FirePerformancePlants"
//   datasetFolder: string,         // "database-sources/fire/FirePerformancePlants"
//   matchResults: MatchResult[],   // output from matchPlantFlow
//   mappingConfig: MappingConfig,  // output from mapSchemaFlow
//   batchId: string,               // analysis_batches ID
//   dryRun?: boolean
// }
// Output: {
//   warrantsCreated: number,
//   warrantsSkipped: number,       // skipped due to no match or SKIP mapping
//   warrantsFlagged: number,       // low confidence match or UNCERTAIN mapping
//   plantsCovered: number,
//   attributesCovered: number,
//   errors: Array<{ row: number, error: string }>
// }
```

#### Flow Steps:

1. **Read source CSV** — parse all rows from `plants.csv`
2. **For each row:**
   a. Look up match result for this plant's `scientific_name`
   b. If `matchType === 'NONE'` → skip (no production plant to link to)
   c. For each mapped column (from `mappingConfig.mappings` where `mappingType !== 'SKIP'`):
      - Read the source value from the CSV row
      - Apply crosswalk transformation if `mappingType === 'CROSSWALK'`
      - Create a warrant record:
        ```
        warrant_type: 'external'
        status: 'unreviewed'
        plant_id: matchResult.productionPlantId
        plant_genus/species: from match
        attribute_id: mapping.targetAttributeId
        attribute_name: mapping.targetAttributeName
        value: transformed value
        source_value: original CSV value
        source_dataset: sourceDataset folder name
        source_id_code: from mapping sourceIdCode
        source_file: 'plants.csv'
        source_row: row index
        source_column: mapping.sourceColumn
        match_method: matchResult.matchType
        match_confidence: matchResult.confidence
        batch_id: batchId
        ```
3. **Batch insert** — insert warrants in batches of 500
4. **Return** summary stats

### 2. External Analysis Orchestration Script

`genkit/src/scripts/external-analysis.ts`:

A runnable script that orchestrates the full pipeline for a given dataset.

```typescript
// Usage: tsx src/scripts/external-analysis.ts <datasetFolder>
// Example: tsx src/scripts/external-analysis.ts database-sources/fire/FirePerformancePlants
```

Steps:

1. **Create analysis batch:**
   ```sql
   INSERT INTO analysis_batches (id, source_dataset, source_id_code, batch_type, status, started_at)
   VALUES ($1, 'FirePerformancePlants', 'FIRE-01', 'external_analysis', 'running', NOW());
   ```

2. **Step 1: Match** — run `matchPlantFlow` on all plants from the source CSV
   - Log: `Matching 541 plants from FIRE-01...`
   - Log: `Match results: 480 exact, 30 synonym, 15 cultivar, 10 genus-only, 6 none`

3. **Step 2: Map** — run `mapSchemaFlow` on the dataset
   - Log: `Mapping schema for FIRE-01...`
   - Log: `Mappings: 3 crosswalk, 1 direct, 3 skip`

4. **Step 3: Enhance** — run `bulkEnhanceFlow` with match results + mapping config
   - Log: `Creating warrants for FIRE-01...`
   - Log: `Created 1,620 warrants (535 plants × ~3 attributes)`

5. **Step 4: Classify** — run `classifyConflictFlow` in `external` mode
   - Log: `Detecting conflicts between FIRE-01 warrants and existing production warrants...`
   - Log: `Found 87 conflicts (12 critical, 45 moderate, 30 minor)`

6. **Update analysis batch:**
   ```sql
   UPDATE analysis_batches SET
     status = 'completed',
     completed_at = NOW(),
     total_source_records = 541,
     plants_matched = 535,
     warrants_created = 1620,
     conflicts_detected = 87,
     notes = 'FIRE-01: 541 plants, 535 matched, 1620 warrants, 87 conflicts'
   WHERE id = $1;
   ```

7. **Dolt commit:**
   ```sql
   SELECT dolt_add('.');
   SELECT dolt_commit('-m', 'analysis: FIRE-01 — 1620 warrants, 87 conflicts');
   ```

8. **Print summary** to console (similar format to internal scan summary)

### 3. Run for Both Datasets

Add npm scripts:
```json
{
  "analyze:fire01": "tsx src/scripts/external-analysis.ts database-sources/fire/FirePerformancePlants",
  "analyze:water01": "tsx src/scripts/external-analysis.ts database-sources/water/WUCOLS"
}
```

Run FIRE-01 first (smaller, simpler) to validate the pipeline, then WATER-01.

### What Does NOT Change

- Source dataset files — read-only (parsed but not modified)
- Production mirror tables — read-only
- Existing bootstrapped warrants — read-only (new warrants are `warrant_type: 'external'`)
- Existing internal conflicts — untouched (new conflicts are `conflict_mode: 'external'`)

## Migration Strategy

1. Implement `genkit/src/flows/bulkEnhanceFlow.ts` — warrant creation from matched+mapped data
2. Implement `genkit/src/scripts/external-analysis.ts` — full pipeline orchestration
3. Add npm scripts to `genkit/package.json`
4. Run FIRE-01 analysis: `npm run analyze:fire01`
5. Verify FIRE-01 results (warrants, conflicts, batch record, Dolt commit)
6. Run WATER-01 analysis: `npm run analyze:water01`
7. Verify WATER-01 results
8. Review total data in staging: should now have bootstrapped warrants + FIRE-01 warrants + WATER-01 warrants + internal conflicts + external conflicts

## Files Modified

### New Files
- `genkit/src/flows/bulkEnhanceFlow.ts` — warrant creation from matched+mapped source data
- `genkit/src/scripts/external-analysis.ts` — full pipeline orchestration script

### Modified Files
- `genkit/package.json` — add `analyze:fire01`, `analyze:water01` npm scripts

### Additional Files (deviations from spec)
- `genkit/src/utils/csv.ts` — extracted shared CSV parser from `sampleSourceData.ts` to avoid duplication
- `genkit/src/tools/sampleSourceData.ts` — now imports `parseCSV` from shared utility
- `genkit/src/flows/matchPlantFlow.ts` — exported `matchResult` zod schema for cross-flow type sharing
- `genkit/src/flows/mapSchemaFlow.ts` — exported `columnMapping` and `mapSchemaOutput` schemas for cross-flow type sharing

### Unchanged
- All existing tools and flows — used but not modified (only type exports added)
- Source datasets — read-only
- DoltgreSQL schema — no table changes (only data inserts)

## Verification

### FIRE-01 (FirePerformancePlants)

1. **Warrants created:**
   ```sql
   SELECT COUNT(*) FROM warrants WHERE source_id_code = 'FIRE-01';
   -- Should be > 0 (expect ~500+ plants × 2-3 mapped attributes)
   ```

2. **All external warrants linked to valid plants:**
   ```sql
   SELECT COUNT(*) FROM warrants w
   WHERE w.source_id_code = 'FIRE-01'
     AND NOT EXISTS (SELECT 1 FROM plants p WHERE p.id = w.plant_id);
   -- Expected: 0
   ```

3. **External conflicts detected:**
   ```sql
   SELECT COUNT(*) FROM conflicts WHERE conflict_mode = 'external'
     AND (source_a LIKE '%FIRE-01%' OR source_b LIKE '%FIRE-01%');
   -- Should be > 0 (FIRE-01 data vs existing production warrants)
   ```

4. **Analysis batch complete:**
   ```sql
   SELECT * FROM analysis_batches WHERE source_id_code = 'FIRE-01';
   -- status = 'completed', warrants_created > 0, plants_matched > 0
   ```

5. **Dolt commit:**
   ```sql
   SELECT * FROM dolt_log ORDER BY date DESC LIMIT 1;
   -- Message contains 'FIRE-01'
   ```

### WATER-01 (WUCOLS)

6. **Warrants created (larger volume):**
   ```sql
   SELECT COUNT(*) FROM warrants WHERE source_id_code = 'WATER-01';
   -- Should be significant (4,103 plants × multiple regional columns)
   ```

7. **Regional water use data preserved:**
   ```sql
   SELECT DISTINCT attribute_name FROM warrants WHERE source_id_code = 'WATER-01';
   -- Should include water use related attributes
   ```

8. **Dolt commit for WUCOLS:**
   ```sql
   SELECT message FROM dolt_log ORDER BY date DESC LIMIT 2;
   -- Should show both FIRE-01 and WATER-01 commits
   ```

### End of Day 1 Milestone Check

9. **Total data inventory:**
   ```sql
   SELECT warrant_type, source_id_code, COUNT(*) as cnt
   FROM warrants
   GROUP BY warrant_type, source_id_code
   ORDER BY cnt DESC;
   -- Should show: PRODUCTION (94,903), FIRE-01 (X), WATER-01 (Y)

   SELECT conflict_mode, COUNT(*) FROM conflicts GROUP BY conflict_mode;
   -- Should show: internal (X), external (Y)
   ```
