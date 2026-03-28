# Internal Conflict Scan — First Demo-Worthy Result

> **Status:** TODO
> **Priority:** P0 (critical)
> **Depends on:** 006-conflict-classifier-agent (classifyConflictFlow must exist)
> **Blocks:** Admin portal dashboard (needs conflict data to display)

## Problem

The production database has 94,903 values from 103 sources — and some of those sources disagree with each other. These are **internal conflicts**: contradictions already present in the production data. Finding them is the first demo-worthy result because it proves the Claim/Warrant model is working and surfaces real data quality issues.

From the bootstrap step, we know conflict candidates exist: Mahonia aquifolium has 18 warrants for Flammability alone, Penstemon spp. has 15. This task runs the Conflict Classifier across ALL bootstrapped warrants to build the full internal conflict inventory.

## Current Implementation

### What Exists
- 94,903 warrants in `warrants` table (all `warrant_type: 'existing'`)
- Empty `conflicts` table
- `classifyConflictFlow` from 006-conflict-classifier-agent
- `getWarrantGroups` and `writeConflict` tools
- `analysis_batches` table with one record (the bootstrap batch)

### What Does NOT Exist Yet
- Any conflict records
- Internal scan batch record
- Summary statistics for dashboard

## Proposed Changes

### 1. Internal Scan Script

`genkit/src/scripts/internal-conflict-scan.ts`:

A runnable script that:

1. **Creates an analysis batch:**
   ```sql
   INSERT INTO analysis_batches (id, source_dataset, source_id_code, batch_type, status, started_at)
   VALUES ($1, 'LivingWithFire-DB', 'INTERNAL', 'internal_scan', 'running', NOW());
   ```

2. **Queries all warrant groups** with 2+ warrants per plant+attribute:
   ```sql
   SELECT plant_id, attribute_id, plant_genus, plant_species, attribute_name, COUNT(*) as cnt
   FROM warrants
   WHERE warrant_type = 'existing' AND status != 'excluded'
   GROUP BY plant_id, attribute_id, plant_genus, plant_species, attribute_name
   HAVING COUNT(*) >= 2
   ORDER BY cnt DESC;
   ```

3. **Runs `classifyConflictFlow`** in `internal` mode across all groups:
   - Process in batches (e.g., 50 plant IDs at a time)
   - Log progress: `Batch 3/N: processing plants 101-150, X conflicts found so far...`
   - Write conflicts to DB after each batch

4. **Updates the analysis batch** with results:
   ```sql
   UPDATE analysis_batches SET
     status = 'completed',
     completed_at = NOW(),
     total_source_records = <total_warrant_groups>,
     warrants_created = 0,
     conflicts_detected = <total_conflicts>,
     notes = 'Internal scan: X conflicts across Y plants (Z critical, W moderate, V minor)'
   WHERE id = $1;
   ```

5. **Commits to Dolt:**
   ```sql
   SELECT dolt_add('.');
   SELECT dolt_commit('-m', 'internal scan: X conflicts detected across Y plants');
   ```

6. **Generates summary report** to console:
   ```
   === Internal Conflict Scan Complete ===

   Warrant groups scanned:    1,234
   Corroborated (agreement):    890
   Complementary (additions):   120
   Conflicts detected:          224

   By severity:
     Critical:   45
     Moderate:  112
     Minor:      67

   By type:
     Rating Disagreement:      38
     Scale Mismatch:           52
     Scope Difference:         41
     Temporal Conflict:        23
     Methodology Difference:   31
     Granularity Mismatch:     15
     Definition Conflict:      18
     Completeness Conflict:     6

   Top conflicted plants:
     1. Mahonia aquifolium      — 12 conflicts
     2. Juniperus scopulorum    —  8 conflicts
     3. Ceanothus velutinus     —  7 conflicts
     ...

   Top conflicted attributes:
     1. Flammability            — 34 conflicts
     2. Deer Tolerance          — 28 conflicts
     3. Water Use               — 19 conflicts
     ...
   ```

### 2. Summary Stats Query

After the scan, the script also creates a summary view or outputs a JSON file at `genkit/output/internal-scan-summary.json` that the future dashboard can consume:

```typescript
{
  scanDate: string,
  batchId: string,
  doltCommitHash: string,
  totalWarrantGroups: number,
  corroborated: number,
  complementary: number,
  totalConflicts: number,
  bySeverity: { critical: number, moderate: number, minor: number },
  byType: Record<string, number>,
  topConflictedPlants: Array<{ genus: string, species: string, conflictCount: number }>,
  topConflictedAttributes: Array<{ name: string, conflictCount: number }>
}
```

### What Does NOT Change

- `warrants` table — read-only (conflicts reference warrants but don't modify them)
- Production tables — untouched
- Existing tools and flows — used but not modified
- Source datasets — not read

## Migration Strategy

1. Write `genkit/src/scripts/internal-conflict-scan.ts`
2. Add npm script: `"internal-scan": "tsx src/scripts/internal-conflict-scan.ts"` in `genkit/package.json`
3. Ensure DoltgreSQL is running with bootstrapped warrants
4. Run the scan: `cd genkit && npm run internal-scan`
5. Monitor progress (batched, logged)
6. Verify conflict records in DB
7. Verify Dolt commit
8. Review summary output — spot check top conflicts for reasonableness

## Files Modified

### New Files
- `genkit/src/scripts/internal-conflict-scan.ts` — the scan script
- `genkit/output/internal-scan-summary.json` — summary stats output

### Modified Files
- `genkit/package.json` — add `"internal-scan"` npm script

### Unchanged
- All tools and flows — used but not modified
- DoltgreSQL schema — no table changes (only data inserts to `conflicts` and `analysis_batches`)

## Verification

1. **Conflicts written to DB:**
   ```sql
   SELECT COUNT(*) FROM conflicts;
   -- Should be > 0 (expect dozens to hundreds based on 94,903 warrants)
   ```

2. **All conflicts have valid types:**
   ```sql
   SELECT conflict_type, COUNT(*) FROM conflicts GROUP BY conflict_type;
   -- All types should be from the taxonomy (no unknown types)
   ```

3. **All conflicts have valid severity:**
   ```sql
   SELECT severity, COUNT(*) FROM conflicts GROUP BY severity;
   -- Only 'critical', 'moderate', 'minor'
   ```

4. **All conflicts reference valid warrants:**
   ```sql
   SELECT COUNT(*) FROM conflicts c
   WHERE NOT EXISTS (SELECT 1 FROM warrants w WHERE w.id = c.warrant_a_id)
      OR NOT EXISTS (SELECT 1 FROM warrants w WHERE w.id = c.warrant_b_id);
   -- Expected: 0
   ```

5. **Analysis batch record updated:**
   ```sql
   SELECT * FROM analysis_batches WHERE source_id_code = 'INTERNAL';
   -- status = 'completed', conflicts_detected > 0
   ```

6. **Dolt commit exists:**
   ```sql
   SELECT * FROM dolt_log ORDER BY date DESC LIMIT 1;
   -- Message should contain 'internal scan'
   ```

7. **Summary JSON written:**
   - File exists at `genkit/output/internal-scan-summary.json`
   - Contains all expected fields
   - Numbers match DB queries above

8. **Spot check top conflict:**
   ```sql
   -- Look at the highest-conflict plant
   SELECT c.plant_name, c.attribute_name, c.conflict_type, c.severity,
          c.value_a, c.value_b, c.source_a, c.source_b
   FROM conflicts c
   WHERE c.plant_name LIKE '%Mahonia%'
   ORDER BY c.severity;
   -- Review: do these look like real conflicts?
   ```
