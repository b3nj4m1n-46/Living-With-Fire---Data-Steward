# 030a — Coverage Analysis & Enrichment Suggestion Backend

> **Status:** COMPLETED
> **Priority:** P1 (important)
> **Depends on:** 028b (internal audit — completed)
> **Blocks:** 030b (coverage dashboard UI)
> **Commit:** `d707f30` — Add coverage analysis & enrichment suggestion backend (task 030a)

## Problem

The production database has 1,361 plants and 94,903 attribute values across 125 attributes, but coverage is uneven. Some plants are missing key attributes (flammability, water use, deer resistance, native status) that directly affect the app's usefulness. Meanwhile, the 40 source databases in `database-sources/` contain 866,000+ records that likely fill many of these gaps — but there's no systematic way to:

1. See which plants are missing which attributes
2. Know which source databases have data that could fill those gaps
3. Prioritize enrichment by impact (safety-critical attributes like flammability first)

The Relative Value Matrix already tracks 15 calculated "Has X" flags per plant, proving that completeness tracking is valued. This task builds the query layer and API endpoints that surface gaps and cross-reference them against source databases. Task 030b will add the UI.

## Current Implementation

### Production DB (Neon PostgreSQL)
- **`plants`** — 1,361 plants with `id`, `genus`, `species`, `common_name`
- **`attributes`** — 125 attributes in hierarchical tree, each with `values_allowed`
- **`values`** — 94,903 rows linking `plant_id` + `attribute_id` + `value` + `source_id`
- **`sources`** — 103 tracked sources

### Relative Value Matrix (existing completeness flags)
15 calculated boolean attributes already track per-plant coverage:
- Has Flammability Rating (`b1000001-...-000000000001`)
- Has Water Amount (`b1000001-...-000000000002`)
- Has Drought Tolerant (`b1000001-...-000000000003`)
- Has Native Status (`b1000001-...-000000000004`)
- Has Deer Resistance (`b1000001-...-000000000005`)
- Has Wildlife Sum, Has Landscape Use, Has Erosion Control, Has Invasive Component
- Has Soils Rating, Has Availability, Has Easy to Grow, Has Edible Plant, Has Climate Rating
- Value Sum Total (aggregate score)

### Internal Audit (028b — completed)
- `POST /api/audit/internal` scans for multi-source disagreements, value validation failures, and missing provenance
- Query functions in `admin/src/lib/queries/audit.ts`
- Creates warrants and conflicts in Dolt staging DB

### Source Databases (40 datasets)
Each dataset has a SQLite `plants.db` with a `plants` table indexed on `scientific_name`. Schemas vary per source but all have `scientific_name` as the match key. Examples:
- `database-sources/fire/OaklandFireSafe/plants.db` — 212 plants, `fire_rating` column
- `database-sources/deer/MissouriBotanicalDeer/plants.db` — 112 plants, `deer_browse` column
- `database-sources/water/WUCOLS/plants.db` — 4,103 plants, 6 regional `water_use` columns

### What Does NOT Exist
- No gap analysis queries or API endpoints
- No cross-reference between production gaps and source database coverage
- No enrichment suggestion engine

## Proposed Changes

### Part 1: Coverage Analysis Queries & API

#### New file: `admin/src/lib/queries/coverage.ts`

Query functions that analyze attribute completeness across production plants:

```typescript
// Count plants missing each key attribute
interface AttributeCoverage {
  attribute_id: string;
  attribute_name: string;
  plants_with_value: number;
  plants_missing: number;
  coverage_pct: number;
}
export async function getAttributeCoverage(): Promise<AttributeCoverage[]>

// For a given attribute, list which plants are missing it
interface PlantGap {
  plant_id: string;
  genus: string;
  species: string;
  common_name: string;
}
export async function getPlantsGap(attributeId: string): Promise<PlantGap[]>

// Per-plant completeness: how many of the 15 key attributes does each plant have?
interface PlantCompleteness {
  plant_id: string;
  genus: string;
  species: string;
  common_name: string;
  attributes_populated: number;
  attributes_total: number;
  completeness_pct: number;
  missing_attributes: string[]; // attribute names
}
export async function getPlantCompleteness(): Promise<PlantCompleteness[]>
```

