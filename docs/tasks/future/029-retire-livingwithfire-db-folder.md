# 029 — Retire LivingWithFire-DB/ Folder

> **Status:** FUTURE
> **Priority:** P3 (polish)
> **Depends on:** None (standalone housekeeping)
> **Blocks:** Nothing

## Problem

The `LivingWithFire-DB/` folder is a stale local snapshot of the Neon production database. The admin portal connects to Neon directly via `admin/src/lib/production.ts` (`queryProd()`), so the CSVs and SQLite files are not used at runtime and will drift further from production as curation continues.

The folder contains two distinct things:
1. **Reference documentation** (`api-reference/`, `README.md`, `DATA-DICTIONARY.md`) — actively used by agents and developers to understand the production schema
2. **Data snapshots** (CSVs, SQLite, JSON) — stale point-in-time exports, not read by any production code

## Current State

### What's in `LivingWithFire-DB/`

**Reference docs (keep, relocate):**
- `api-reference/` — ATTRIBUTE-REGISTRY.md, EAV-QUERY-PATTERNS.md, SOURCE-REGISTRY.md, openapi-spec.json, cached JSON responses (14 files)
- `README.md` — EAV schema overview, connection info, rebuild steps
- `DATA-DICTIONARY.md` — All 13 tables with column definitions

**Data snapshots (delete):**
- `plants.csv` (1,361 rows), `values.csv` (94,903 rows), `sources.csv`, `attributes.csv`
- `attribute_sources.csv`, `filter_presets.csv`, `key_terms.csv`, `nurseries.csv`
- `plant_images.csv`, `plant_nurseries.csv`, `plant_research.csv`
- `resource_sections.csv`, `risk_reduction_snippets.csv`
- `plants.db` (SQLite), `plants.json`

**Scripts (delete — one-time generators, can be re-derived):**
- `scripts/build_sqlite.py`
- `scripts/extract_tables.py`
- `scripts/generate_attribute_registry.py`
- `scripts/generate_source_registry.py`

### Files That Reference `LivingWithFire-DB` (25 total)

**Path references to update (`LivingWithFire-DB/api-reference/` → `docs/reference/production/`):**
- `CLAUDE.md` — repo structure tree, production API section (3 references)
- `README.md` — production database section, repo structure tree (4 references)
- `README-HACKATHON.md` — repo structure tree (1 reference)
- `docs/planning/ARCHITECTURE.md` — agent context section (1 reference)
- `docs/planning/DATASET-MAPPINGS.md` — source schema links (3 references)
- `docs/planning/TASKS.md` — verification task (1 reference)
- `docs/planning/IMPLEMENTATION-PLAN.md` — CSV import reference (1 reference)
- `docs/planning/agents/schema-mapper-agent.md` — tool references (3 references)
- `docs/planning/agents/research-agent.md` — tool references (2 references)
- `docs/planning/agents/rating-conflict-agent.md` — tool references (1 reference)
- `docs/planning/agents/matcher-agent.md` — tool references (1 reference)
- `docs/planning/agents/conflict-classifier-agent.md` — tool references (3 references)
- `docs/planning/agents/bulk-enhancer-agent.md` — tool references (3 references)
- `docs/tasks/completed/002-genkit-setup.md` — context note (1 reference)
- `docs/tasks/completed/003-bootstrap-warrants.md` — SQL + notes (5 references)
- `docs/tasks/completed/005-schema-mapper-agent.md` — context note (1 reference)
- `docs/tasks/completed/007-internal-conflict-scan.md` — SQL string (1 reference)
- `docs/tasks/completed/018-production-sync.md` — schema references (3 references)

**String identifiers in code (`'LivingWithFire-DB'` as a dataset name — may keep as-is or rename):**
- `genkit/src/scripts/bootstrap-warrants.ts` — `source_dataset = 'LivingWithFire-DB'` (2 references)
- `genkit/src/scripts/internal-conflict-scan.ts` — `source_dataset = 'LivingWithFire-DB'` (1 reference)
- `scripts/import_production.py` — `CSV_DIR` pointed at local folder (1 reference)
- `scripts/create_staging_tables.sql` — comment referencing CSV headers (1 reference)

**Gitignore:**
- `.gitignore` — `LivingWithFire-DB/Sources/` entry (remove entire line after folder deleted)

## Proposed Changes

### Move reference docs
```
LivingWithFire-DB/api-reference/  →  docs/reference/production/
LivingWithFire-DB/README.md       →  docs/reference/production/README.md
LivingWithFire-DB/DATA-DICTIONARY.md → docs/reference/production/DATA-DICTIONARY.md
```

### Delete data files
All CSVs, `plants.db`, `plants.json`, and `scripts/` in `LivingWithFire-DB/`. Then delete the now-empty `LivingWithFire-DB/` folder.

### Update path references
Find-and-replace `LivingWithFire-DB/api-reference/` → `docs/reference/production/` across all 25 files listed above. For completed task docs, update paths but don't rewrite content (they're historical records).

### Code string identifiers
The string `'LivingWithFire-DB'` used as a `source_dataset` value in Genkit scripts is a **logical name**, not a file path. Leave these as-is — they identify the production database as a data source in the warrant/conflict tables, not the folder on disk.

### Update `.gitignore`
Remove the `LivingWithFire-DB/Sources/` line.

### What Does NOT Change
- `docs/reference/ADMIN-API-REFERENCE.md` — already in the right place
- Production database connection (`admin/src/lib/production.ts`) — connects to Neon, never referenced local files
- Any data in Neon or Dolt — this is purely a repo reorganization

## Migration Strategy

1. `git mv LivingWithFire-DB/api-reference docs/reference/production`
2. `git mv LivingWithFire-DB/README.md docs/reference/production/README.md`
3. `git mv LivingWithFire-DB/DATA-DICTIONARY.md docs/reference/production/DATA-DICTIONARY.md`
4. `git rm` all CSVs, `plants.db`, `plants.json`, and `scripts/` from `LivingWithFire-DB/`
5. Remove `LivingWithFire-DB/Sources/` line from `.gitignore`
6. Find-and-replace all path references across the 25 files listed above
7. Verify no broken links: grep the entire repo for `LivingWithFire-DB` — should return only the code string identifiers in Genkit scripts
8. Single commit with all changes

## Verification

1. `grep -r "LivingWithFire-DB/api-reference" .` → zero results
2. `grep -r "LivingWithFire-DB/" .` → only Genkit script string identifiers and this task doc
3. `docs/reference/production/ATTRIBUTE-REGISTRY.md` exists and is readable
4. `docs/reference/production/EAV-QUERY-PATTERNS.md` exists and is readable
5. `docs/reference/production/SOURCE-REGISTRY.md` exists and is readable
6. `LivingWithFire-DB/` folder no longer exists in repo
7. Admin portal still connects to Neon and functions normally (no runtime dependency on local files)
