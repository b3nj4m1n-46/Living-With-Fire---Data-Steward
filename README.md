# LivinWitFire — Plant Data Fusion Platform for Fire-Wise Landscaping

**40 plant databases** | **866,000+ records** | **AI-powered data curation** | **Version-controlled staging**

A plant data collection and admin tooling project for building a fire-wise, wildlife-friendly, drought-tolerant plant selection tool for the Pacific West (Oregon, California, Washington). Includes an AI agent pipeline and admin portal for fusing 40 source databases into a production database using a Claim/Warrant evidence curation model.

## Architecture

```mermaid
flowchart LR
    docs["40 Source\nDatasets"]
    kb["52 Research\nDocuments"]

    kb --> PageIndex --> KnowledgeDB[(Knowledge\nBase)]

    docs --> |CSV upload| Fusion
    KnowledgeDB -.-> |research context| Fusion

    subgraph Fusion ["Genkit Agent Pipeline"]
        direction TB
        match[Match] --> map[Map] --> enhance[Warrants] --> classify[Conflicts]
    end

    Fusion --> Staging[(DoltgreSQL\nStaging)]

    Staging <--> |curation loop| Admin

    subgraph Admin ["Admin Portal"]
        direction TB
        review[Review Warrants]
        resolve[Resolve Conflicts]
        approve[Approve Claims]
        review --> resolve --> approve
    end

    Admin -.-> |specialist analysis| AI["AI Specialists\n+ Synthesis"]
    AI -.-> Staging

    Staging --> |sync| Prod[(Neon\nProduction DB)]
```

## Project Components

### 1. Source Datasets (`database-sources/`)

40 datasets harvested from federal agencies, universities, extension services, and conservation organizations, spanning **8 categories**:

| Category | Datasets | Key Question Answered |
|----------|----------|----------------------|
| 🔥 Fire Resistance | 10 | Is this plant fire-resistant or flammable? |
| 🦌 Deer Resistance | 6 | Will deer eat this plant? |
| 🌱 Plant Traits & Taxonomy | 5 | What are its growing requirements? |
| 💧 Water Need & Drought | 4 | How much water does it need? |
| 🐝 Pollinators | 4 | Does it support bees, butterflies, hummingbirds? |
| 🐦 Birds & Wildlife | 1 | Does it support bird populations? |
| 🌿 Native Plants | 5 | Is it native to Oregon/California/Washington? |
| ⚠️ Invasiveness | 5 | Is it invasive or noxious? |

## How the Data Is Organized

### Folder Structure

All 40 source datasets live under `database-sources/`, organized by category:

```
database-sources/
├── fire/                  # 12 fire resistance datasets
├── deer/                  # 6 deer resistance datasets
├── traits/                # 2 plant trait datasets
├── taxonomy/              # 3 taxonomy backbones
├── water/                 # 3 water/drought datasets
├── pollinators/           # 3 pollinator datasets
├── birds/                 # 2 bird/wildlife datasets
├── native/                # 4 native plant datasets
└── invasive/              # 5 invasiveness datasets
```

Every individual dataset follows the same pattern:

```
database-sources/<category>/DatasetName/
├── README.md              # What it is, where it came from, field definitions
├── DATA-DICTIONARY.md     # Column definitions, rating scales, merge keys
├── plants.csv             # Primary output — flat CSV, UTF-8
├── plants.json            # JSON with metadata and scale definitions
├── plants.db              # SQLite database with indexes
├── scripts/               # Parser/builder scripts (Python, reproducible)
│   └── parse_pdf.py       # or build_data.py, scrape_all.py, etc.
└── Sources/               # Original source files (PDFs, XLSX, HTML)
    └── original_file.pdf
```

### Standard Output Formats

| Format | File | Use Case |
|--------|------|----------|
| **CSV** | `plants.csv` | Universal — opens in Excel, imports into any database, readable by any language |
| **JSON** | `plants.json` | Includes metadata (source URL, rating scale definitions, methodology notes) + plant data |
| **SQLite** | `plants.db` | Queryable database with indexes — fastest for cross-referencing and filtering |