**Core SQL pattern** for attribute coverage (queries Neon production DB):
```sql
-- Count plants that have vs. lack a value for each non-calculated attribute
SELECT
  a.id AS attribute_id,
  a.name AS attribute_name,
  COUNT(DISTINCT v.plant_id) AS plants_with_value,
  (SELECT COUNT(*) FROM plants) - COUNT(DISTINCT v.plant_id) AS plants_missing,
  ROUND(COUNT(DISTINCT v.plant_id)::numeric / (SELECT COUNT(*) FROM plants) * 100, 1) AS coverage_pct
FROM attributes a
LEFT JOIN "values" v ON v.attribute_id = a.id
WHERE a.parent_attribute_id IS NOT NULL          -- skip top-level category nodes
  AND a.id NOT LIKE 'b1000001-%'                 -- skip calculated Relative Value Matrix flags
GROUP BY a.id, a.name
ORDER BY coverage_pct ASC;
```

#### New file: `admin/src/app/api/coverage/route.ts`

`GET /api/coverage` — returns full attribute coverage array.

Query params:
- `?sort=coverage_asc|coverage_desc|name` (default: `coverage_asc` — worst gaps first)
- `?category=flammability|water|deer|...` — filter to one attribute category

#### New file: `admin/src/app/api/coverage/[attributeId]/route.ts`

`GET /api/coverage/:attributeId` — returns list of plants missing that attribute.

#### New file: `admin/src/app/api/coverage/plants/route.ts`

`GET /api/coverage/plants` — returns per-plant completeness scores.

Query params:
- `?sort=completeness_asc|completeness_desc` (default: `completeness_asc`)
- `?limit=50` — pagination

### Part 2: Source-to-Attribute Mapping Config

#### New file: `admin/src/lib/source-attribute-map.ts`

A static registry mapping source database columns to production attribute UUIDs. This builds on the existing `admin/src/lib/attribute-map.ts` crosswalk:

```typescript
interface SourceAttributeMapping {
  sourceId: string;           // e.g., "FIRE-01"
  dbPath: string;             // relative path to plants.db
  tableName: string;          // usually "plants"
  matchColumn: string;        // usually "scientific_name"
  mappings: {
    sourceColumn: string;     // column in source DB
    attributeId: string;      // target production attribute UUID
    attributeName: string;    // for display
    transformFn?: string;     // optional value normalization function name
  }[];
}
```

Initial mappings to define (highest-impact sources):

| Source ID | Category | Key Columns | Maps To |
|-----------|----------|-------------|---------|
| FIRE-01 through FIRE-12 | Fire | `fire_rating`, `flammability`, `fire_resistance` | Flammability attributes |
| DEER-01 through DEER-06 | Deer | `deer_rating`, `deer_browse`, `deer_resistance` | Deer Resistance |
| WATER-01 (WUCOLS) | Water | `region_*_water_use` | Water Needs Amount |
| DROUGHT-01 | Drought | `drought_tolerance` | Drought Tolerant |
| NATIVE-01 through NATIVE-04 | Native | `native_status`, `state` | Native Status |
| POLL-01 through POLL-03 | Pollinator | `pollinators`, `host_plant` | Wildlife Values |

### Part 3: Enrichment Scanner Queries & API

#### New file: `admin/src/lib/queries/enrichment.ts`

Functions that open source SQLite databases and cross-reference against production gaps:

```typescript
// For a given attribute gap, scan relevant source DBs for matching plants
interface EnrichmentCandidate {
  plant_id: string;        // production plant UUID
  genus: string;
  species: string;
  source_id: string;       // e.g., "FIRE-01"
  source_name: string;
  source_db_path: string;
  source_column: string;   // column in source DB that maps to this attribute
  source_value: string;    // the value the source has
}
export async function findEnrichmentCandidates(
  attributeId: string
): Promise<EnrichmentCandidate[]>

// Summary: for each gap attribute, how many plants could be enriched from which sources
interface EnrichmentSummary {
  attribute_id: string;
  attribute_name: string;
  plants_missing: number;
  enrichable_count: number;    // plants missing that ALSO appear in a source
  enrichable_pct: number;
  sources: {
    source_id: string;
    source_name: string;
    matchable_plants: number;
  }[];
}
export async function getEnrichmentSummary(): Promise<EnrichmentSummary[]>
```

