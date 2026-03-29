# 028 — Manual Plant Entry with Auto-Population (Split into Sub-Tasks)

> **Status:** COMPLETED
> **Priority:** P2 (normal)
> **Depends on:** Core admin portal complete (tasks 001–025), Genkit agent pipeline operational
> **Blocks:** Geographic expansion beyond Pacific NW

## Sub-Tasks

This spec was split into four independently shippable tasks:

| Task | Title | Status | Commit |
|------|-------|--------|--------|
| [028a](../completed/028a-plant-browser.md) | Production Plant Browser | COMPLETED | `af3e170` |
| [028b](../completed/028b-internal-audit.md) | Internal Audit of Production Data | COMPLETED | `270841b` |
| [028c](../todo/028c-plant-detail-staleness-guard.md) | Plant Detail Page + Staleness Guard | COMPLETED | `ad0297b` |
| [028d](../todo/028d-manual-plant-entry.md) | Manual Plant Entry with Auto-Population | COMPLETED | `7f4293a` |

The original spec is preserved below for reference.

---

## Problem

The admin portal has two gaps: no way to add individual plants, and no way to audit existing production data.

### Gap 1: No individual plant entry
All data ingestion flows through the batch CSV upload pipeline (Sources > Upload → AI pipeline → warrant curation → sync). This means:

1. **Adding a single plant requires creating a CSV file** with one row, uploading it, filling in source metadata, generating a data dictionary, and running the full pipeline — a 10-minute workflow for one plant.
2. **Expanding the production database** beyond the current 1,361 Pacific NW plants requires a per-plant entry mechanism that doesn't force batch overhead.
3. **Curator-discovered plants** (from literature, nursery catalogs, field observations) have no direct entry path.

### Gap 2: No internal audit of existing production data
The Neon production database has 94,903 attribute values from 103 sources — all curated **before** the Claim/Warrant evidence model existed. This legacy data was never run through conflict detection. There are likely internal inconsistencies:

1. **Same plant, same attribute, multiple sources disagree** — e.g., plant has fire_resistance = "High" from FIRE-01 and fire_resistance = "Medium" from FIRE-07, both in production.
2. **Values that don't match current allowed values** — the attribute registry has been refined; some legacy values may not conform.
3. **Missing provenance** — some `values` rows may have `source_id = NULL` or point to sources with incomplete metadata.
4. **Taxonomic drift** — plant names may have been updated in POWO/WFO since original curation; production records may use outdated synonyms.

The conflict detection pipeline (`classifyConflictFlow`) currently only runs when new external data is ingested. It needs to also run as an **internal audit** against the existing production data.

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

## Data Source Architecture

The admin portal has two database connections, and this feature uses both with clear read/write boundaries:

### Neon PostgreSQL (Production) — `admin/src/lib/production.ts` → `queryProd()`
- **Contains**: The live production data — `plants` (1,361), `values` (94,903), `attributes` (125), `sources` (103), plus `plant_images`, `nurseries`, `plant_research`, etc.
- **Used for READS**: The `/plants` browser and `/plants/[plantId]` detail page pull all plant data from Neon. This is the source of truth for "what's live right now." Curators see exactly what the public app sees.
- **Used for READS during add**: The `/plants/add` typeahead checks Neon first to detect "this plant already exists in production" before searching taxonomy backbones.
- **NEVER written to directly** by this feature. All production writes go through the existing sync pipeline (`POST /api/sync/push`).

### DoltgreSQL (Staging) — `admin/src/lib/dolt.ts` → `query()`
- **Contains**: The curation tables — `warrants`, `claims`, `claim_warrants`, `conflicts`, `analysis_batches`. Does NOT mirror the full production plant/values data.
- **Used for WRITES**: All manual entry and edit operations write to Dolt. Creating a plant, accepting attribute values, and approving claims all happen here with version control (branching, commit history, revert).
- **Used for READS on detail page**: The `/plants/[plantId]` page overlays Dolt data on top of Neon data — showing pending warrants, unresolved conflicts, and unapproved claims alongside current production values. This gives the curator a single view of "what's live" + "what's in the pipeline."

