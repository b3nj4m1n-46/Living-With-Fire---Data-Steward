# Warrant & Claim Curation UI — The Core Feature

> **Status:** COMPLETED
> **Priority:** P0 (critical)
> **Depends on:** 010-portal-scaffold (Next.js app + DB connection)
> **Blocks:** None directly, but this is the primary P0 feature from the PRD
> **Commit:** `c056448` — Build claim curation UI with warrant cards, API routes, and docs

## Problem

The claim/warrant curation interface is the core value proposition of the admin portal. Data stewards need to see all evidence (warrants) for a given plant+attribute, select which warrants to include, trigger AI synthesis to merge them into a claim, edit the result, and approve it. Without this UI, the entire pipeline produces data that nobody can act on.

From the PRD: "As a data steward, I want to see all warrants for a claim and select which warrants to include, even when they conflict, because conflicting evidence can add nuance."

## Current Implementation

### What Exists
- Portal scaffold with placeholder claims page (from 010)
- `lib/dolt.ts` connection utility
- DoltgreSQL tables: `warrants`, `conflicts`, `claims`, `claim_warrants`
- Genkit `classifyConflictFlow` and research tools (flows exist, not yet callable from portal)
- Real warrant data: bootstrapped (existing) + FIRE-01 + WATER-01 (external)

### What Does NOT Exist Yet
- Claim View page (plant+attribute detail with warrant cards)
- Warrant selection UI (checkboxes, include/exclude)
- Synthesis API route or UI
- Claim approval workflow
- `synthesizeClaimFlow` Genkit flow (Phase 4 T44, but we need the UI shell now)

## Proposed Changes

### 1. Claims List Page

`admin/src/app/claims/page.tsx`:

A table of all plant+attribute combinations that have warrants, showing:

| Column | Source |
|--------|--------|
| Plant | `plant_genus \|\| ' ' \|\| plant_species` from warrants |
| Attribute | `attribute_name` from warrants |
| Warrant Count | `COUNT(*)` grouped by plant_id + attribute_id |
| Sources | Distinct `source_id_code` values |
| Conflict? | Whether any conflicts exist for this plant+attribute |
| Claim Status | From `claims` table if exists: draft/approved/pushed, else "No claim" |

Filterable by: has conflicts, claim status, attribute category, source dataset.
Clickable rows → navigate to Claim View.

### 2. Claim View Page (The Core UI)

`admin/src/app/claims/[plantId]/[attributeId]/page.tsx`:

**Header:**
- Plant name (scientific + common)
- Attribute name + category
- Current production value (from `"values"` table, if exists)
- Claim status badge

**Warrant Cards:**
Each warrant displayed as a card with:
- Checkbox for include/exclude (default: included for `status = 'included'`, excluded for `status = 'excluded'`, unchecked for `status = 'unreviewed'`)
- Source name + source ID code
- Value (highlighted if differs from production)
- Source value (original before crosswalk)
- Methodology snippet (from source metadata)
- Region / geographic scope
- Match confidence badge (for external warrants)
- Conflict badge (if this warrant is part of a conflict pair — click to see conflict details)
- Specialist analysis inline (if conflict has specialist_verdict)

Cards should be visually grouped: existing warrants first, then external by source.

**Synthesis Panel:**
- "Synthesize Claim" button (disabled until `synthesizeClaimFlow` exists in Phase 4 — show placeholder message)
- When synthesis is available: shows AI-generated text in editable textarea
- Confidence level + reasoning
- "Approve" button to finalize

**Actions:**
- Toggle warrant inclusion (PATCH `/api/warrants/[id]` → update status)
- Trigger synthesis (POST `/api/synthesize` — stub for now)
- Approve claim (POST `/api/claims/approve` — writes to claims + claim_warrants + Dolt commit)

### 3. API Routes

`admin/src/app/api/warrants/[id]/route.ts`:
- PATCH — update warrant status (included/excluded/unreviewed)

`admin/src/app/api/synthesize/route.ts`:
- POST — stub that returns a placeholder message ("Synthesis agent not yet connected. Wire up synthesizeClaimFlow in Phase 4.")
- Input: `{ plantId, attributeId, warrantIds[] }`

`admin/src/app/api/claims/approve/route.ts`:
- POST — create claim record + claim_warrants junction rows + Dolt commit
- Input: `{ plantId, attributeId, value, warrantIds[], notes? }`
- Steps:
  1. INSERT into `claims` with status 'approved'
  2. INSERT into `claim_warrants` for each selected warrant
  3. `SELECT dolt_add('.')`
  4. `SELECT dolt_commit('-m', 'claim: <plant> <attribute> approved')`
  5. Return claim ID + commit hash

### What Does NOT Change

- Genkit flows — not modified (synthesis flow is Phase 4)
- DoltgreSQL schema — no table changes
- Dashboard or conflict queue — independent pages
- Source datasets — not accessed

## Migration Strategy

1. Write query functions in `admin/src/lib/queries/claims.ts` — list claims, get claim view data, get warrants for plant+attribute
2. Build warrant card component (`admin/src/components/warrant-card.tsx`)
3. Build claims list page with filtering
4. Build claim view page with warrant cards + selection
5. Create API routes: warrant status update, synthesis stub, claim approval
6. Wire up warrant checkbox toggle → PATCH API
7. Wire up approve button → POST API
8. Test full flow: browse claims → select warrants → approve claim → verify Dolt commit

## Files Modified

### New Files
- `admin/src/lib/queries/claims.ts` — claim/warrant query functions
- `admin/src/components/warrant-card.tsx` — warrant evidence card
- `admin/src/app/claims/page.tsx` — claims list (replace placeholder)
- `admin/src/app/claims/[plantId]/[attributeId]/page.tsx` — claim view
- `admin/src/app/api/warrants/[id]/route.ts` — warrant status PATCH
- `admin/src/app/api/synthesize/route.ts` — synthesis stub
- `admin/src/app/api/claims/approve/route.ts` — claim approval + Dolt commit

### Modified Files
- None (all new files)

## Verification

1. **Claims list loads:**
   - Shows plant+attribute combinations with warrant counts
   - Filter by "has conflicts" → shows subset
   - Click a row → navigates to claim view

2. **Claim view renders warrants:**
   ```sql
   SELECT COUNT(*) FROM warrants WHERE plant_id = $1 AND attribute_id = $2;
   ```
   UI card count should match query

3. **Warrant toggle works:**
   - Click checkbox → warrant status updates in DB
   - Refresh page → checkbox state persists

4. **Claim approval creates records:**
   - Select warrants → click Approve → verify:
   ```sql
   SELECT * FROM claims ORDER BY created_at DESC LIMIT 1;
   SELECT * FROM claim_warrants WHERE claim_id = $1;
   SELECT message FROM dolt_log ORDER BY date DESC LIMIT 1;
   -- Should show claim record, junction rows, and Dolt commit
   ```

5. **Synthesis stub returns placeholder:** POST `/api/synthesize` → 200 with message about Phase 4
