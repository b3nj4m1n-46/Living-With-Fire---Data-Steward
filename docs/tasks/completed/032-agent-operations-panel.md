# 032 — Agent Operations Panel

> **Status:** COMPLETED
> **Priority:** P1 (important)
> **Depends on:** 031 (Quality nav group must exist)
> **Blocks:** None
> **Commit:** bb1f880

## Problem

AI agent processes (internal audit, conflict classification, claim synthesis) can only be triggered as side effects of the source upload pipeline or by hitting raw API endpoints. A data steward has no UI to:

1. **Run an internal audit** — the API exists (`POST /api/audit/internal`) but there's no button to call it
2. **Re-classify conflicts** on existing data — `classifyConflictFlow` only runs during source ingestion
3. **Synthesize claims** on demand — `synthesizeClaimFlow` only runs at the end of the full-analysis pipeline
4. **See what agents are doing** — no progress indicators for long-running agent operations

This means the steward can't audit data quality, trigger gap-filling workflows, or re-run AI analysis without developer intervention.

## Current Implementation

### Internal Audit
- **API:** `POST /api/audit/internal` (`admin/src/app/api/audit/internal/route.ts`)
- **Logic:** `runInternalAudit(batchId)` in `admin/src/lib/queries/audit.ts`
- **What it does:** 3-stage scan — multi-source disagreements, value validation against allowed enums, missing provenance detection
- **Creates:** warrants + conflicts in Dolt, tracked via `analysis_batches` table
- **UI:** None — no page, no button, no status display

### Conflict Classification
- **Flow:** `genkit/src/flows/classifyConflictFlow.ts`
- **Trigger:** Only called from fusion-bridge `execute` and `full-analysis` actions
- **Modes:** `internal` (within-source), `external` (cross-source), `cross_source`
- **UI:** None for standalone re-runs

### Claim Synthesis
- **Flow:** `genkit/src/flows/synthesizeClaimFlow.ts`
- **Trigger:** Called via `POST /api/synthesize` from the claim detail page for individual claims
- **UI:** Per-claim synthesis button exists on `/claims/[plantId]/[attributeId]` — but no bulk synthesis

### Batch Tracking
- **Table:** `analysis_batches` tracks batch_type, status, timestamps, stats
- **UI:** `/sources/[batchId]` shows pipeline progress for source uploads — but only for source pipeline batches

## Proposed Changes

### New page: `/quality/operations` (or tab within `/coverage`)

Add an "Agent Operations" section to the Quality group (from task 031). This could be:
- **Option A:** A new tab on the Coverage page (keeps nav simple)
- **Option B:** A separate `/quality/operations` route in the Quality nav group

Recommend **Option A** — add a 4th tab "Operations" to the existing coverage dashboard.

### Tab content: Agent Operations

#### Section 1: Internal Audit

Card with:
- **"Run Internal Audit" button** — calls `POST /api/audit/internal`
- **Last audit summary** — query `analysis_batches WHERE batch_type = 'internal_audit' ORDER BY created_at DESC LIMIT 1` to show: date, warrants created, conflicts created, status
- **Audit history table** — last 10 audit batches with date, status, and result counts
- Button is disabled while an audit is running (poll status or use the batch status)

#### Section 2: Bulk Conflict Re-classification

Card with:
- **"Re-classify Pending Conflicts" button** — calls a new API endpoint that invokes `classifyConflictFlow` on conflicts with `status = 'pending'`
- Scope selector: all pending, or filter by source pair / attribute category
- Count of pending conflicts shown before running
- Progress: number processed / total (updated via polling)

#### Section 3: Bulk Claim Synthesis

Card with:
- **"Synthesize Unsynthesized Claims" button** — calls a new API endpoint that finds plant-attribute pairs with warrants but no approved claim and runs `synthesizeClaimFlow` on each
- Scope selector: all, or filter by attribute category / plant
- Count of candidates shown before running
- Progress: number synthesized / total

#### Section 4: Active Operations

Live status panel showing any currently running agent operations:
- Batch ID, type (audit / classification / synthesis), status, started at, progress
- Source: query `analysis_batches WHERE status = 'running'`
- Auto-refresh every 5 seconds (same pattern as `/sources/[batchId]`)

