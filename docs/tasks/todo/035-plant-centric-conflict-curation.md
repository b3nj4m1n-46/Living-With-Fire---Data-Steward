# 035 — Plant-Centric Conflict Curation

> **Status:** DONE
> **Priority:** P1 (important)
> **Depends on:** None (all underlying data model, APIs, and components exist)
> **Blocks:** Warrant browser (no longer needed as standalone page)

## Problem

The curation UI is split across three top-level pages (Claims, Conflicts, Warrants) that each show flat lists of individual records. But the actual curation workflow is plant-centric: you audit a plant, see what's in conflict, review the competing warrants, pick the ones to include, synthesize a claim, and approve it.

Currently:
- **Conflicts page** (`/conflicts`) lists individual conflict rows (warrant A vs warrant B). Each row is one conflict — a plant with 8 conflicts across 3 attributes appears as 8 separate rows with no grouping.
- **Claims page** (`/claims`) lists plant+attribute pairs with warrant counts. Clicking goes to a claim detail page (`/claims/[plantId]/[attributeId]`) where you curate warrants and approve.
- **Warrants page** (`/warrants`) is a stub.
- **Plant detail page** (`/plants/[plantId]`) shows attributes with conflict badges, linking to the claim detail page per attribute.

The problem: there's no view that says "here are all the plants that need attention, ranked by how much conflict they have." You have to scan a flat conflict list, mentally group by plant, then navigate to each claim page individually.

## Current Implementation

### Sidebar Navigation (`admin/src/components/sidebar-nav.tsx`)
```
Curation
  ├─ Claims      → /claims
  ├─ Conflicts   → /conflicts
  └─ Warrants    → /warrants (stub, badge: "soon")
```

### Conflicts Page (`admin/src/app/conflicts/`)
- `page.tsx` — server component, fetches conflict list + filter options + matrix data
- `conflicts-client.tsx` — list/matrix view toggle
- `conflicts-filters.tsx` — 7 filter dimensions (status, severity, type, mode, attribute category, source dataset, source pair)
- `conflicts-table.tsx` — flat table of individual conflicts with expandable detail rows showing side-by-side warrant cards, classifier/specialist analysis, research panel, quick actions
- `matrix-client.tsx` — source-pair conflict heatmap
- `research-panel.tsx` — AI research findings panel

### Claims Page (`admin/src/app/claims/`)
- `page.tsx` — flat list of plant+attribute pairs with warrant counts and conflict flags
- `claims-filters.tsx` — 3 filters (hasConflicts, claimStatus, sourceDataset)
- `[plantId]/[attributeId]/claim-view-client.tsx` — the actual curation UI: warrant cards grouped by source, include/exclude toggling, synthesis, approval

### Plant Detail (`admin/src/app/plants/[plantId]/`)
- `plant-detail-client.tsx` — attributes table with curation overlay (warrant counts, conflict counts, claim status badges), each attribute links to `/claims/[plantId]/[attributeId]`

### Query Layer (`admin/src/lib/queries/`)
- `conflicts.ts` — `fetchConflictsList()`, `fetchConflictFilterOptions()`, `fetchConflictDetail()`, `fetchConflictWarrants()`, `updateConflictStatus()`, `batchUpdateConflictStatus()`
- `claims.ts` — `fetchClaimsList()`, `fetchClaimViewData()`, `fetchFilterOptions()`
- `conflict-matrix.ts` — `fetchMatrixData()`, `fetchPairTypeBreakdown()`

### API Routes
- `PATCH /api/conflicts/[id]` — update conflict status
- `POST /api/conflicts/[id]/specialist` — specialist verdict
- `POST /api/conflicts/[id]/research` — research findings
- `POST /api/conflicts/batch` — batch status update
- `POST /api/synthesize` — AI claim synthesis
- `POST /api/claims/approve` — approve claim with warrants
- `PATCH /api/warrants/[id]` — update warrant status

## Proposed Changes

### 1. Restructure the Conflicts Dashboard as a Plant Queue

Replace the flat conflict list with a **plant-level conflict queue**:

| Plant | Conflicts | Max Severity | Attributes Affected | Unresolved | Status |
|-------|-----------|-------------|-------------------|------------|--------|
| *Arctostaphylos manzanita* | 12 | critical | 4 | 8 | In progress |
| *Ceanothus thyrsiflorus* | 6 | moderate | 2 | 6 | Pending |

