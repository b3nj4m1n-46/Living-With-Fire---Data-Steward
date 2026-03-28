# Portal Scaffold — Next.js Admin App with DoltgreSQL Connection

> **Status:** COMPLETED
> **Priority:** P0 (critical)
> **Depends on:** 001-dolt-setup (DoltgreSQL running on port 5433)
> **Blocks:** 011-dashboard, 012-warrant-claim-curation, 013-conflict-queue
> **Commit:** 3e85a2a

## Problem

Phase 2 built the entire data pipeline (matcher, schema mapper, conflict classifier, research tools) but there's no UI to interact with it. The admin portal is the write path to production — data stewards need it to review warrants, resolve conflicts, and approve claims. Nothing exists yet: no Next.js app, no DB connection utility, no layout.

## Current Implementation

### What Exists
- DoltgreSQL running on port 5433 with PostgreSQL wire protocol
- 5 new tables (warrants, conflicts, claims, claim_warrants, analysis_batches) with real data
- 94,903 bootstrapped warrants + FIRE-01 + WATER-01 external warrants + internal/external conflicts
- 4 Genkit flows in `genkit/src/flows/` callable via API
- Architecture spec (`docs/planning/ARCHITECTURE.md`) specifies Next.js 14 + shadcn/ui + Tailwind

### What Does NOT Exist Yet
- Any Next.js application
- DoltgreSQL connection utility for the portal
- App layout or navigation
- Any UI components

## Proposed Changes

### 1. Scaffold Next.js App

Create `admin/` at repository root:

```bash
npx create-next-app@latest admin --typescript --tailwind --app --src-dir --no-import-alias
```

### 2. Install Dependencies

```bash
cd admin
npx shadcn@latest init
npx shadcn@latest add table card badge dialog button tabs checkbox input select separator skeleton toast
npm install pg @types/pg
```

### 3. DoltgreSQL Connection Utility

`admin/src/lib/dolt.ts`:

```typescript
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DOLT_HOST || 'localhost',
  port: parseInt(process.env.DOLT_PORT || '5433'),
  database: process.env.DOLT_DATABASE || 'lwf_staging',
  user: process.env.DOLT_USER || 'root',
  password: process.env.DOLT_PASSWORD || '',
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export default pool;
```

**DoltgreSQL gotchas** (from 001/002 task specs):
- Must quote `"values"` table name (reserved word)
- No ILIKE support — use `LOWER(col) LIKE LOWER($1)`
- ENUMs replaced with VARCHAR + CHECK constraints

### 4. App Layout

`admin/src/app/layout.tsx` — root layout with sidebar navigation:

- **Dashboard** — `/` — summary stats
- **Conflicts** — `/conflicts` — conflict queue (filterable table)
- **Claims** — `/claims` — claim curation list
- **Warrants** — `/warrants` — warrant browser
- **History** — `/history` — Dolt commit log

Sidebar should show app title ("LWF Admin") and nav links with active state highlighting.

### 5. Environment Config

`admin/.env.local`:
```
DOLT_HOST=localhost
DOLT_PORT=5433
DOLT_DATABASE=lwf_staging
DOLT_USER=root
DOLT_PASSWORD=
```

### What Does NOT Change

- Genkit project (`genkit/`) — untouched, called via API routes later
- DoltgreSQL schema — read-only from portal perspective in this task
- Source datasets — not accessed by portal

## Migration Strategy

1. Scaffold Next.js app in `admin/`
2. Install shadcn/ui components and pg driver
3. Create `lib/dolt.ts` connection utility
4. Create root layout with sidebar navigation (5 nav items)
5. Create placeholder pages for each route (`/`, `/conflicts`, `/claims`, `/warrants`, `/history`)
6. Add `.env.local` with DoltgreSQL connection defaults
7. Verify: `npm run dev` starts, nav works, DB connection returns data

## Files Modified

### New Files
- `admin/` — entire Next.js application scaffold
- `admin/src/lib/dolt.ts` — DoltgreSQL connection utility
- `admin/src/app/layout.tsx` — root layout with sidebar nav
- `admin/src/app/page.tsx` — dashboard placeholder
- `admin/src/app/conflicts/page.tsx` — conflicts placeholder
- `admin/src/app/claims/page.tsx` — claims placeholder
- `admin/src/app/warrants/page.tsx` — warrants placeholder
- `admin/src/app/history/page.tsx` — history placeholder
- `admin/.env.local` — DoltgreSQL connection config

### Modified Files
- None

## Verification

1. **App starts:**
   ```bash
   cd admin && npm run dev
   # Should start on localhost:3000
   ```

2. **Navigation works:** Click each nav item → correct page renders

3. **DB connection works:** Add a temporary test to dashboard page:
   ```typescript
   const [{ count }] = await query('SELECT COUNT(*) as count FROM warrants');
   // Should return 94,903+ (bootstrapped + external)
   ```

4. **shadcn/ui components render:** Verify at least one component (e.g., Card, Button) renders without errors