### Large Datasets

Three datasets exceed 100K records and skip JSON output due to file size:
- `database-sources/taxonomy/POWO_WCVP` (362,739 species) — use CSV or SQLite
- `database-sources/taxonomy/WorldFloraOnline` (381,467 species) — use CSV or SQLite
- `database-sources/taxonomy/USDA_PLANTS` (93,157 records) — use CSV or SQLite

### Naming Conventions

- `plants.csv` — primary plant list output
- `plants_full.csv` — all columns when a simplified version also exists
- `plants_oregon.csv` / `plants_california.csv` — state-specific subsets
- `plants_enriched.csv` — plant list with detail page data merged in
- `references.csv` — source references (for literature-review datasets)
- `variables.csv` — variable/trait definitions (for scientific databases)
- `taxonomic_changes.csv` — nomenclatural updates

## Quick Start

### Find fire-resistant plants for Oregon

```sql
-- In any SQLite browser, open database-sources/fire/FirePerformancePlants/plants.db
SELECT scientific_name, common_name, firewise_rating, landscape_zone
FROM plants
WHERE firewise_rating = 'Firewise (1)'
ORDER BY common_name;
```

### Find plants that are fire-safe AND deer-resistant

```python
import sqlite3

fire_db = sqlite3.connect('database-sources/fire/FirePerformancePlants/plants.db')
deer_db = sqlite3.connect('database-sources/deer/RutgersDeerResistance/plants.db')

fire_plants = set(r[0].lower() for r in fire_db.execute(
    "SELECT scientific_name FROM plants WHERE firewise_rating LIKE '%Firewise (1)%'"))
deer_plants = set(r[0].lower() for r in deer_db.execute(
    "SELECT scientific_name FROM plants WHERE deer_rating_code = 'A'"))

both = fire_plants & deer_plants
print(f"Fire-safe AND rarely damaged by deer: {len(both)} species")
```

### Check if a plant is invasive

```sql
-- Check database-sources/invasive/USGS_RIIS/plants.db (most comprehensive — 4,918 species)
SELECT scientific_name, common_name, degree_of_establishment, locality
FROM plants
WHERE scientific_name LIKE '%Hedera%';
```

### Find low-water plants for California

```sql
-- database-sources/water/WUCOLS/plants.db — 4,103 plants with regional water ratings
SELECT scientific_name, common_name, plant_type,
       region_4_water_use AS south_coastal,
       region_6_water_use AS north_coastal_bay
FROM plants
WHERE region_4_water_use IN ('Very Low', 'Low')
ORDER BY scientific_name;
```

## Complete Dataset Inventory

