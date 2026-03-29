# Implementation Plan: 48-Hour Hackathon

## Strategy

**Priority order:** Enhance existing → then expand.
1. Bootstrap existing production values as warrants
2. Detect internal conflicts within the 1,361 existing plants FIRST
3. Enhance existing plants with new warrants from source datasets
4. Curate warrants → synthesize claims → push to production
5. Then propose new species from unmatched records

**Build order:** Data layer → Genkit agents → Portal → Specialists + Synthesis → Polish

---

## Day 1: Saturday — Foundation + Agent Pipeline

### Morning (4 hours): Data Layer Setup

**Hour 1-2: Dolt Database + Genkit**
- Install Dolt binary, `dolt init`
- Import production mirror from LivingWithFire-DB CSVs:
  - plants.csv (1,361 rows)
  - values.csv (94,903 rows)
  - attributes.csv (125 rows)
  - sources.csv (103 rows)
- Create Claim/Warrant tables: warrants, conflicts, claims, claim_warrants, analysis_batches (see PROPOSALS-SCHEMA.md)
- `dolt add .` + `dolt commit -m "initial production mirror"`
- Start Dolt SQL server on port 3307
- Initialize Genkit: install packages, configure Anthropic plugin (Haiku 4.5 for bulk agents, Sonnet 4.6 for synthesis)
- Create shared Genkit tools: `lookupProductionPlant`, `getDataDictionary`, `getSourceMetadata`, Dolt query tool

**Hour 3-4: Bootstrap + Matcher Agent**
- **Bootstrap existing warrants:** Convert all 94,903 production `values` into warrants with `warrant_type: 'existing'` — preserving source_id provenance. This is what makes internal conflict detection possible.
- `dolt commit -m "bootstrap: 94,903 production values → warrants"`
- Implement `matchPlantFlow` in Genkit:
  - Exact genus+species match
  - Synonym resolution via POWO_WCVP tool
  - Fuzzy match fallback
- Test against FirePerformancePlants (541 plants)

**Checkpoint — Lunch Day 1:**
- Dolt running with production mirror + warrants
- Genkit configured with model plugins + shared tools
- Matcher agent working

### Afternoon (4 hours): Conflict Detection + First Analysis

**Hour 5-6: Conflict Classifier + Internal Scan**
- Implement `classifyConflictFlow` in Genkit:
  - For each plant+attribute with 2+ warrants, compare values
  - Classify conflict type (8 categories from CONFLICT-TAXONOMY.md)
  - Assign severity (critical/moderate/minor)
  - Route to specialist (store specialist flow name)
- Run internal scan across all bootstrapped warrants
- Write conflicts to Dolt, commit: `"internal scan: X conflicts detected"`
- **This is the first demo-worthy result**

**Hour 7-8: First External Analysis**
- Implement `mapSchemaFlow` (Schema Mapper) — auto-suggest column mappings
- Implement `bulkEnhanceFlow` — create warrants from approved mappings
- Process FirePerformancePlants (541 plants):
  - matchPlantFlow → bulkEnhanceFlow → classifyConflictFlow
  - Write warrants + conflicts to Dolt
  - `dolt commit -m "analysis: FIRE-01, X warrants, Y conflicts"`
- Process WUCOLS (4,103 plants) — same pipeline
  - `dolt commit -m "analysis: WATER-01, X warrants, Y conflicts"`

**Checkpoint — End of Day 1:**
- Internal conflicts detected and stored
- 2 source datasets analyzed with warrants + conflicts generated
- Can query Dolt: "show me all warrants and conflicts for Ceanothus velutinus"
- All data has full provenance chain

---

## Day 2: Sunday — Portal + Synthesis + Polish

### Morning (4 hours): Admin Portal

**Hour 1-2: Scaffold + Dashboard + Claim View**
- `npx create-next-app` with TypeScript, Tailwind, App Router
- Install shadcn/ui components + mysql2 for Dolt
- Dashboard page (`/`):
  - Summary cards: total warrants, pending conflicts (by severity), claims generated, datasets processed
  - Analysis batches table with status
  - Most-conflicted plants list
- Navigation: Dashboard, Sources, Claims, Conflicts, Matrix, Warrants, Fusion, Sync, History

**Hour 3-4: Warrant Curation UI (THE CORE FEATURE)**
- **Claim View** (`/claims/[plantId]/[attributeId]`):
  - Current production value (if any) shown at top
  - All warrants displayed as evidence cards:
    - Source name, value, methodology badge, region, year
    - Checkbox for include/exclude
    - Conflict badge linking to the conflicting warrant
    - Specialist analysis shown inline (if annotated)
  - "Synthesize Claim" button → calls `synthesizeClaimFlow`
  - AI synthesis shown in editable text area
  - Confidence level with reasoning
  - "Approve & Commit" button → writes to Dolt
