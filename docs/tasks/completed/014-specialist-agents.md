# Specialist Agents — Rating and Scope Conflict Resolution

> **Status:** COMPLETED
> **Priority:** P1 (important)
> **Depends on:** 006-conflict-classifier-agent (classifyConflictFlow), 013-conflict-queue (conflict UI exists)
> **Blocks:** None directly, but enhances conflict resolution quality for demo
> **Commit:** e3449eb — Add rating and scope specialist agents (014) with classifier dispatch and API route

## Problem

The Conflict Classifier (006) detects and categorizes conflicts into 8 types, but doesn't resolve them. Resolution requires specialist logic that understands *why* two sources disagree. The two most common and impactful conflict types are:

1. **Rating Disagreement** — direct contradictions on the same trait (e.g., "fire-resistant" vs "highly flammable"). These are the highest-severity conflicts and need a specialist that compares source methodologies and rating scales to determine if the disagreement is real or an artifact of scale differences.

2. **Scope Difference** — a value is correct but applies to a different geographic/climatic context (e.g., Rutgers NJ deer rating applied to Southern Oregon). These are critical for regional applicability and need a specialist that checks source regions against the target context.

From `docs/planning/CONFLICT-TAXONOMY.md`: Rating + Scope cover the majority of detected conflicts. Other specialist types (temporal, categorical, methodology, taxonomic, completeness, corroboration) can remain unimplemented for the demo.

## Current Implementation

### What Exists
- `classifyConflictFlow` in `genkit/src/flows/classifyConflictFlow.ts` — detects conflicts, assigns `conflict_type` and `severity`
- `conflicts` table with real data containing `conflict_type`, `severity`, `warrant_a_id`, `warrant_b_id`
- `warrants` table with `source_methodology`, `source_region`, `source_id_code`
- Research tools: `getDatasetContext`, `searchDocumentIndex`, `navigateDocumentTree`
- Conflict queue UI (013) with inline expansion showing warrant details
- `docs/planning/CONFLICT-TAXONOMY.md` defining all 8 conflict types with detection/resolution patterns
- `docs/planning/agents/` — agent profile MDs (if any exist for specialists)

### What Does NOT Exist Yet
- `ratingConflictFlow` Genkit flow
- `scopeConflictFlow` Genkit flow
- Specialist dispatch logic in the classifier
- `specialist_verdict` or `specialist_recommendation` populated in conflicts table

## Proposed Changes

### 1. Rating Conflict Specialist Flow

`genkit/src/flows/ratingConflictFlow.ts`:

```typescript
// Genkit flow: ratingConflictFlow
// Model: MODELS.quality (Sonnet 4.6) — needs nuanced judgment
// Input: {
//   conflictId: string,
//   plantName: string,
//   attributeName: string,
//   warrantA: { value, sourceValue, sourceDataset, sourceIdCode, sourceMethodology, sourceRegion },
//   warrantB: { value, sourceValue, sourceDataset, sourceIdCode, sourceMethodology, sourceRegion }
// }
// Output: {
//   verdict: 'REAL' | 'APPARENT' | 'NUANCED',
//   recommendation: string,     // human-readable explanation
//   preferredWarrant: 'A' | 'B' | 'BOTH' | 'NEITHER',
//   reasoning: string,          // detailed analysis
//   confidence: 'HIGH' | 'MODERATE' | 'LOW'
// }
```

#### Flow Steps:

1. **Load source context** — call `getDatasetContext` for both source datasets to get methodology descriptions and rating scale definitions
2. **Search knowledge base** — call `searchDocumentIndex` with plant name + attribute to find relevant research
3. **LLM analysis** — prompt Sonnet with:
   - Both warrant values + source methodologies
   - Rating scale definitions from both DATA-DICTIONARY.md files
   - Any relevant knowledge base context
   - Ask: "Are these values genuinely contradictory, or can the difference be explained by methodology/scale differences?"
4. **Return verdict** — REAL (genuine disagreement), APPARENT (scale/methodology artifact), or NUANCED (both correct in different contexts)

### 2. Scope Conflict Specialist Flow

`genkit/src/flows/scopeConflictFlow.ts`:

