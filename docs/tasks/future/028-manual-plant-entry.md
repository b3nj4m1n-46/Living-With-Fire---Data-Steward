# 028 — Manual Plant Entry with Auto-Population

> **Status:** FUTURE
> **Priority:** P2 (normal)
> **Depends on:** Core admin portal complete (tasks 001–025), Genkit agent pipeline operational
> **Blocks:** Geographic expansion beyond Pacific NW

## Problem

The admin portal has no way to add individual plant species. All data ingestion flows through the batch CSV upload pipeline (Sources > Upload → AI pipeline → warrant curation → sync). This means:

1. **Adding a single plant requires creating a CSV file** with one row, uploading it, filling in source metadata, generating a data dictionary, and running the full pipeline — a 10-minute workflow for one plant.
2. **Expanding the production database** beyond the current 1,361 Pacific NW plants requires a per-plant entry mechanism that doesn't force batch overhead.
3. **Curator-discovered plants** (from literature, nursery catalogs, field observations) have no direct entry path.

## Current Implementation

### Entry path (batch only)
- `admin/src/app/sources/upload/` — 4-step CSV upload wizard
- `admin/src/app/api/sources/` — upload, create, dictionary, run endpoints
- No individual plant creation endpoints exist anywhere in the API

### Production database schema
- `plants` table: `id` (UUID), `genus`, `species`, `subspecies_varieties`, `common_name`, `notes`, `last_updated`, `urls`
- `values` table (EAV): `id`, `attribute_id`, `plant_id`, `value`, `source_id`, `notes`, `source_value`, `metadata`
- `attributes` table: 125 attributes across 13 categories with `value_type`, `values_allowed`, `display_type`
- `sources` table: 103 sources with provenance metadata

### Existing data for auto-population
- **Taxonomy backbones** (362K+ species): POWO_WCVP, WorldFloraOnline, USDA_PLANTS — provide family, genus, species, lifeform, climate zones, native distribution, hardiness zones
- **41 source databases** (866K+ records): fire resistance, deer resistance, water use, pollinator value, invasiveness, native status, growth traits
- **Genkit flows**: `matchPlantFlow` (fuzzy name matching), `bulkEnhanceFlow` (warrant creation from matches), `classifyConflictFlow` (conflict detection)

### Warrant/claim model (Dolt staging)
- `warrants` table: evidence records with `warrant_type`, `status`, plant/attribute/value fields, source provenance, admin notes
- `claims` table: approved decisions linking warrants
- `claim_warrants` junction table
- Existing sync pushes approved claims to Neon production

## Proposed Changes

### Core Concept: Type a Name, Get a Pre-Filled Plant

The manual entry flow is **not** a blank 125-field form. It is:

1. **Curator types a scientific name** (with autocomplete against taxonomy backbones + existing production plants)
2. **System searches all 41 source databases + 3 taxonomy backbones** for that species (and known synonyms)
3. **System presents auto-populated attribute values** grouped by category, each tagged with its source
4. **Curator reviews, edits, accepts/rejects** individual values
5. **System creates warrants** for each accepted value and routes through existing claim/approval/sync flow

This leverages the exact same evidence model as batch ingestion — every value has provenance — but the entry point is a curator typing a name instead of uploading a CSV.

### New Page: `/plants`

**Plant browser and entry point.**

- Searchable table of all production plants (1,361+)
- Columns: scientific name, common name, family, attribute count, last updated
- Filter by: family, category completeness (has fire rating, has deer rating, etc.)
- Action buttons: "View/Edit" (existing plant), "Add New Plant" (triggers manual entry flow)

### New Page: `/plants/add`

**Manual plant entry with auto-population.**

#### Step 1: Plant Identification

- Text input with **typeahead autocomplete** searching:
  - Production `plants` table (exact matches → "already exists, edit instead?")
  - USDA_PLANTS (`scientific_name`, `common_name`) — 93K species
  - POWO_WCVP (`taxon_name`) — 362K species
  - WorldFloraOnline (`scientificName`) — 381K species
- On selection, display: scientific name, common name(s), family, lifeform, native range
- **Synonym resolution**: if name is a synonym in POWO/WFO, show accepted name and let curator confirm
- If no match in any backbone: allow manual entry with warning "Not found in taxonomy databases"

#### Step 2: Auto-Population Search

- System searches all 41 source databases for the species (by `scientific_name`, accounting for synonyms)
- Uses existing `matchPlantFlow` logic for fuzzy matching
- Results displayed as a **source hit map**:
  ```
  Found in 8 of 41 sources:
  ✓ FIRE-01 (OSU PNW590) — fire_resistance: "High"
  ✓ DEER-01 (Rutgers) — deer_rating: "Rarely Damaged"
  ✓ WATER-01 (WUCOLS) — water_use: "Low"
  ✓ TAXON-01 (POWO) — family: "Rosaceae", lifeform: "Shrub"
  ✓ NATIVE-01 (PlantNative) — native_status: "Native to OR, WA"
  ✗ POLL-01 — no match
  ✗ INVAS-01 — no match
  ...
  ```