- API routes:
  - POST `/api/synthesize` — calls Genkit synthesizeClaimFlow
  - POST `/api/claims/approve` — writes claim + claim_warrants to Dolt, auto-commits

- **Conflicts Queue** (`/conflicts`):
  - Filterable/sortable table: plant, attribute, type, severity, values, specialist verdict, status
  - Click → navigates to Claim View for that plant+attribute
  - On-demand Research button (calls `researchConflictFlow` — reads DATA-DICTIONARY.md context for each source)

**Checkpoint — Lunch Day 2:**
- Working portal with dashboard and warrant curation
- Can review warrants, synthesize a claim, and approve it through the UI
- Approval recorded in Dolt with full provenance

### Afternoon (4 hours): Specialists + Integration + Demo

**Hour 5-6: Specialist Agents + Synthesis**
- Implement `ratingConflictFlow` — handles the most common conflict type
- Implement `scopeConflictFlow` — critical for regional applicability assessment
- Wire specialists into Conflict Classifier dispatch
- Implement `synthesizeClaimFlow` — merge selected warrants into production claim
- Test full pipeline: detect conflict → specialist annotates → admin curates → synthesize → approve

**Hour 7: Dolt UI + Production Sync**
- **Save Changes** button: auto-generates commit message from actions taken
- **History** page (`/history`): `dolt_log` as a timeline, human-readable diffs
- **Undo** button with confirmation → `dolt_revert`
- **Push to Production** button:
  - Preview: shows what will change in Neon
  - Confirm: syncs Dolt main → Neon PostgreSQL
  - All buttons — no CLI required

**Hour 8: Demo Polish**
- Seed compelling examples:
  1. **Juniper flammability** — 3 warrants from different sources, scope + rating conflict, specialist explains regional difference, admin curates, AI synthesizes nuanced claim
  2. **Ceanothus multi-warrant synthesis** — 4 warrants that complement each other → AI produces richer description than any single source
  3. **Invasiveness temporal conflict** — 1997 "not invasive" vs 2024 "High invasive", temporal agent explains
- Demo script: walk through one full Claim/Warrant lifecycle
- UI polish: loading states, empty states, error handling
- README for hackathon repo

---

## MVP Scope vs. Stretch Goals

### MVP (Must ship)
- [x] Dolt staging DB with production mirror + warrant bootstrap
- [x] Internal conflict detection (classifyConflictFlow)
- [x] External analysis for 2+ datasets (warrants created)
- [x] Warrant curation UI with evidence cards
- [x] Claim synthesis (synthesizeClaimFlow)
- [x] Dolt commit/history (button-based, no CLI)
- [x] At least 1 specialist agent (Rating Conflict)

### Built Post-Hackathon (completed)
- [x] Table Fusion visual mapping UI (task 021)
- [x] Cross-source conflict matrix heatmap (task 022)
- [x] Source Pipeline UI — upload CSV, AI dictionary, run pipeline from portal (task 023)
- [x] Production sync to Neon — preview + push from portal
- [x] All 6 specialist agents implemented (Rating, Scope, Taxonomy, Research, Temporal + stubs)
- [x] Knowledge Base RAG via PageIndex (searchDocumentIndex + navigateDocumentTree tools)

### Deferred
- [ ] Bulk column addition workflow
- [ ] All 40 datasets processed (proof: 2-3 datasets analyzed)
- [ ] Batch warrant curation (one-at-a-time curation only)
- [ ] Local model inference via Ollama (tested, too slow — using Anthropic API instead)
- [ ] Source Collection Automation — URL queue, auto-download (PRD P2)

### If Running Behind
- Day 1 PM: Skip WUCOLS, just do FirePerformancePlants as proof
- Day 2 AM: Skip dashboard, go straight to Claim View
- Day 2 PM: Skip specialist agents — show raw Conflict Classifier output. Skip production sync — demo Dolt diff as the "push preview"
- Synthesis Agent is non-negotiable — it's the demo climax

### If Running Ahead
- Process more datasets (show scale: "we analyzed 40 databases in the background")
- Implement more specialist agents beyond Rating + Scope
- Add batch warrant curation
- Wire PageIndex RAG into Research Agent (post-hackathon priority)
- Add the Table Fusion drag-and-drop UI
- Production sync to Neon (post-hackathon priority)