**Columns:**
- Plant name (scientific, with common name subtitle)
- Total conflict count
- Max severity (color-coded badge: critical/moderate/minor)
- Number of attributes with conflicts
- Unresolved count (pending + annotated, not resolved/dismissed)
- Overall status (derived: "Pending" if all unresolved, "In progress" if some resolved, "Complete" if all resolved/dismissed)

**Sorting:** Default by max severity desc, then unresolved count desc. Sortable on all columns.

**Filters:** Severity (critical/moderate/minor), status (pending/in progress/complete), search by plant name.

**Clicking a plant row** navigates to the plant conflict resolution page (see below).

### 2. Plant Conflict Resolution Page

New page at `/conflicts/[plantId]` — the unified curation view for a single plant.

**Layout:**

```
← Back to Conflict Queue

Arctostaphylos manzanita (Manzanita)
12 conflicts across 4 attributes · 8 unresolved

┌─────────────────────────────────────────────────────┐
│ Fire Resistance (3 conflicts · 2 unresolved)        │
│                                                     │
│  [Conflict 1: Rating Disagreement · critical]       │
│  ┌─────────────────┐  ┌─────────────────┐          │
│  │ Warrant A (FIRE-01)│ │ Warrant B (FIRE-07)│      │
│  │ "fire-resistant"   │ │ "moderate"         │      │
│  │ [Include] [Exclude]│ │ [Include] [Exclude]│      │
│  └─────────────────┘  └─────────────────┘          │
│  Specialist: REAL · Recommend: PREFER_A             │
│  [Research Panel]                                    │
│                                                     │
│  [Conflict 2: Scale Mismatch · moderate]            │
│  ...                                                │
│                                                     │
│  ─── Synthesis ───                                  │
│  [Synthesize from N included warrants]              │
│  [Approve Claim]                                    │
├─────────────────────────────────────────────────────┤
│ Deer Resistance (2 conflicts · 2 unresolved)        │
│  ...                                                │
│  ─── Synthesis ───                                  │
│  [Synthesize] [Approve]                             │
└─────────────────────────────────────────────────────┘
```

**Per attribute section:**
- Collapsible accordion, open by default if unresolved conflicts exist
- Shows all conflicts for that attribute with side-by-side warrant cards (reuse existing `WarrantCard` component)
- Specialist verdict and research panel per conflict (reuse `ResearchPanel`)
- Include/exclude warrant toggling (reuse existing status change flow via `PATCH /api/warrants/[id]`)
- Synthesis + approval controls at the bottom of each attribute section (reuse logic from `claim-view-client.tsx`)
- Conflict quick actions (resolve/dismiss) per conflict row

**This page replaces the claim detail page** (`/claims/[plantId]/[attributeId]`) as the primary curation destination. The claim detail page can remain accessible but is no longer the main entry point.

### 3. Update Plant Detail Page Links

In `plant-detail-client.tsx`, conflict badges on attributes should link to `/conflicts/[plantId]#[attributeName]` (anchored to the relevant attribute section) instead of `/claims/[plantId]/[attributeId]`.

### 4. Simplify Sidebar Navigation

```
Curation
  └─ Conflicts    → /conflicts
```

