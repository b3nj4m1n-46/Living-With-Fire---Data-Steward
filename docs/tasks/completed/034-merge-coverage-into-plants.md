# 034 — Condense Coverage & Operations into Plants Browse Page

> **Status:** DONE — `1441265`, `61ca5a9`
> **Priority:** P1 (important)
> **Depends on:** None
> **Blocks:** None

## Problem

Plant quality data is scattered across separate nav sections instead of living where you'd naturally use it — on the plants page itself:

```
Plants
  Browse              → /plants (just a search table)
Quality
  Coverage            → /coverage (4 tabs: Attribute Coverage, Plant Completeness, Enrichment, Operations)
```

The Operations tab (audit/classify/synthesize) is three buttons buried behind two clicks. Coverage stats and enrichment suggestions are divorced from the plant list they describe. All of this should be condensed into the plants browse page.

## Current Implementation

**Sidebar** (`admin/src/components/sidebar-nav.tsx`):
- "Plants" group: Browse (`/plants`)
- "Quality" group: Coverage (`/coverage`)

**Coverage page** (`admin/src/app/coverage/coverage-client.tsx`) — 4 tabs:
1. **Attribute Coverage** — coverage % per attribute, expandable gaps
2. **Plant Completeness** — per-plant completeness %, searchable/sortable
3. **Enrichment Opportunities** — source-to-gap cross-reference
4. **Operations** — agent triggers (audit, classify, synthesize)

**Plants Browse** (`admin/src/app/plants/page.tsx`):
- Search + paginated table (name, attributes count, last updated)
- No quality context, no actions

## Proposed Changes

Condense everything onto the `/plants` page:

### 1. Operations toolbar at top of `/plants`

Add a toolbar row above the search bar with the three agent action buttons inline:
- **Run Audit** — triggers `POST /api/audit/internal`
- **Classify Conflicts** — triggers `POST /api/agents/classify`
- **Synthesize Claims** — triggers `POST /api/agents/synthesize`

Show a running status indicator when an operation is active (poll `/api/agents/status`). These are just buttons — no need for a dedicated page.

### 2. Coverage summary cards below the toolbar

A row of compact stat cards above the plant table:
- **Plants**: total count
- **Avg Completeness**: percentage across all plants
- **Low Coverage Attributes**: count of attributes with <50% coverage
- **Pending Conflicts / Unsynthesized**: from `/api/agents/counts`

One line of cards, not a full dashboard — just enough context to know the state of the data.

### 3. Add completeness column to plant table

Add a **Completeness** column to the existing plant browse table showing per-plant coverage % (or attribute count vs. total attributes). This replaces the "Plant Completeness" tab entirely — the data is right there in the list.

### 4. Coverage & Enrichment as tabs on the same page

Below the plant table (or as tabs alongside it), add:
- **Attribute Gaps** tab — the current Attribute Coverage content (which attributes have low coverage)
- **Enrichment** tab — the current Enrichment Opportunities content (which sources can fill gaps)

These are reference views for when you want to dig deeper, but the core browse + actions are front and center.

### 5. Remove Quality nav group

Delete the "Quality" section from sidebar. The `/coverage` route either redirects to `/plants` or is removed.

### What Does NOT Change

- API routes (`/api/coverage`, `/api/enrichment`, `/api/agents/*`, `/api/audit/*`) — no changes
- Plant detail page (`/plants/[plantId]`)
- Plant add wizard (`/plants/add`)
- Dashboard
- Curation section (Claims, Conflicts, Warrants)

## Migration Strategy

1. Add operations toolbar component to `/plants/page.tsx` — inline audit/classify/synthesize buttons with status polling
2. Add coverage summary cards component — fetch from `/api/agents/counts` and `/api/coverage`
3. Add completeness % column to plant table query and display
4. Move Attribute Gaps and Enrichment content into tab components on `/plants/page.tsx`
5. Update `sidebar-nav.tsx` — remove "Quality" group
6. Remove or redirect `/coverage` route

## Files Modified

### Modified Files
- `admin/src/app/plants/page.tsx` — add toolbar, summary cards, completeness column, coverage/enrichment tabs
- `admin/src/components/sidebar-nav.tsx` — remove Quality group
- `admin/src/lib/queries/plants.ts` — add completeness % to plant list query

### Removed/Deprecated Files
- `admin/src/app/coverage/page.tsx` — functionality absorbed into `/plants`
- `admin/src/app/coverage/coverage-client.tsx` — split into reusable components or inlined

### Reused Files (no changes needed)
- `admin/src/app/coverage/operations-tab.tsx` — extract button logic into a toolbar component
- `admin/src/app/api/agents/*` — all API routes stay as-is
- `admin/src/app/api/coverage/*` — stays as-is
- `admin/src/app/api/enrichment/*` — stays as-is

## Verification

- Navigate to `/plants`:
  - See audit/classify/synthesize buttons at top
  - See coverage summary cards (total plants, avg completeness, low-coverage count, pending conflicts)
  - Plant table has Completeness column
  - Attribute Gaps and Enrichment tabs below the table
- Click "Run Audit" — status indicator shows running, completes
- Old `/coverage` URL redirects to `/plants` or 404s
- Sidebar "Quality" group is gone
- No broken links from dashboard or elsewhere
