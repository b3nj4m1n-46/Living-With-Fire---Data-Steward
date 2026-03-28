# Schema Mapper Agent — Source Column to Production Attribute Mapping

> **Status:** COMPLETED
> **Priority:** P1 (important)
> **Depends on:** 002-genkit-setup (Genkit tools + config)
> **Blocks:** 009-first-external-analysis (needs mappings before creating warrants)
> **Commit:** `7b8e812` — Implement schema mapper agent for source-to-production column mapping

## Problem

Each of the 40 source datasets has its own column schema and rating scales. Before we can create warrants from a source, we need to know: which source columns map to which production attributes? And how do the source's rating values translate to production values?

For example, FirePerformancePlants (FIRE-01) has `firewise_rating_code` (1-4 integer) that maps to the production attribute "Flammability" (`a8b73bcb-...`), but the value must be transformed from `1` → `"Firewise (1)"`. Each dataset needs this kind of crosswalk.

The Schema Mapper Agent reads a dataset's DATA-DICTIONARY.md + sample CSV data and proposes mappings to the 125 production attributes, including value transformation rules.

## Current Implementation

### What Exists
- `getDatasetContext` Genkit tool (`genkit/src/tools/datasetContext.ts`) — reads DATA-DICTIONARY.md + README.md for any dataset folder
- `queryDolt` tool — can query the `attributes` table (125 production attributes)
- `LivingWithFire-DB/api-reference/ATTRIBUTE-REGISTRY.md` — full 125-attribute hierarchy with UUIDs and allowed values
- `docs/planning/DATASET-MAPPINGS.md` — mapping framework with example config structure
- Each source dataset has `DATA-DICTIONARY.md` with column definitions and rating scales

### What Does NOT Exist Yet
- `mapSchemaFlow` Genkit flow
- Any tools for reading production attribute definitions or sampling source CSVs
- Stored mapping configurations

## Proposed Changes

### 1. Production Attributes Tool

`genkit/src/tools/productionAttributes.ts`:

A Genkit tool that returns the full production attribute hierarchy from the staging DB.

```typescript
// Genkit tool: getProductionAttributes
// Input: { category?: string }   // optional filter by top-level category name
// Output: {
//   attributes: Array<{
//     id: string,
//     name: string,
//     parentId: string | null,
//     parentName: string | null,
//     valueType: string,
//     valuesAllowed: string | null,   // pipe-delimited allowed values
//     selectionType: string | null
//   }>,
//   count: number
// }
```

Query the `attributes` table, joining parent attribute for hierarchy context. This gives the LLM the full target schema to map against.

### 2. Sample Source Data Tool

`genkit/src/tools/sampleSourceData.ts`:

A Genkit tool that reads a source CSV and returns the header + sample rows.

```typescript
// Genkit tool: sampleSourceData
// Input: {
//   csvPath: string,          // e.g. "database-sources/fire/FirePerformancePlants/plants.csv"
//   sampleSize?: number       // default 10
// }
// Output: {
//   headers: string[],
//   sampleRows: Record<string, string>[],  // first N rows as objects
//   totalRows: number,
//   uniqueValues: Record<string, string[]>  // per-column unique values (up to 20 each)
// }
```

The `uniqueValues` field is critical — it lets the LLM see the actual value distribution for each column, which informs both the mapping and the crosswalk.

### 3. Map Schema Flow

`genkit/src/flows/mapSchemaFlow.ts`:

The main Genkit flow that proposes column→attribute mappings with crosswalks.

```typescript
// Genkit flow: mapSchemaFlow
// Model: MODELS.quality (Sonnet 4.6) — needs strong reasoning for mapping decisions
// Input: {
//   sourceDataset: string,       // folder name: "FirePerformancePlants"
//   datasetFolder: string,       // full path: "database-sources/fire/FirePerformancePlants"
//   csvPath?: string             // override CSV path (default: datasetFolder + "/plants.csv")
// }
// Output: {
//   sourceDataset: string,
//   sourceIdCode: string,         // e.g. "FIRE-01"
//   mappings: Array<{
//     sourceColumn: string,
//     sourceType: string,          // from DATA-DICTIONARY.md
//     sourceDefinition: string,    // column description
//     mappingType: 'DIRECT' | 'CROSSWALK' | 'SPLIT' | 'NEW_ATTRIBUTE' | 'SKIP' | 'UNCERTAIN',
//     targetAttributeId: string | null,
//     targetAttributeName: string | null,
//     confidence: number,
//     reasoning: string,
//     crosswalk?: Record<string, string>,  // source_value → production_value
//     notes: string
//   }>,
//   unmappedColumns: string[],     // columns with no clear production target
//   summary: {
//     total: number,
//     direct: number,
//     crosswalk: number,
//     split: number,
//     skip: number,
//     uncertain: number
//   }
// }
```

#### Flow Steps:

1. **Load context** — call `getDatasetContext` for DATA-DICTIONARY.md + README.md
2. **Load target schema** — call `getProductionAttributes` for all 125 attributes
3. **Sample source data** — call `sampleSourceData` for headers + sample rows + unique values
4. **LLM mapping** — send all three to Sonnet 4.6 with a structured prompt:
   - "You are mapping source columns to the production EAV attribute hierarchy."
   - Include DATA-DICTIONARY.md definitions, production attributes with allowed values, and sample data
   - Ask for mapping type, target attribute, crosswalk table, and confidence per column
