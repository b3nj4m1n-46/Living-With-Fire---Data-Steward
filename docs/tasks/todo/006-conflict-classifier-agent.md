# Conflict Classifier Agent — Detect and Classify Warrant Disagreements

> **Status:** TODO
> **Priority:** P0 (critical)
> **Depends on:** 003-bootstrap-warrants (warrants must exist to compare)
> **Blocks:** 007-internal-conflict-scan, 009-first-external-analysis

## Problem

The staging database now has 94,903 warrants from production values. Many plants have multiple warrants for the same attribute from different sources — these are potential conflicts. Before an admin can curate data, we need to detect which warrants disagree, classify the conflict type (from the 8 types in `docs/planning/CONFLICT-TAXONOMY.md`), score severity, and route to the appropriate specialist agent.

This is the intelligence layer that turns raw data disagreements into actionable conflict records.

## Current Implementation

### What Exists
- 94,903 bootstrapped warrants in `warrants` table (`warrant_type: 'existing'`)
- Empty `conflicts` table (schema from 001-dolt-setup, defined in `docs/planning/PROPOSALS-SCHEMA.md`)
- `queryDolt` tool for database queries
- `getDatasetContext` tool for reading source metadata
- `getSourceMetadata` tool for source lookups
- `lookupProductionPlant` tool for plant data
- Genkit config with `MODELS.bulk` (Haiku 4.5)
- Full conflict taxonomy in `docs/planning/CONFLICT-TAXONOMY.md` (8 types, 3 severity levels)
- Specialist routing table in `docs/planning/CONFLICT-TAXONOMY.md` (conflict type → specialist flow)

### What Does NOT Exist Yet
- `classifyConflictFlow` Genkit flow
- Tools for reading/writing warrant groups and conflict records
- Severity scoring logic
- Specialist routing logic

## Proposed Changes

### 1. Warrant Group Query Tool

`genkit/src/tools/warrantGroups.ts`:

A Genkit tool that finds groups of warrants that share the same plant+attribute — these are conflict candidates.

```typescript
// Genkit tool: getWarrantGroups
// Input: {
//   mode: 'internal' | 'external' | 'all',
//   plantIds?: string[],            // filter to specific plants
//   attributeFilter?: string,       // filter by attribute name pattern
//   minGroupSize?: number           // minimum warrants per group (default 2)
// }
// Output: {
//   groups: Array<{
//     plantId: string,
//     plantGenus: string,
//     plantSpecies: string,
//     attributeId: string,
//     attributeName: string,
//     warrants: Array<{
//       id: string,
//       value: string,
//       sourceValue: string | null,
//       sourceId: string | null,
//       sourceDataset: string,
//       sourceIdCode: string,
//       sourceMethodology: string | null,
//       sourceRegion: string | null,
//       warrantType: string,
//       matchConfidence: number
//     }>
//   }>,
//   totalGroups: number
// }
```

SQL approach:
```sql
-- Find plant+attribute combos with 2+ warrants
SELECT plant_id, attribute_id, plant_genus, plant_species, attribute_name, COUNT(*) as cnt
FROM warrants
WHERE status != 'excluded'
GROUP BY plant_id, attribute_id, plant_genus, plant_species, attribute_name
HAVING COUNT(*) >= $1
ORDER BY cnt DESC;
```

Then for each group, fetch the full warrant details.

**DoltgreSQL note:** Batch the detail queries (e.g., 50 groups at a time) to avoid connection pool exhaustion.

### 2. Write Conflict Tool

`genkit/src/tools/writeConflict.ts`:

A Genkit tool that inserts a conflict record into the `conflicts` table.

```typescript
// Genkit tool: writeConflict
// Input: {
//   conflictType: string,          // from CONFLICT-TAXONOMY.md
//   conflictMode: 'internal' | 'external' | 'cross_source',
//   severity: 'critical' | 'moderate' | 'minor',
//   warrantAId: string,
//   warrantBId: string,
//   plantId: string,
//   plantName: string,
//   attributeName: string,
//   valueA: string,
//   valueB: string,
//   sourceA: string,
//   sourceB: string,
//   classifierExplanation: string,
//   batchId?: string
// }
// Output: { conflictId: string, success: boolean }
```

Uses `crypto.randomUUID()` for the conflict ID. Inserts via parameterized SQL.

### 3. Classify Conflict Flow

`genkit/src/flows/classifyConflictFlow.ts`:

The main Genkit flow that scans warrant groups and classifies conflicts.

```typescript
// Genkit flow: classifyConflictFlow
// Model: MODELS.bulk (Haiku 4.5)
// Input: {
//   mode: 'internal' | 'external' | 'cross_source',
//   plantIds?: string[],           // process specific plants (default: all)
//   attributeFilter?: string,      // filter by attribute name
//   sourceDataset?: string,        // for external mode: which new dataset
//   batchId?: string,              // link to analysis_batches
//   dryRun?: boolean               // if true, classify but don't write to DB
// }
// Output: {
//   conflicts: Array<{
//     conflictId: string | null,    // null if dryRun
//     plantName: string,
//     attributeName: string,
//     conflictType: string,
//     severity: string,
//     valueA: string,
//     valueB: string,
//     sourceA: string,
//     sourceB: string,
//     classifierExplanation: string,
//     specialistRoute: string | null  // which specialist flow should review this
//   }>,
//   corroborated: number,           // warrant groups that agree
//   complementary: number,          // one warrant adds data the other lacks
//   summary: {
//     total: number,
//     critical: number,
//     moderate: number,
//     minor: number,
//     byType: Record<string, number>
//   }
// }
```

