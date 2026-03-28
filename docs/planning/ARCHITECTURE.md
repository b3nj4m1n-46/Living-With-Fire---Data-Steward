# Technical Architecture: Data Fusion Admin Portal

## System Overview

```
+--------------------------------------------------+
|              ADMIN PORTAL (Next.js)               |
|  +----------+ +----------+ +-------+ +---------+ |
|  | Table    | | Conflict | | Fact  | | Source  | |
|  | Fusion   | | Resolve  | | Check | | Collect | |
|  +----------+ +----------+ +-------+ +---------+ |
+---------------------------+-----------------------+
                            |
                     API Routes (Next.js)
                            |
              +-------------+-------------+
              |                           |
     +--------v--------+      +----------v----------+
     | Dolt Database   |      | Multi-Agent System   |
     | (Staging Layer) |      | (Python + Claude API)|
     |                 |      |                       |
     | - plants        |      | - Taxonomy Agent      |
     | - attributes    |      | - Mapping Agent       |
     | - values        |      | - Conflict Detector   |
     | - sources       |      | - Research Agent (RAG)|
     | - proposals     |      | - Explanation Agent   |
     | - conflicts     |      +-----------+-----------+
     | - resolutions   |                  |
     +--------+--------+      +-----------v-----------+
              |               | LivinWitFire Collection|
        [on approval]         | 40 datasets + 52 PDFs  |
              |               | DATA-DICTIONARY.md each |
     +--------v--------+     +------------------------+
     | Neon PostgreSQL  |
     | (Production DB)  |
     | lwf-app reads    |
     +------------------+
```

## Architecture Decisions

### Dolt as Staging Layer (Not Production Replacement)

The production app (lwf-app.vercel.app) runs against Neon PostgreSQL. We do NOT migrate to Dolt. Instead:

- Dolt mirrors the production EAV tables (plants, values, attributes, sources)
- All enhancement/fusion work happens in Dolt
- Dolt provides: branching, diffing, commit history, blame, revert
- On approval, changes sync from Dolt `main` → Neon PostgreSQL

**Why:** Zero risk to the production app. The public site never touches Dolt. Dolt is the admin's workspace.

### EAV Schema Preserved

The production database uses Entity-Attribute-Value. We don't change this. The admin portal works WITH the EAV pattern:

```
plants (entity)     → 1,361 rows: id, genus, species, common_name
attributes (schema) → 125 rows: hierarchical trait definitions
values (data)       → 94,903 rows: plant_id + attribute_id + value + source_id
sources (provenance)→ 103 rows: where each value came from
```

New tables added in Dolt for the Claim/Warrant workflow:
- `warrants` — source evidence for plant attributes (raw claims from each source)
- `conflicts` — detected disagreements between warrants
- `claims` — finalized production values synthesized from curated warrants
- `claim_warrants` — junction table linking claims to their supporting warrants
- `analysis_batches` — tracking which datasets have been analyzed

See PROPOSALS-SCHEMA.md for full table definitions.

### Multi-Agent System (Google Genkit)

Agents are implemented as **Genkit flows** — typed, observable, and model-agnostic. Genkit provides:
- **Flow definitions** with Zod input/output schemas
- **Tool registration** for database queries, file reads, RAG search
- **Model flexibility** — Claude, Gemini, or any LLM via plugins
- **Observability** — traces every flow execution for debugging and audit

Agents are orchestrated by the Next.js API routes (not by each other). There is no cross-agent communication — agents read from and write to Dolt, which serves as the shared state. The API routes call Genkit flows sequentially or in parallel, passing results between them through the database.

**Why Genkit:** Model-agnostic (can switch between Claude, Gemini, etc. per agent based on cost/quality tradeoffs). Typed flows with Zod schemas. Integrates natively with Next.js. No heavy orchestration framework needed — the database IS the coordination layer.

### Next.js Admin Portal

The portal is a read/write interface to Dolt. It:
- Reads proposals, conflicts, and production data from DoltgreSQL (via pg)
- Writes resolution decisions back to Dolt
- Triggers Dolt commits and merges via SQL stored procedures
- Calls Claude API on-demand for explanations (via API routes)

