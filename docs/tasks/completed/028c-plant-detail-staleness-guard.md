# 028c — Plant Detail Page + Sync Staleness Guard

> **Status:** COMPLETE
> **Priority:** P2 (normal)
> **Depends on:** 028a (plant browser provides navigation to detail pages)
> **Blocks:** 028d (manual entry edit flow uses this page)
> **Commit:** ad0297b

## Problem

### Gap 1: No per-plant detail view
Curators can see plants in the production browser (028a) but cannot drill into a single plant to see all 125 attributes, their current values, sources, and pending curation status. To audit a specific plant, they must query Neon and Dolt manually.

### Gap 2: Stale claims can be pushed to production
A claim approved on Monday could become stale if a new dataset ingested on Tuesday provides a conflicting value for the same plant+attribute. The current sync flow (`POST /api/sync/push`) pushes all approved claims without checking for newer evidence.

## Current Implementation

### Sync flow
- `admin/src/lib/queries/sync.ts` — `fetchSyncableClaims()`, `fetchSyncPreview()`, `fetchProductionValues()`, `markClaimsAsPushed()`
- `admin/src/app/api/sync/push/route.ts` — POST handler that writes to Neon production, then marks claims as pushed in Dolt
- `admin/src/app/sync/sync-client.tsx` — Client component with preview table and push confirmation dialog
- `SyncPreviewRow` interface: `{ id, plantName, attributeName, oldValue, newValue, confidence }`

### Database connections
- `admin/src/lib/production.ts` — `queryProd()` for Neon reads
- `admin/src/lib/dolt.ts` — `query()` for Dolt reads/writes

### No plant detail page exists
- No `/plants/[plantId]` route in `admin/src/app/`

## Proposed Changes

### New Page: `/plants/[plantId]`

**Composite read from Neon (production state) + Dolt (pending curation).**

#### Production Layer (Neon via `queryProd()`)
- All 125 attributes grouped by the 13 categories (Flammability, Growth, Water Requirements, Environmental, Plant Materials, Nativeness, Invasiveness, Wildlife, Utility, Edibility, Climate, Soils, Relative Value Matrix)
- Each attribute row shows: attribute name, current live value, source tag
- Plant header: scientific name, common name, family, last updated

#### Curation Overlay (Dolt via `query()`)
- Pending warrants for this plant: badge on affected attributes
- Unresolved conflicts: warning indicator (e.g., "Conflict: FIRE-07 says Medium" next to a fire resistance value showing "High")
- Unapproved claims: indicator that a decision is pending

#### Edit Capability (deferred to 028d)
- In this task, the detail page is **read-only**
- 028d adds the click-to-edit capability that creates `manual_edit` warrants

#### Sync Status
- Clear indicator of whether this plant has pending changes ready to push
- Link to `/sync` page

### New API: `GET /api/plants/[plantId]`

**Reads from Neon + Dolt.** Returns plant identity, all attribute values with sources, and pending curation state.

**Response:**
```json
{
  "plant": {
    "id": "uuid",
    "genus": "Mahonia",
    "species": "aquifolium",
    "common_name": "Oregon Grape",
    "family": "Berberidaceae",
    "last_updated": "2025-01-15T..."
  },
  "attributes": [
    {
      "attribute_id": "uuid",
      "attribute_name": "Fire Resistance",
      "category": "Flammability",
      "value": "High",
      "source_name": "OSU PNW590",
      "source_id": "uuid",
      "pending_warrants": 1,
      "has_conflict": true,
      "conflict_summary": "FIRE-07 says Medium"
    }
  ],
  "pending_sync": true,
  "pending_claims": 2
}
```

### Staleness Guard on Sync Push

**Lightweight pre-push check — no AI, just a Dolt query.**

#### Query: find newer warrants since claim approval
```sql
SELECT w.id, w.source_id_code, w.value, w.created_at
FROM warrants w
WHERE w.plant_id = $1
  AND w.attribute_id = $2
  AND w.created_at > $3  -- claim.approved_at
  AND w.status != 'excluded'
```

#### Integration into sync flow

1. **`fetchSyncPreview()`** in `admin/src/lib/queries/sync.ts`: after building the preview rows, run the staleness check for each claim. Add a `stale` flag and `staleWarrants` array to `SyncPreviewRow`.

2. **Extended `SyncPreviewRow`**:
```ts
export interface SyncPreviewRow {
  id: string;
  plantName: string;
  attributeName: string;
  oldValue: string | null;
  newValue: string;
  confidence: string;
  stale: boolean;
  staleWarrants: { source: string; value: string; created_at: string }[];
}
```

3. **Sync client UI** in `admin/src/app/sync/sync-client.tsx`: stale claims show a warning row:
```
⚠ Mahonia aquifolium → Fire Resistance: "High" (approved Jan 15)
  New evidence since approval: FIRE-07 batch (Jan 18) says "Medium"
  [Push Anyway] [Review First →]
```
- "Review First" links to the claim detail page
- "Push Anyway" proceeds — the curator has final say
- Claims with no newer warrants push without warning (the common case)

4. **Push route** in `admin/src/app/api/sync/push/route.ts`: no changes needed — the staleness guard is a UI concern. The push endpoint pushes whatever claims are sent to it. The client filters out claims where the curator chose "Review First."

### What Does NOT Change

- Push endpoint logic — still pushes all approved claims it receives
- Dolt schema — no changes
- Existing pages (conflicts, claims, warrants, sources, etc.)
- No new dependencies

## Files Modified

### New Files
- `admin/src/app/plants/[plantId]/page.tsx` — Server component: composite Neon + Dolt read
- `admin/src/app/api/plants/[plantId]/route.ts` — GET handler: plant detail from Neon + Dolt curation overlay

### Modified Files
- `admin/src/lib/queries/plants.ts` — Add `fetchPlantDetail()` query function (Neon read + Dolt overlay)
- `admin/src/lib/queries/sync.ts` — Add `checkStaleness()` function, extend `SyncPreviewRow` with `stale` + `staleWarrants`, update `fetchSyncPreview()` to call staleness check
- `admin/src/app/sync/sync-client.tsx` — Show staleness warnings in preview table, add "Push Anyway" / "Review First" actions per stale row

## Verification

### Plant Detail
1. Navigate to `/plants` (from 028a), click "View" on a plant
2. Verify: plant header shows correct scientific name, common name, family
3. Verify: attributes grouped by 13 categories, values match Neon data
4. Verify: pending warrants/conflicts from Dolt shown as badges on affected attributes
5. Verify: sync status indicator accurate

### Staleness Guard
1. Approve a claim for plant X, attribute Y
2. Create a new warrant (via batch pipeline or direct Dolt insert) for the same plant X, attribute Y with a different value and a timestamp after the claim's `approved_at`
3. Navigate to `/sync` — verify the approved claim shows a staleness warning with the newer warrant info
4. Click "Push Anyway" — verify push succeeds and newer warrant remains in queue
5. Alternatively, click "Review First" — verify navigation to claim detail page
6. Verify: claims with no newer warrants show no warning and push normally
7. TypeScript compiles clean (`npx tsc --noEmit`)
