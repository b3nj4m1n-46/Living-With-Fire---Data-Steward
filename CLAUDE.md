# CLAUDE.md — Project Context for AI Assistants

## What Is This Project?

**LivinWitFire** is a plant data collection and admin tooling project for building a fire-wise, wildlife-friendly, drought-tolerant plant selection tool for the Pacific West (Oregon, California, Washington). It contains 41 plant databases with 866,000+ records harvested from federal agencies, universities, extension services, and conservation organizations — plus a production database (`LivingWithFire-DB`) with 1,361 curated plants powering a public-facing app.

The **admin portal** (in development) uses AI agents to fuse the 41 source databases into the production DB through a Claim/Warrant evidence curation model. See `docs/planning/PRD.md` for the full vision.

## Repository Structure

```
LivinWitFire/
├── README.md                    # Project overview, inventory, quick-start examples
├── CLAUDE.md                    # This file — AI assistant context
├── HOW-TO-USE.md                # Practical guide for querying and merging data
├── AI_COLLABORATION_PROCESS.md  # Spec-driven development workflow & task doc template
├── .gitignore                   # Excludes Sources/ and temp files only
├── .gitattributes               # Git LFS for files >100MB (taxonomy CSVs/DBs)
├── docs/                        # All project documentation
│   ├── planning/                # Design artifacts (PRD, architecture, schemas)
│   │   ├── PRD.md               # Product Requirements — Claim/Warrant model
│   │   ├── ARCHITECTURE.md      # System architecture — Dolt + Genkit + agents
│   │   ├── PROPOSALS-SCHEMA.md  # Claims, warrants, resolutions data model
│   │   ├── CONFLICT-TAXONOMY.md # 8 conflict types with detection/resolution patterns
│   │   ├── DATASET-MAPPINGS.md  # Source-to-production schema crosswalks
│   │   ├── IMPLEMENTATION-PLAN.md # Phased hackathon build plan
│   │   ├── TASKS.md             # Rough task breakdown (not spec format)
│   │   └── agents/              # Agent profile MDs (one per Genkit flow)
│   ├── reference/               # API and system reference docs
│   │   └── ADMIN-API-REFERENCE.md # All admin portal API endpoints with request/response shapes
│   ├── tasks/                   # Spec-driven task documents (see below)
│   │   ├── todo/                # Active specs, ready for implementation
│   │   ├── future/              # Acknowledged but deferred
│   │   └── completed/           # Implemented with commit references
│   └── legacy/                  # Deprecated approaches, quarantined from AI context
│
├── data-sources/                # Reference docs: provenance, literature, crossref, TODO
│   ├── Primary Sources for the Plant List Generator Project.docx
│   ├── DATA-PROVENANCE.md       # Source ID registry with full citations
│   ├── SOURCE-CROSSREF.md       # Maps requirements doc to completed folders
│   ├── TODO-DataSources.md      # Tracking status of all data sources
│   ├── LITERATURE-TRIAGE.md     # 195 references triaged — 93.3% accounted for
│   └── LITERATURE-REFERENCES-SEARCH.csv  # Search-ready with Google Scholar/Wayback URLs
│
├── knowledge-base/              # 52 procured research documents (PDFs, HTML)
│   ├── SEARCH-LITERATURE.html   # Interactive search tool for remaining references
│   └── Org_Title_Year.pdf       # Named by: Organization, Descriptive Title, Year
│
├── LivingWithFire-DB/           # Production database (Neon PostgreSQL mirror)
│   ├── README.md                # EAV schema overview, connection info, rebuild steps
│   ├── DATA-DICTIONARY.md       # All 13 tables with column definitions
│   ├── plants.csv               # 1,361 plants
│   ├── values.csv               # 94,903 attribute values (the core data)
│   ├── plants.db                # SQLite with all 13 tables
│   ├── api-reference/           # ** Critical for coding agents **
│   │   ├── API-REFERENCE.md     # All REST endpoints, response shapes
│   │   ├── ATTRIBUTE-REGISTRY.md # Full 125-attribute tree with UUIDs & allowed values
│   │   ├── SOURCE-REGISTRY.md   # All 50 production sources with UUIDs
│   │   ├── EAV-QUERY-PATTERNS.md # SQL recipes, key UUID table, agent notes
│   │   ├── openapi-spec.json    # Full OpenAPI 3.0 specification
│   │   └── *.json               # Cached API responses for offline use
│   └── Sources/                 # PostgreSQL dump (gitignored)
│
├── admin/                       # Next.js 16 admin portal
│   ├── src/app/                 # App Router pages + API routes
│   │   ├── page.tsx             # Dashboard
│   │   ├── sources/             # Source pipeline — upload, registry, progress
│   │   │   ├── page.tsx         # Source registry listing all datasets
│   │   │   ├── upload/          # 4-step upload workflow (CSV → metadata → AI dict → run)
│   │   │   └── [batchId]/       # Pipeline progress tracking (auto-refresh)
│   │   ├── claims/              # Claim curation — warrant cards, synthesis, approval
│   │   ├── conflicts/           # Conflict queue — filterable, research, batch ops
│   │   ├── matrix/              # Cross-source conflict heatmap
│   │   ├── warrants/            # Warrant browser
│   │   ├── fusion/              # Schema mapping review and batch execution
│   │   ├── sync/                # Preview and push to production
│   │   ├── history/             # Dolt commit log and diff viewer
│   │   └── api/                 # API routes
│   │       ├── sources/         # Upload, create, dictionary, run, status polling
│   │       ├── fusion/          # Map, preview, execute
│   │       ├── warrants/        # Status updates
│   │       ├── claims/          # Approve
│   │       ├── conflicts/       # Detail, research, specialist, batch
│   │       ├── synthesize/      # AI claim synthesis
│   │       ├── matrix/          # Conflict matrix data
│   │       ├── dolt/            # Log, status, commit, revert
│   │       └── sync/            # Preview, push
│   ├── src/components/          # UI components (shadcn/ui + base-ui)
│   ├── src/lib/                 # DB connection, queries, fusion bridge
│   │   ├── dolt.ts              # PostgreSQL pool + query<T>(), queryOne<T>()
│   │   ├── fusion-bridge.ts     # Subprocess bridge to Genkit flows
│   │   └── queries/             # Type-safe query functions per domain
│   └── .env.local               # DoltgreSQL connection config
│
├── genkit/                      # Genkit agent pipeline
│   ├── src/flows/               # 11 Genkit flows (match, map, enhance, classify, specialists, synthesize)
│   ├── src/tools/               # 13 reusable tools (queryDolt, getDatasetContext, etc.)
│   ├── src/scripts/             # CLI scripts + fusion-bridge.ts (JSON stdin/stdout for admin)
│   └── src/config.ts            # Anthropic plugin + model assignments
│
├── database-sources/            # 40 source datasets, organized by category
│   ├── fire/                    # 12 fire resistance datasets (FIRE-01 through FIRE-12)
│   ├── deer/                    # 6 deer resistance datasets (DEER-01 through DEER-06)
│   ├── traits/                  # 2 plant trait datasets (TRAIT-01, TRAIT-02)
│   ├── taxonomy/                # 3 taxonomy backbones (TAXON-01 through TAXON-03)
│   ├── water/                   # 3 water/drought datasets (WATER-01, WATER-02, DROUGHT-01)
│   ├── pollinators/             # 3 pollinator datasets (POLL-01 through POLL-03)
│   ├── birds/                   # 2 bird/wildlife datasets (BIRD-01 + Audubon)
│   ├── native/                  # 4 native plant datasets (NATIVE-01 through NATIVE-04)
│   └── invasive/                # 5 invasiveness datasets (INVAS-01 through INVAS-05)
│       └── DatasetName/         # Each dataset folder follows this pattern:
│           ├── README.md        # Source, citation, field definitions, data quality notes
│           ├── DATA-DICTIONARY.md # Column definitions, rating scales, merge guidance
│           ├── plants.csv       # Primary output (UTF-8, comma-delimited)
│           ├── plants.json      # Metadata + data (small datasets only)
│           ├── plants.db        # SQLite with indexes
│           ├── scripts/         # Python scripts to parse/build the data
│           │   └── build_data.py
│           └── Sources/         # Original files — PDFs, XLSX, HTML (gitignored)
│               └── original_file.pdf
```

