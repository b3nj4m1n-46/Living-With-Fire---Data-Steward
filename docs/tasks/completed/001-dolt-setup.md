# DoltgreSQL Setup — Staging Database with Production Mirror + Claim/Warrant Tables

> **Status:** COMPLETED
> **Priority:** P0 (critical)
> **Depends on:** None — start here
> **Blocks:** 002-genkit-setup, 003-bootstrap-warrants
> **Commit:** `3f87073` — Add DoltgreSQL staging database setup scripts (001-dolt-setup)

## Problem

The admin portal needs a versioned staging database that mirrors the production EAV schema and extends it with Claim/Warrant tables. DoltgreSQL provides git-for-data capabilities (branch, diff, commit, revert) over the PostgreSQL wire protocol — critical for the audit trail that makes the Claim/Warrant model trustworthy.

No staging database currently exists. The production data lives in Neon PostgreSQL (accessed via `LivingWithFire-DB/` CSV exports) and must be imported into DoltgreSQL without modifying production.

## Current Implementation

### Production Data (source of truth for import)

The production database is exported as CSV files in `LivingWithFire-DB/`:

| File | Records | Description |
|------|---------|-------------|
| `plants.csv` | 1,361 | Plant entities (id, genus, species, common_name, etc.) |
| `values.csv` | 94,903 | EAV values (plant_id, attribute_id, value, source_id) |
| `attributes.csv` | 125 | Attribute definitions (hierarchical trait taxonomy) |
| `sources.csv` | 103 | Source provenance records |
| `attribute_sources.csv` | — | Junction: which sources provide which attributes |
| `filter_presets.csv` | — | Pre-built filter combinations for the public app |
| `key_terms.csv` | — | Glossary terms |
| `nurseries.csv` | — | Nursery listings |
| `risk_reduction_snippets.csv` | — | Fire risk tips |

Schema details: `LivingWithFire-DB/DATA-DICTIONARY.md`

### What Does NOT Exist Yet

- DoltgreSQL installation
- Staging database
- Claim/Warrant tables (warrants, conflicts, claims, claim_warrants, analysis_batches)

## Proposed Changes

### 1. Install DoltgreSQL

DoltgreSQL speaks the PostgreSQL wire protocol, so the admin portal can use the same `pg` client for both staging (DoltgreSQL) and production (Neon).

```bash
# Windows — download from GitHub releases
# https://github.com/dolthub/doltgresql/releases/latest
# Add to PATH
doltgres --version
```

### 2. Initialize Staging Database

```bash
mkdir lwf-staging && cd lwf-staging
doltgres init
```

Start server on port 5433 (avoid conflict with any local PostgreSQL on 5432):

```bash
doltgres --host 0.0.0.0 --port 5433
```

**Connection string:** `postgresql://localhost:5433/lwf-staging`

### 3. Create Production Mirror Tables

Create the 4 core EAV tables matching the production schema exactly. Column types and names must match `LivingWithFire-DB/DATA-DICTIONARY.md`:

```sql
-- plants table (1,361 records)
CREATE TABLE plants (
  id                    VARCHAR(36) PRIMARY KEY,
  genus                 VARCHAR(255) NOT NULL,
  species               VARCHAR(255),
  subspecies_varieties  TEXT,
  common_name           TEXT,
  notes                 TEXT,
  last_updated          TIMESTAMP,
  urls                  TEXT
);

-- attributes table (125 records)
CREATE TABLE attributes (
  id                    VARCHAR(36) PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  parent_attribute_id   VARCHAR(36),
  value_type            VARCHAR(50),
  values_allowed        TEXT,
  value_units           VARCHAR(100),
  notes                 TEXT,
  display_type          VARCHAR(50)
);

-- sources table (103 records)
CREATE TABLE sources (
  id                    VARCHAR(36) PRIMARY KEY,
  name                  VARCHAR(255) NOT NULL,
  url                   TEXT,
  source_type           VARCHAR(100),
  fire_region           VARCHAR(255),
  notes                 TEXT,
  citation              TEXT
);

-- values table (94,903 records)
CREATE TABLE values (
  id                    VARCHAR(36) PRIMARY KEY,
  attribute_id          VARCHAR(36) NOT NULL,
  plant_id              VARCHAR(36) NOT NULL,
  value                 TEXT,
  source_id             VARCHAR(36),
  notes                 TEXT,
  source_value          TEXT,
  metadata              TEXT,
  urls                  TEXT
);

CREATE INDEX idx_values_plant ON values(plant_id);
CREATE INDEX idx_values_attribute ON values(attribute_id);
CREATE INDEX idx_values_source ON values(source_id);
CREATE INDEX idx_values_plant_attr ON values(plant_id, attribute_id);
```

### 4. Import Production CSVs

Write a Node.js or Python import script that:
1. Reads each CSV from `LivingWithFire-DB/`
2. Inserts into DoltgreSQL via the `pg` client (connection: `postgresql://localhost:5433/lwf-staging`)
3. Verifies row counts match source files

Import order (respects FK relationships):
1. `plants.csv` (1,361)
2. `attributes.csv` (125)
3. `sources.csv` (103)
4. `values.csv` (94,903)

### 5. Create Claim/Warrant Tables

