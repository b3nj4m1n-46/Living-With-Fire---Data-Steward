# Genkit Setup — Agent Framework with Anthropic Plugin + Shared Tools

> **Status:** COMPLETED
> **Priority:** P0 (critical)
> **Depends on:** 001-dolt-setup (DoltgreSQL running on port 5433)
> **Blocks:** 003-bootstrap-warrants, all Phase 2 agent tasks
> **Commit:** `5e9ea2b` — Add Genkit agent framework with Anthropic plugin + shared tools

## Problem

The multi-agent system needs a framework for defining typed, observable AI flows that can query the staging database and read dataset metadata. Google Genkit provides model-agnostic flows with Zod schemas, tool registration, and observability — and critically, allows per-agent model selection (Haiku 4.5 for bulk work, Sonnet 4.6 for synthesis).

No agent infrastructure currently exists.

## Current Implementation

### What Exists
- DoltgreSQL staging database (from 001-dolt-setup) with production mirror + Claim/Warrant tables
- 40 source datasets in `database-sources/`, each with `README.md` and `DATA-DICTIONARY.md`
- Production API reference cached in `LivingWithFire-DB/api-reference/`
- `ANTHROPIC_API_KEY` environment variable (to be set by developer)

### What Does NOT Exist Yet
- Genkit project or package.json
- Anthropic model plugin configuration
- Shared Genkit tools for database queries and dataset context
- Any agent flow definitions

## Proposed Changes

### 1. Initialize Genkit Project

Create a `genkit/` directory at the project root for all agent code:

```bash
mkdir genkit && cd genkit
npm init -y
npm install genkit @genkit-ai/anthropic zod pg
npm install -D typescript @types/node @types/pg tsx
```

> **Note:** The package is `@genkit-ai/anthropic` (official Google-maintained), NOT the community `genkitx-anthropic`.

`package.json` must include `"type": "module"` for ESM compatibility.

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### 2. Configure Anthropic Plugin

`genkit/src/config.ts`:

```typescript
import { genkit } from 'genkit';
import { anthropic } from '@genkit-ai/anthropic';

// Conditional plugin init — tools work without API key for DB-only testing
const plugins = process.env.ANTHROPIC_API_KEY
  ? [anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })]
  : [];

export const ai = genkit({ plugins });

// Model constants — single place to change model assignments
export const MODELS = {
  bulk: 'anthropic/claude-haiku-4-5',     // Internal agents: matcher, classifier, specialists
  quality: 'anthropic/claude-sonnet-4-6',  // Admin-facing: synthesis, schema mapper
} as const;
```

> **Note:** The Anthropic plugin throws at import time if no API key is set. The conditional init allows DB tools and smoke tests to run without an API key.

### 3. Database Connection Tool

`genkit/src/tools/dolt.ts`:

Shared `pg` pool connecting to DoltgreSQL on port 5433. Exposes a Genkit tool that agents can use to run arbitrary SQL queries against the staging database.

```typescript
import { Pool } from 'pg';

export const doltPool = new Pool({
  connectionString: process.env.DOLT_CONNECTION_STRING || 'postgresql://postgres:password@localhost:5433/lwf_staging',
});

// Genkit tool: queryDolt
// Input: { sql: string, params?: any[] }
// Output: { rows: any[], rowCount: number }
```

> **Note:** The database name is `lwf_staging` (underscore), not `lwf-staging` (hyphen). Default DoltgreSQL credentials are `postgres:password`.

The tool should:
- Accept parameterized SQL (prevent injection)
- Return rows + rowCount
- Handle connection errors gracefully

### 4. Dataset Context Tool

`genkit/src/tools/datasetContext.ts`:

Reads `DATA-DICTIONARY.md` and `README.md` for a given source dataset. This is how agents understand source methodology, rating scales, and geographic scope.