### Production Database API
The Living With Fire production app exposes a REST API at `https://lwf-api.vercel.app`. All reference data is cached locally in `LivingWithFire-DB/api-reference/` for offline agent access. Key files:
- **ATTRIBUTE-REGISTRY.md** — the target schema for all data fusion (125 attributes with UUIDs and allowed values)
- **EAV-QUERY-PATTERNS.md** — SQL recipes and key UUID lookup table
- **SOURCE-REGISTRY.md** — existing production sources (check before creating duplicates)

## Key Conventions

### File Formats
- **CSV** is the canonical format — always `plants.csv` as primary output
- **SQLite** databases have indexes for fast querying — tracked in repo
- **JSON** includes metadata (source URLs, rating scale definitions) — skip for datasets >50K records
- **Sources/** folders contain original downloads (PDFs, XLSX, HTML) and are gitignored
- **DATA-DICTIONARY.md** in each folder defines every column, rating scale, and merge key

### Naming
- `plants.csv` — primary plant list
- `plants_full.csv` — all columns when a simplified version also exists
- `plants_oregon.csv` / `plants_california.csv` — state-specific subsets
- `plants_enriched.csv` — merged with detail page data
- `references.csv` — source bibliography
- `variables.csv` — trait/variable definitions

### Source IDs
Every dataset has a unique Source ID (e.g., `FIRE-01`, `DEER-03`, `INVAS-04`) defined in `DATA-PROVENANCE.md`. When merging datasets, always tag records with their source_id to maintain provenance.

### Data Quality
- Match on `scientific_name`, NEVER on common name alone
- Fire/deer/water ratings are NOT standardized across sources — each uses its own scale
- Taxonomy changes over time — use POWO_WCVP, WorldFloraOnline, or USDA_PLANTS to resolve synonyms
- Coverage varies by region — check each dataset's README for geographic scope

## Dataset Categories

| Category | Prefix | Datasets | Key Fields |
|----------|--------|----------|------------|
| Fire Resistance | `FIRE-` | 12 | firewise_rating, flammability, fire_resistance |
| Deer Resistance | `DEER-` | 6 | deer_rating, deer_rating_code, deer_browse |
| Plant Traits | `TRAIT-` | 2 | type, family, zone, height, spread, sun, water, bloom |
| Taxonomy | `TAXON-` | 3 | family, genus, species, lifeform, climate, native_to |
| Water/Drought | `WATER-`/`DROUGHT-` | 3 | water_use, plant_factor, ET0, drought_tolerance |
| Pollinators | `POLL-` | 3 | pollinators, bloom, flower_color, host_plant |
| Birds | `BIRD-` | 1 | lepidoptera_species, bird_value (genus-level) |
| Native Plants | `NATIVE-` | 4 | state, sun, moisture, height |
| Invasiveness | `INVAS-` | 5 | degree_of_establishment, cal_ipc_rating, category |

## The Three Taxonomy Backbones

These are reference databases for resolving plant names across all other datasets:

| Dataset | Scope | Records | Key Use |
|---------|-------|---------|---------|
| `POWO_WCVP` | Global | 362,739 | Lifeform, climate, native distribution |
| `WorldFloraOnline` | Global | 381,467 | Independent taxonomic cross-validation |
| `USDA_PLANTS` | US | 93,157 | USDA symbols, US common names, OR/CA state lists |

## How to Add a New Dataset

Follow this pattern exactly:

1. Create folder: `database-sources/<category>/NewDatasetName/Sources/` and `database-sources/<category>/NewDatasetName/scripts/`
2. Put original files in `Sources/`
3. Write a parser script in `scripts/` that outputs `plants.csv`, `plants.json`, `plants.db`
4. Write `README.md` with: source, URL, citation, field definitions, data quality notes
5. Write `DATA-DICTIONARY.md` with: column definitions, data types, rating scales, merge keys
6. Assign a Source ID in `data-sources/DATA-PROVENANCE.md` (e.g., `FIRE-13`, `DEER-07`)
7. Update `data-sources/SOURCE-CROSSREF.md` if the source was in the original requirements doc
8. Update `README.md` inventory table

### Script template:
```python
import csv, json, os, sqlite3

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.dirname(SCRIPT_DIR)

# ... parse source data into list of dicts ...

# Write CSV
csv_path = os.path.join(DATA_DIR, "plants.csv")
with open(csv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=fields)
    writer.writeheader()
    for p in plants:
        writer.writerow(p)

# Write JSON (skip if >50K records)
json_path = os.path.join(DATA_DIR, "plants.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump({"source": "...", "url": "...", "plants": plants}, f, indent=2)

# Write SQLite
db_path = os.path.join(DATA_DIR, "plants.db")
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("CREATE TABLE plants (...)")
cur.execute("CREATE INDEX idx_sci ON plants(scientific_name)")
# ... insert records ...
conn.commit(); conn.close()
```

## Task Document Process

This project uses **spec-driven development** where design and implementation are separated into distinct sessions, connected by task documents. Full process described in `AI_COLLABORATION_PROCESS.md`.

### Task Doc Lifecycle
```
docs/tasks/todo/          ← Active specs, ready for implementation
docs/tasks/future/        ← Acknowledged but deferred
docs/tasks/completed/     ← Implemented, reviewed, with commit references
docs/legacy/              ← Deprecated approaches (excluded from AI context)
```

### Task Doc Template

Every implementation task gets a structured MD in `docs/tasks/todo/`. The template:

```markdown
# Title — Brief Descriptive Subtitle

> **Status:** TODO | PLANNING | IN PROGRESS
> **Priority:** P0 (critical) | P1 (important) | P2 (normal) | P3 (polish)
> **Depends on:** What must be done first (or "None")
> **Blocks:** What can't start until this is done (or "None")

## Problem
Why this work exists. Specific symptoms — file paths, line numbers, data issues.

## Current Implementation
What exists today, anchored to real code/data. Reference specific files, schemas, record counts.

## Proposed Changes
What to build. Be specific: file names, column mappings, data flows.

### What Does NOT Change
Explicit scope boundary.

## Migration Strategy
Ordered steps from current → proposed. Number them.

## Files Modified
### New Files
- `path/to/new/File` — purpose

### Modified Files
- `path/to/existing/File` — what changes

## Verification
Concrete steps to confirm it works — not "it should work" but "query X, expect Y rows."
```

### Key Rules
- **Planning docs** (`docs/planning/`) inform task specs but are NOT task specs themselves
- **Task specs** are executable — an implementing agent reads one and knows exactly what to build
- **After implementation**, the agent reconciles the spec against what was built, adds commit refs, and moves to `completed/`
- **Legacy docs** are quarantined — agents don't read them by default to prevent context poisoning

## Common Tasks

### "Tell me everything about [plant]"
Search across all 40 databases by scientific name. Check fire, deer, water, pollinator, invasive, and native status. Return results with source IDs.

### "Find plants matching [criteria]"
Cross-reference datasets: e.g., fire-safe (FIRE-01) + deer-resistant (DEER-01) + low water (WATER-01) + native to Oregon (TAXON-03 state list). Always check invasive databases before recommending.

### "Add this new data source"
Follow the "How to Add a New Dataset" pattern above. Parse to standard formats, write README with citation, assign source ID.

### "Merge datasets for [purpose]"
Tag every record with its source_id. Keep multiple ratings from different sources rather than averaging — let the downstream application decide how to weight them.

## Dependencies

```bash
pip install pdfplumber openpyxl requests beautifulsoup4
```

## Deferred Data Sources

These require JavaScript rendering (Selenium/Playwright) or registration and are not yet captured:
- Calscape (CA Native Plant Society) — JS app
- Audubon Native Plants — JS, no API
- NWF Native Plant Finder — SSL cert issues
- TRY Plant Trait Database — Academic registration
- Invasive Plant Atlas — 403 blocked
