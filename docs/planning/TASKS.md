# Task Checklist: 48-Hour Hackathon

## Phase 0: Pre-Hackathon Preparation

### Pre-Hackathon Setup
- [x] **T00a** ~~Verify Ollama running with `qwen3:32b`~~ — **Dropped:** Ollama too slow; using cloud APIs (Anthropic) instead
- [ ] **T00b** (10 min) Verify all 40 dataset DATA-DICTIONARY.md files exist and are readable
- [ ] **T00c** (5 min) Verify LivingWithFire-DB api-reference/ files are current (re-fetch from API if needed)

> **Knowledge Base RAG (PageIndex) is Phase 2.** For the hackathon, agents use DATA-DICTIONARY.md + README.md as research context. If PageIndexAlt is ready, it can be wired in as a bonus.

---

## Phase 1: Data Layer Setup (Day 1, 4 hrs)

### Dolt Database — ✅ COMPLETED (`3f87073`)
- [x] **T01** Install DoltgreSQL v0.55.6 (PostgreSQL wire protocol, not MySQL)
- [x] **T02** Init database `lwf_staging`, create schema for all 13 production tables
- [x] **T03** Import all 13 production CSVs (not just 4 core — includes nurseries, key_terms, etc.)
- [x] **T04** Create Claim/Warrant tables (warrants, conflicts, claims, claim_warrants, analysis_batches)
- [x] **T05** Create indexes on key columns
- [x] **T06** Initial Dolt commit: `f3imeuite70s1bh1vcmni8nhg6em7oun`
- [x] **T07** DoltgreSQL server on port 5433, verified via `psql`

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/001-dolt-setup.md`
> **Note:** Used DoltgreSQL (PostgreSQL protocol) instead of Dolt (MySQL protocol). Schema corrections documented in task spec — `sources` table has 12 cols not 7, `"values"` requires quoting, ENUMs replaced with VARCHAR.

### Genkit Setup — ✅ COMPLETED (`5e9ea2b`)
- [x] **T08** Initialize Genkit project in `genkit/` with ESM (`"type": "module"`), deps: genkit, @genkit-ai/anthropic, zod, pg
- [x] **T09** Configured Anthropic plugin (conditional init — works without API key for DB-only testing). Models: Haiku 4.5 (bulk), Sonnet 4.6 (quality)
- [x] **T10** Created shared tools: `lookupProductionPlant`, `getDatasetContext`, `getSourceMetadata` + barrel export with `allTools`
- [x] **T11** Created `queryDolt` tool with `pg` pool on port 5433, parameterized SQL

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/002-genkit-setup.md`
> **Note:** DoltgreSQL compatibility gotchas documented — no ILIKE, no LEFT JOIN on nullable FKs, must quote `"values"`. Smoke test script at `genkit/src/test-tools.ts`.

### Bootstrap Existing Warrants — ✅ COMPLETED (`820b50b`)
- [x] **T12** Converted 94,903 production values to warrants (`warrant_type: 'existing'`, `match_confidence: 1.00`). Used `COALESCE(value, source_value)` to preserve 26,889 boolean presence markers. Idempotent re-run support added.
- [x] **T13** Dolt commit: `"bootstrap: 94903 production values converted to warrants"`

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/003-bootstrap-warrants.md`
> **Note:** Source table columns differ from original spec (`notes`→methodology, `region`→region). DoltgreSQL LEFT JOIN bug workaround: sources loaded into in-memory Map. Internal conflict candidates found: Mahonia aquifolium (18 warrants/attribute), Penstemon spp. (15).

**Milestone: Lunch Day 1** — ~~Dolt running~~ ✅, ~~Genkit configured~~ ✅, ~~production values bootstrapped as warrants~~ ✅

---

## Phase 2: Pipeline Agents (Day 1, 4 hrs)

### Matcher Agent — ✅ COMPLETED (`ceb3ec7`)
- [x] **T14** Implement `matchPlantFlow` in Genkit: exact genus+species match against production
- [x] **T15** Add synonym resolution tool via POWO_WCVP/WFO lookup
- [x] **T16** Add fuzzy match fallback (Levenshtein)
- [x] **T17** Test against FirePerformancePlants (541 plants)

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/004-matcher-agent.md`
> **Note:** Three-tier matching: exact → synonym (POWO_WCVP/WFO) → fuzzy (Levenshtein). Cultivar stripping and genus-level `spp.` handling included.

