# Dashboard — Summary Stats and Analysis Overview

> **Status:** COMPLETED
> **Priority:** P1 (important)
> **Depends on:** 010-portal-scaffold (Next.js app + DB connection)
> **Blocks:** None (other pages can be built in parallel)
> **Commit:** 816e898 — Build dashboard with summary stats, batches table, and quick links

## Problem

After running the pipeline (bootstrap + internal scan + FIRE-01 + WATER-01), the staging database has thousands of warrants and conflicts but no way to see an overview. The dashboard gives data stewards an at-a-glance picture of what's in the system and where attention is needed.

## Current Implementation

### What Exists
- Portal scaffold with placeholder dashboard page (from 010)
- `lib/dolt.ts` connection utility
- DoltgreSQL with populated tables:
  - `warrants` — 94,903 bootstrapped + FIRE-01 + WATER-01 external warrants
  - `conflicts` — internal + external conflicts with severity levels
  - `analysis_batches` — batch records for each pipeline run
  - `claims` — empty (no claims synthesized yet)

### What Does NOT Exist Yet
- Any data display on the dashboard
- Summary stat queries
- Analysis batches table component
- Conflict severity breakdown

## Proposed Changes

### 1. Summary Cards

Four cards across the top of the dashboard:

| Card | Query | Display |
|------|-------|---------|
| Total Warrants | `SELECT COUNT(*) FROM warrants` | Number + breakdown by type (existing/external) |
| Pending Conflicts | `SELECT COUNT(*) FROM conflicts WHERE status = 'pending'` | Number + severity badge breakdown |
| Claims Generated | `SELECT COUNT(*) FROM claims` | Number + breakdown by status (draft/approved/pushed) |
| Datasets Processed | `SELECT COUNT(*) FROM analysis_batches WHERE status = 'completed'` | Number + list of source IDs |

### 2. Analysis Batches Table

Table showing all pipeline runs:

| Column | Source |
|--------|--------|
| Source Dataset | `source_dataset` |
| Source ID | `source_id_code` |
| Type | `batch_type` |
| Status | `status` (badge: running/completed/failed) |
| Plants Matched | `plants_matched` |
| Warrants Created | `warrants_created` |
| Conflicts Found | `conflicts_detected` |
| Started | `started_at` (relative time) |

### 3. Conflict Severity Breakdown

Simple breakdown showing counts by severity:
- Critical (red badge) — count
- Moderate (yellow badge) — count
- Minor (gray badge) — count

Each clickable → navigates to `/conflicts?severity=<level>`

### 4. Quick Links

Links to the most actionable items:
- "X critical conflicts need review" → `/conflicts?severity=critical&status=pending`
- "X unreviewed warrants from latest batch" → `/warrants?status=unreviewed`

### What Does NOT Change

- DoltgreSQL schema — read-only queries
- Genkit flows — not called from dashboard
- Other portal pages — independent

## Migration Strategy

1. Write server-side data fetching functions in `admin/src/lib/queries/dashboard.ts`
2. Build summary card component using shadcn Card
3. Build analysis batches table using shadcn Table
4. Build conflict severity breakdown with badge counts
5. Assemble dashboard page as server component with async data fetching
6. Add quick-action links

## Files Modified

### New Files
- `admin/src/lib/queries/dashboard.ts` — dashboard-specific SQL queries
- `admin/src/components/summary-cards.tsx` — stat card row
- `admin/src/components/batches-table.tsx` — analysis batches table

### Modified Files
- `admin/src/app/page.tsx` — replace placeholder with real dashboard

## Verification

1. **Summary cards show real data:**
   - Total Warrants > 94,903
   - Pending Conflicts > 0
   - Datasets Processed shows bootstrap + FIRE-01 + WATER-01

2. **Analysis batches table populated:**
   - Shows at least 3 rows (bootstrap, FIRE-01, WATER-01)
   - Status badges render correctly

3. **Conflict breakdown matches DB:**
   ```sql
   SELECT severity, COUNT(*) FROM conflicts GROUP BY severity;
   ```
   Dashboard numbers should match query results

4. **Quick links navigate correctly:** Click critical conflicts link → arrives at `/conflicts?severity=critical&status=pending`