| Folder | Records | Category | Source |
|--------|---------|----------|--------|
| `database-sources/fire/FirePerformancePlants` | 541 | 🔥 Fire | SREF Fire Performance Plants Selector |
| `database-sources/fire/IdahoFirewise` | 379 | 🔥 Fire | Idaho Firewise Garden Plant Database |
| `database-sources/fire/FLAMITS` | 40 vars | 🔥 Fire | Global Plant Flammability Traits Database |
| `database-sources/fire/NIST_USDA_Flammability` | 34 | 🔥 Fire | NIST/USDA/Forest Service (34 shrubs tested) |
| `database-sources/fire/UCForestProductsLab` | 164 | 🔥 Fire | UC Forest Products Lab 1997 (57 refs) |
| `database-sources/fire/BethkeUCCE2016` | 12 meta | 🔥 Fire | Bethke et al. UCCE Literature Review |
| `database-sources/fire/DiabloFiresafe` | 140 | 🔥 Fire | Diablo Firesafe Council |
| `database-sources/fire/OaklandFireSafe` | 212 | 🔥 Fire | Oakland Fire Safe Council |
| `database-sources/fire/SAFELandscapes` | — | 🔥 Fire | SAFE Landscapes So. CA (README only) |
| `database-sources/fire/FirescapingBook` | 180 | 🔥 Fire | Edwards & Schleiger 2023 |
| `database-sources/fire/OSU_PNW590` | 133 | 🔥 Fire | OSU PNW-590 Fire-Resistant Plants |
| `database-sources/fire/UF_IFAS_FirewiseShrubs` | — | 🔥 Fire | UF/IFAS Firewise Shrubs (ref to NIST) |
| `database-sources/deer/RutgersDeerResistance` | 326 | 🦌 Deer | Rutgers NJ Ag Experiment Station |
| `database-sources/deer/NCSU_DeerResistant` | 727 | 🦌 Deer | NC State Extension Gardener Toolbox |
| `database-sources/deer/MissouriBotanicalDeer` | 112 | 🦌 Deer | Missouri Botanical Garden / Shaw Reserve |
| `database-sources/deer/WSU_DeerResistant` | 82 | 🦌 Deer | Washington State University Extension |
| `database-sources/deer/CSU_DeerDamage` | 55 | 🦌 Deer | Colorado State University Extension |
| `database-sources/deer/CornellDeerResistance` | 211 | 🦌 Deer | Cornell Cooperative Extension |
| `database-sources/traits/MBG_PlantFinder` | 8,840 | 🌱 Traits | Missouri Botanical Garden (+ detail scraping) |
| `database-sources/traits/NCSU database` | 5,028 | 🌱 Traits | NC State Extension Gardener Plant Toolbox |
| `database-sources/taxonomy/POWO_WCVP` | 362,739 | 🌱 Taxonomy | Kew World Checklist of Vascular Plants |
| `database-sources/taxonomy/WorldFloraOnline` | 381,467 | 🌱 Taxonomy | World Flora Online Consortium |
| `database-sources/taxonomy/USDA_PLANTS` | 93,157 | 🌱 Taxonomy | USDA NRCS PLANTS Database (national + OR + CA) |
| `database-sources/water/WUCOLS` | 4,103 | 💧 Water | UC Davis Water Use Classification (6 CA regions) |
| `database-sources/water/UtahCWEL` | 94 | 💧 Water | Utah State CWEL Western Native Plants |
| `database-sources/water/OSU_DroughtTolerant` | 24 | 💧 Drought | OSU Extension Unirrigated Trials |
| `database-sources/pollinators/XercesPollinator` | 428 | 🐝 Pollinator | Xerces Society + Pollinator Partnership (4 regions) |
| `database-sources/pollinators/PollinatorPartnership` | 28 | 🐝 Pollinator | Pollinator Partnership Pacific Lowland Guide |
| `database-sources/pollinators/NRCS_Pollinator` | 107 | 🐝 Pollinator | NRCS / Heather Holm (wildflowers + trees/shrubs) |
| `database-sources/birds/TallamyBirdPlants` | 42 | 🐦 Birds | Tallamy — Plant genera ranked by bird food value |
| `database-sources/native/LBJ_Wildflower` | 1,000 | 🌿 Native | Lady Bird Johnson Wildflower Center (OR/WA/CA) |
| `database-sources/native/PlantNativeORWA` | 59 | 🌿 Native | PlantNative.org Western OR & WA |
| `database-sources/native/OregonFlora` | 355 | 🌿 Native | Oregon Flora Project (supplements) |
| `database-sources/native/OrAssocNurseries` | 833 | 🌿 Native | Oregon Association of Nurseries |
| `database-sources/invasive/FederalNoxiousWeeds` | 112 | ⚠️ Invasive | USDA APHIS Federal Noxious Weed List |
| `database-sources/invasive/USDA_InvasiveSpecies` | 30 | ⚠️ Invasive | USDA National Invasive Species Info Center |
| `database-sources/invasive/WGA_InvasiveSpecies` | 26 | ⚠️ Invasive | Western Governors Association Top 50 |
| `database-sources/invasive/USGS_RIIS` | 5,941 | ⚠️ Invasive | USGS Register of Introduced & Invasive Species |
| `database-sources/invasive/CalIPC_Invasive` | 331 | ⚠️ Invasive | Cal-IPC California Invasive Plant Inventory |
| `database-sources/birds/AudubonBirdPlants` | — | 🐦 Birds | Audubon (deferred — JS-heavy) |

## Taxonomy Backbones