### Schema Mapper Agent — ✅ COMPLETED (`7b8e812`)
- [x] **T18** Implement `mapSchemaFlow`: read DATA-DICTIONARY.md, suggest column→attribute mappings
- [x] **T19** Build rating scale crosswalk generator

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/005-schema-mapper-agent.md`
> **Note:** AI-driven mapping from source columns to 125 production attributes. Includes value transformation rules (e.g., integer rating codes → production display values).

### Conflict Classifier Agent — ✅ COMPLETED (`60a7ee1`)
- [x] **T20** Implement `classifyConflictFlow`: compare warrants per plant+attribute, classify conflict type
- [x] **T21** Implement severity scoring and specialist routing logic

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/006-conflict-classifier-agent.md`
> **Note:** Deterministic fast-path for corroboration/completeness + LLM-batched classification (Haiku 4.5). All 8 conflict types with specialist routing. Pairwise comparison capped at N=5 with mode-value anchor above that.

### Internal Conflict Scan — ✅ COMPLETED (`461743b`)
- [x] **T22** Run Conflict Classifier in `internal` mode across all bootstrapped warrants
- [x] **T23** Write conflicts to Dolt, commit: `"internal scan: X conflicts detected"`
- [x] **T24** Generate summary stats for dashboard (console report + JSON at `genkit/output/internal-scan-summary.json`)

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/007-internal-conflict-scan.md`
> **Note:** Single `classifyConflictFlow` call handles all pagination and LLM batching internally. Script adds batch tracking, Dolt commit, verification queries, and JSON summary output.

### Research Tools (Dataset Context + PageIndex) — ✅ COMPLETED (`80aa921`)
- [x] **T22a** Implement `getDatasetContext` Genkit tool: reads DATA-DICTIONARY.md + README.md for a dataset folder, returns structured metadata (rating scales, methodology, scope)
- [x] **T22b** Implement `searchDocumentIndex` Genkit tool: loads `knowledge-base/indexes/manifest.json`, searches all 47 document trees by keyword against section titles and summaries
- [x] **T22c** Implement `navigateDocumentTree` Genkit tool: given a document index file + node_id, returns that section's full summary and children
- [x] **T22d** Register all 3 tools with Research Agent and specialist agents
- [x] **T22e** Test: query "Ceanothus fire resistance methodology" → verify returns DATA-DICTIONARY context + matching PageIndex sections from Bethke and UC Forest Products Lab

> **Completed:** 2026-03-28 | **Task spec:** `docs/tasks/completed/008-research-tools.md`
> **Note:** Three tools: `getDatasetContext`, `searchDocumentIndex`, `navigateDocumentTree`. PageIndex RAG over 45+ pre-indexed knowledge base documents without vector embeddings.

### First External Analysis
- [ ] **T25** (30 min) Process FirePerformancePlants:
  - matchPlantFlow → bulkEnhanceFlow → classifyConflictFlow
  - Write warrants + conflicts to Dolt
- [ ] **T26** (10 min) Dolt commit: `"analysis: FIRE-01, X warrants, Y conflicts"`
- [ ] **T27** (30 min) Process WUCOLS (4,103 plants) — same pipeline
- [ ] **T28** (10 min) Dolt commit for WUCOLS

> **Depends on:** T14-T17 ✅, T18-T19 ✅, T20-T21

**Milestone: End of Day 1** — Internal conflicts detected, 2 datasets analyzed, warrants + conflicts in Dolt

---

## Phase 3: Admin Portal (Day 2, 4 hrs)

### Scaffold
- [ ] **T29** (15 min) `npx create-next-app` with TS, Tailwind, App Router
- [ ] **T30** (15 min) Install: shadcn/ui (table, card, badge, dialog, button, tabs, checkbox), pg
- [ ] **T31** (15 min) Create DoltgreSQL connection utility (`lib/dolt.ts`) — use `pg` client, port 5433
- [ ] **T32** (10 min) Create layout with nav: Dashboard, Claims, Warrants, Conflicts, History

### Dashboard
- [ ] **T33** (30 min) Dashboard page:
  - Summary cards (total warrants, pending conflicts, claims generated, datasets processed)
  - Analysis batches table
  - Conflict severity breakdown chart
  - Quick links to critical conflicts

> **Depends on:** T22-T28 (data exists in Dolt)

### Warrant & Claim Curation UI (The Core Feature)
- [ ] **T34** (45 min) **Claim View Page** — for a given plant+attribute:
  - Show current production value (if any)
  - List all warrants as evidence cards with: source name, value, methodology, region, year, specialist notes
  - Checkbox on each warrant for include/exclude
  - Conflict badges on conflicting warrant pairs
  - Specialist analysis shown inline on conflicting warrants
- [ ] **T35** (30 min) **Synthesis Button** — calls `synthesizeClaimFlow` with selected warrants
  - Shows AI-generated merged claim in editable text area
  - Shows confidence level and reasoning
  - "Approve" button to finalize
- [ ] **T36** (15 min) API route: POST `/api/synthesize` — calls Genkit synthesizeClaimFlow
- [ ] **T37** (15 min) API route: POST `/api/claims/approve` — writes claim + claim_warrants to Dolt, commits

### Conflict Queue
- [ ] **T38** (30 min) Conflicts list page: filterable/sortable table
  - Columns: plant, attribute, type, severity, value A vs value B, specialist verdict, status
  - Filter by: status, severity, conflict type, attribute category
  - Click → navigates to Claim View for that plant+attribute
- [ ] **T39** (20 min) On-demand Research button: calls `researchConflictFlow` for a specific conflict
- [ ] **T40** (15 min) Batch operations: select multiple conflicts → batch dismiss / batch route to specialist

**Milestone: Lunch Day 2** — Working portal, can curate warrants and synthesize claims

---

## Phase 4: Integration + Polish (Day 2, 4 hrs)

### Specialist Agents (Implement Top 2-3)
- [ ] **T41** (30 min) Implement `ratingConflictFlow` — most common conflict type
- [ ] **T42** (30 min) Implement `scopeConflictFlow` — critical for regional applicability
- [ ] **T43** (20 min) Wire specialists into Conflict Classifier dispatch

> Rating + Scope cover the majority of conflicts. Other specialists can be stubs for the demo.

### Synthesis Agent
- [ ] **T44** (30 min) Implement `synthesizeClaimFlow` — merge selected warrants into production claim
- [ ] **T45** (15 min) Test with a real multi-warrant example

### Dolt Version Control UI (No CLI for Users)
- [ ] **T46** (20 min) **Save Changes** button: API route calls `CALL dolt_commit(...)` with auto-generated message
- [ ] **T47** (30 min) **History** page: display `dolt_log` as timeline (commit hash, message, date)
- [ ] **T48** (20 min) **View Changes** on any history entry: human-readable diff from `dolt_diff`
- [ ] **T49** (15 min) **Undo** button with confirmation dialog → `dolt_revert`

### Production Sync
- [ ] **T50** (30 min) Sync script: read Dolt diff since last sync → generate Neon upserts
- [ ] **T51** (15 min) **Push to Production** button with preview of what will change
- [ ] **T52** (10 min) Log sync events

### Demo Polish
- [ ] **T53** (30 min) Seed 2-3 compelling conflict examples for walkthrough:
  - Juniper flammability conflict (rating + scope)
  - Ceanothus multi-warrant synthesis (4 warrants → 1 rich claim)
  - Invasiveness temporal conflict (1997 vs 2024)
- [ ] **T54** (15 min) Demo script: write the narrative flow for presentation
- [ ] **T55** (15 min) Clean up UI: loading states, error handling, empty states
- [ ] **T56** (15 min) README for hackathon repo

**Milestone: End of Day 2** — Demo-ready

---

## Dependency Graph

```
T01-T07 (Dolt) ───────────────────────────┐
T08-T11 (Genkit) ──┐                      │
                    ├── T12-T13 (Bootstrap warrants)
                    │         │