**Why Next.js:** Fast to scaffold with shadcn/ui. Good table UX (sortable, filterable, selectable). API routes built in. Same framework as the existing lwf-app.

## The EAV Schema in Detail

### How Production Stores Data

A single plant trait looks like this across 3 tables:

```
plants:     { id: "abc-123", genus: "Ceanothus", species: "velutinus" }
attributes: { id: "def-456", name: "Flammability", parent: null }
values:     { plant_id: "abc-123", attribute_id: "def-456",
              value: "Consider", source_id: "ghi-789" }
sources:    { id: "ghi-789", name: "City of Ashland" }
```

### Attribute Hierarchy (125 attributes, 8 top-level categories)

```
Flammability
├── Character Score (numeric 1-20+)
│   ├── Tree, Shrub, Vine, Graminoid (sub-scores)
│   └── All plants (general questions 18, 20, 22A-D)
├── Home Ignition Zone (0-5, 5-10, 10-30, 30-100, 50-100 ft)
├── List Choice (Unsuitable, Consider, Charisse's list, Conflict)
├── Restrictions (Ashland municipal restrictions)
├── Flammability Notes
├── Risk Reduction Notes
└── Idaho Database planting distance

Growth
├── Plant Size → Plant Height (Min/Max) + Plant Width (Min/Max)
├── Plant Structure (22 sub-attributes: Tree, Shrub, Vine, Evergreen, Deciduous, etc.)
└── Bloom & Flower → Flower Color, Bloom Time, Flower Smell

Environmental Requirements to Thrive
├── Light Needs (Full Sun, Part Sun/Shade, Shade)
├── Hardiness Zone (4-9)
└── Climate Vulnerable

Water Requirements
├── Water Needs → Water Amount, Water Season
└── Drought Tolerant (Low/Medium/High)

Nativeness
├── Native Status (Oregon, S. Oregon, Naturalized, Coastal OR, California)
└── Oregon Native (boolean with Conflict flag)

Invasiveness
├── Invasive (Conflict, Agree invasive)
└── Invasive Qualities (Invasive, Noxious weed, Invades wetlands)

Wildlife Values
├── Benefits (Pollinator friendly/host/food, Bird shelter/food, Bat)
├── Deer Resistance (Some, High, Very High)
└── Wildlife Sum (Calculated)

Utility
├── Landscape Use (screen, border, groundcover)
├── Erosion Control
└── Lawn Replace
```

### How Proposals Map to EAV

When an agent analyzes a source dataset, each source record potentially generates multiple EAV proposals:

**Source record (FirePerformancePlants):**
```csv
scientific_name: Ceanothus velutinus
firewise_rating_code: 1
landscape_zone: LZ2
```

**Generated proposals:**
```
Proposal 1: { plant: Ceanothus velutinus, attribute: Flammability,
              value: "Firewise (1)", source: FIRE-01, type: new_value }
Proposal 2: { plant: Ceanothus velutinus, attribute: Home Ignition Zone,
              value: "LZ2 (5-30 ft)", source: FIRE-01, type: new_value }
```

If the production DB already has a Flammability value for this plant from a different source, the agent generates a **conflict** instead.

## Dolt Workflow

### Branch Strategy

```
main                         ← mirrors production state
  ├── internal-audit         ← internal conflict scan results
  ├── batch/fire-01          ← FirePerformancePlants analysis
  ├── batch/water-01         ← WUCOLS analysis
  └── batch/deer-01          ← RutgersDeerResistance analysis
```

For hackathon MVP, simplify to a single `proposals` branch.

### Operations

| Step | Dolt Operation | Who |
|------|---------------|-----|
| Setup | `dolt init` + import production CSVs + `dolt commit -m "initial production mirror"` | Setup script |
| Analysis | `dolt checkout -b batch/fire-01` + INSERT proposals + `dolt commit` | Agent |
| Review | `SELECT * FROM dolt_diff('main', 'batch/fire-01', 'values')` | Admin portal |
| Approve | `CALL dolt_merge('batch/fire-01')` on main | Admin portal |
| Sync | Read Dolt main diff since last sync → upsert to Neon | Sync script |