Three datasets serve as **reference taxonomies** for resolving plant names across all other datasets:

| Dataset | Scope | Records | Use For |
|---------|-------|---------|---------|
| `database-sources/taxonomy/POWO_WCVP` | Global | 362,739 | Lifeform, climate zone, native distribution |
| `database-sources/taxonomy/WorldFloraOnline` | Global | 381,467 | Independent taxonomic cross-validation |
| `database-sources/taxonomy/USDA_PLANTS` | US | 93,157 | USDA symbols, US-specific common names, OR/CA state lists |

### 2. Genkit Agent Pipeline (`genkit/`)

AI-powered data fusion agents built with [Firebase Genkit](https://firebase.google.com/docs/genkit) and the Anthropic Claude API.

**Flows** (`genkit/src/flows/`):
| Flow | Purpose | Model |
|------|---------|-------|
| `matchPlantFlow` | Three-tier plant matching: exact → synonym (POWO/WFO) → fuzzy (Levenshtein) | None (DB-only) |
| `mapSchemaFlow` | AI-driven source column → production attribute mapping with crosswalks | Sonnet 4.6 |
| `bulkEnhanceFlow` | Create warrant records from matched + mapped source data | None (data transform) |
| `classifyConflictFlow` | Detect and classify conflicts into 8 types with severity | Haiku 4.5 |
| `ratingConflictFlow` | Specialist: resolve rating disagreements via methodology/scale analysis | Sonnet 4.6 |
| `scopeConflictFlow` | Specialist: resolve scope conflicts via regional applicability analysis | Sonnet 4.6 |
| `taxonomyConflictFlow` | Specialist: resolve taxonomy/naming conflicts via POWO/WFO/USDA lookups | Sonnet 4.6 |
| `researchConflictFlow` | Specialist: resolve evidence-quality conflicts via source methodology analysis | Sonnet 4.6 |
| `temporalConflictFlow` | Specialist: resolve temporal conflicts via publication date/currency analysis | Sonnet 4.6 |
| `methodologyConflictFlow` | Specialist: resolve methodology conflicts (stub — returns needs-research) | None |
| `definitionConflictFlow` | Specialist: resolve definition/category conflicts (stub — returns needs-research) | None |
| `synthesizeClaimFlow` | Merge selected warrants into production-ready claim with confidence | Sonnet 4.6 |

**Tools** (`genkit/src/tools/`) — 13 reusable Genkit tools: `queryDolt`, `lookupProductionPlant`, `getDatasetContext`, `searchDocumentIndex`, `navigateDocumentTree`, `resolveSynonym`, `fuzzyMatch`, `warrantGroups`, `writeConflict`, `sourceMetadata`, `productionAttributes`, `sampleSourceData`

**Scripts** (`genkit/src/scripts/`):
| Script | Purpose |
|--------|---------|
| `bootstrap-warrants.ts` | Convert 94,903 production values to warrants |
| `internal-conflict-scan.ts` | Detect conflicts within existing production data |
| `external-analysis.ts` | Full pipeline for processing a source dataset (CLI) |
| `fusion-bridge.ts` | JSON stdin/stdout bridge for admin portal API routes (map, preview, execute, full-analysis) |
| `test-matcher.ts` | Validate plant matching against FIRE-01 |

### 3. Admin Portal (`admin/`)

Next.js 16 admin portal with shadcn/ui for data steward curation workflow.

**Pages:**
| Route | Purpose |
|-------|---------|
| `/` | Dashboard — summary cards, analysis batches, conflict severity breakdown |
| `/sources` | Source registry — all datasets with status, upload entry point |
| `/sources/upload` | Upload workflow — 4-step: CSV upload, metadata, AI dictionary, run pipeline |
| `/sources/[batchId]` | Pipeline progress — live step tracking with auto-refresh |
| `/claims` | Claims list — filterable plant+attribute combinations with warrant counts |
| `/claims/[plantId]/[attributeId]` | Claim view — warrant cards, selection, synthesis, approval |
| `/conflicts` | Conflict queue — filterable table with inline expansion, research, batch ops |
| `/matrix` | Conflict matrix — cross-source heatmap visualization |
| `/warrants` | Warrant browser |
| `/fusion` | Fusion — schema mapping review and batch execution |
| `/fusion/[batchId]` | Fusion batch detail — mapping config review and crosswalk editing |
| `/sync` | Sync — preview and push approved changes to production |
| `/history` | Dolt commit log with diff viewer, save, and undo |
| `/history/[commitHash]` | Commit diff viewer — row-level changes per table |

**API Routes:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sources/upload` | POST | Upload CSV file, return preview (headers, sample rows) |
| `/api/sources/create` | GET/POST | GET: suggest next source ID; POST: create dataset folder + README |
| `/api/sources/dictionary` | POST/PUT | POST: AI-generate DATA-DICTIONARY.md; PUT: save edits |
| `/api/sources/run` | POST | Trigger full analysis pipeline (fire-and-forget) |
| `/api/sources/[batchId]/status` | GET | Poll pipeline progress (step status, stats) |
| `/api/fusion/map` | POST | Run schema mapping for a dataset |
| `/api/fusion/preview` | GET | Preview fusion results |
| `/api/fusion/execute` | POST | Execute fusion batch with reviewed mapping config |
| `/api/fusion/[batchId]` | GET | Fetch fusion batch detail |
| `/api/warrants/[id]` | PATCH | Update warrant status (included/excluded/unreviewed) |
| `/api/synthesize` | POST | AI claim synthesis from warrants (Anthropic Sonnet 4.6) |
| `/api/claims/approve` | POST | Approve claim → Dolt commit |
| `/api/conflicts/[id]` | GET/PATCH | Get conflict detail / update status |
| `/api/conflicts/[id]/research` | POST | Retrieve research context for a conflict |
| `/api/conflicts/[id]/specialist` | POST | Run AI specialist analysis (rating/scope) |
| `/api/conflicts/batch` | POST | Batch dismiss/route conflicts |
| `/api/matrix` | GET | Cross-source conflict matrix data |
| `/api/dolt/log` | GET | Fetch Dolt commit history |
| `/api/dolt/status` | GET | Check for uncommitted changes |
| `/api/dolt/commit` | POST | Create manual Dolt commit |
| `/api/dolt/revert` | POST | Revert a recent commit |
| `/api/sync/preview` | GET | Preview changes to push to production |
| `/api/sync/push` | POST | Push approved changes to Neon production |

### 4. Production Database (`LivingWithFire-DB/`)

Neon PostgreSQL with 1,361 curated plants powering the public app at `lwf-api.vercel.app`. EAV schema (13 tables, 125 attributes, 94,903 values). Full API reference cached in `LivingWithFire-DB/api-reference/`.

### 5. DoltgreSQL Staging Database

Version-controlled PostgreSQL (DoltgreSQL v0.55.6) on port 5433. Contains mirrored production tables + Claim/Warrant tables:

| Table | Purpose |
|-------|---------|
| `warrants` | Evidence records (existing + external) with source provenance |
| `conflicts` | Detected disagreements between warrant pairs |
| `claims` | Finalized production values synthesized from curated warrants |
| `claim_warrants` | Junction: which warrants support which claims |
| `analysis_batches` | Audit trail per pipeline run |

Every data operation is tracked as a Dolt commit with full diff history.

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **DoltgreSQL** v0.55.6+ ([install guide](https://docs.dolthub.com/introduction/installation))
- **Python 3.9+** (for dataset build scripts only)
- **Anthropic API key** (optional — pipeline works without it for DB-only operations)

### 1. Start DoltgreSQL

```bash
# First time: init the database
cd path/to/dolt-data
doltgresql --data-dir . --port 5433

# The staging DB (lwf_staging) should already be initialized
# If starting fresh, run the bootstrap scripts (see below)
```

### 2. Set Up the Genkit Pipeline

```bash
cd genkit
npm install

# Optional: set Anthropic API key for AI-powered flows
export ANTHROPIC_API_KEY=sk-ant-...

# Run the pipeline scripts
npm run bootstrap          # Convert production values to warrants
npm run internal-scan      # Detect internal conflicts
npm run analyze:fire01     # Process FIRE-01 through full pipeline
npm run analyze:water01    # Process WATER-01 through full pipeline
npm run test-matcher       # Validate plant matching
npm test                   # Smoke test all tools
```

### 3. Start the Admin Portal

```bash
cd admin
npm install

# Configure DoltgreSQL connection (defaults should work)
# Edit .env.local if needed:
#   DOLT_HOST=localhost
#   DOLT_PORT=5433
#   DOLT_DATABASE=lwf_staging
#   DOLT_USER=root
#   DOLT_PASSWORD=

npm run dev
# Portal available at http://localhost:3000
```

### Environment Variables

| Variable | Where | Required | Default | Purpose |
|----------|-------|----------|---------|---------|
| `ANTHROPIC_API_KEY` | `genkit/`, `admin/` | No | — | Enables AI-powered flows and admin API routes (synthesis, specialist analysis, schema mapping, conflict classification) |
| `DOLT_HOST` | `admin/.env.local` | No | `localhost` | DoltgreSQL host |
| `DOLT_PORT` | `admin/.env.local` | No | `5433` | DoltgreSQL port |
| `DOLT_DATABASE` | `admin/.env.local` | No | `lwf_staging` | Staging database name |
| `DOLT_USER` | `admin/.env.local` | No | `root` | DoltgreSQL user |
| `DOLT_PASSWORD` | `admin/.env.local` | No | (empty) | DoltgreSQL password |

---

## Repository Structure

```
LivinWitFire/
├── README.md                    # This file
├── CLAUDE.md                    # AI assistant context
├── HOW-TO-USE.md                # Practical guide for querying/merging data
├── admin/                       # Next.js 16 admin portal
│   ├── src/app/                 # App Router pages + API routes
│   ├── src/components/          # shadcn/ui components
│   ├── src/lib/                 # DB connection + query functions
│   └── .env.local               # DoltgreSQL connection config
├── genkit/                      # Genkit agent pipeline
│   ├── src/flows/               # 12 Genkit flows (incl. indexDocumentFlow)
│   ├── src/tools/               # 13 reusable tools
│   ├── src/scripts/             # Bridge scripts (fusion-bridge, index-bridge)
│   └── src/config.ts            # Anthropic plugin + model assignments
├── scripts/                     # Utility scripts
│   ├── pageindex/               # PDF document indexing pipeline
│   ├── index_pdf.py             # CLI: index a single PDF
│   └── index_all_pdfs.sh        # Batch: index all unindexed PDFs
├── database-sources/            # 40 source datasets by category
├── LivingWithFire-DB/           # Production database mirror + API reference
├── knowledge-base/              # 52 research documents (PDFs, HTML)
│   └── indexes/                 # 47 hierarchical JSON indexes for agent search
├── data-sources/                # Provenance, literature, crossref docs
└── docs/                        # Planning, architecture, task specs
    ├── planning/                # PRD, architecture, schema, conflict taxonomy
    └── tasks/                   # Spec-driven task documents
        ├── todo/                # Active specs ready for implementation
        ├── completed/           # Implemented with commit references
        └── future/              # Deferred
```

### Key Reference Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | AI assistant context — conventions, structure, common tasks |
| `HOW-TO-USE.md` | Practical guide for querying, merging, and using the data |
| `docs/planning/PRD.md` | Product Requirements — Claim/Warrant model |
| `docs/planning/ARCHITECTURE.md` | System architecture — Dolt + Genkit + agents |
| `docs/planning/PROPOSALS-SCHEMA.md` | Claims, warrants, resolutions data model |
| `docs/planning/CONFLICT-TAXONOMY.md` | 8 conflict types with detection/resolution patterns |
| `LivingWithFire-DB/api-reference/ATTRIBUTE-REGISTRY.md` | 125 production attributes with UUIDs |
| `docs/reference/ADMIN-API-REFERENCE.md` | All admin portal API endpoints with request/response shapes |
| `data-sources/DATA-PROVENANCE.md` | Source ID registry with full citations |

---

## Quick Start: Querying Source Data

### Find fire-resistant plants for Oregon

```sql
-- In any SQLite browser, open database-sources/fire/FirePerformancePlants/plants.db
SELECT scientific_name, common_name, firewise_rating, landscape_zone
FROM plants
WHERE firewise_rating = 'Firewise (1)'
ORDER BY common_name;
```

### Find plants that are fire-safe AND deer-resistant

```python
import sqlite3

fire_db = sqlite3.connect('database-sources/fire/FirePerformancePlants/plants.db')
deer_db = sqlite3.connect('database-sources/deer/RutgersDeerResistance/plants.db')

fire_plants = set(r[0].lower() for r in fire_db.execute(
    "SELECT scientific_name FROM plants WHERE firewise_rating LIKE '%Firewise (1)%'"))
deer_plants = set(r[0].lower() for r in deer_db.execute(
    "SELECT scientific_name FROM plants WHERE deer_rating_code = 'A'"))

both = fire_plants & deer_plants
print(f"Fire-safe AND rarely damaged by deer: {len(both)} species")
```

### Check if a plant is invasive

```sql
-- database-sources/invasive/USGS_RIIS/plants.db (most comprehensive — 4,918 species)
SELECT scientific_name, common_name, degree_of_establishment, locality
FROM plants
WHERE scientific_name LIKE '%Hedera%';
```

### Find low-water plants for California

```sql
-- database-sources/water/WUCOLS/plants.db — 4,103 plants with regional water ratings
SELECT scientific_name, common_name, plant_type,
       region_4_water_use AS south_coastal,
       region_6_water_use AS north_coastal_bay
FROM plants
WHERE region_4_water_use IN ('Very Low', 'Low')
ORDER BY scientific_name;
```

## Rebuilding Source Datasets

Every dataset includes the Python script that built it in the `scripts/` folder:

```bash
cd database-sources/<category>/DatasetName
python scripts/build_data.py    # or parse_pdf.py, scrape_all.py
```

Dependencies: `pip install pdfplumber openpyxl requests beautifulsoup4`

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Agent Pipeline | [Firebase Genkit](https://firebase.google.com/docs/genkit) + TypeScript |
| AI Models | Anthropic Claude — Haiku 4.5 (bulk), Sonnet 4.6 (quality) |
| Staging Database | [DoltgreSQL](https://www.dolthub.com/blog/2024-03-29-doltgresql/) (version-controlled PostgreSQL) |
| Admin Portal | Next.js 16 + shadcn/ui + Tailwind CSS |
| Production Database | Neon PostgreSQL (EAV schema) |
| Public API | Vercel (`lwf-api.vercel.app`) |
| Dataset Scripts | Python 3 (pdfplumber, openpyxl, beautifulsoup4) |
| Document Indexing | Python 3 (PyMuPDF, PyPDF2, Anthropic SDK) |

## Document Indexing (Knowledge Base)

The knowledge base contains 52 research PDFs indexed into hierarchical JSON structures used by Genkit agent tools for research context. To index new or unindexed PDFs:

```bash
# Install dependencies
pip install -r scripts/pageindex/requirements.txt

# Index a single PDF
python scripts/index_pdf.py --pdf knowledge-base/NewDocument.pdf

# Batch-index all unindexed PDFs (2 concurrent jobs)
bash scripts/index_all_pdfs.sh
```

Indexing uses Claude Haiku 4.5 (~$0.02-0.10 per PDF) to detect table of contents, extract hierarchical structure, verify page mappings, and generate section summaries. Results are written to `knowledge-base/indexes/` and the manifest is auto-updated.

The admin portal also provides a UI at **Sources > Documents** for uploading and indexing PDFs.

## What's Deferred

These data sources require JavaScript rendering (Selenium/Playwright) or registration:

- **Calscape** (CA Native Plant Society) — JavaScript app
- **Audubon Native Plants** — JavaScript, no API
- **NWF Native Plant Finder** — SSL cert issues
- **TRY Plant Trait Database** — Academic registration required
- **Invasive Plant Atlas** — 403 blocked
- **RHS** (Royal Horticultural Society) — UK, low priority
