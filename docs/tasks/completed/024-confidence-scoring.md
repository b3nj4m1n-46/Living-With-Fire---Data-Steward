# Confidence Scoring — Per-Source Reliability Weights

> **Status:** COMPLETE — commit `5c95d96`
> **Priority:** P2 (normal)
> **Depends on:** 015-synthesis-agent (claims already have HIGH/MODERATE/LOW confidence), 012-warrant-claim-curation (warrant cards show source info)
> **Blocks:** None

## Problem

Claims currently have a per-claim confidence level (HIGH/MODERATE/LOW) assigned by the synthesis agent based on warrant agreement. But all sources are treated as equally reliable, which they're not:

- A 20-year USDA field study is more reliable than a single-author blog post
- A peer-reviewed meta-analysis carries more weight than a regional extension bulletin
- Sources covering Oregon specifically are more relevant than national averages for Oregon plants

The synthesis agent can't make these distinctions because it has no structured reliability metadata for each source. Data stewards intuitively know which sources to trust but have no way to encode that knowledge into the system.

From the PRD (P2): "Confidence Scoring — Weight source reliability based on methodology type."

## Current Implementation

### What Exists
- `sources` table in production with `id`, `name`, `notes` — no reliability fields
- `data-sources/DATA-PROVENANCE.md` — source citations with methodology descriptions (text, not structured)
- Each dataset's `README.md` describes methodology, geographic scope, and sample size
- `warrants` table has `source_id_code` linking to source metadata
- `synthesizeClaimFlow` builds prompts that include source info but treats all sources equally
- Claims have `confidence` field (HIGH/MODERATE/LOW) and `confidence_reasoning`
- Specialist flows analyze source methodologies ad-hoc during conflict resolution

### What Does NOT Exist Yet
- Structured reliability metadata per source (methodology type, sample size, geographic scope, peer review status)
- Source reliability score (numeric weight)
- Synthesis agent integration with source weights
- UI for data steward to set/override source reliability

## Proposed Changes

### 1. Source Reliability Schema

Add columns to a new `source_reliability` table in DoltgreSQL (or extend `sources` mirror):

```sql
CREATE TABLE source_reliability (
  source_id_code VARCHAR(20) PRIMARY KEY,       -- e.g., FIRE-01
  methodology_type VARCHAR(50),                  -- experimental, literature_review, expert_opinion, meta_analysis, field_observation, modeling
  peer_reviewed BOOLEAN DEFAULT false,
  sample_size VARCHAR(20),                       -- numeric or 'unknown'
  geographic_scope VARCHAR(100),                 -- e.g., 'Pacific Northwest', 'California', 'National'
  geographic_specificity VARCHAR(20),            -- local, regional, national, global
  temporal_currency VARCHAR(20),                 -- current (≤5yr), recent (5-15yr), dated (>15yr)
  publication_year INTEGER,
  reliability_score NUMERIC(3,2) DEFAULT 0.50,   -- 0.00 to 1.00
  reliability_reasoning TEXT,                     -- steward's justification
  auto_score NUMERIC(3,2),                       -- AI-suggested score (before steward override)
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by VARCHAR(100) DEFAULT 'system'
);
```

**Scoring formula (auto-calculated, steward-overridable):**

| Factor | Weight | Values |
|--------|--------|--------|
| Methodology | 0.30 | meta_analysis=1.0, experimental=0.9, field_observation=0.7, literature_review=0.6, expert_opinion=0.4, modeling=0.5 |
| Peer Review | 0.20 | yes=1.0, no=0.3 |
| Sample Size | 0.15 | >1000=1.0, 100-1000=0.7, <100=0.4, unknown=0.5 |
| Geographic Specificity | 0.20 | local=1.0, regional=0.8, national=0.5, global=0.3 |
| Temporal Currency | 0.15 | current=1.0, recent=0.7, dated=0.4 |

### 2. Source Reliability UI

`admin/src/app/sources/reliability/page.tsx`:

**Source Reliability Table:**

| Source | Methodology | Peer Reviewed | Sample Size | Scope | Currency | AI Score | Steward Score |
|--------|------------|---------------|-------------|-------|----------|----------|---------------|
| FIRE-01 | Literature Review | No | 200+ | Idaho | Recent | 0.58 | 0.65 |
| FIRE-04 | Meta-Analysis | Yes | 5000+ | National | Current | 0.89 | — |

- Editable inline — click a cell to change methodology type, toggle peer review, etc.
- "Auto-Score" button per row → recalculates based on formula
- "Auto-Score All" button → batch calculate for all sources
- Steward score overrides auto score when set
- "AI Suggest" button → uses Anthropic to read the source's README.md + DATA-DICTIONARY.md and suggest metadata values

### 3. Synthesis Integration

Modify the synthesis prompt to include source reliability:

