# 028b — Internal Audit of Production Data

> **Status:** TODO
> **Priority:** P2 (normal)
> **Depends on:** None (uses existing conflict pipeline)
> **Blocks:** None (independent, but curators benefit from 028a for browsing results)

## Problem

The Neon production database has 94,903 attribute values from 103 sources — all curated **before** the Claim/Warrant evidence model existed. This legacy data was never run through conflict detection. There are likely internal inconsistencies:

1. **Multi-source disagreements**: Same plant + same attribute has different values from different sources (e.g., fire_resistance = "High" from FIRE-01 and "Medium" from FIRE-07)
2. **Value validation failures**: Values that don't match the attribute's current `values_allowed` list
3. **Missing provenance**: `values` rows where `source_id IS NULL`
4. **Taxonomic drift**: Plant names that have been updated in POWO/WFO since original curation

The conflict detection pipeline (`classifyConflictFlow`) currently only runs during external dataset ingestion. It needs to also run as an internal audit.

## Current Implementation

- `admin/src/lib/production.ts` — `queryProd()` reads from Neon
- `admin/src/lib/dolt.ts` — `query()` writes to Dolt staging
- `admin/src/lib/queries/dashboard.ts` — `fetchDashboardData()` drives all 6 dashboard cards
- `admin/src/components/summary-cards.tsx` — renders 6 dashboard cards in a 6-col grid
- `admin/src/app/conflicts/page.tsx` — existing conflict queue (handles display and resolution)
- Dolt `warrants` table uses TEXT `warrant_type` column — no ALTER needed for new values
- Dolt `analysis_batches` table tracks batch operations with `batch_type` column
- Existing `classifyConflictFlow` in `genkit/src/flows/` handles conflict detection

## Proposed Changes

### New API: `POST /api/audit/internal`

Triggers a scan of production data. **Reads from Neon, writes to Dolt.**

#### Step 1: Multi-source disagreement scan
```sql
-- Run against Neon via queryProd()
SELECT v.plant_id, v.attribute_id, COUNT(DISTINCT v.value) AS distinct_values
FROM "values" v
WHERE v.source_id IS NOT NULL
GROUP BY v.plant_id, v.attribute_id
HAVING COUNT(DISTINCT v.value) > 1
```

For each disagreement found, fetch the full value rows and create warrants in Dolt:
- `warrant_type = 'internal_audit'`
- `status = 'unreviewed'`
- One warrant per source's value for the disagreeing plant+attribute pair
- Tag with an `analysis_batches` record: `batch_type = 'internal_audit'`

#### Step 2: Value validation scan
```sql
-- For each attribute, fetch its values_allowed from the attribute registry
-- Then find production values that don't match
SELECT v.id, v.plant_id, v.attribute_id, v.value, a.values_allowed
FROM "values" v
JOIN attributes a ON a.id = v.attribute_id
WHERE a.values_allowed IS NOT NULL
  AND v.value IS NOT NULL
```
Compare each value against the allowed list in application code. Non-conforming values get flagged as warrants with notes indicating the validation failure.

#### Step 3: Missing provenance scan
```sql
SELECT v.id, v.plant_id, v.attribute_id, v.value
FROM "values" v
WHERE v.source_id IS NULL
```
Create warrants flagging these for source assignment.

#### Step 4: Taxonomy check (optional, can defer)
Compare production plant names against POWO/WFO accepted names using the taxonomy backbone SQLite files. Flag plants using outdated synonyms.

**Response:**
```json
{
  "batch_id": "uuid",
  "disagreements_found": 42,
  "validation_failures": 15,
  "missing_provenance": 8,
  "taxonomy_issues": 3,
  "warrants_created": 130,
  "conflicts_created": 42
}
```

### Dashboard Card: "Internal Audit"

Add a 7th card to `admin/src/components/summary-cards.tsx`:
- Shows count of unresolved internal audit conflicts
- Query: `SELECT COUNT(*) FROM conflicts WHERE status = 'pending' AND batch_id IN (SELECT id FROM analysis_batches WHERE batch_type = 'internal_audit')`
- Link to `/conflicts` with filter for internal audit batch type
- Add to `fetchDashboardData()` in `admin/src/lib/queries/dashboard.ts`

### Conflict Queue Integration

Internal audit conflicts appear in the existing `/conflicts` page. Curators can filter by `batch_type = 'internal_audit'` to separate them from external ingestion conflicts. No changes needed to the conflicts page — it already handles all conflict types.

### What Does NOT Change

- No writes to Neon production — audit only reads production, writes to Dolt staging
- Existing conflict resolution flow unchanged — internal audit conflicts use same approve/reject/claim workflow
- No changes to the Genkit pipeline or batch CSV upload flow
- No Dolt schema changes (warrant_type is TEXT)

## Files Modified

### New Files
- `admin/src/app/api/audit/internal/route.ts` — POST handler: runs the 4-step scan
- `admin/src/lib/queries/audit.ts` — Query functions for each scan step

### Modified Files
- `admin/src/lib/queries/dashboard.ts` — Add `AuditStats` interface, internal audit conflict count query to `fetchDashboardData()`
- `admin/src/components/summary-cards.tsx` — Add 7th "Internal Audit" card, accept `auditStats` prop
- `admin/src/app/page.tsx` — Pass `auditStats` to `<SummaryCards>`

## Verification

1. Trigger `POST /api/audit/internal` — returns counts of issues found
2. Check Dolt: `SELECT COUNT(*) FROM warrants WHERE warrant_type = 'internal_audit'` — matches `warrants_created` from response
3. Check Dolt: `SELECT COUNT(*) FROM conflicts WHERE batch_id = '<audit-batch-id>'` — matches `conflicts_created`
4. Navigate to `/conflicts` — internal audit conflicts visible and filterable
5. Dashboard shows "Internal Audit" card with correct unresolved count
6. Resolve one internal conflict through existing claim approval flow — verify it syncs cleanly via `/sync`
7. TypeScript compiles clean (`npx tsc --noEmit`)