### DoltgreSQL as PostgreSQL-Compatible Staging Server

DoltgreSQL speaks the **PostgreSQL wire protocol**, so we use the same `pg` client library for both the staging DB (DoltgreSQL) and production DB (Neon). No MySQL needed anywhere in the stack.

```bash
# Install
sudo bash -c 'curl -L https://github.com/dolthub/doltgresql/releases/latest/download/install.sh | bash'

# Initialize
mkdir lwf-staging && cd lwf-staging
doltgres init

# Start server (PostgreSQL protocol, port 5433 to avoid Neon conflict)
doltgres --host 0.0.0.0 --port 5433
```

**Connection string:** `postgresql://localhost:5433/lwf-staging` — works with `pg`, Prisma, Drizzle, etc.

Dolt-specific operations via SQL (same syntax as Dolt, now over PostgreSQL):

```sql
-- Version control
SELECT dolt_add('.');
SELECT dolt_commit('-m', 'Accepted 47 new water values from WUCOLS');
SELECT dolt_checkout('main');
SELECT dolt_merge('batch/water-01');

-- Diffing
SELECT * FROM dolt_diff('main', 'batch/water-01', 'values');

-- History
SELECT * FROM dolt_log ORDER BY date DESC LIMIT 20;

-- Branching
SELECT dolt_checkout('-b', 'batch/fire-01');
```

**Why DoltgreSQL over Dolt:**
- Same PostgreSQL wire protocol as Neon production — one `pg` client, not mysql2 + pg
- Same SQL syntax for both staging and production queries
- Schema can be identical between staging and production
- 91% PostgreSQL compatibility (beta) — sufficient for our EAV schema
- 5.2x slower than PostgreSQL — irrelevant for 1,361 plants

## Multi-Agent Design (Genkit Flows)

All agents are Genkit flows with typed input/output schemas. Full profiles with system prompts, tools, and examples are in `hackathon-prep/agents/`.

### Orchestration Pattern

Agents don't communicate with each other directly. The Next.js API routes orchestrate the flow:

```
POST /api/analyze-source
  → Schema Mapper (mapSchemaFlow)
  → admin reviews mapping
  → Matcher (matchPlantFlow)
  → Bulk Enhancer (bulkEnhanceFlow) — creates warrants
  → Conflict Classifier (classifyConflictFlow) — detects conflicts
  → Specialist dispatch (by conflict type)
  → results stored in Dolt → UI renders warrant cards

POST /api/synthesize-claim
  → admin selects warrants
  → Synthesis Agent (synthesizeClaimFlow)
  → returns draft claim → admin reviews

POST /api/finalize-claim
  → writes claim to Dolt
  → CALL dolt_commit(...)
  → provenance chain preserved
```

### Data Pipeline Agents

| Agent | Genkit Flow | Purpose |
|-------|------------|---------|
| **Matcher** | `matchPlantFlow` | Match source plants to production via taxonomy resolution (POWO/WFO/USDA) |
| **Schema Mapper** | `mapSchemaFlow` | Auto-suggest column mappings from source to production schema |
| **Bulk Enhancer** | `bulkEnhanceFlow` | Execute approved mapping — create warrants for each plant+attribute |

### Conflict Detection & Classification

| Agent | Genkit Flow | Purpose |
|-------|------------|---------|
| **Conflict Classifier** | `classifyConflictFlow` | Detect conflicts, classify type (8 categories), assign severity, route to specialist |

### Specialist Conflict Agents

Dispatched by the Conflict Classifier based on conflict type. Each specialist has domain-specific knowledge and assessment criteria.