**Matching logic:**
1. Get list of plants missing the target attribute from production DB (reuse `getPlantsGap`)
2. For each source mapped to that attribute (from `source-attribute-map.ts`), open its SQLite DB
3. Query `SELECT scientific_name, <source_column> FROM plants WHERE <source_column> IS NOT NULL AND <source_column> != ''`
4. Match source `scientific_name` against production `genus || ' ' || species` (case-insensitive, trimmed)
5. Return matches with the source value included

#### New file: `admin/src/app/api/enrichment/route.ts`

`GET /api/enrichment` — returns enrichment summary (which gaps can be filled, by which sources).

#### New file: `admin/src/app/api/enrichment/[attributeId]/route.ts`

`GET /api/enrichment/:attributeId` — returns specific enrichment candidates for one attribute.

### What Does NOT Change

- Internal audit (028b) remains untouched — gap analysis is additive, not a replacement
- Existing conflict detection and resolution workflows
- Production database schema (EAV model stays the same)
- Source database files and schemas — read-only access
- Existing Genkit flows and agents
- The enrichment scanner does NOT auto-ingest — it only suggests. Actual ingestion still goes through the existing upload/fusion pipeline
- No UI changes in this task (deferred to 030b)

## Migration Strategy

1. **Add coverage queries** — `admin/src/lib/queries/coverage.ts` with SQL against Neon production DB
2. **Add coverage API routes** — `GET /api/coverage`, `/api/coverage/:attributeId`, `/api/coverage/plants`
3. **Build source-attribute mapping** — `admin/src/lib/source-attribute-map.ts` with initial mappings for fire, deer, water, drought, native sources
4. **Add enrichment queries** — `admin/src/lib/queries/enrichment.ts` with SQLite cross-reference logic
5. **Add enrichment API routes** — `GET /api/enrichment`, `/api/enrichment/:attributeId`

## Files Modified

### New Files
- `admin/src/lib/queries/coverage.ts` — coverage analysis query functions
- `admin/src/lib/queries/enrichment.ts` — enrichment candidate query functions
- `admin/src/lib/source-attribute-map.ts` — source DB column → production attribute UUID registry
- `admin/src/app/api/coverage/route.ts` — attribute coverage endpoint
- `admin/src/app/api/coverage/[attributeId]/route.ts` — per-attribute gap list endpoint
- `admin/src/app/api/coverage/plants/route.ts` — per-plant completeness endpoint
- `admin/src/app/api/enrichment/route.ts` — enrichment summary endpoint
- `admin/src/app/api/enrichment/[attributeId]/route.ts` — per-attribute enrichment candidates endpoint

### Modified Files
None — this task is purely additive backend work.

## Verification

### Coverage Analysis
1. `GET /api/coverage` returns all non-calculated attributes with coverage percentages
2. Attributes with 0% coverage appear at the top when sorted ascending
3. `GET /api/coverage/:attributeId` for a known low-coverage attribute returns the correct list of plants missing it
4. `GET /api/coverage/plants?sort=completeness_asc&limit=10` returns the 10 least-complete plants
5. Cross-check: for "Has Flammability Rating", count plants where value = "1" in production `values` table — should match the `plants_with_value` count from the coverage API

### Enrichment Scanner
1. `GET /api/enrichment` returns at least one entry for fire, deer, water, and native categories
2. For flammability gaps: enrichment candidates reference FIRE-xx source databases and include actual `fire_rating` values from those SQLite files
3. `GET /api/enrichment/:attributeId` for deer resistance returns candidates from DEER-01 through DEER-06 with `scientific_name` matches against production plants
4. No false matches: spot-check 5 enrichment candidates to confirm the `scientific_name` in the source DB genuinely matches the production plant's `genus || ' ' || species`