### New API routes

#### `POST /api/agents/classify`
```ts
// Runs classifyConflictFlow on pending conflicts
// Body: { scope?: "all" | { sourcePair?: [string, string], category?: string } }
// Returns: { batchId: string, conflictsQueued: number }
```

Creates an `analysis_batches` record with `batch_type = 'reclassification'`. Calls the fusion bridge with a new `classify-existing` action (or directly invokes the flow via a new bridge action).

#### `POST /api/agents/synthesize`
```ts
// Runs synthesizeClaimFlow on unsynthesized claims
// Body: { scope?: "all" | { category?: string, plantId?: string } }
// Returns: { batchId: string, claimsQueued: number }
```

Creates an `analysis_batches` record with `batch_type = 'bulk_synthesis'`. Iterates plant-attribute pairs needing synthesis.

#### `GET /api/agents/status`
```ts
// Returns running and recent agent operations
// Response: { running: BatchRow[], recent: BatchRow[] }
```

Queries `analysis_batches` for running ops + last 10 completed.

### Fusion bridge additions

Add two new actions to `genkit/src/scripts/fusion-bridge.ts`:

- **`classify-existing`** — accepts a list of conflict IDs (or filter criteria), runs `classifyConflictFlow` on them, updates batch progress
- **`bulk-synthesize`** — accepts a list of plant-attribute pairs, runs `synthesizeClaimFlow` on each, updates batch progress

### What Does NOT Change
- Existing source upload pipeline and its agent triggers
- Individual claim synthesis button on claim detail page
- Coverage, enrichment, or gap analysis queries
- Any existing page layouts (additive only — new tab on coverage page)
- Genkit flow logic itself — flows are reused as-is, just invoked from new entry points

## Migration Strategy

1. **Add `GET /api/agents/status` route** — query `analysis_batches` for running + recent ops. This is read-only and immediately useful.

2. **Add audit trigger to coverage page** — new tab "Operations" on `coverage-client.tsx` with the "Run Internal Audit" button and audit history. This just calls the existing `POST /api/audit/internal` API.

3. **Add `classify-existing` action to fusion bridge** — new action in `genkit/src/scripts/fusion-bridge.ts` that accepts conflict filter criteria and runs `classifyConflictFlow`. Add corresponding `POST /api/agents/classify` route.

4. **Add `bulk-synthesize` action to fusion bridge** — new action that accepts plant-attribute pairs and runs `synthesizeClaimFlow`. Add corresponding `POST /api/agents/synthesize` route.

5. **Build bulk classification UI** — card in Operations tab with scope selector, count preview, run button, and progress polling.

6. **Build bulk synthesis UI** — card in Operations tab with scope selector, count preview, run button, and progress polling.

7. **Build active operations panel** — live status showing running ops, auto-refresh, links to results.

## Files Modified

### New Files
- `admin/src/app/api/agents/status/route.ts` — running + recent agent operations
- `admin/src/app/api/agents/classify/route.ts` — trigger bulk conflict re-classification
- `admin/src/app/api/agents/synthesize/route.ts` — trigger bulk claim synthesis

### Modified Files
- `admin/src/app/coverage/coverage-client.tsx` — add 4th "Operations" tab with audit, classify, synthesize, and status sections
- `genkit/src/scripts/fusion-bridge.ts` — add `classify-existing` and `bulk-synthesize` actions
- `admin/src/lib/fusion-bridge.ts` — no changes needed (generic `callFusionBridge` already accepts any action string)

## Verification

1. **Audit trigger:** Click "Run Internal Audit" on Operations tab → batch appears in active operations → completes with warrant/conflict counts matching `analysis_batches` record
2. **Audit history:** Shows last 10 audit runs with correct dates and stats
3. **Classify:** Set scope to "all pending", click "Re-classify" → progress updates in real time → conflicts get updated `conflict_type` and specialist assignments
4. **Synthesize:** Click "Synthesize Unsynthesized" → progress updates → new claims appear in claims list with AI-generated values and confidence scores
5. **Active operations:** Panel shows running ops with live progress, clears when complete
6. **Button guards:** All run buttons disabled while their respective operation is in progress
7. **Error handling:** Failed operations show error state in operations panel, batch marked as `failed` in DB