| Agent | Genkit Flow | Conflict Type | Domain Knowledge |
|-------|------------|---------------|------------------|
| **Rating Conflict** | `ratingConflictFlow` | Direct contradictions | Rating scale crosswalks, normalization |
| **Scope** | `scopeConflictFlow` | Geographic mismatch | Source regions, climate zones, PNW applicability |
| **Temporal** | `temporalConflictFlow` | Outdated vs current | Publication dates, methodology evolution |
| **Methodology** | `methodologyConflictFlow` | Lab vs field vs lit review | Study design quality hierarchy |
| **Definition** | `definitionConflictFlow` | Same term, different meaning | DATA-DICTIONARY semantic comparison |
| **Taxonomy** | `taxonomyConflictFlow` | Naming/synonym issues | POWO/WFO/USDA backbone resolution |

### Research & Synthesis Agents

| Agent | Genkit Flow | Purpose |
|-------|------------|---------|
| **Research** | `researchConflictFlow` | RAG search of 52 knowledge-base PDFs for evidence |
| **Synthesis** | `synthesizeClaimFlow` | Merge admin's selected warrants into a rich production claim |

### Agent Communication via Database

```
Matcher writes → warrants table
Bulk Enhancer writes → warrants table
Conflict Classifier reads warrants → writes conflicts table
Specialists read conflicts → annotate conflicts table
Research Agent reads conflicts → annotates warrants table
Synthesis Agent reads selected warrants → writes claims table
Admin reads everything → curates via UI → triggers Dolt commits
```

No agent calls another agent. The database is the coordination layer. This makes the system:
- **Debuggable** — every intermediate state is in the DB
- **Resumable** — if an agent fails, restart from last DB state
- **Auditable** — full trace from source → warrant → conflict → claim
- **Model-flexible** — each agent can use a different model (e.g., Haiku for classification, Sonnet for synthesis)

## Agent Research Context: DATA-DICTIONARY Injection

### How Agents Get Source Context (Hackathon Approach)

Instead of RAG over PDFs, agents get their research context from **structured metadata already in the repo**: each dataset's `DATA-DICTIONARY.md` and `README.md`. These contain methodology, rating scale definitions, geographic scope, and data quality notes — exactly what agents need to explain conflicts.

**Why this works for the hackathon:**
- Every dataset already has a DATA-DICTIONARY.md with rating scales, column definitions, and merge guidance
- Every dataset has a README.md with source citation, methodology notes, and geographic scope
- The `LivingWithFire-DB/api-reference/` folder has the production attribute tree, source registry, and query patterns
- Agents can read these as tool context — no vector store, no embedding pipeline, no indexing

**How it works in practice:**

When a conflict is detected (e.g., FIRE-01 says "Firewise (1)" but FIRE-02 says "Moderately Resistant"), the specialist agent:

1. Reads `FirePerformancePlants/DATA-DICTIONARY.md` → learns the 1-4 rating scale and that it's literature-based
2. Reads `IdahoFirewise/DATA-DICTIONARY.md` → learns the 4-tier system and that it's a practitioner guide
3. Reads both `README.md` files → learns geographic scope, publication dates, methodology
4. Produces an informed explanation: "These sources use different rating scales (1-4 numeric vs. categorical tiers) and different methodologies (literature review vs. practitioner field experience). Both rate this plant favorably, but FIRE-02 adds a 30ft planting distance recommendation."

### Shared Genkit Tool: `getDatasetContext`

```typescript
const getDatasetContext = defineTool({
  name: 'getDatasetContext',
  description: 'Load the DATA-DICTIONARY.md and README.md for a source dataset to understand its methodology, rating scales, and scope.',
  inputSchema: z.object({
    datasetFolder: z.string(),  // e.g. "database-sources/fire/FirePerformancePlants"
    sections: z.array(z.enum([
      'rating_scales', 'methodology', 'geographic_scope',
      'column_definitions', 'merge_guidance', 'all'
    ])).optional(),
  }),
  outputSchema: z.object({
    dataDictionary: z.string(),
    readme: z.string(),
    sourceId: z.string(),
  }),
});
```

### Which Agents Use Dataset Context

