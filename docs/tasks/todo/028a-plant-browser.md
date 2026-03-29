# 028a — Production Plant Browser

> **Status:** TODO
> **Priority:** P2 (normal)
> **Depends on:** None (read-only, zero risk)
> **Blocks:** 028c (plant detail page), 028d (manual entry)

## Problem

Curators have no way to browse or search the 1,361 plants in the production database from the admin portal. All existing pages focus on the curation pipeline (warrants, conflicts, claims, sync). To check what's live, curators must query the Neon database directly or use the public API.

## Current Implementation

- No `/plants` route exists in `admin/src/app/`
- Production database connection exists: `admin/src/lib/production.ts` exposes `queryProd()` and `queryOneProd()`
- Sidebar nav in `admin/src/components/sidebar-nav.tsx` has no "Plants" entry
- Production schema: `plants` table has `id`, `genus`, `species`, `subspecies_varieties`, `common_name`, `notes`, `last_updated`, `urls`; `values` table (EAV) links plants to 125 attributes via `attribute_id`

## Proposed Changes

### New Page: `/plants`

Searchable, paginated table of all production plants. **Reads from Neon only via `queryProd()`** — no writes, no Dolt interaction.

- Columns: scientific name (genus + species), common name, family, attribute count, last updated
- Search: text input filtering by scientific name or common name (server-side query with `LOWER() LIKE`)
- Pagination: 50 plants per page, page/limit query params
- Sort: by scientific name (default), common name, last updated
- Action: "View" link per row (links to `/plants/[plantId]` — built in 028c, can be a dead link initially)
- Action: "Add New Plant" button in header (links to `/plants/add` — built in 028d, can be a dead link initially)

### New API: `GET /api/plants`

**Query params:** `?search=`, `?page=` (default 1), `?limit=` (default 50)

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
  "page": 1,
  "limit": 50
}
```

The `family` and `attribute_count` require joins:
- Family: `JOIN "values" v ON v.plant_id = p.id AND v.attribute_id = '<family-attribute-uuid>'` — look up the family attribute UUID from `ATTRIBUTE-REGISTRY.md`
- Attribute count: `(SELECT COUNT(*) FROM "values" WHERE plant_id = p.id)` as subquery

### Sidebar Update

Add "Plants" nav item to `admin/src/components/sidebar-nav.tsx` in the `navItems` array, positioned after "Dashboard":

```ts
{ href: "/plants", label: "Plants" },
```

### What Does NOT Change

- No Dolt queries, no writes to any database
- No changes to existing pages or API routes
- No new dependencies

## Files Modified

### New Files
- `admin/src/app/plants/page.tsx` — Server component: fetches plant list, renders search + table
- `admin/src/app/api/plants/route.ts` — GET handler: paginated plant list from Neon
- `admin/src/lib/queries/plants.ts` — `fetchPlantList()` query function using `queryProd()`

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — Add "Plants" nav item

## Verification

1. Navigate to `/plants` — page loads with table of plants
2. Search for "Mahonia" — results filter to matching plants
3. Verify attribute count matches: pick a plant, run `SELECT COUNT(*) FROM "values" WHERE plant_id = '<id>'` against Neon — count should match the displayed number
4. Pagination: navigate to page 2, verify different plants shown
5. Sidebar "Plants" link is active when on `/plants`
6. TypeScript compiles clean (`npx tsc --noEmit`)