- Curator can expand each hit to see raw source values

#### Step 3: Attribute Review Grid

- Auto-populated values mapped to production attributes (using existing `mapSchemaFlow` logic)
- Displayed in a **category-grouped grid** matching the 13 attribute categories:
  - Flammability, Growth, Water Requirements, Environmental, Plant Materials, Nativeness, Invasiveness, Wildlife, Utility, Edibility, Climate, Soils, Relative Value Matrix
- Each attribute row shows:
  - Attribute name
  - Auto-populated value (normalized to allowed values) with source tag
  - Confidence indicator (exact match vs. fuzzy vs. inferred)
  - Accept/Reject/Edit toggle
  - If multiple sources disagree: show all values, let curator pick or enter custom
- **Calculated fields** (marked `Calculated: Yes` in attribute registry) are read-only and auto-computed
- Empty attributes (no source data found) shown as blank with optional manual fill

#### Step 4: Confirm and Create

- Summary of: plant identity, N attributes accepted, sources cited
- Optional curator notes field
- "Create Plant" button triggers:
  1. INSERT into Dolt `plants` table (if genuinely new species) with new UUID
  2. INSERT one `warrant` per accepted attribute value with:
     - `warrant_type = 'manual_entry'` (new enum value)
     - `status = 'included'`
     - `source_id_code` = original source ID (e.g., `FIRE-01`) for auto-populated values, or `MANUAL` for hand-entered values
     - `curated_by` = current user
     - `match_confidence` = 1.0 for exact source matches, lower for fuzzy
  3. Auto-create `claim` + `claim_warrants` (pre-approved since curator just reviewed)
  4. Dolt commit: `"Manual entry: Genus species (N attributes from M sources)"`
  5. Redirect to plant detail page showing the new entry ready for sync

### New Page: `/plants/[plantId]`

**Plant detail/edit view.**

- All 125 attributes grouped by category
- Current production values with source tags
- Edit individual values (creates new warrant with `warrant_type = 'manual_edit'`)
- History: Dolt log filtered to this plant's changes
- Link to sync page for pushing changes

### New API Endpoints

#### `GET /api/plants`
List production plants with search and filtering.

**Query params:** `?search=`, `?family=`, `?page=`, `?limit=`

**Response:**
```json
{
  "plants": [
    {
      "id": "uuid",
      "genus": "Mahonia",
      "species": "aquifolium",
      "common_name": "Oregon Grape",
      "family": "Berberidaceae",
      "attribute_count": 47,
      "last_updated": "2025-01-15T..."
    }
  ],
  "total": 1361,
  "page": 1
}
```

#### `GET /api/plants/lookup`
Search taxonomy backbones and source databases for a species name. Powers the typeahead and auto-population.

**Query params:** `?name=` (scientific name, partial OK for typeahead)

**Response:**
```json
{
  "taxonomy": {
    "matched_name": "Mahonia aquifolium",
    "accepted_name": "Mahonia aquifolium",
    "family": "Berberidaceae",
    "lifeform": "Shrub",
    "native_range": "Western North America",
    "synonyms": ["Berberis aquifolium"],
    "sources": ["POWO_WCVP", "USDA_PLANTS", "WorldFloraOnline"]
  },
  "production_match": {
    "exists": true,
    "plant_id": "uuid",
    "attribute_count": 47
  },
  "source_hits": [
    {
      "source_id": "FIRE-01",
      "source_name": "OSU PNW590",
      "matched_name": "Mahonia aquifolium",
      "match_confidence": 1.0,
      "fields": {
        "fire_resistance": "High",
        "flammability_notes": "Low fuel volume..."
      }
    }
  ]
}
```

#### `POST /api/plants/create`
Create a new plant with curated attribute values.

**Request:**
```json
{
  "genus": "string",
  "species": "string",
  "subspecies_varieties": "string | null",
  "common_name": "string",
  "notes": "string | null",
  "attributes": [
    {
      "attribute_id": "uuid",
      "value": "string",
      "source_id_code": "FIRE-01 | MANUAL",
      "source_value": "string (original value before normalization)",
      "match_confidence": 0.95,
      "notes": "string | null"
    }
  ],
  "curator_notes": "string | null"
}
```

**Response:**
```json
{
  "plant_id": "uuid",
  "warrants_created": 47,
  "claims_created": 1,
  "commit_hash": "abc123...",
  "conflicts_detected": 0
}
```