When `synthesizeClaimFlow` builds its prompt, include a source reliability section:

```
Source Reliability Scores:
- FIRE-01 (Idaho Fire-Resistant Plants): 0.65 — Literature review, regional scope, not peer-reviewed
- FIRE-04 (FireWise Plant Database): 0.89 — Meta-analysis, peer-reviewed, 5000+ plants
- WATER-01 (WUCOLS): 0.82 — Field observation, peer-reviewed, California regional

Weight your synthesis toward higher-reliability sources. When sources conflict, prefer the source with higher reliability unless the lower-reliability source has stronger geographic specificity for the plant's region.
```

The synthesis agent already produces `warrant_weights` (primary/supporting/contextual) — source reliability should inform these weights.

### 4. API Routes

`admin/src/app/api/sources/reliability/route.ts`:
- GET — list all source reliability records
- PATCH — update reliability metadata for a source

`admin/src/app/api/sources/reliability/auto-score/route.ts`:
- POST — calculate auto-scores for specified sources (or all)
- Input: `{ sourceIds?: string[] }` (empty = all)

`admin/src/app/api/sources/reliability/ai-suggest/route.ts`:
- POST — AI reads source README + DATA-DICTIONARY and suggests metadata values
- Input: `{ sourceIdCode: string }`
- Response: `{ suggestions: { methodology_type, peer_reviewed, sample_size, geographic_scope, ... } }`

### 5. Conflict Queue Enhancement

In the conflict detail view, show reliability scores for both sources:

```
Source A: FIRE-01 (reliability: 0.65) — Literature review, Idaho regional
Source B: FIRE-04 (reliability: 0.89) — Meta-analysis, national, peer-reviewed
```

This gives the data steward immediate context for resolution decisions.

### What Does NOT Change

- Production database schema — reliability is staging-side only
- Claim approval workflow — confidence is still set by synthesis, not overridden by reliability
- Existing warrant data — warrants are not modified
- Conflict detection — conflicts are detected regardless of source reliability
- `external-analysis.ts` — pipeline doesn't use reliability scores (those inform curation, not ingestion)

## Migration Strategy

1. Create `source_reliability` table in DoltgreSQL
2. Write seed script to populate initial reliability records for all ~50 known sources (auto-score from DATA-PROVENANCE.md metadata)
3. Create `/api/sources/reliability` CRUD routes
4. Create `/api/sources/reliability/ai-suggest` route
5. Build reliability table UI with inline editing
6. Modify `admin/src/app/api/synthesize/route.ts` to include reliability scores in the synthesis prompt
7. Add reliability badges to conflict detail view
8. Add reliability badges to warrant cards in claim view
9. Test: set FIRE-01 reliability to 0.3, FIRE-04 to 0.9 → synthesize a claim → verify synthesis favors FIRE-04

## Files Modified

### New Files
- `admin/src/app/sources/reliability/page.tsx` — reliability management page
- `admin/src/app/sources/reliability/reliability-client.tsx` — editable table client component
- `admin/src/app/api/sources/reliability/route.ts` — CRUD for reliability records
- `admin/src/app/api/sources/reliability/auto-score/route.ts` — auto-calculate scores
- `admin/src/app/api/sources/reliability/ai-suggest/route.ts` — AI metadata suggestion
- `admin/src/lib/queries/reliability.ts` — reliability query functions
- `genkit/src/scripts/seed-reliability.ts` — initial data population

### Modified Files
- `admin/src/app/api/synthesize/route.ts` — include reliability in synthesis prompt
- `admin/src/app/conflicts/page.tsx` or conflict detail component — show reliability badges
- `admin/src/components/warrant-card.tsx` — show source reliability badge

## Verification

1. **Reliability table renders all sources:**
   ```sql
   SELECT COUNT(*) FROM source_reliability;
   ```
   Should match count of distinct `source_id_code` values across warrants

2. **Auto-score calculation is correct:**
   - Source with methodology=meta_analysis, peer_reviewed=true, sample_size=5000, scope=national, currency=current
   - Expected: 0.30×1.0 + 0.20×1.0 + 0.15×1.0 + 0.20×0.5 + 0.15×1.0 = 0.85
   - UI should show 0.85

3. **Steward override persists:**
   - Set FIRE-01 reliability to 0.75 → save → reload → still 0.75
   - Auto-score shows different value → steward override takes precedence

4. **AI suggestion is reasonable:**
   - Run AI suggest for FIRE-01 → should identify "literature review" from README
   - Should detect geographic scope from dataset description

5. **Synthesis uses reliability:**
   - Create two warrants from sources with very different reliability
   - Synthesize → `confidence_reasoning` should reference source reliability
   - `warrant_weights` should assign "primary" to higher-reliability source

6. **Conflict view shows reliability:**
   - Open a conflict between two sources → both reliability scores visible
   - Higher-reliability source is visually distinguished
