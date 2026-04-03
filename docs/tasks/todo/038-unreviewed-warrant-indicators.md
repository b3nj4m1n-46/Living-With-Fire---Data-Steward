# Unreviewed Warrant Indicators — Surface New Evidence on Plant Browser

> **Status:** TODO
> **Priority:** P1 (important)
> **Depends on:** 028a-plant-browser, 021-table-fusion-ui
> **Blocks:** Efficient curation workflow after any data ingestion

## Problem

After any data ingestion — fusing a source dataset via `/fusion`, running an API enrichment script, or manual edits — new unreviewed warrants are created in Dolt. There is no way to tell which plants have new, unreviewed evidence available.

The plant browser shows attribute counts and completeness but nothing about pending warrants needing attention. A curator looking at `/plants` has to click into each plant individually and check for warrant badges — with 1,361 plants, this is impractical.

Whether the warrants came from fusing FIRE-01, enriching from Trefle, or a cross-source conflict scan, the curator needs to see at a glance: "these plants have new data that needs review."

## Current Implementation

### Plant Browser (`/plants`)
- **File:** `admin/src/app/plants/page.tsx`, `admin/src/lib/queries/plants.ts`
- Columns: Scientific Name, Common Name, Attribute Count, Completeness %, Last Updated
- Sortable and searchable
- No warrant or curation status information

### Plant Detail (`/plants/[plantId]`)
- Shows warrant count badges per attribute (from Dolt)
- Badges link to claims page for review
- But you have to navigate here first to see them

### Claims List (`/claims`)
- Groups by plant+attribute, shows warrant counts and conflict status
- Can filter by source dataset
- But doesn't show which plants have *new* (unreviewed) warrants vs already-reviewed ones

## Proposed Changes

### 1. Add Unreviewed Warrant Count to Plant Browser

Add a new column/badge to the plant list table showing the count of unreviewed warrants per plant.

**Query addition in `fetchPlantList`** (Dolt):
```sql
SELECT plant_id, COUNT(*)::int AS unreviewed_count
FROM warrants
WHERE status = 'unreviewed'
  AND (source_id_code IS NULL OR source_id_code != 'INTERNAL_AUDIT')
GROUP BY plant_id
```

**Display options:**
- New "New Evidence" column with count badge (e.g., `12 new`)
- Badge color: amber/yellow to indicate action needed
- Sortable — so curators can sort by most new evidence first
- Zero counts hidden (no badge)

### 2. Add Source Filter for Warrants

Allow filtering the plant list by warrant source:
- "Has Trefle warrants"
- "Has unreviewed warrants"
- "Needs review" (unreviewed > 0)

This lets a curator say "show me all plants that got new data from the last fusion run" or "show me everything from Trefle."

### 3. Optional: Post-Ingestion Summary Banner

After any ingestion (fusion or enrichment), show a dismissable banner on the plants page:
> "FIRE-01 fusion added 412 warrants across 320 plants. [Review →]"
> "Trefle enrichment added 1,795 warrants across 823 plants. [Review →]"

Sourced from the `analysis_batches` table — show the most recent completed batch.

### What Does NOT Change

- Plant detail page — already shows warrant badges per attribute
- Claims page — already supports filtering
- Warrant/claim data model — no schema changes
- Sync pipeline — unaffected

## Migration Strategy

1. Add Dolt query for unreviewed warrant counts per plant to `fetchPlantList`
2. Add `unreviewedWarrants` column to `PlantListRow` type
3. Display as badge/column in plant browser table
4. Add sort option for unreviewed warrant count (descending)
5. Add filter toggle: "Has unreviewed warrants"

## Files Modified

### Modified Files
- `admin/src/lib/queries/plants.ts` — add unreviewed warrant count to plant list query
- `admin/src/app/plants/page.tsx` — add column/badge and filter
- `admin/src/app/plants/plants-tabs.tsx` — if filtering lives here

## Verification

1. Fuse any dataset via `/fusion` (e.g., FIRE-01) → plants get warrants
2. Open `/plants` → see "New Evidence" column with counts
3. Sort by "New Evidence" descending → plants with most warrants appear first
4. Filter by source → "show me only FIRE-01 warrants"
5. Click into a plant → see warrant badges on attributes
6. Review and include/exclude warrants → unreviewed count decreases
7. After full review, plant shows 0 in the "New Evidence" column
8. Run API enrichment (e.g., Trefle) → same flow, new warrants appear