```typescript
// Genkit flow: scopeConflictFlow
// Model: MODELS.quality (Sonnet 4.6)
// Input: same as ratingConflictFlow
// Output: same shape as ratingConflictFlow, plus:
//   regionAnalysis: {
//     sourceARegion: string,
//     sourceBRegion: string,
//     targetRegion: string,       // Pacific West (OR/CA/WA)
//     applicability: 'BOTH' | 'A_ONLY' | 'B_ONLY' | 'NEITHER'
//   }
```

#### Flow Steps:

1. **Load source context** — get geographic scope from each source's README/DATA-DICTIONARY
2. **Region comparison** — determine each source's geographic applicability to Pacific West
3. **LLM analysis** — prompt Sonnet with:
   - Both warrant values + source regions
   - Target region context (Oregon, California, Washington)
   - Ask: "Which source's data is more applicable to the Pacific West? Is one source from an incompatible climate zone?"
4. **Return verdict** — include region applicability assessment

### 3. Wire Specialists into Classifier Dispatch

Update `classifyConflictFlow.ts` to optionally dispatch to specialists after classification:

```typescript
// After classifying a conflict, if specialist flows are available:
// - conflict_type === 'rating_disagreement' → ratingConflictFlow
// - conflict_type === 'scope_difference' → scopeConflictFlow
// - all other types → leave specialist_verdict as null (future work)
```

The dispatch should be:
- **Optional** — controlled by a `runSpecialists: boolean` flag (default: false)
- **Non-blocking** — classification completes even if specialist fails
- Write specialist results back to the `conflicts` table: `specialist_verdict`, `specialist_recommendation`

### 4. API Route for On-Demand Specialist Analysis

`admin/src/app/api/conflicts/[id]/specialist/route.ts`:
- POST — trigger specialist analysis for a single conflict
- Reads conflict from DB, determines type, calls appropriate flow
- Updates conflict record with verdict + recommendation
- Returns specialist result to UI

### What Does NOT Change

- `classifyConflictFlow` core logic — classification is unchanged, specialist dispatch is additive
- Conflict queue UI — already displays `specialist_verdict` when present (from 013)
- Other 6 conflict types — no specialist flows yet
- Warrant data — read-only
- DoltgreSQL schema — no table changes (specialist fields already exist on conflicts)

## Migration Strategy

1. Implement `genkit/src/flows/ratingConflictFlow.ts`
2. Implement `genkit/src/flows/scopeConflictFlow.ts`
3. Add specialist dispatch to `classifyConflictFlow.ts` (behind `runSpecialists` flag)
4. Create API route `admin/src/app/api/conflicts/[id]/specialist/route.ts`
5. Test rating specialist on a known rating conflict from internal scan
6. Test scope specialist on a FIRE-01 vs WATER-01 conflict with different regions
7. Verify specialist verdicts appear in conflict queue UI

## Files Modified

### New Files
- `genkit/src/flows/ratingConflictFlow.ts` — rating disagreement specialist
- `genkit/src/flows/scopeConflictFlow.ts` — scope difference specialist
- `admin/src/app/api/conflicts/[id]/specialist/route.ts` — on-demand specialist API

### Modified Files
- `genkit/src/flows/classifyConflictFlow.ts` — add optional specialist dispatch

## Verification

1. **Rating specialist produces verdict:**
   ```sql
   -- Find a rating conflict
   SELECT id, conflict_type FROM conflicts WHERE conflict_type = 'rating_disagreement' LIMIT 1;
   ```
   - Call specialist API → verify `specialist_verdict` is set (REAL/APPARENT/NUANCED)
   - Verify `specialist_recommendation` is a readable explanation

2. **Scope specialist produces verdict:**
   ```sql
   SELECT id, conflict_type FROM conflicts WHERE conflict_type = 'scope_difference' LIMIT 1;
   ```
   - Call specialist API → verify verdict includes region analysis

3. **Specialist results visible in UI:**
   - Open conflict queue → expand a conflict that has specialist verdict → verdict badge and recommendation text display

4. **Classifier dispatch works (when enabled):**
   - Run `classifyConflictFlow` with `runSpecialists: true` on a small batch
   - Verify rating + scope conflicts get specialist verdicts automatically

5. **Non-specialist conflicts unaffected:**
   ```sql
   SELECT COUNT(*) FROM conflicts WHERE conflict_type NOT IN ('rating_disagreement', 'scope_difference') AND specialist_verdict IS NOT NULL;
   -- Expected: 0
   ```