| Agent | Dataset Context | PageIndex Search | Why |
|-------|----------------|-----------------|-----|
| **Rating Conflict** | DATA-DICTIONARY.md for both sources | Search for methodology sections | Compare rating scales, find original study methodology |
| **Scope Agent** | README.md geographic scope | Search for regional applicability data | Determine if source applies to target region |
| **Methodology Agent** | README.md + DATA-DICTIONARY.md | Search for study design details | Compare study designs and evidence quality |
| **Definition Agent** | DATA-DICTIONARY.md column definitions | Search for term definitions in papers | Find how terms are defined per source |
| **Synthesis Agent** | DATA-DICTIONARY.md + README.md for all warrants | — (uses findings from Research Agent) | Cite methodology context in synthesized claims |
| **Research Agent** | All dataset context + LITERATURE-TRIAGE.md | Full search + drill-down | Primary PageIndex consumer — cross-references everything |

### Knowledge Base: PageIndex Document Navigation

The `knowledge-base/` folder contains 52 procured research documents (PDFs, HTML), of which **47 have been indexed** via [PageIndexAlt](https://github.com/VectifyAI/PageIndex) (fork using Gemini 2.5 Flash). The indexes are pre-built JSON trees stored at `knowledge-base/indexes/`.

**Index structure** (per document):
```json
{
  "doc_name": "Bethke-UCCE_...2016.pdf",
  "structure": [
    {
      "title": "Appendix II: Plant Lists Database Sources",
      "start_index": 20,   // start page
      "end_index": 30,     // end page
      "node_id": "0011",
      "summary": "Compilation of 53 publications with methodology notes...",
      "children": [...]    // nested subsections
    }
  ]
}
```

**Manifest:** `knowledge-base/indexes/manifest.json` — lists all 47 indexed documents with file name, top-level section count, and size.

**How agents use PageIndex:**
1. `searchDocumentIndex` — keyword search across all 47 document trees (section titles + summaries)
2. `navigateDocumentTree` — drill into a specific document section by node_id to read children and deeper summaries

This gives agents structured navigation into the original research papers without vector embeddings. The Research Agent combines this with DATA-DICTIONARY context for a complete evidence picture.

### Shared Genkit Tools: Document Search

```typescript
const searchDocumentIndex = defineTool({
  name: 'searchDocumentIndex',
  description: 'Search PageIndex trees for sections relevant to a plant, attribute, or methodology question. Returns matching sections across all 47 indexed knowledge-base documents.',
  inputSchema: z.object({
    keywords: z.array(z.string()), // e.g. ["Ceanothus", "flammability", "methodology"]
    maxResults: z.number().default(10),
  }),
  outputSchema: z.object({
    results: z.array(z.object({
      documentName: z.string(),
      sectionTitle: z.string(),
      nodeId: z.string(),
      pageRange: z.string(),
      summary: z.string(),
      relevanceScore: z.number(), // keyword match score
    })),
  }),
});

const navigateDocumentTree = defineTool({
  name: 'navigateDocumentTree',
  description: 'Read a specific section of a knowledge-base document by node_id. Returns the section summary and all child sections.',
  inputSchema: z.object({
    indexFile: z.string(),  // e.g. "Bethke-UCCE_..._structure.json"
    nodeId: z.string(),     // e.g. "0011"
  }),
  outputSchema: z.object({
    title: z.string(),
    pageRange: z.string(),
    summary: z.string(),
    children: z.array(z.object({
      title: z.string(),
      nodeId: z.string(),
      summary: z.string(),
    })),
  }),
});
```

## Production Sync (DoltgreSQL → Neon)

After admin merges approved changes to DoltgreSQL `main`:

1. Query DoltgreSQL for changes since last sync: `SELECT * FROM dolt_diff('last_sync_hash', 'HEAD', 'values')`
2. For each change type:
   - **New plant:** INSERT into Neon `plants` (generate new UUID if needed)
   - **New value:** INSERT into Neon `values` (generate new UUID, map attribute_id and source_id)
   - **Updated value:** UPDATE the specific row in Neon
   - **New source:** INSERT into Neon `sources`
3. Record the sync commit hash for next time
4. One-way sync only: DoltgreSQL → Neon. Never the reverse.
5. Both use `pg` client — same connection pattern, just different connection strings.

## Tech Stack Summary

| Layer | Technology | Why |
|-------|-----------|-----|
| Staging DB | DoltgreSQL | Git-for-data with PostgreSQL wire protocol: branch, merge, diff, blame, revert |
| Production DB | Neon PostgreSQL | Existing production, shared with lwf-app |
| Admin Portal | Next.js 14 + shadcn/ui + Tailwind | Fast tables, forms, API routes |
| DB Access | pg (Node) | Single client for both DoltgreSQL (staging) and Neon (production) |
| Agent Framework | Google Genkit | Model-agnostic flows with typed schemas, tool registration, observability |
| LLM | Anthropic API (Haiku 4.5 + Sonnet 4.6) | Haiku for bulk/internal agents, Sonnet for admin-facing synthesis |
| Taxonomy Matching | Genkit tool + POWO/WFO/USDA data | Synonym resolution and fuzzy matching |
| Agent Research Context | DATA-DICTIONARY.md + README.md | Structured metadata in each dataset folder under `database-sources/`. PageIndex RAG over knowledge-base PDFs deferred to post-hackathon. |
| Production Sync | Node.js + pg (Postgres client) | DoltgreSQL main → Neon upsert |

### Cloud-Only Model Strategy (Anthropic API)

All agents run against the **Anthropic API** via Genkit's Anthropic plugin. Two model tiers based on whether the output is internal (stored in DB, used for routing) or admin-facing (read and edited by the data steward).

```typescript
// Genkit config — Anthropic only
import { anthropic } from 'genkitx-anthropic';

configureGenkit({
  plugins: [
    anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  ],
});
```

| Agent | Model | Tier | Reasoning |
|-------|-------|------|-----------|
| Matcher | `anthropic/claude-haiku-4-5` | Internal | High volume, pattern matching — fast and cheap |
| Schema Mapper | `anthropic/claude-sonnet-4-6` | **Admin-facing** | Needs reasoning about field semantics, output reviewed by admin |
| Bulk Enhancer | No LLM needed | — | Pure data transformation, no model calls |
| Conflict Classifier | `anthropic/claude-haiku-4-5` | Internal | Bulk classification against 8 conflict types |
| Rating Conflict | `anthropic/claude-haiku-4-5` | Internal | Scale normalization and comparison — internal annotation |
| Scope Agent | `anthropic/claude-haiku-4-5` | Internal | Geographic applicability — internal annotation |
| Temporal Agent | `anthropic/claude-haiku-4-5` | Internal | Date comparison and recency assessment |
| Methodology Agent | `anthropic/claude-haiku-4-5` | Internal | Study design comparison with DATA-DICTIONARY context |
| Definition Agent | `anthropic/claude-haiku-4-5` | Internal | Term definition comparison across dictionaries |
| Taxonomy Agent | `anthropic/claude-haiku-4-5` | Internal | Name resolution — mostly lookup + fuzzy match |
| Research Agent | `anthropic/claude-haiku-4-5` | Internal | Cross-references DATA-DICTIONARY metadata |
| **Synthesis Agent** | `anthropic/claude-sonnet-4-6` | **Admin-facing** | **The demo climax.** Quality of merged claim text matters — word choice, nuance, citation formatting. |

**Selection rule:** If the output is internal (stored in DB, read by other agents, used for routing) → **Haiku 4.5**. If the output is admin-facing (synthesized claims, schema mapping suggestions the admin reviews) → **Sonnet 4.6**.

**Why cloud-only:**
- **Speed:** Anthropic API is fast. Local models (Ollama) were tested and found too slow for the hackathon workflow.
- **Simplicity:** One API key, one billing account, one Genkit plugin. No local model setup or benchmarking.
- **Cost:** Haiku 4.5 ($1/M input, $5/M output) handles 10 of 12 agents. Estimated total API cost for full build: ~$3-5.
- **Quality:** Even the cheapest tier (Haiku) is stronger than local 32B models for classification and structured output.

**Model swap is trivial** — just change the model string if quality needs differ from expectations:
```typescript
// Easy swap — just change the model string
const result = await generate({
  model: 'anthropic/claude-sonnet-4-6',  // was 'anthropic/claude-haiku-4-5'
  prompt: ...
});
```