#### Classification Algorithm:

For each warrant group (2+ warrants on same plant+attribute):

1. **Identical values** → skip (corroboration, not conflict)
2. **One NULL, one non-NULL** → `COMPLETENESS_CONFLICT`, severity `minor`
3. **Different values** → call LLM to classify:

The LLM receives:
- The two (or more) warrant values with their source metadata
- The attribute definition (from `attributes` table)
- Source metadata (methodology, region, year) for each warrant
- The 8 conflict types from CONFLICT-TAXONOMY.md with definitions

The LLM returns:
- `conflictType`: one of the 8 types
- `severity`: critical/moderate/minor
- `explanation`: why this is classified this way
- `specialistRoute`: which specialist flow (from routing table)

**For pairwise conflicts:** If a group has N warrants, compare each pair. Use combination logic: N=2 → 1 pair, N=3 → 3 pairs, N=4 → 6 pairs. Cap at N=5 (10 pairs) — above that, compare each against the most common value only.

#### Conflict Type → Specialist Routing:

| Conflict Type | Specialist Flow | Severity Default |
|--------------|-----------------|------------------|
| `RATING_DISAGREEMENT` | `ratingConflictFlow` | critical |
| `SCALE_MISMATCH` | `ratingConflictFlow` | moderate |
| `SCOPE_DIFFERENCE` | `scopeConflictFlow` | moderate |
| `TEMPORAL_CONFLICT` | `temporalConflictFlow` | minor |
| `METHODOLOGY_DIFFERENCE` | `methodologyConflictFlow` | varies |
| `GRANULARITY_MISMATCH` | `taxonomyConflictFlow` | minor |
| `DEFINITION_CONFLICT` | `definitionConflictFlow` | moderate |
| `COMPLETENESS_CONFLICT` | *(auto-handled)* | minor |

#### Batching Strategy:

- Process warrant groups in batches of 20-50 to manage API calls
- Each batch sends one LLM call with multiple groups (reduces overhead)
- Write conflicts to DB after each batch (not all at end — survive interruptions)
- Log progress to console: `Processing batch 3/47 (groups 101-150)...`

### What Does NOT Change

- `warrants` table data — read-only (conflicts reference warrants but don't modify them)
- Existing tools — no modifications
- `genkit/src/config.ts` — no changes
- Production tables — untouched

## Migration Strategy

1. Implement `genkit/src/tools/warrantGroups.ts` — query for multi-warrant plant+attribute groups
2. Implement `genkit/src/tools/writeConflict.ts` — insert conflict records
3. Update `genkit/src/tools/index.ts` — add new tool exports
4. Implement `genkit/src/flows/classifyConflictFlow.ts` — classification flow with LLM + routing
5. Test with `dryRun: true` on a small set of plant IDs
6. Verify conflict types and severity assignments make sense
7. Test write path with `dryRun: false` on same small set
8. Verify conflicts appear in `conflicts` table with correct foreign keys

## Files Modified

### New Files
- `genkit/src/tools/warrantGroups.ts` — warrant group query tool
- `genkit/src/tools/writeConflict.ts` — conflict record writer tool
- `genkit/src/flows/classifyConflictFlow.ts` — conflict classification flow

### Modified Files
- `genkit/src/tools/index.ts` — add new tool exports

### Unchanged
- All existing tools and flows
- DoltgreSQL schema — no table changes (only data inserts to `conflicts`)
- Source datasets — not read in this task

## Verification

1. **Warrant groups found:**
   ```typescript
   const groups = await getWarrantGroups({ mode: 'internal', minGroupSize: 2 });
   // groups.totalGroups > 0 (we know from bootstrap that multi-warrant groups exist)
   // Mahonia aquifolium should appear with 18 warrants for Flammability
   ```

2. **Dry run produces valid classifications:**
   ```typescript
   const result = await classifyConflictFlow({
     mode: 'internal',
     plantIds: ['<mahonia_aquifolium_id>'],
     dryRun: true
   });
   // result.conflicts.length > 0
   // Each conflict has a valid conflictType from the taxonomy
   // Each conflict has severity and specialistRoute
   ```

3. **Write path creates conflict records:**
   ```typescript
   const result = await classifyConflictFlow({
     mode: 'internal',
     plantIds: ['<mahonia_aquifolium_id>'],
     dryRun: false
   });
   // Verify in DB:
   // SELECT COUNT(*) FROM conflicts WHERE plant_id = '<mahonia_aquifolium_id>';
   // Should match result.conflicts.length
   ```

4. **Conflict records have valid foreign keys:**
   ```sql
   SELECT c.id, c.conflict_type, c.severity,
          w1.value AS value_a, w2.value AS value_b
   FROM conflicts c
   JOIN warrants w1 ON w1.id = c.warrant_a_id
   JOIN warrants w2 ON w2.id = c.warrant_b_id
   LIMIT 5;
   -- All joins should succeed (no orphaned FKs)
   ```

5. **Corroboration and complementary counts are reasonable:**
   ```typescript
   // result.corroborated > 0 (many warrants should agree)
   // result.summary.total + result.corroborated + result.complementary ≈ total groups
   ```
