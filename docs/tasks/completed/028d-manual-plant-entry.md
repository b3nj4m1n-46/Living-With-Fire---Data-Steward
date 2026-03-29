# 028d — Manual Plant Entry with Auto-Population

> **Status:** COMPLETE
> **Priority:** P2 (normal)
> **Depends on:** 028a (plant browser), 028c (plant detail page for post-creation view)
> **Blocks:** Geographic expansion beyond Pacific NW
> **Commits:** `7f4293a` — Add manual plant entry wizard with SQLite source lookup; `d03ec91` — Add attribute UUID crosswalk and mapped fields; `pending` — Add synonym resolution and calculated field read-only

### Known Limitations (deferred to follow-up)

1. **Source coverage** — 28 of 41 source databases are registered (datasets without `plants.db` files or with non-standard structures are excluded).
2. **Unmapped source columns** — Some source columns (e.g., `cultivar`, `region`) don't have a production attribute mapping yet. These are shown with an "unmapped" badge and excluded by default; curator can still include them manually.

## Problem

All data ingestion flows through the batch CSV upload pipeline. Adding a single plant requires creating a CSV file with one row, uploading it, filling in source metadata, generating a data dictionary, and running the full pipeline — a 10-minute workflow for one plant. Curator-discovered plants (from literature, nursery catalogs, field observations) have no direct entry path.

## Current Implementation

- Batch upload: `admin/src/app/sources/upload/` — 4-step CSV upload wizard
- No individual plant creation endpoints exist
- Taxonomy backbones (362K+ species): POWO_WCVP, WorldFloraOnline, USDA_PLANTS in `database-sources/taxonomy/`
- 41 source databases (866K+ records) in `database-sources/` as SQLite `plants.db` files
- Genkit flows: `matchPlantFlow` (fuzzy name matching), `classifyConflictFlow` (conflict detection)
- Dolt staging: `warrants`, `claims`, `claim_warrants` tables
- Production: `plants`, `values`, `attributes`, `sources` tables in Neon
- `admin/src/lib/production.ts` — `queryProd()` for Neon reads
- `admin/src/lib/dolt.ts` — `query()` for Dolt reads/writes

### Source Database Schema Patterns

Each source database has a SQLite `plants.db` with a `plants` table. Column names vary per dataset (e.g., `fire_resistance`, `deer_rating`, `water_use`). The `DATA-DICTIONARY.md` in each dataset folder maps columns to production attributes.

## Proposed Changes

### Core Concept: Type a Name, Get a Pre-Filled Plant

1. Curator types a scientific name (with autocomplete against taxonomy backbones + production)
2. System searches all 41 source databases + 3 taxonomy backbones for that species
3. System presents auto-populated attribute values grouped by category, each tagged with source
4. Curator reviews, edits, accepts/rejects individual values
5. System creates warrants for each accepted value → existing claim/approval/sync flow

### New Page: `/plants/add`

**4-step wizard flow.**

#### Step 1: Plant Identification

- Text input with **typeahead autocomplete** searching:
  - Production `plants` table via Neon (exact matches → "already exists, edit instead?" with link to `/plants/[id]`)
  - USDA_PLANTS (`scientific_name`, `common_name`) — 93K species
  - POWO_WCVP (`taxon_name`) — 362K species
  - WorldFloraOnline (`scientificName`) — 381K species
- On selection: display scientific name, common name(s), family, lifeform, native range
- **Synonym resolution**: if name is a synonym in POWO/WFO, show accepted name and let curator confirm
- If no match in any backbone: allow manual entry with warning "Not found in taxonomy databases"

#### Step 2: Auto-Population Search

- System searches all 41 source databases by `scientific_name` (accounting for synonyms)
- Uses existing `matchPlantFlow` logic for fuzzy matching
- Results displayed as a **source hit map**:
  ```
  Found in 8 of 41 sources:
  ✓ FIRE-01 (OSU PNW590) — fire_resistance: "High"
  ✓ DEER-01 (Rutgers) — deer_rating: "Rarely Damaged"
  ✗ POLL-01 — no match
  ...
  ```
- Curator can expand each hit to see raw source values

#### Step 3: Attribute Review Grid

- Auto-populated values mapped to production attributes (using existing `mapSchemaFlow` logic)
- Displayed in **category-grouped grid** matching the 13 attribute categories
- Each attribute row shows:
  - Attribute name
  - Auto-populated value (normalized to allowed values) with source tag
  - Confidence indicator (exact vs. fuzzy vs. inferred)
  - Accept/Reject/Edit toggle
  - If multiple sources disagree: show all values, let curator pick or enter custom
- **Calculated fields** (marked `Calculated: Yes` in attribute registry) are read-only
- Empty attributes shown as blank with optional manual fill

