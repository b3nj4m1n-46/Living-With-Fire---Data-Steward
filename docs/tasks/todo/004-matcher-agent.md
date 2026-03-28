# Matcher Agent — Plant Name Resolution with Synonym + Fuzzy Matching

> **Status:** TODO
> **Priority:** P0 (critical)
> **Depends on:** 002-genkit-setup (Genkit tools + DoltgreSQL connection)
> **Blocks:** 009-first-external-analysis (can't create warrants without plant matches)

## Problem

When a source dataset like FirePerformancePlants (FIRE-01) lists "Amelanchier laevis", we need to determine: does this plant already exist in the production database? If so, which `plant_id`? Without reliable matching, warrants can't be linked to production plants, and the entire pipeline stalls.

Matching is harder than exact string comparison because:
- Taxonomy changes over time (e.g., `Mahonia aquifolium` → `Berberis aquifolium`)
- Sources may use outdated synonyms
- Cultivar names vary (`Acer macrophyllum 'Seattle Sentinel'` vs `Acer macrophyllum`)
- Some sources only provide genus-level data (`Acer spp.`)
- Typos and formatting differences exist across sources

## Current Implementation

### What Exists
- `lookupProductionPlant` Genkit tool (`genkit/src/tools/lookupPlant.ts`) — exact genus+species lookup against staging DB, returns plant record + all values
- `queryDolt` tool (`genkit/src/tools/dolt.ts`) — parameterized SQL against DoltgreSQL
- DoltgreSQL staging DB with 1,361 production plants
- 3 taxonomy backbones in `database-sources/taxonomy/`:
  - `POWO_WCVP` — 362,739 records with accepted names + synonyms
  - `WorldFloraOnline` — 381,467 records for cross-validation
  - `USDA_PLANTS` — 93,157 records with US common names
- Genkit config with model constants (`genkit/src/config.ts`): `MODELS.bulk = 'anthropic/claude-haiku-4-5'`

### What Does NOT Exist Yet
- `matchPlantFlow` Genkit flow
- Synonym resolution tool (queries taxonomy DBs)
- Fuzzy match fallback
- Any flow definitions in `genkit/src/flows/`

## Proposed Changes

### 1. Synonym Resolution Tool

`genkit/src/tools/resolveSynonym.ts`:

A Genkit tool that checks the taxonomy backbone databases for accepted names and synonyms.

```typescript
// Genkit tool: resolveSynonym
// Input: { scientificName: string }
// Output: {
//   acceptedName: { genus: string, species: string, authority: string } | null,
//   synonymOf: string | null,       // if input is a synonym, the accepted name
//   source: 'POWO_WCVP' | 'WorldFloraOnline' | 'USDA_PLANTS' | null,
//   confidence: number              // 0.0-1.0
// }
```

Query strategy (try in order, stop on first match):
1. **POWO_WCVP** (`database-sources/taxonomy/POWO_WCVP/plants.db`):
   - Check if input matches an accepted name: `SELECT * FROM plants WHERE scientific_name = $1 AND taxonomic_status = 'Accepted'`
   - Check if input is a synonym: `SELECT * FROM plants WHERE scientific_name = $1 AND taxonomic_status = 'Synonym'` → follow `accepted_name_id` to get the accepted name
2. **WorldFloraOnline** (`database-sources/taxonomy/WorldFloraOnline/plants.db`):
   - Same pattern as POWO but different column names — check DATA-DICTIONARY.md
3. **USDA_PLANTS** (`database-sources/taxonomy/USDA_PLANTS/plants.db`):
   - Check `scientific_name` column

**Important:** These are SQLite databases (`.db`), not DoltgreSQL. Use the `better-sqlite3` package (synchronous, fast) to query them directly. Do NOT try to query them through the DoltgreSQL pool.

```bash
cd genkit && npm install better-sqlite3
npm install -D @types/better-sqlite3
```

### 2. Fuzzy Match Tool

`genkit/src/tools/fuzzyMatch.ts`:

A Genkit tool that finds close matches when exact and synonym lookups fail.

```typescript
// Genkit tool: fuzzyMatchPlant
// Input: { genus: string, species?: string, limit?: number }
// Output: {
//   candidates: Array<{
//     plantId: string,
//     genus: string,
//     species: string,
//     commonName: string,
//     similarity: number,  // 0.0-1.0 Levenshtein-based
//     matchReason: string  // e.g. "genus exact, species 1 edit away"
//   }>
// }
```

Implementation:
- Query all plants from staging DB with same genus (exact match on genus first)
- Compute Levenshtein distance on species within that genus
- If genus doesn't match exactly, compute Levenshtein on full `genus + ' ' + species`
- Use `fastest-levenshtein` npm package (fastest JS implementation)
- Return top N candidates (default 5) sorted by similarity

```bash
cd genkit && npm install fastest-levenshtein
```

### 3. Match Plant Flow

`genkit/src/flows/matchPlantFlow.ts`:

The main Genkit flow that orchestrates matching for a batch of source plants.

```typescript
// Genkit flow: matchPlantFlow
// Model: MODELS.bulk (Haiku 4.5) — only used for ambiguous cases
// Input: {
//   plants: Array<{
//     sourceRowId: string | number,
//     scientificName: string,
//     commonName?: string,
//     sourceDataset: string
//   }>,
//   options?: {
//     fuzzyThreshold?: number,     // minimum similarity for fuzzy matches (default 0.85)
//     includeGenusOnly?: boolean   // whether to match genus-level entries (default true)
//   }
// }
// Output: {
//   matches: Array<{
//     sourceRowId: string | number,
//     inputName: string,
//     matchType: 'EXACT' | 'SYNONYM' | 'CULTIVAR' | 'GENUS_ONLY' | 'FUZZY' | 'NONE',
//     confidence: number,
//     productionPlantId: string | null,
//     productionGenus: string | null,
//     productionSpecies: string | null,
//     synonymResolution?: { originalName: string, acceptedName: string, source: string },
//     alternativeCandidates?: Array<{ plantId: string, genus: string, species: string, similarity: number }>,
//     notes: string
//   }>,
//   summary: {
//     total: number,
//     exact: number,
//     synonym: number,
//     cultivar: number,
//     genusOnly: number,
//     fuzzy: number,
//     noMatch: number
//   }
// }
```

#### Matching Algorithm (per plant):

1. **Parse scientific name** — split into genus + species + subspecies/cultivar parts
2. **Exact match** — call `lookupProductionPlant({ genus, species })`
   - If found → `matchType: 'EXACT'`, `confidence: 1.0`
3. **Synonym resolution** — call `resolveSynonym({ scientificName })`
   - If synonym found → look up accepted name via `lookupProductionPlant`
   - If found → `matchType: 'SYNONYM'`, `confidence: 0.95`
4. **Cultivar fallback** — if input has cultivar info, try matching without it (just genus+species)
   - If found → `matchType: 'CULTIVAR'`, `confidence: 0.90`
5. **Genus-only match** — if only genus provided or species doesn't match, check if genus exists
   - If found → `matchType: 'GENUS_ONLY'`, `confidence: 0.50`
6. **Fuzzy match** — call `fuzzyMatchPlant({ genus, species })`
   - If best candidate > threshold → `matchType: 'FUZZY'`, `confidence: similarity * 0.9`
7. **No match** — `matchType: 'NONE'`, `confidence: 0.0`

**AI is only invoked** for ambiguous cases where multiple candidates exist with similar confidence scores. The LLM is asked to pick the best match given common name context and botanical knowledge. This keeps API costs low for bulk operations.

### 4. Test Script

`genkit/src/scripts/test-matcher.ts`:

Test against FirePerformancePlants (FIRE-01, 541 plants):
1. Read `database-sources/fire/FirePerformancePlants/plants.csv`
2. Parse `scientific_name` column
3. Run `matchPlantFlow` on all 541 plants
4. Print summary stats and examples of each match type
5. Verify: majority should be EXACT matches since FIRE-01 is already a production source

### What Does NOT Change

- DoltgreSQL schema — no table changes
- Taxonomy SQLite databases — read-only
- Existing Genkit tools — no modifications
- `genkit/src/config.ts` — no changes

## Migration Strategy

1. Install new dependencies: `better-sqlite3`, `@types/better-sqlite3`, `fastest-levenshtein`
2. Implement `genkit/src/tools/resolveSynonym.ts` — synonym lookup against taxonomy SQLite DBs
3. Implement `genkit/src/tools/fuzzyMatch.ts` — Levenshtein-based fuzzy matching
4. Update `genkit/src/tools/index.ts` — add new tools to exports and `allTools`
5. Implement `genkit/src/flows/matchPlantFlow.ts` — orchestration flow with 7-step algorithm
6. Write test script `genkit/src/scripts/test-matcher.ts`
7. Run test against FirePerformancePlants (541 plants)
8. Verify match summary: expect high EXACT rate, some SYNONYM, few NONE

## Files Modified

### New Files
- `genkit/src/tools/resolveSynonym.ts` — synonym resolution tool
- `genkit/src/tools/fuzzyMatch.ts` — fuzzy match tool
- `genkit/src/flows/matchPlantFlow.ts` — main matching flow
- `genkit/src/scripts/test-matcher.ts` — test script

### Modified Files
- `genkit/src/tools/index.ts` — add new tool exports
- `genkit/package.json` — add `better-sqlite3`, `fastest-levenshtein` dependencies

### Unchanged
- `genkit/src/config.ts` — no changes
- All existing tools — no modifications
- DoltgreSQL database — read-only in this task
- Taxonomy databases — read-only

## Verification

1. **Synonym resolution works:**
   ```typescript
   const result = await resolveSynonym({ scientificName: 'Mahonia aquifolium' });
   // Should resolve to Berberis aquifolium (or vice versa depending on backbone)
   ```

2. **Fuzzy match works:**
   ```typescript
   const result = await fuzzyMatchPlant({ genus: 'Ceanothus', species: 'velutinus' });
   // Should return exact or near-exact match with high similarity
   ```

3. **Full flow against FIRE-01:**
   ```typescript
   // Run matchPlantFlow on all 541 FirePerformancePlants
   // Expected: >80% EXACT, remainder split across SYNONYM/CULTIVAR/GENUS_ONLY/FUZZY/NONE
   // Zero crashes, all 541 plants processed
   ```

4. **Known synonym resolves:**
   ```typescript
   // Test a known synonym pair from the taxonomy backbones
   const match = matches.find(m => m.matchType === 'SYNONYM');
   // Should have at least one synonym resolution with source backbone identified
   ```

5. **No-match plants are reasonable:**
   ```typescript
   // Review NONE matches — should be plants genuinely absent from production DB
   const noMatches = matches.filter(m => m.matchType === 'NONE');
   // Manual spot check: are these plants really not in the 1,361 production plants?
   ```