```typescript
// Genkit tool: getDatasetContext
// Input: { datasetFolder: string }
//   e.g. "database-sources/fire/FirePerformancePlants"
// Output: { dataDictionary: string, readme: string, sourceId: string }
```

The tool should:
- Read both files from the dataset folder (path relative to repo root)
- Extract the source ID via regex from DATA-DICTIONARY.md frontmatter: `/\*\*Source ID:\*\*\s*`([^`]+)`/`
- Fall back to README.md if not found in DATA-DICTIONARY.md, then `'UNKNOWN'`
- Return full text content (agents parse what they need)
- Handle missing files gracefully (return empty string for missing files)

### 5. Production Plant Lookup Tool

`genkit/src/tools/lookupPlant.ts`:

Queries the staging database for a plant by scientific name, returning the plant record and all its values.

```typescript
// Genkit tool: lookupProductionPlant
// Input: { genus: string, species?: string }
// Output: {
//   plant: { id, genus, species, common_name } | null,
//   values: { attribute_name, value, source_name }[],
//   matchCount: number
// }
```

#### DoltgreSQL Compatibility Notes

- **No ILIKE:** Use `LOWER(column) = LOWER($1)` instead of `ILIKE`
- **No cast syntax in conditionals:** Split into separate query paths for genus-only vs genus+species instead of `($2::text IS NULL OR ...)`
- **No LEFT JOIN on nullable FKs:** DoltgreSQL panics on `LEFT JOIN sources s ON s.id = v.source_id` when `source_id` is NULL. Use a correlated subquery instead:
  ```sql
  SELECT a.name AS attribute_name, v."value",
         (SELECT s.name FROM sources s WHERE s.id = v.source_id) AS source_name
  FROM "values" v
  JOIN attributes a ON a.id = v.attribute_id
  WHERE v.plant_id = $1
  ORDER BY a.name
  ```
- **Always quote `"values"`:** It is a PostgreSQL reserved word

### 6. Source Metadata Tool

`genkit/src/tools/sourceMetadata.ts`:

Returns metadata about a production source by UUID or name.

```typescript
// Genkit tool: getSourceMetadata
// Input: { sourceId?: string, sourceName?: string }
// Output: { id, name, url, address, phone, notes, region, target_location,
//           topics_addressed, attribution, ref_code, file_link }
```

> **Note:** The actual `sources` table columns (from 001-dolt-setup) are: `id, name, url, address, phone, notes, region, target_location, topics_addressed, attribution, ref_code, file_link`. The original spec incorrectly listed `source_type, fire_region, citation` — those fields do not exist.

For name search, use `LOWER(name) LIKE LOWER(CONCAT('%', $1, '%'))` instead of `ILIKE`.

### 7. Barrel Export

`genkit/src/tools/index.ts`:

Re-exports all tools individually and provides an `allTools` array for flows that want the full set.

### Project Structure

```
genkit/
├── package.json
├── tsconfig.json
├── src/
│   ├── config.ts              # Genkit init + Anthropic plugin + model constants
│   ├── tools/
│   │   ├── index.ts           # Barrel export + allTools array
│   │   ├── dolt.ts            # DoltgreSQL connection pool + queryDolt tool
│   │   ├── datasetContext.ts  # getDatasetContext tool (reads DATA-DICTIONARY.md + README.md)
│   │   ├── lookupPlant.ts     # lookupProductionPlant tool
│   │   └── sourceMetadata.ts  # getSourceMetadata tool
│   └── flows/                 # Agent flows (created in subsequent tasks)
│       └── .gitkeep
```

### What Does NOT Change

- `LivingWithFire-DB/` — read-only reference
- `database-sources/` — read-only by tools
- DoltgreSQL schema — no table changes in this task
- No agent flows are implemented yet — just the framework and shared tools

## DoltgreSQL Compatibility Gotchas

These were discovered during implementation and apply to all future agent code:

| Feature | PostgreSQL | DoltgreSQL Workaround |
|---------|-----------|----------------------|
| `ILIKE` | Supported | Use `LOWER(col) = LOWER($1)` or `LOWER(col) LIKE LOWER(...)` |
| `$1::text IS NULL` | Supported | Split into separate query branches |
| `LEFT JOIN` on nullable FK | Supported | Use correlated subquery: `(SELECT ... WHERE s.id = v.source_id)` |
| `"values"` table | Must quote | Must quote — reserved word |

## Migration Strategy

1. Create `genkit/` directory at project root
2. Initialize npm project with `"type": "module"`, install dependencies (genkit, @genkit-ai/anthropic, zod, pg, typescript, @types/pg, tsx)
3. Create `tsconfig.json` with `skipLibCheck: true`
4. Implement `src/config.ts` — Genkit init with conditional Anthropic plugin, model constants
5. Implement `src/tools/dolt.ts` — pg pool (with credentials) + queryDolt Genkit tool
6. Implement `src/tools/datasetContext.ts` — reads DATA-DICTIONARY.md + README.md, extracts source ID
7. Implement `src/tools/lookupPlant.ts` — plant lookup using DoltgreSQL-compatible queries
8. Implement `src/tools/sourceMetadata.ts` — source metadata lookup with corrected schema
9. Implement `src/tools/index.ts` — barrel export + allTools array
10. Write a smoke test script (`src/test-tools.ts`) that exercises each tool
11. Verify: run smoke test against live DoltgreSQL

## Files Modified

### New Files
- `genkit/package.json` — dependencies (ESM, type: module)
- `genkit/tsconfig.json` — TypeScript config
- `genkit/src/config.ts` — Genkit + conditional Anthropic plugin + model constants
- `genkit/src/tools/dolt.ts` — DoltgreSQL query tool
- `genkit/src/tools/datasetContext.ts` — dataset context reader
- `genkit/src/tools/lookupPlant.ts` — production plant lookup
- `genkit/src/tools/sourceMetadata.ts` — source metadata lookup
- `genkit/src/tools/index.ts` — barrel export + allTools array
- `genkit/src/test-tools.ts` — smoke test script
- `genkit/src/flows/.gitkeep` — placeholder for future flows

### Modified Files
- `.gitignore` — add `genkit/node_modules/`, `genkit/dist/`

### Unchanged
- All dataset folders — read-only
- DoltgreSQL database — read-only in this task
- `LivingWithFire-DB/` — read-only reference

## Verification

1. **Dependencies installed:**
   ```bash
   cd genkit && npm ls genkit @genkit-ai/anthropic pg zod
   # All listed without errors
   ```
2. **TypeScript compiles:**
   ```bash
   npx tsc --noEmit
   # No errors
   ```
3. **queryDolt tool works:**
   ```typescript
   const result = await queryDolt({ sql: 'SELECT COUNT(*) as cnt FROM plants' });
   // result.rows[0].cnt === 1361
   ```
4. **getDatasetContext tool works:**
   ```typescript
   const ctx = await getDatasetContext({
     datasetFolder: 'database-sources/fire/FirePerformancePlants'
   });
   // ctx.sourceId === 'FIRE-01'
   // ctx.dataDictionary contains 'firewise_rating'
   ```
5. **lookupProductionPlant tool works:**
   ```typescript
   const result = await lookupProductionPlant({ genus: 'Ceanothus', species: 'velutinus' });
   // result.plant is not null
   // result.values.length === 80
   // result.matchCount === 1
   ```
6. **getSourceMetadata tool works:**
   ```typescript
   const result = await getSourceMetadata({ sourceName: 'Ashland' });
   // result.name === 'City of Ashland'
   ```
7. **Anthropic API connectivity (conditional — requires ANTHROPIC_API_KEY):**
   ```typescript
   const response = await ai.generate({
     model: MODELS.bulk,
     prompt: 'Reply with just the word "connected"',
   });
   // response.text contains "connected"
   ```
