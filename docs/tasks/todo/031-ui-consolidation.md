# 031 — Consolidate Admin Portal Navigation

> **Status:** TODO
> **Priority:** P1 (important)
> **Depends on:** None
> **Blocks:** 032 (agent operations panel lives inside new Quality section)

## Problem

The sidebar has 13 flat nav items with no grouping. Related pages (Conflicts + Matrix, Sources + Documents + Reliability + Fusion, Coverage + enrichment) sit at the same level as top-level concepts. A data steward has to scan the full list to find what they need, and there's no visual hierarchy to communicate workflows.

Current sidebar:
```
Dashboard | Plants | Conflicts | Matrix | Claims | Warrants |
Sources | Documents | Reliability | Coverage | Fusion | Sync | History
```

## Current Implementation

### Navigation
- `admin/src/components/sidebar-nav.tsx` — flat array of 13 `{ href, label }` items rendered as links
- Active state: exact match for `/`, startsWith for everything else
- No grouping, no collapsible sections, no icons

### Pages that overlap or belong together
- **Conflicts** (`/conflicts`) + **Matrix** (`/matrix`) — same data, different views (list vs heatmap)
- **Claims** (`/claims`) + **Warrants** (`/warrants`) — warrants page is a placeholder, claims already shows warrant counts
- **Sources** (`/sources`) + **Documents** (`/sources/documents`) + **Reliability** (`/sources/reliability`) + **Fusion** (`/fusion`) — all steps in getting data into the system
- **Coverage** (`/coverage`) — standalone but logically groups with audit and enrichment (task 032)

### Pages and routes (no URL changes needed — only nav grouping)
All existing `page.tsx` files and API routes stay at their current paths.

## Proposed Changes

### New sidebar structure: 6 groups

```
Dashboard

PLANTS
  Browse           → /plants

DATA PIPELINE
  Sources          → /sources
  Documents        → /sources/documents
  Reliability      → /sources/reliability
  Fusion           → /fusion

CURATION
  Claims           → /claims
  Conflicts        → /conflicts
  Warrants         → /warrants

QUALITY
  Coverage         → /coverage
  (Audit — added in task 032)

OPERATIONS
  Sync             → /sync
  History          → /history
```

### Key decisions

1. **Matrix becomes a tab on the Conflicts page**, not a separate nav entry. The conflicts page already has filtering; add a "Matrix" tab alongside the existing list view. Route: `/conflicts?view=matrix` or a tab within the client component.

2. **Grouped sidebar with section headers.** Each group label is non-clickable text. Items within groups are indented links. Groups are always expanded (no collapse toggle — keep it simple).

3. **No URL changes.** All existing routes stay the same. Only the nav component and the conflicts page change.

4. **Warrants stays in nav** despite being a placeholder — it's in the PRD and will be built. Mark it with a subtle "(soon)" badge.

### What Does NOT Change
- Any API routes
- Any page URLs (except Matrix gets folded into Conflicts)
- Dashboard page layout
- Any backend queries or data flows
- The coverage, sync, history, plants, claims, sources, documents, reliability, or fusion pages

## Migration Strategy

1. **Merge Matrix into Conflicts page** — move `matrix-client.tsx` content into a tab within `conflicts-client.tsx` (or a peer component loaded by the same page). Add a `view` state toggling between "List" and "Matrix". Remove `/matrix/page.tsx` route (or redirect to `/conflicts?view=matrix`).

2. **Refactor sidebar-nav.tsx** — replace flat `navItems` array with a grouped structure:
   ```ts
   const navGroups = [
     { items: [{ href: "/", label: "Dashboard" }] },
     { label: "Plants", items: [{ href: "/plants", label: "Browse" }] },
     { label: "Data Pipeline", items: [
       { href: "/sources", label: "Sources" },
       { href: "/sources/documents", label: "Documents" },
       { href: "/sources/reliability", label: "Reliability" },
       { href: "/fusion", label: "Fusion" },
     ]},
     { label: "Curation", items: [
       { href: "/claims", label: "Claims" },
       { href: "/conflicts", label: "Conflicts" },
       { href: "/warrants", label: "Warrants", badge: "soon" },
     ]},
     { label: "Quality", items: [
       { href: "/coverage", label: "Coverage" },
     ]},
     { label: "Operations", items: [
       { href: "/sync", label: "Sync" },
       { href: "/history", label: "History" },
     ]},
   ];
   ```

3. **Render grouped nav** — section headers as small uppercase labels, items indented below. Keep active-state logic unchanged.

4. **Test all routes** — confirm every page still loads and sidebar highlights correctly.

## Files Modified

### Modified Files
- `admin/src/components/sidebar-nav.tsx` — grouped nav structure with section headers
- `admin/src/app/conflicts/conflicts-client.tsx` — add Matrix tab (import matrix content)
- `admin/src/app/conflicts/page.tsx` — may need to pass matrix data or adjust server-side fetch

### Removed Files
- `admin/src/app/matrix/page.tsx` — absorbed into conflicts page
- `admin/src/app/matrix/matrix-client.tsx` — content moved to conflicts tab (or kept as imported component)

## Verification

1. Sidebar renders 6 groups with section headers and correct indentation
2. All nav links navigate to correct pages, active states highlight correctly
3. `/conflicts` page shows two tabs: "List" (default) and "Matrix"
4. Matrix tab renders the same heatmap with same filtering as the old `/matrix` page
5. `/matrix` either redirects to `/conflicts?view=matrix` or returns 404 (choose one)
6. No other pages are affected — spot-check `/plants`, `/sources`, `/coverage`, `/sync`, `/history`
