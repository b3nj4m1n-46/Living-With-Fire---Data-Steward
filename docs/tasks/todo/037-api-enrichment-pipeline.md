# API Enrichment Pipeline — Fill Coverage Gaps from External Plant APIs

> **Status:** IN PROGRESS
> **Priority:** P1 (important)
> **Depends on:** 003-bootstrap-warrants, 018-production-sync
> **Blocks:** Full attribute coverage for production plants

## Problem

Out of 1,361 production plants, most attributes have very low coverage:

| Attribute | Plants with data | Coverage |
|---|---|---|
| Native Status | 15 | 1% |
| Edible Plant | 4 | 0.3% |
| Bark | 5 | 0.4% |
| Leaf Structure | 35 | 3% |
| Habit/Form | 31 | 2% |
| Plant Structure (booleans) | ~30 | 2% |
| Flower Color | 89 | 7% |
| Bloom Time | 87 | 6% |
| Deciduous/Evergreen | ~20 | 1.5% |

Multiple external APIs have this data already. Rather than manually entering values for 1,361 plants, we can query APIs programmatically and create warrants through the existing Claim/Warrant curation pipeline.

## Current Implementation

The fusion pipeline (`genkit/src/scripts/external-analysis.ts`) processes CSV-based source datasets through: match → map → enhance → classify. This works well for static datasets but doesn't support live API queries.

The admin portal's enrichment UI (`/coverage`) shows attribute gaps and suggests source databases that might fill them, but has no mechanism to query external APIs.

## Proposed Changes

### Pattern: API Enrichment Script

Each API integration is a standalone script in `genkit/src/scripts/` that:

1. Reads production plants from Neon (genus + species)
2. Queries the external API for each plant
3. Maps API response fields to LWF attribute UUIDs
4. Writes warrants into Dolt with `warrant_type: "external"` and `source_id_code` identifying the API
5. Creates a Dolt commit and `analysis_batches` record

Warrants then flow through the normal curation pipeline: review on claims page, synthesize, approve, sync to production.

### API Sources

#### Phase 1: Trefle (DONE)

**Script:** `genkit/src/scripts/trefle-enrich.ts`
**API:** `https://trefle.io/api/v1/species/{slug}`
**Token:** `TREFLE_TOKEN` env var
**Source ID:** `TREFLE`

Fields mapped:

| Trefle Field | LWF Attribute | LWF UUID |
|---|---|---|
| `distribution.native` | Native Status | `716f3d8f-195f-4d16-824b-6dd1e88767a6` |
| `edible` | Edible Plant | `4afa9fb3-dd3c-4f46-bd99-5b584dc10605` |
| `specifications.growth_habit` | Shrub/Tree/Vine/Graminoid/Groundcover | (boolean attrs) |
| `foliage.leaf_retention` | Deciduous / Evergreen | `fee87734...` / `f2ed9581...` |
| `flower.color` | Flower Color | `86a95833-886a-42bf-b149-c3754e9d913a` |

Usage:
```bash
cd genkit
npx tsx src/scripts/trefle-enrich.ts --dry-run --limit 10   # test
npx tsx src/scripts/trefle-enrich.ts                         # full run
```

#### Phase 2: USDA PLANTS API (TODO)

**API:** `https://plantsservices.sc.egov.usda.gov/api/`
**Source ID:** `USDA_API`

Potential fields:
- Native/introduced status by state (OR, CA, WA)
- Growth habit, duration (annual/perennial)
- USDA symbol (cross-reference key)
- Federal/state noxious weed status

#### Phase 3: GBIF (TODO)

**API:** `https://api.gbif.org/v1/species/match`
**Source ID:** `GBIF`

Potential fields:
- Taxonomic backbone validation (accepted name, synonyms)
- Distribution records with occurrence counts
- Habitat classifications

#### Phase 4: iNaturalist (TODO)

**API:** `https://api.inaturalist.org/v1/taxa`
**Source ID:** `INAT`

Potential fields:
- Conservation status
- Native/introduced per place
- Community-verified photo IDs
- Observation counts (indicator of availability/commonality)

### What Does NOT Change

- Production database schema — no new tables or columns
- Warrant/Claim/Conflict data model — API warrants use the same structure
- Sync pipeline — approved claims push to production the same way
- Admin portal UI — warrants appear in claims view like any other source

## Migration Strategy

1. **[DONE]** Build Trefle enrichment script with dry-run support
2. **[DONE]** Add TREFLE_TOKEN to `.env`
3. Run Trefle enrichment: `npx tsx src/scripts/trefle-enrich.ts`
4. Review warrants in admin portal claims view
5. Build USDA PLANTS enrichment script (same pattern)
6. Build GBIF enrichment script
7. Build iNaturalist enrichment script
8. Consider admin UI for triggering enrichment runs

## Files Modified

### New Files
- `genkit/src/scripts/trefle-enrich.ts` — Trefle API enrichment (DONE)
- `genkit/src/scripts/usda-enrich.ts` — USDA PLANTS API enrichment (TODO)
- `genkit/src/scripts/gbif-enrich.ts` — GBIF API enrichment (TODO)
- `genkit/src/scripts/inat-enrich.ts` — iNaturalist API enrichment (TODO)

### Modified Files
- `.env` — API tokens for each service

## Verification

After running each enrichment script:
1. `SELECT COUNT(*) FROM warrants WHERE source_id_code = 'TREFLE'` — should have warrants
2. Check admin portal `/claims` — filter by TREFLE source, verify values are decoded and meaningful
3. Approve a sample claim, sync to production, verify the value appears on the plant detail page
4. Check coverage dashboard — attribute coverage percentages should increase
