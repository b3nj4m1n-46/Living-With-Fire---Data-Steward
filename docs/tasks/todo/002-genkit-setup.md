# Genkit Setup — Agent Framework with Anthropic Plugin + Shared Tools

> **Status:** TODO
> **Priority:** P0 (critical)
> **Depends on:** 001-dolt-setup (DoltgreSQL running on port 5433)
> **Blocks:** 003-bootstrap-warrants, all Phase 2 agent tasks

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
npm install -D typescript @types/node tsx
```

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
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

### 2. Configure Anthropic Plugin

`genkit/src/config.ts`:

```typescript
import { genkit } from 'genkit';
import { anthropic } from 'genkitx-anthropic';

export const ai = genkit({
  plugins: [
    anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  ],
});

// Model constants — single place to change model assignments
export const MODELS = {
  bulk: 'anthropic/claude-haiku-4-5',     // Internal agents: matcher, classifier, specialists
  quality: 'anthropic/claude-sonnet-4-6',  // Admin-facing: synthesis, schema mapper
} as const;
```

### 3. Database Connection Tool

`genkit/src/tools/dolt.ts`:

Shared `pg` pool connecting to DoltgreSQL on port 5433. Exposes a Genkit tool that agents can use to run arbitrary SQL queries against the staging database.

```typescript
import { Pool } from 'pg';

export const doltPool = new Pool({
  connectionString: process.env.DOLT_CONNECTION_STRING || 'postgresql://localhost:5433/lwf-staging',
});

// Genkit tool: queryDolt
// Input: { sql: string, params?: any[] }
// Output: { rows: any[], rowCount: number }
```

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
- Read both files from the dataset folder
- Extract the source ID from DATA-PROVENANCE.md or the README
- Return full text content (agents parse what they need)
- Handle missing files gracefully (some datasets may lack DATA-DICTIONARY.md)

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

### 6. Source Metadata Tool

`genkit/src/tools/sourceMetadata.ts`:

Returns metadata about a production source by ID or name.

```typescript
// Genkit tool: getSourceMetadata
// Input: { sourceId?: string, sourceName?: string }
// Output: { id, name, url, source_type, fire_region, notes, citation }
```

### Project Structure

```
genkit/
├── package.json
├── tsconfig.json
├── src/
│   ├── config.ts              # Genkit init + Anthropic plugin + model constants
│   ├── tools/
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

## Migration Strategy

1. Create `genkit/` directory at project root
2. Initialize npm project, install dependencies (genkit, anthropic plugin, zod, pg, typescript)
3. Create `tsconfig.json`
4. Implement `src/config.ts` — Genkit init with Anthropic plugin, model constants
5. Implement `src/tools/dolt.ts` — pg pool + queryDolt Genkit tool
6. Implement `src/tools/datasetContext.ts` — reads DATA-DICTIONARY.md + README.md
7. Implement `src/tools/lookupPlant.ts` — plant lookup via staging DB
8. Implement `src/tools/sourceMetadata.ts` — source metadata lookup
9. Write a smoke test script (`src/test-tools.ts`) that exercises each tool
10. Verify: run smoke test against live DoltgreSQL

## Files Modified

### New Files
- `genkit/package.json` — dependencies
- `genkit/tsconfig.json` — TypeScript config
- `genkit/src/config.ts` — Genkit + Anthropic plugin + model constants
- `genkit/src/tools/dolt.ts` — DoltgreSQL query tool
- `genkit/src/tools/datasetContext.ts` — dataset context reader
- `genkit/src/tools/lookupPlant.ts` — production plant lookup
- `genkit/src/tools/sourceMetadata.ts` — source metadata lookup
- `genkit/src/test-tools.ts` — smoke test script

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
   // In test-tools.ts
   const result = await queryDolt({ sql: 'SELECT COUNT(*) as cnt FROM plants' });
   // result.rows[0].cnt === 1361
   ```
4. **getDatasetContext tool works:**
   ```typescript
   const ctx = await getDatasetContext({
     datasetFolder: 'database-sources/fire/FirePerformancePlants'
   });
   // ctx.readme contains "SREF" or "Fire Performance"
   // ctx.dataDictionary contains column definitions
   ```
5. **lookupProductionPlant tool works:**
   ```typescript
   const result = await lookupProductionPlant({ genus: 'Ceanothus', species: 'velutinus' });
   // result.plant is not null
   // result.values.length > 0
   ```
6. **Anthropic API connectivity:**
   ```typescript
   const response = await ai.generate({
     model: MODELS.bulk,
     prompt: 'Reply with just the word "connected"',
   });
   // response.text contains "connected"
   ```
