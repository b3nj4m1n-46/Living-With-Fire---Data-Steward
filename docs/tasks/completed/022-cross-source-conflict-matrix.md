# Cross-Source Conflict Matrix — Heatmap of Source Disagreements

> **Status:** COMPLETE
> **Commit:** 3fbb570
> **Priority:** P2 (normal)
> **Depends on:** 007-internal-conflict-scan, 009-first-external-analysis, 013-conflict-queue (conflicts must exist in DB)
> **Blocks:** None

## Problem

The `conflicts` table has data showing which sources disagree, but there's no way to see the big picture. A data steward needs to understand:
- Which source pairs disagree the most (e.g., does FIRE-01 always clash with FIRE-04?)
- Which conflict types dominate between specific pairs
- Whether certain sources are systematically unreliable or just have different scopes
- Where to focus curation effort for maximum impact

From the PRD (P2): "Cross-Source Conflict Matrix — Heatmap of which sources disagree most."

## Current Implementation

### What Exists
- `conflicts` table with `source_a`, `source_b`, `conflict_type`, `severity`, `status` fields
- Real conflict data from internal scan (007) and external analyses (009+)
- Conflict queue page (013) with per-conflict browsing and filtering
- Dashboard with aggregate conflict counts by severity
- `admin/src/lib/queries/conflicts.ts` with filtering and aggregation functions

### What Does NOT Exist Yet
- Source-pair aggregation query
- Matrix/heatmap visualization
- Conflict type breakdown by source pair
- Drill-down from matrix cell → filtered conflict queue

## Proposed Changes

### 1. Matrix Query Functions

`admin/src/lib/queries/conflict-matrix.ts`:

```sql
-- Source pair conflict counts
SELECT source_a, source_b, COUNT(*) as conflict_count,
       COUNT(*) FILTER (WHERE severity = 'critical') as critical_count,
       COUNT(*) FILTER (WHERE severity = 'moderate') as moderate_count,
       COUNT(*) FILTER (WHERE severity = 'minor') as minor_count,
       COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
       COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count
FROM conflicts
GROUP BY source_a, source_b
ORDER BY conflict_count DESC;
```

```sql
-- Conflict type breakdown for a source pair
SELECT conflict_type, COUNT(*) as count, severity,
       COUNT(*) FILTER (WHERE status = 'pending') as pending
FROM conflicts
WHERE source_a = $1 AND source_b = $2
GROUP BY conflict_type, severity
ORDER BY count DESC;
```

```sql
-- Per-source summary (total conflicts, resolution rate)
SELECT source, COUNT(*) as total_conflicts,
       COUNT(*) FILTER (WHERE status IN ('resolved', 'dismissed')) as resolved,
       ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('resolved', 'dismissed')) / COUNT(*), 1) as resolution_rate
FROM (
  SELECT source_a as source FROM conflicts
  UNION ALL
  SELECT source_b as source FROM conflicts
) sub
GROUP BY source
ORDER BY total_conflicts DESC;
```

### 2. Matrix Page

`admin/src/app/matrix/page.tsx`:

**Heatmap Grid:**
- Rows and columns are source IDs (e.g., FIRE-01, FIRE-04, WATER-01, DEER-01)
- Cell color intensity = conflict count between that pair (white → yellow → orange → red)
- Cell text shows count (e.g., "23")
- Diagonal is empty (no self-conflicts)
- Hover tooltip shows breakdown: "23 conflicts: 5 critical, 12 moderate, 6 minor"
- Click cell → navigates to `/conflicts?source_a=FIRE-01&source_b=FIRE-04` (filtered conflict queue)

**Source Summary Table (below heatmap):**

| Source | Total Conflicts | Critical | Pending | Resolution Rate |
|--------|----------------|----------|---------|-----------------|
| FIRE-01 | 47 | 12 | 31 | 34% |
| WATER-01 | 23 | 3 | 18 | 22% |

Sortable by any column. Click source → filtered conflict queue for that source.

**Filters:**
- Status: show all / pending only / resolved only
- Severity threshold: hide minor / show all
- Conflict type: filter to specific types

### 3. API Route

`admin/src/app/api/matrix/route.ts`:
- GET — returns matrix data (source pairs with counts) and source summaries
- Query params: `status`, `severity`, `conflictType` for filtering
- Response: `{ pairs: SourcePair[], sources: SourceSummary[], maxConflicts: number }`

### 4. Dashboard Integration

Add a mini-matrix or "Top Conflicting Pairs" card to the dashboard:
- Shows top 5 source pairs by conflict count
- Links to the full matrix page

### What Does NOT Change

- `conflicts` table schema — read-only aggregation queries
- Conflict queue page — matrix links into it via URL query params
- Genkit flows — no agent involvement
- Other admin pages — matrix is additive

## Migration Strategy

1. Write aggregation queries in `admin/src/lib/queries/conflict-matrix.ts`
2. Create `/api/matrix` route returning pair data and source summaries
3. Build heatmap component using CSS grid with color-scaled cells
4. Build source summary table below heatmap
5. Add filters (status, severity, type)
6. Wire cell clicks → conflict queue with pre-filled filters
7. Add "Matrix" to sidebar nav
8. Add "Top Conflicts" mini-card to dashboard
9. Test: verify matrix counts match `SELECT COUNT(*) FROM conflicts WHERE source_a = X AND source_b = Y`

## Files Modified

### New Files
- `admin/src/app/matrix/page.tsx` — matrix page (server component)
- `admin/src/app/matrix/matrix-client.tsx` — interactive heatmap + filters
- `admin/src/app/api/matrix/route.ts` — matrix data API
- `admin/src/lib/queries/conflict-matrix.ts` — aggregation queries

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — add "Matrix" nav item
- `admin/src/components/summary-cards.tsx` — add "Top Conflicts" card (optional)
- `admin/src/lib/queries/dashboard.ts` — add top-pairs query (optional)

## Verification

1. **Matrix renders with correct data:**
   ```sql
   SELECT source_a, source_b, COUNT(*) FROM conflicts GROUP BY source_a, source_b;
   ```
   Each cell count in the UI should match the query result

2. **Color scaling works:**
   - Highest-conflict pair should be darkest red
   - Zero-conflict pairs should be white/empty
   - Hover tooltip shows severity breakdown

3. **Cell click navigates correctly:**
   - Click FIRE-01 × WATER-01 cell → lands on `/conflicts?source_a=FIRE-01&source_b=WATER-01`
   - Conflict queue shows only conflicts between those two sources

4. **Source summary matches:**
   ```sql
   SELECT COUNT(*) FROM conflicts WHERE source_a = 'FIRE-01' OR source_b = 'FIRE-01';
   ```
   Row total in summary table should match

5. **Filters reduce the matrix:**
   - Filter to "pending only" → counts drop (resolved/dismissed excluded)
   - Filter to "critical" → only critical-severity conflicts counted