### Source Databases (Read-Only) — SQLite files in `database-sources/`
- **Contains**: The 41 source datasets as SQLite `plants.db` files, plus 3 taxonomy backbones (POWO, WFO, USDA).
- **Used for READS during add**: The `/api/plants/lookup` endpoint queries these SQLite files to auto-populate attribute values from all available sources. This is a read-only cross-database search.
- **NEVER written to**. These are reference data.

### Data Flow Summary

```
READS (browse/view):     Neon production → admin UI
READS (pending curation): Dolt staging → overlay on admin UI
READS (auto-populate):   41 SQLite source DBs + 3 taxonomy backbones → lookup results
WRITES (create/edit):    Admin UI → Dolt staging (warrants, claims)
WRITES (publish):        Dolt approved claims → Neon production (existing sync flow)
```

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

**Plant browser and entry point. Reads from Neon production via `queryProd()`.**

- Searchable table of all production plants (1,361+), queried live from Neon `plants` + `values` tables
- Columns: scientific name, common name, family, attribute count, last updated
- Filter by: family, category completeness (has fire rating, has deer rating, etc.)
- **Pending indicator**: badge on plants that have unresolved conflicts or unapproved claims in Dolt staging (cross-query via `query()`)
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

**Plant detail/edit view. Composite read from Neon (production state) + Dolt (pending curation).**

- **Production layer** (from Neon via `queryProd()`): All 125 attributes grouped by category, showing current live values with source tags. This is what the public app sees right now.
- **Curation overlay** (from Dolt via `query()`): Pending warrants, unresolved conflicts, and unapproved claims for this plant. Displayed as badges/indicators on the affected attributes — e.g., a fire resistance value shows "Live: High (FIRE-01)" with a warning badge "Conflict: FIRE-07 says Medium."
- **Edit capability**: Click any attribute to edit. Changes write to Dolt only (creates new warrant with `warrant_type = 'manual_edit'`). The production value stays unchanged until the claim is approved and synced.
- **History**: Dolt log filtered to this plant's warrants/claims — shows full curation timeline
- **Sync status**: Clear indicator of whether this plant has pending changes ready to push, with link to sync page

### New API Endpoints

#### `GET /api/plants`
List production plants with search and filtering. **Reads from Neon** via `queryProd()`, with optional Dolt cross-query for pending curation status.

**Query params:** `?search=`, `?family=`, `?page=`, `?limit=`, `?pending=true` (include curation status from Dolt)

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
Search taxonomy backbones and source databases for a species name. Powers the typeahead and auto-population. **Reads from three sources**: Neon (production match check), SQLite source databases (41 datasets), and SQLite taxonomy backbones (POWO, WFO, USDA). No writes.

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
Create a new plant with curated attribute values. **Writes to Dolt only** — creates warrants and claims in staging. Plant does not appear in Neon production until approved and synced via existing `/api/sync/push`.

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
Edit attributes on an existing plant. **Writes to Dolt only.** Same attribute array format as create. Creates new warrants for changed values only. Production values in Neon remain unchanged until sync.

### Two Modes of Conflict Detection

The admin portal must support two distinct conflict detection modes:

#### Mode 1: Internal Audit (existing production data vs. itself)

Run on first startup or on-demand. Reads from **Neon production only** — no external datasets involved.

**What it checks:**
1. **Multi-source disagreements**: For each plant+attribute, query all `values` rows. If multiple rows exist from different sources with different values → create conflict in Dolt staging.
   ```sql
   -- Find plant+attribute pairs with conflicting values across sources
   SELECT v.plant_id, v.attribute_id, COUNT(DISTINCT v.value) AS distinct_values
   FROM "values" v
   WHERE v.source_id IS NOT NULL
   GROUP BY v.plant_id, v.attribute_id
   HAVING COUNT(DISTINCT v.value) > 1
   ```