Remove Claims and Warrants from the sidebar. The claims list page and claim detail page remain routable (don't delete them) but are no longer primary navigation targets. Delete the warrants stub page.

### 5. Keep the Matrix View

The source-pair conflict matrix (`?view=matrix`) remains available as a tab/toggle on the conflicts dashboard alongside the new plant queue view. It provides a different analytical lens (which sources disagree most) that's complementary to the plant queue.

### What Does NOT Change
- **Data model** — no schema changes to warrants, conflicts, claims, or claim_warrants tables
- **API routes** — all existing endpoints remain unchanged
- **WarrantCard component** — reused as-is
- **ResearchPanel component** — reused as-is
- **Claim approval flow** — same POST /api/claims/approve logic
- **Synthesis flow** — same POST /api/synthesize logic
- **Conflict matrix** — kept, just moved to be a view option on the plant queue page
- **Plant detail page** — kept, just update links
- **Claim detail page** — kept as a secondary route, not deleted

## Migration Strategy

1. **Add new query function** `fetchPlantConflictQueue()` in `admin/src/lib/queries/conflicts.ts` — groups conflicts by plant_id, aggregates counts, max severity, unresolved count. Returns `PlantConflictQueueRow[]`.

2. **Add new query function** `fetchPlantConflicts(plantId)` in `admin/src/lib/queries/conflicts.ts` — fetches all conflicts for a plant grouped by attribute, with full warrant details, specialist verdicts, and existing claim data. Returns everything needed to render the resolution page.

3. **Create plant conflict resolution page** at `admin/src/app/conflicts/[plantId]/page.tsx` and `admin/src/app/conflicts/[plantId]/plant-conflicts-client.tsx`. Build the per-attribute accordion with warrant cards, conflict details, synthesis, and approval. Reuse `WarrantCard`, `ResearchPanel`, and the synthesis/approval logic from `claim-view-client.tsx`.

4. **Replace the conflicts list view** — update `admin/src/app/conflicts/page.tsx` to use the plant queue view as the default list (instead of the flat conflict table). Keep the matrix view toggle. Update `conflicts-client.tsx` to switch between plant-queue and matrix views.

5. **Simplify filters** — the plant queue needs fewer filters than the flat list. Keep: severity, status (pending/in progress/complete), plant name search. Drop: conflict type, conflict mode, attribute category, source dataset, source pair (these are per-conflict details visible on the resolution page).

6. **Update sidebar** — in `admin/src/components/sidebar-nav.tsx`, remove Claims and Warrants items from the Curation group. Keep only Conflicts.

7. **Update plant detail links** — in `plant-detail-client.tsx`, change conflict badge links to point to `/conflicts/[plantId]`.

8. **Delete warrants stub** — remove `admin/src/app/warrants/page.tsx`.

## Files Modified

### New Files
- `admin/src/app/conflicts/[plantId]/page.tsx` — server component for plant conflict resolution
- `admin/src/app/conflicts/[plantId]/plant-conflicts-client.tsx` — client component: per-attribute accordion with warrant curation, synthesis, approval

### Modified Files
- `admin/src/lib/queries/conflicts.ts` — add `fetchPlantConflictQueue()` and `fetchPlantConflicts(plantId)`
- `admin/src/app/conflicts/page.tsx` — switch to plant queue data fetching
- `admin/src/app/conflicts/conflicts-client.tsx` — replace list view with plant queue table, keep matrix toggle
- `admin/src/app/conflicts/conflicts-table.tsx` — replace with plant queue table (or rename/rewrite)
- `admin/src/app/conflicts/conflicts-filters.tsx` — simplify to severity, status, plant name search
- `admin/src/components/sidebar-nav.tsx` — remove Claims and Warrants from Curation group
- `admin/src/app/plants/[plantId]/plant-detail-client.tsx` — update conflict badge links

### Deleted Files
- `admin/src/app/warrants/page.tsx` — stub, no longer needed

### Preserved (not deleted, just no longer in sidebar)
- `admin/src/app/claims/page.tsx` — still routable
- `admin/src/app/claims/[plantId]/[attributeId]/` — still routable (claim-view-client.tsx back link should update to point to `/conflicts/[plantId]` instead of `/claims`)

## Verification

1. **Plant queue displays correctly:** Navigate to `/conflicts`. See a table of plants with conflict counts, max severity badges, and unresolved counts. Plants with critical severity appear first.

2. **Plant resolution page works:** Click a plant row. See all conflicting attributes as collapsible sections. Each section shows conflicts with side-by-side warrant cards. Specialist verdicts and research panels render correctly.

3. **Warrant curation works:** Toggle warrant include/exclude status on the resolution page. Badge counts update. Verify via `SELECT status FROM warrants WHERE id = '...'` in Dolt.

4. **Synthesis works:** Include 2+ warrants for an attribute, click Synthesize. AI synthesis result appears with confidence rating.

5. **Claim approval works:** After synthesis, click Approve. Verify claim record created in Dolt with correct `dolt_commit_hash`. Plant queue unresolved count decrements.

6. **Plant detail links work:** Navigate to `/plants/[plantId]`. Click a conflict badge on an attribute. Lands on `/conflicts/[plantId]` scrolled to the relevant attribute section.

7. **Matrix view preserved:** On `/conflicts`, switch to Matrix view. Source-pair heatmap renders as before.

8. **Sidebar simplified:** Only "Conflicts" appears under Curation. No Claims or Warrants links.

9. **Old routes still work:** Navigating directly to `/claims` or `/claims/[plantId]/[attributeId]` still renders (not deleted, just not in nav).