#### Step 4: Confirm and Create

- Summary: plant identity, N attributes accepted, sources cited
- Optional curator notes field
- "Create Plant" triggers:
  1. INSERT into Dolt `plants` table with new UUID
  2. INSERT one `warrant` per accepted attribute value:
     - `warrant_type = 'manual_entry'`
     - `status = 'included'`
     - `source_id_code` = original source ID (e.g., `FIRE-01`) or `MANUAL` for hand-entered
     - `match_confidence` = 1.0 for exact source matches, lower for fuzzy
  3. Auto-create `claim` + `claim_warrants` (pre-approved since curator just reviewed)
  4. Dolt commit: `"Manual entry: Genus species (N attributes from M sources)"`
  5. Redirect to `/plants/[plantId]` (from 028c)

### New API: `GET /api/plants/lookup`

**Searches taxonomy backbones + source databases.** Reads from Neon (production match check) + SQLite files (41 datasets + 3 backbones). No writes.

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
      "fields": { "fire_resistance": "High" }
    }
  ]
}
```

### New API: `POST /api/plants/create`

**Writes to Dolt only.** Creates plant + warrants + claim in staging.

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
      "source_value": "string",
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
  "commit_hash": "abc123..."
}
```

### New API: `PATCH /api/plants/[plantId]`

**Edit existing plant attributes. Writes to Dolt only.** Same attribute array format as create. Creates new warrants with `warrant_type = 'manual_edit'` for changed values only.

### Sidebar Update

Add "Add Plant" as sub-item under Plants in sidebar, or as a button on the `/plants` page header (028a already adds the Plants nav item).

### Dolt Warrant Type Values

```
'existing'        — from batch pipeline (external dataset ingestion)
'internal_audit'  — from internal audit (028b)
'manual_entry'    — new plant via manual entry form
'manual_edit'     — edit existing plant attribute via detail page
```

No schema changes needed — `warrant_type` is TEXT.

### What Does NOT Change

- Batch CSV upload pipeline — remains primary path for whole datasets
- Claim/Warrant model — manual entries use same evidence structure
- Sync flow — manual entry claims pushed identically to pipeline claims
- Production database schema — no table changes in Neon
- Existing admin pages (sources, claims, conflicts, matrix, warrants, fusion, sync, history)

## Files Modified

### New Files
- `admin/src/app/plants/add/page.tsx` — Server component wrapper
- `admin/src/app/plants/add/add-plant-client.tsx` — Client component: 4-step wizard
- `admin/src/app/api/plants/lookup/route.ts` — GET: taxonomy + source search
- `admin/src/app/api/plants/create/route.ts` — POST: create plant + warrants in Dolt
- `admin/src/app/api/plants/[plantId]/route.ts` — PATCH: edit plant attributes in Dolt (GET already added in 028c)
- `admin/src/lib/queries/lookup.ts` — Cross-database species lookup logic (SQLite reads)

### Modified Files
- `admin/src/lib/queries/plants.ts` — Add `createPlant()`, `editPlantAttributes()` functions (Dolt writes)

## Verification

### Plant Lookup
1. Navigate to `/plants/add`, type "Mahonia aquifolium"
2. Typeahead shows matches from POWO, USDA_PLANTS, and production DB
3. Select species → taxonomy info populated (family, lifeform, native range)
4. Source hits shown from fire, deer, water, native databases with correct values

### Auto-Population Accuracy
1. Choose a plant known to exist in multiple source databases
2. Verify each auto-populated attribute matches the raw source CSV value
3. Verify values normalized to production attribute `values_allowed` codes
4. Verify calculated fields computed, not editable

### New Plant Creation
1. Search for a species NOT in production but present in source databases
2. Review auto-populated attributes, accept some, reject some, hand-edit one
3. Click "Create Plant"
4. Verify: new row in Dolt `plants` table, N rows in `warrants` with `warrant_type = 'manual_entry'`, 1 claim created
5. Verify Dolt commit message includes plant name and attribute count
6. Redirect to `/plants/[plantId]` shows new entry

### Edit Existing Plant
1. Navigate to `/plants/[plantId]` for an existing plant
2. Change one attribute value
3. Verify: new warrant with `warrant_type = 'manual_edit'`, claim created
4. Push via sync → verify Neon `values` table updated

### Synonym Resolution
1. Search for "Berberis aquifolium" (synonym of Mahonia aquifolium)
2. System shows "Did you mean Mahonia aquifolium (accepted name)?"
3. Confirm → lookup uses accepted name for source searches

### Production Sync
1. Create a manual entry plant
2. Navigate to `/sync` → new claims appear in pending sync list
3. Push to production → plant and values exist in Neon
4. Query `https://lwf-api.vercel.app/api/plants?search=<name>` → plant appears in public API