2. **Value validation**: For each value, check against the attribute's `values_allowed` list. Flag non-conforming values.
3. **Missing provenance**: Flag `values` rows where `source_id IS NULL` — these need a source assigned or manual confirmation.
4. **Taxonomy check**: Compare production plant names against current POWO/WFO accepted names. Flag plants using outdated synonyms.

**How it works:**
- New API endpoint: `POST /api/audit/internal` — triggers a scan of production data
- Reads all plants + values from Neon via `queryProd()`
- Creates warrants in Dolt for each existing production value (type `warrant_type = 'internal_audit'`) so they enter the evidence model
- Runs `classifyConflictFlow` on the generated warrants to detect and categorize conflicts
- Creates conflicts in Dolt staging for curator resolution
- This is a **one-time bootstrap** operation (or periodic re-run), not something that runs on every page load

**UI integration:**
- Dashboard card: "Internal Audit" showing count of unresolved internal conflicts
- The `/conflicts` page already handles display and resolution — internal audit conflicts appear there with `batch_type = 'internal_audit'` so curators can filter them separately from external ingestion conflicts
- The `/plants/[plantId]` detail page shows internal conflicts on the affected attributes alongside external ones

#### Mode 2: External Ingestion (new datasets vs. production)

This is the **existing flow** — unchanged. When a new CSV is uploaded through Sources > Upload and the pipeline runs:
1. `matchPlantFlow` matches new data to production plants
2. `classifyConflictFlow` compares new values against production values
3. Conflicts are created in Dolt for curator resolution

**The two modes share the same downstream workflow**: conflicts appear in the queue, curator resolves them, approved claims sync to production. The only difference is the source of the data being compared.

### Sync Staleness Guard

A claim approved on Monday could become stale if a new dataset is ingested on Tuesday that provides a conflicting value for the same plant+attribute. The existing sync flow (`POST /api/sync/push`) does not check for this — it blindly pushes approved claims.

**Add a pre-push staleness check** (lightweight, no AI):

1. Before pushing, for each approved claim, query Dolt for any warrants created **after** the claim's `approved_at` timestamp that target the same `plant_id` + `attribute_id`.
2. If newer warrants exist, flag the claim as **stale** in the sync preview UI:
   ```
   ⚠ Mahonia aquifolium → Fire Resistance: "High" (approved Jan 15)
     New evidence since approval: FIRE-07 batch (Jan 18) says "Medium"
     [Push Anyway] [Review First →]
   ```
3. "Review First" links to the claim detail page where the curator can see the new warrant and re-evaluate.
4. "Push Anyway" proceeds — the curator has final say, and the new warrant remains in the queue for separate resolution.
5. Claims with no newer warrants push without warning (the common case).

This is a **read-only check** against Dolt — no AI re-run, no conflict reclassification. It just surfaces "hey, new data arrived since you approved this." The query is:

```sql
SELECT w.id, w.source_id_code, w.value, w.created_at
FROM warrants w
WHERE w.plant_id = $1
  AND w.attribute_id = $2
  AND w.created_at > $3  -- claim.approved_at
  AND w.status != 'excluded'
```

