# Dashboard — Add "Datasets Mapped" Summary Card

> **Status:** COMPLETED
> **Priority:** P3 (polish)
> **Depends on:** 021-table-fusion-ui
> **Blocks:** None

## Problem

The dashboard summary cards show 5 metrics but none reflect fusion/schema mapping activity. A data steward returning to the portal has no at-a-glance indicator of how many source datasets have been mapped or are awaiting review.

## Implementation

Added a 6th "Datasets Mapped" summary card to the dashboard that queries `analysis_batches WHERE batch_type = 'schema_mapping'` for total count and status breakdown.

### Files Modified
- `admin/src/lib/queries/dashboard.ts` — Added `MappingStats` interface, 2 new queries (total + by-status) to `fetchDashboardData()`, wired into `DashboardData`
- `admin/src/components/summary-cards.tsx` — Added `mappingStats` prop, changed grid from 5-col to 6-col, added "Datasets Mapped" card with status badges and link to `/fusion`
- `admin/src/app/page.tsx` — Passes `mappingStats={data.mappingStats}` to `<SummaryCards>`

## Verification

1. Dashboard shows 6th card with correct count of schema_mapping batches
2. Status breakdown badges match actual batch statuses in DB
3. Card links to `/fusion` page
4. TypeScript compiles clean (`npx tsc --noEmit` passes)
