# Conflict Queue — Filterable Conflict Review Interface

> **Status:** COMPLETE
> **Commit:** `fb7338e`
> **Priority:** P0 (critical)
> **Depends on:** 010-portal-scaffold (Next.js app + DB connection)
> **Blocks:** None directly, but critical for the curation workflow

## Problem

The pipeline has detected conflicts (internal from bootstrapped warrants + external from FIRE-01 and WATER-01), but there's no way to browse, filter, prioritize, or act on them. The conflict queue is the primary entry point for data stewards — they need to see what's wrong, how severe it is, and navigate to the claim view to resolve it.

## Current Implementation

### What Exists
- Portal scaffold with placeholder conflicts page (from 010)
- `lib/dolt.ts` connection utility
- `conflicts` table with real data: internal + external conflicts with type, severity, and warrant references
- `warrants` table with values that can be compared side-by-side
- Conflict types defined in `docs/planning/CONFLICT-TAXONOMY.md`: rating_scale, regional_scope, temporal, categorical, completeness, corroboration, methodology, taxonomic

### What Does NOT Exist Yet
- Conflicts list page with real data
- Conflict filtering/sorting UI
- Research button (calls Genkit research tools)
- Batch operations
- Navigation from conflict → claim view

## Proposed Changes

### 1. Conflicts List Page

`admin/src/app/conflicts/page.tsx`:

A filterable, sortable table of all conflicts:

| Column | Source | Notes |
|--------|--------|-------|
| Plant | Join warrants → `plant_genus species` | Link to claim view |
| Attribute | Join warrants → `attribute_name` | |
| Type | `conflict_type` | Badge with color per type |
| Severity | `severity` | Badge: critical (red), moderate (yellow), minor (gray) |
| Value A | Warrant A value + source | Side-by-side comparison |
| Value B | Warrant B value + source | Side-by-side comparison |
| Specialist Verdict | `specialist_verdict` | Badge if exists, "Pending" if null |
| Status | `status` | pending / resolved / dismissed |

**Filters (URL query params for shareability):**
- Status: pending, resolved, dismissed (default: pending)
- Severity: critical, moderate, minor
- Conflict Type: dropdown of all 8 types
- Attribute Category: fire, water, deer, native, etc.
- Source Dataset: FIRE-01, WATER-01, etc.

**Sorting:** Default by severity DESC, then conflict_type. Clickable column headers to toggle sort.

**Row click:** Navigate to `/claims/[plantId]/[attributeId]` for that conflict's plant+attribute.

### 2. Conflict Detail Expansion

Inline expandable row (or side panel) showing:
- Full warrant A card (value, source, methodology, region, year)
- Full warrant B card
- Conflict classification reasoning (from `classifyConflictFlow` output)
- Specialist analysis (if available)

### 3. Research Button

Per-conflict "Research" button that calls the research tools:
- POST `/api/conflicts/[id]/research`
- Calls `getDatasetContext` for both sources
- Calls `searchDocumentIndex` with plant name + attribute keywords
- Returns: source methodologies + relevant knowledge base excerpts
- Displayed inline under the conflict

This is a read-only operation — no DB writes, just context retrieval.

### 4. Batch Operations

Toolbar that appears when conflicts are selected (checkboxes):
- **Batch Dismiss** — set `status = 'dismissed'` for all selected
- **Batch Route to Specialist** — placeholder for Phase 4 specialist agents (updates a `routed_to` field or similar)

### 5. API Routes

`admin/src/app/api/conflicts/route.ts`:
- GET — list conflicts with filtering/sorting/pagination

`admin/src/app/api/conflicts/[id]/route.ts`:
- PATCH — update conflict status (pending/resolved/dismissed)

`admin/src/app/api/conflicts/[id]/research/route.ts`:
- POST — call research tools, return context (no DB write)

`admin/src/app/api/conflicts/batch/route.ts`:
- POST — batch status update for multiple conflict IDs

### What Does NOT Change

- Genkit flows — research tools already exist, just called from API route
- DoltgreSQL schema — no table changes (only data updates to status fields)
- Claims page — independent (conflicts link to it but don't modify it)
- Source datasets — not accessed directly

## Migration Strategy

1. Write query functions in `admin/src/lib/queries/conflicts.ts` — list with filters, get detail, batch update
2. Build conflict row component with inline expand
3. Build filters bar (status, severity, type, category, source)
4. Build conflicts list page with shadcn Table
5. Create API routes: list, update, research, batch
6. Wire up research button → API → display results
7. Wire up batch operations toolbar
8. Wire up row click → navigate to claim view
9. Test: filter by severity → expand a conflict → research → dismiss → verify DB

## Files Modified

### New Files
- `admin/src/lib/queries/conflicts.ts` — conflict query functions with filtering
- `admin/src/components/conflict-row.tsx` — expandable conflict row
- `admin/src/components/conflict-filters.tsx` — filter bar component
- `admin/src/app/conflicts/page.tsx` — conflicts list (replace placeholder)
- `admin/src/app/api/conflicts/route.ts` — list conflicts API
- `admin/src/app/api/conflicts/[id]/route.ts` — update conflict status
- `admin/src/app/api/conflicts/[id]/research/route.ts` — research context API
- `admin/src/app/api/conflicts/batch/route.ts` — batch operations API

### Modified Files
- None (all new files)

## Verification

1. **Conflicts list loads with real data:**
   ```sql
   SELECT COUNT(*) FROM conflicts;
   ```
   Table row count should match (with pagination)

2. **Filters work:**
   - Filter by severity=critical → only critical conflicts shown
   - Filter by conflict_type=rating_scale → subset
   - Filter by source → only conflicts involving that source
   - URL updates with query params → shareable links

3. **Conflict detail shows correct warrant values:**
   - Expand a conflict → warrant A value and warrant B value match DB:
   ```sql
   SELECT w.value, w.source_id_code FROM warrants w
   WHERE w.id IN (SELECT warrant_a_id FROM conflicts WHERE id = $1
                  UNION SELECT warrant_b_id FROM conflicts WHERE id = $1);
   ```

4. **Research button returns context:**
   - Click Research → shows source methodology from DATA-DICTIONARY.md
   - Shows relevant knowledge base sections (if any match)

5. **Batch dismiss works:**
   - Select 3 conflicts → Batch Dismiss → verify:
   ```sql
   SELECT status FROM conflicts WHERE id IN ($1, $2, $3);
   -- All should be 'dismissed'
   ```

6. **Row click navigates to claim view:** Click a conflict row → arrives at `/claims/[plantId]/[attributeId]`