Full schemas defined in `docs/planning/PROPOSALS-SCHEMA.md`. Create all 5 tables:

- `warrants` — source evidence for plant+attribute pairs
- `conflicts` — detected disagreements between warrants
- `claims` — finalized synthesized production values
- `claim_warrants` — junction linking claims to supporting warrants
- `analysis_batches` — tracking analysis runs

### 6. Initial Dolt Commit

```sql
SELECT dolt_add('.');
SELECT dolt_commit('-m', 'production mirror: 1,361 plants, 94,903 values, 125 attributes, 103 sources');
```

### What Does NOT Change

- Production Neon database — zero writes to production
- CSV files in `LivingWithFire-DB/` — read-only source for import
- Any source dataset files in `database-sources/`

## Migration Strategy

1. Install DoltgreSQL binary, verify with `doltgres --version`
2. Initialize database: `doltgres init` in a `lwf-staging/` directory
3. Start DoltgreSQL server on port 5433
4. Create production mirror tables (plants, attributes, sources, values)
5. Write and run import script against `LivingWithFire-DB/*.csv`
6. Verify row counts: plants=1361, attributes=125, sources=103, values=94903
7. Create Claim/Warrant tables (warrants, conflicts, claims, claim_warrants, analysis_batches)
8. Create indexes on key columns
9. Run `dolt_commit` to snapshot the initial state
10. Verify: `SELECT * FROM dolt_log ORDER BY date DESC LIMIT 5` shows the commit

## Files Modified

### New Files
- `lwf-staging/` — DoltgreSQL database directory (gitignored — local dev only)
- `scripts/import_production.py` (or `.ts`) — import script for production CSVs
- `scripts/create_warrant_tables.sql` — DDL for Claim/Warrant tables

### Modified Files
- `.gitignore` — add `lwf-staging/` directory

### Unchanged
- `LivingWithFire-DB/` — read-only, no modifications
- `database-sources/` — not touched in this task

## Verification

1. **DoltgreSQL running:** `psql postgresql://localhost:5433/lwf-staging -c "SELECT 1"` returns 1
2. **Row counts match:**
   ```sql
   SELECT 'plants' AS tbl, COUNT(*) FROM plants
   UNION ALL SELECT 'attributes', COUNT(*) FROM attributes
   UNION ALL SELECT 'sources', COUNT(*) FROM sources
   UNION ALL SELECT 'values', COUNT(*) FROM values;
   -- Expected: 1361, 125, 103, 94903
   ```
3. **Claim/Warrant tables exist:**
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   ORDER BY table_name;
   -- Should list: analysis_batches, attributes, claim_warrants, claims, conflicts, plants, sources, values, warrants
   ```
4. **Dolt versioning works:**
   ```sql
   SELECT * FROM dolt_log ORDER BY date DESC LIMIT 1;
   -- Should show the initial commit
   ```
5. **Sample data integrity:**
   ```sql
   SELECT p.genus, p.species, COUNT(v.id) AS value_count
   FROM plants p JOIN values v ON v.plant_id = p.id
   WHERE p.genus = 'Ceanothus' AND p.species = 'velutinus'
   GROUP BY p.genus, p.species;
   -- Should return a non-zero value_count
   ```

---

## Implementation Notes

**Completed:** 2026-03-28 | **Commit:** `3f87073`

### Schema corrections from spec

The original spec had several schema mismatches vs the actual production CSVs. All were corrected:

| Issue | Spec Said | Corrected To |
|-------|-----------|-------------|
| `sources` columns | `source_type, fire_region, citation` (7 cols) | `address, phone, region, target_location, topics_addressed, attribution, ref_code, file_link` (12 cols) |
| `attributes` column | `display_type` | `selection_type` |
| `values` table name | Unquoted | Quoted as `"values"` (PostgreSQL reserved word) |
| Tables imported | 4 core tables only | All 13 production CSV tables |
| Claim/Warrant ENUMs | MySQL `ENUM('a','b')` | `VARCHAR(N)` (DoltgreSQL PostgreSQL compatibility) |
| Claim/Warrant indexes | MySQL inline `INDEX` | Separate `CREATE INDEX` statements |

### DoltgreSQL setup details

- **Version:** 0.55.6
- **Port:** 5433
- **Default credentials:** `postgres` / `password` (DoltgreSQL default)
- **Database:** `lwf_staging` (created via `CREATE DATABASE`)
- **Config:** `lwf-staging/config.yaml` (listener port override)
- **Dolt commit hash:** `f3imeuite70s1bh1vcmni8nhg6em7oun`

### Files delivered

| File | Purpose |
|------|---------|
| `scripts/create_staging_tables.sql` | DDL for 13 production mirror tables + indexes |
| `scripts/create_warrant_tables.sql` | DDL for 5 Claim/Warrant tables + indexes |
| `scripts/import_production.py` | CSV import, verification, Dolt commit |
| `.gitignore` | Added `lwf-staging/`, `.doltcfg/`, `auth.db` |

### Verification results

- All 13 CSV row counts verified (1,361 plants, 94,903 values, 125 attributes, 103 sources + 9 more)
- All 18 tables present (13 production + 5 Claim/Warrant)
- Dolt commit and log working
- Sample query: Ceanothus velutinus = 80 values