This guard applies to **all** sync pushes (batch pipeline claims and manual entry claims alike), not just this feature.

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
-- 'existing'        (from batch pipeline — external dataset ingestion)
-- 'internal_audit'  (from internal audit — existing production data scanned against itself)
-- 'manual_entry'    (new plant via manual entry form)
-- 'manual_edit'     (edit existing plant attribute via manual entry form)
```

## Migration Strategy

### Phase A: Production Browser (read-only, no risk)
1. **Add `/api/plants` endpoint** — reads from Neon, no schema changes, can ship independently
2. **Add `/plants` browser page** — curators can immediately browse and search production data

### Phase B: Internal Audit (bootstrap existing data into the evidence model)
3. **Add `POST /api/audit/internal` endpoint** — scans Neon production for multi-source disagreements, value validation, missing provenance, taxonomy drift
4. **Add `'internal_audit'` warrant type** — generated warrants for existing production values enter the Claim/Warrant model
5. **Run initial audit** — one-time scan creates conflicts in Dolt staging; curators begin resolving internal inconsistencies through the existing conflict queue
6. **Add dashboard card** — "Internal Audit: N unresolved conflicts" with link to filtered conflict view

### Phase C: Plant Detail View (composite Neon + Dolt reads)
7. **Add `/plants/[plantId]` detail page** — production values from Neon overlaid with pending curation from Dolt
8. **Add staleness guard to sync flow** — pre-push check for newer warrants since claim approval

### Phase D: Manual Plant Entry (full feature)
9. **Build lookup engine** — query taxonomy backbones + source databases SQLite files for a given species name; return unified results
10. **Add `/api/plants/lookup` endpoint** — powers typeahead and auto-population
11. **Add `/api/plants/create` endpoint** — creates plant + warrants + claim in Dolt
12. **Build `/plants/add` page** — the 4-step flow with typeahead, auto-population, attribute review grid, and confirm
13. **Add `PATCH /api/plants/[plantId]`** — edit flow creating `manual_edit` warrants
14. **Test end-to-end**: add new plant → warrants created → claim approved → sync to production → verify in Neon

## Files Modified

### New Files
- `admin/src/app/plants/page.tsx` — Plant browser with search/filter (reads from Neon)
- `admin/src/app/plants/add/page.tsx` — Manual entry flow (client component)
- `admin/src/app/plants/add/add-plant-client.tsx` — Client-side form logic
- `admin/src/app/plants/[plantId]/page.tsx` — Plant detail/edit view (composite Neon + Dolt read)
- `admin/src/app/api/plants/route.ts` — GET plant list (Neon)
- `admin/src/app/api/plants/lookup/route.ts` — GET taxonomy + source search (Neon + SQLite)
- `admin/src/app/api/plants/create/route.ts` — POST create plant + warrants (Dolt)
- `admin/src/app/api/plants/[plantId]/route.ts` — GET detail (Neon + Dolt), PATCH edit (Dolt)
- `admin/src/app/api/audit/internal/route.ts` — POST trigger internal audit scan (reads Neon, writes Dolt)
- `admin/src/lib/queries/plants.ts` — Query functions for plant operations (Neon reads)
- `admin/src/lib/queries/lookup.ts` — Cross-database species lookup logic (SQLite reads)
- `admin/src/lib/queries/audit.ts` — Internal audit queries (Neon reads, Dolt writes)

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — Add "Plants" nav item with sub-items (Browse, Add New)
- `admin/src/components/summary-cards.tsx` — Add "Internal Audit" dashboard card with unresolved conflict count
- `admin/src/lib/queries/warrants.ts` — Support `manual_entry`, `manual_edit`, and `internal_audit` warrant types
- `admin/src/lib/queries/sync.ts` — Add staleness check query before push
- `admin/src/app/api/sync/push/route.ts` — Integrate staleness guard into push flow
- `admin/src/app/sync/sync-client.tsx` — Show staleness warnings in sync preview UI

## Verification

### Internal Audit
1. Trigger `POST /api/audit/internal`
2. Verify: scan queries Neon `values` table for multi-source disagreements
3. Verify: warrants created in Dolt with `warrant_type = 'internal_audit'` for each conflicting value
4. Verify: conflicts created in Dolt and visible in `/conflicts` page with `batch_type = 'internal_audit'` filter
5. Verify: dashboard card shows correct count of unresolved internal conflicts
6. Resolve one internal conflict through existing claim approval flow → verify it syncs cleanly

### Staleness Guard
1. Approve a claim for plant X, attribute Y
2. Upload a new dataset that provides a different value for plant X, attribute Y (creates new warrant)
3. Navigate to `/sync` → verify the approved claim shows a staleness warning with the newer warrant info
4. Click "Push Anyway" → verify push succeeds and newer warrant remains in queue
5. Alternatively, click "Review First" → verify navigation to claim detail page

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