T14-T19 (Matcher    │         ├── T20-T24 (Internal Conflict Scan)
 + Schema Mapper) ──┤         ├── T25-T28 (External Analysis)
                    │                │
                    │                ├── T29-T40 (Portal)
                    │                │         │
                    │                │         ├── T41-T45 (Specialists + Synthesis)
                    │                │         ├── T46-T52 (Versioning + Sync)
                    │                │         └── T53-T56 (Polish)
```

## Time Budget

| Phase | Tasks | Estimated | Buffer |
|-------|-------|-----------|--------|
| Data Layer | T01-T13 | 3.5 hrs | +1 hr |
| Pipeline Agents | T14-T28 | 4.5 hrs | +1 hr |
| Portal | T29-T40 | 4.0 hrs | +1 hr |
| Integration | T41-T56 | 5.0 hrs | +1 hr |
| **Total** | **56 tasks** | **17 hrs** | **+4 hrs = 21 hrs coding** |

Leaves ~3 hours for meals, breaks, debugging, and unexpected issues across 48 hours.

## What to Cut If Behind

1. **Specialist agents** — stub them out, show Conflict Classifier output only
2. **Research Agent** — uses DATA-DICTIONARY.md context injection (Phase 2: upgrade to PageIndex RAG over knowledge-base PDFs)
3. **Batch operations** — process conflicts one at a time
4. **Production sync** — demo the Dolt staging layer only, describe the sync step
5. **History/revert UI** — show `dolt_log` via terminal instead of in portal