#### `PATCH /api/plants/[plantId]`
Edit attributes on an existing plant. Same attribute array format as create. Creates new warrants for changed values only.

### What Does NOT Change

- **Batch CSV upload pipeline** — remains the primary path for ingesting entire datasets
- **Claim/Warrant model** — manual entries use the same evidence structure, just with `warrant_type = 'manual_entry'`
- **Sync flow** — `POST /api/sync/push` handles manual entry claims identically to pipeline claims
- **Genkit agent flows** — reused for matching and mapping, not replaced
- **Production database schema** — no table changes in Neon; manual entries create standard `plants` + `values` rows
- **Existing admin pages** (sources, claims, conflicts, matrix, warrants, fusion, sync, history) — all unchanged

### Dolt Schema Addition

Add `'manual_entry'` and `'manual_edit'` to the `warrant_type` values used in the warrants table:

```sql
-- No ALTER needed since warrant_type is TEXT, not ENUM
-- Just document the new valid values:
-- 'existing' (from batch pipeline)
-- 'manual_entry' (new plant via manual entry)
-- 'manual_edit' (edit existing plant attribute via manual entry)
```

## Migration Strategy

1. **Add `/api/plants` and `/api/plants/lookup` endpoints** — read-only, no schema changes, can ship independently
2. **Add `/plants` browser page** — useful immediately for viewing production data
3. **Build lookup engine** — query taxonomy backbones + source databases SQLite files for a given species name; return unified results
4. **Add `/api/plants/create` endpoint** — creates plant + warrants + claim in Dolt, using existing warrant/claim table structure
5. **Build `/plants/add` page** — the 4-step flow with typeahead, auto-population, attribute review grid, and confirm
6. **Add `/plants/[plantId]` detail page** — view + edit individual plant attributes
7. **Add `PATCH /api/plants/[plantId]`** — edit flow creating `manual_edit` warrants
8. **Test end-to-end**: add new plant → warrants created → claim approved → sync to production → verify in Neon

## Files Modified

### New Files
- `admin/src/app/plants/page.tsx` — Plant browser with search/filter
- `admin/src/app/plants/add/page.tsx` — Manual entry flow (client component)
- `admin/src/app/plants/add/add-plant-client.tsx` — Client-side form logic
- `admin/src/app/plants/[plantId]/page.tsx` — Plant detail/edit view
- `admin/src/app/api/plants/route.ts` — GET plant list
- `admin/src/app/api/plants/lookup/route.ts` — GET taxonomy + source search
- `admin/src/app/api/plants/create/route.ts` — POST create plant + warrants
- `admin/src/app/api/plants/[plantId]/route.ts` — GET detail, PATCH edit
- `admin/src/lib/queries/plants.ts` — Query functions for plant operations
- `admin/src/lib/queries/lookup.ts` — Cross-database species lookup logic

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — Add "Plants" nav item with sub-items (Browse, Add New)
- `admin/src/lib/queries/warrants.ts` — Support `manual_entry` and `manual_edit` warrant types

## Verification

### Plant Lookup
1. Navigate to `/plants/add`, type "Mahonia aquifolium"
2. Typeahead shows matches from POWO, USDA_PLANTS, and production DB
3. Select the species → verify taxonomy info populated (family: Berberidaceae, lifeform: Shrub)
4. Verify source hits shown from fire, deer, water, native databases with correct values

### Auto-Population Accuracy
1. Choose a plant known to exist in multiple source databases
2. Verify each auto-populated attribute matches the raw source CSV value
3. Verify values are normalized to production attribute `values_allowed` codes
4. Verify calculated fields are computed, not editable

### New Plant Creation
1. Search for a species NOT in production but present in source databases
2. Review auto-populated attributes, accept some, reject some, hand-edit one
3. Click "Create Plant"
4. Verify: new row in Dolt `plants` table, N rows in `warrants` with `warrant_type = 'manual_entry'`, 1 claim created
5. Verify Dolt commit message includes plant name and attribute count

### Edit Existing Plant
1. Navigate to `/plants/[plantId]` for an existing plant
2. Change one attribute value
3. Verify: new warrant created with `warrant_type = 'manual_edit'`, claim created
4. Push via sync → verify Neon `values` table updated

### Synonym Resolution
1. Search for "Berberis aquifolium" (synonym of Mahonia aquifolium)
2. Verify system shows "Did you mean Mahonia aquifolium (accepted name)?"
3. Confirm → verify lookup uses accepted name for source searches

### Production Sync
1. Create a manual entry plant
2. Navigate to `/sync` → verify the new claims appear in pending sync list
3. Push to production → verify plant and values exist in Neon
4. Query `https://lwf-api.vercel.app/api/plants?search=<name>` → verify plant appears in public API