5. **Parse and validate** — extract structured mappings from LLM response, validate that target attribute IDs exist
6. **Return** — structured mapping config ready for the Bulk Enhancer Agent

#### Mapping Types:

| Type | Meaning | Example |
|------|---------|---------|
| `DIRECT` | 1:1 column→attribute, values compatible | `common_name` → Common Name |
| `CROSSWALK` | 1:1 column→attribute, values need transformation | `firewise_rating_code` (1-4) → Flammability (text labels) |
| `SPLIT` | One source column → multiple attributes | `size_feet` → Height + Spread |
| `NEW_ATTRIBUTE` | No production attribute exists | Suggest creating one (rare) |
| `SKIP` | Column not useful for production | `slug`, `url`, internal IDs |
| `UNCERTAIN` | LLM unsure — needs human review | Ambiguous semantics |

### What Does NOT Change

- Production attribute definitions — read-only
- Source dataset files — read-only
- DoltgreSQL schema — no table changes (mappings are returned as data, not stored in this task)
- Existing Genkit tools — no modifications

## Migration Strategy

1. Implement `genkit/src/tools/productionAttributes.ts` — query attributes table with parent join
2. Implement `genkit/src/tools/sampleSourceData.ts` — CSV reader with unique value extraction
3. Update `genkit/src/tools/index.ts` — add new tool exports
4. Implement `genkit/src/flows/mapSchemaFlow.ts` — LLM-driven mapping flow
5. Test against FirePerformancePlants (FIRE-01) — well-understood dataset with known mappings
6. Test against WUCOLS (WATER-01) — more complex with 6 regional columns
7. Verify mapping output matches expected mappings from `docs/planning/DATASET-MAPPINGS.md`

## Files Modified

### New Files
- `genkit/src/tools/productionAttributes.ts` — production attribute hierarchy tool
- `genkit/src/tools/sampleSourceData.ts` — source CSV sampler tool
- `genkit/src/flows/mapSchemaFlow.ts` — schema mapping flow

### Modified Files
- `genkit/src/tools/index.ts` — add new tool exports

### Unchanged
- `genkit/src/config.ts` — no changes
- All existing tools — no modifications
- DoltgreSQL database — read-only
- Source datasets — read-only

## Verification

1. **Production attributes tool returns full hierarchy:**
   ```typescript
   const attrs = await getProductionAttributes({});
   // attrs.count === 125
   // attrs.attributes should include "Flammability", "Deer Tolerance", "Water Use", etc.
   ```

2. **Sample source data extracts correctly:**
   ```typescript
   const sample = await sampleSourceData({
     csvPath: 'database-sources/fire/FirePerformancePlants/plants.csv'
   });
   // sample.headers includes 'scientific_name', 'firewise_rating_code', etc.
   // sample.totalRows === 541
   // sample.uniqueValues['firewise_rating_code'] includes ['1', '2', '3', '4']
   ```

3. **FIRE-01 mapping is correct:**
   ```typescript
   const mapping = await mapSchemaFlow({
     sourceDataset: 'FirePerformancePlants',
     datasetFolder: 'database-sources/fire/FirePerformancePlants'
   });
   // mapping.sourceIdCode === 'FIRE-01'
   // Should map firewise_rating_code → Flammability (CROSSWALK)
   // Should map landscape_zone → Home Ignition Zone (CROSSWALK)
   // Should map scientific_name → SKIP (used for matching, not an attribute)
   // Should map common_name → Common Name (DIRECT)
   ```

4. **WUCOLS mapping handles regional columns:**
   ```typescript
   const mapping = await mapSchemaFlow({
     sourceDataset: 'WUCOLS',
     datasetFolder: 'database-sources/water/WUCOLS'
   });
   // Should map region_X_water_use columns to Water Use attribute
   // Should handle the "Not Appropriate for this Region" and "Unknown" values
   ```

## Implementation Notes

### Commit: `7b8e812`

**Files created:**
- `genkit/src/tools/productionAttributes.ts` — queries `attributes` table with self-join for parent names
- `genkit/src/tools/sampleSourceData.ts` — CSV reader with built-in RFC 4180 parser (no new dependencies)
- `genkit/src/flows/mapSchemaFlow.ts` — orchestrates 3 tools in parallel, sends structured prompt to Sonnet, validates output

**Files modified:**
- `genkit/src/tools/index.ts` — added exports and `allTools` entries for both new tools

### Deviations from Spec

- **CSV parser is built-in** — implemented a ~60-line RFC 4180 state-machine parser rather than adding a dependency. Handles quoted fields, escaped double-quotes, BOM stripping, and mixed line endings.
- **JSON extraction** — added 3-tier extraction (direct parse → fenced block → brace extraction) plus one retry on failure, which the spec didn't specify but is needed for LLM output reliability.
- **csvPath auto-discovery** — when `csvPath` is not provided, the flow uses `readdir` to find the first `.csv` in the dataset folder rather than requiring it.
- **Attribute ID validation** — post-LLM validation marks any hallucinated UUIDs as `UNCERTAIN` and nullifies the `targetAttributeId`, preventing invalid references downstream.
