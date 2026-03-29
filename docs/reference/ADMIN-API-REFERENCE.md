# Admin Portal API Reference

**Base URL:** `http://localhost:3000` (development)
**Authentication:** None (local admin tool)
**Database:** DoltgreSQL (`lwf_staging`)

All endpoints are Next.js Route Handlers served from `admin/src/app/api/`.

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/plants` | List plants with search, sort, pagination |
| `GET` | `/api/plants/{plantId}` | Get plant detail with curation overlay |
| `GET` | `/api/plants/lookup?suggest={prefix}` | Typeahead: top 10 species from USDA + POWO |
| `GET` | `/api/plants/lookup?q={name}` | Full lookup: taxonomy + 30 sources + production |
| `POST` | `/api/plants/create` | Create plant + warrants + claims in Dolt |
| `PATCH` | `/api/plants/{plantId}` | Edit plant attributes (manual_edit warrants) |
| `PATCH` | `/api/warrants/{id}` | Update warrant curation status |
| `POST` | `/api/synthesize` | Generate AI claim synthesis from warrants (Anthropic Sonnet 4.6) |
| `POST` | `/api/claims/approve` | Approve a claim with Dolt version control |
| `GET` | `/api/conflicts/{id}` | Get conflict detail with both warrants |
| `PATCH` | `/api/conflicts/{id}` | Update conflict status |
| `POST` | `/api/conflicts/{id}/research` | Fetch research context for a conflict |
| `POST` | `/api/conflicts/{id}/specialist` | Run AI specialist analysis (rating or scope) |
| `POST` | `/api/conflicts/batch` | Batch update conflict statuses |
| `POST` | `/api/sources/upload` | Upload CSV file, return preview (headers, sample rows) |
| `GET` | `/api/sources/create?suggestId={category}` | Suggest next source ID for a category |
| `POST` | `/api/sources/create` | Create dataset folder with plants.csv + README.md |
| `POST` | `/api/sources/dictionary` | AI-generate DATA-DICTIONARY.md from CSV |
| `PUT` | `/api/sources/dictionary` | Save edited DATA-DICTIONARY.md content |
| `POST` | `/api/sources/run` | Trigger full analysis pipeline (fire-and-forget) |
| `GET` | `/api/sources/{batchId}/status` | Poll pipeline progress (step status, stats) |
| `POST` | `/api/sources/documents/upload` | Upload a PDF to knowledge-base/ |
| `POST` | `/api/sources/documents/index` | Trigger PDF indexing (fire-and-forget) |
| `GET` | `/api/sources/documents/status` | List all PDFs with indexed status |
| `POST` | `/api/fusion/map` | Run schema mapping for a dataset |
| `GET` | `/api/fusion/preview` | Preview fusion results |
| `POST` | `/api/fusion/execute` | Execute fusion batch with reviewed mapping |
| `GET` | `/api/fusion/{batchId}` | Fetch fusion batch detail |
| `GET` | `/api/matrix` | Cross-source conflict matrix data |
| `GET` | `/api/coverage` | Attribute coverage gap analysis |
| `GET` | `/api/coverage/{attributeId}` | Plants missing a specific attribute |
| `GET` | `/api/coverage/plants` | Per-plant completeness scores |
| `GET` | `/api/enrichment` | Enrichment summary: source DBs that can fill gaps |
| `GET` | `/api/enrichment/{attributeId}` | Enrichment candidates for one attribute |
| `GET` | `/api/dolt/log` | Fetch Dolt commit history |
| `GET` | `/api/dolt/status` | Check for uncommitted changes |
| `POST` | `/api/dolt/commit` | Create a manual Dolt commit |
| `POST` | `/api/dolt/revert` | Revert a recent commit |
| `GET` | `/api/sync/preview` | Preview approved claims pending sync to production |
| `POST` | `/api/sync/push` | Push approved claims to production Neon PostgreSQL |

---

## `PATCH /api/warrants/{id}`

Update the curation status of a single warrant. Used by the warrant card checkbox in the claim view UI.

**Source:** `admin/src/app/api/warrants/[id]/route.ts`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Warrant UUID |

### Request Body

```json
{
  "status": "included"
}
```

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| `status` | `string` | Yes | `included`, `excluded`, `unreviewed`, `flagged` |

### Response — 200 OK

```json
{
  "id": "a1b2c3d4-...",
  "status": "included"
}
```

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Invalid status..." }` | Status not in allowed values |
| `404` | `{ "error": "Warrant not found" }` | No warrant with that ID |
| `500` | `{ "error": "Failed to update warrant" }` | Database error |

### Side Effects

- Sets `warrants.curated_at = NOW()` on the updated row.

---

## `POST /api/synthesize`

Generate AI synthesis of selected warrants into a production claim. Uses the Anthropic Claude Sonnet 4.6 API to analyze warrant values, source methodologies, conflict verdicts, and attribute constraints to produce a merged claim.

**Source:** `admin/src/app/api/synthesize/route.ts`
**Requires:** `ANTHROPIC_API_KEY` environment variable

### Request Body

```json
{
  "plantId": "uuid-string",
  "attributeId": "uuid-string",
  "warrantIds": ["uuid-1", "uuid-2", "uuid-3"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plantId` | `string` | Yes | Plant UUID |
| `attributeId` | `string` | Yes | Attribute UUID |
| `warrantIds` | `string[]` | Yes | Non-empty array of warrant UUIDs to synthesize |

### Response — 200 OK

```json
{
  "synthesized_text": "Based on FIRE-01 and WATER-01, Arbutus menziesii exhibits high fire resistance...",
  "categorical_value": "High",
  "confidence": "HIGH",
  "confidence_reasoning": "Two independent Pacific West sources agree on fire resistance rating.",
  "sources_cited": ["FIRE-01", "WATER-01"],
  "warrant_weights": [
    { "warrantId": "uuid-1", "weight": "primary" },
    { "warrantId": "uuid-2", "weight": "supporting" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `synthesized_text` | `string` | 2-3 sentence synthesis with evidence citations |
| `categorical_value` | `string \| null` | Validated against attribute's `values_allowed`; null if no match |
| `confidence` | `string` | `HIGH`, `MODERATE`, or `LOW` |
| `confidence_reasoning` | `string \| null` | Explanation of confidence assessment |
| `sources_cited` | `string[]` | Source ID codes referenced in synthesis |
| `warrant_weights` | `array` | Per-warrant weight: `primary`, `supporting`, or `contextual` |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Missing required fields..." }` | Missing plantId, attributeId, or empty warrantIds |
| `404` | `{ "error": "No warrants found..." }` | None of the provided warrant IDs exist |
| `500` | `{ "error": "Failed to process synthesis request" }` | Anthropic API error or JSON parse failure |

### Implementation Notes

- Loads warrant details, attribute metadata (allowed values), current production value, and related conflicts in parallel from DoltgreSQL
- Builds a structured prompt including all warrant values, source methodologies, conflict specialist verdicts, and attribute constraints
- Uses `@anthropic-ai/sdk` with `claude-sonnet-4-6-20250514`
- Includes JSON extraction retry: if the first response isn't valid JSON, sends a correction prompt
- Validates `categorical_value` against the attribute's `values_allowed` list; returns null if no match

---

## `POST /api/claims/approve`

Create an approved claim record, link it to selected warrants via `claim_warrants`, and commit the changes to Dolt version control. This is the final step in the curation workflow.

**Source:** `admin/src/app/api/claims/approve/route.ts`

### Request Body

```json
{
  "plantId": "uuid-string",
  "attributeId": "uuid-string",
  "plantName": "Arbutus menziesii",
  "attributeName": "Fire Resistance",
  "warrantIds": ["uuid-1", "uuid-2"],
  "synthesizedText": "Based on FIRE-01 and WATER-01...",
  "categoricalValue": "High",
  "confidence": "HIGH",
  "confidenceReasoning": "Two independent sources agree...",
  "approvalNotes": "Both sources are Oregon-specific",
  "editedValue": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `plantId` | `string` | Yes | Plant UUID |
| `attributeId` | `string` | Yes | Attribute UUID |
| `plantName` | `string` | No | Display name (denormalized) |
| `attributeName` | `string` | No | Display name (denormalized) |
| `warrantIds` | `string[]` | Yes | Non-empty array of included warrant UUIDs |
| `synthesizedText` | `string` | No | AI or manual synthesis text. Defaults to `"Approved with N warrant(s)"` |
| `categoricalValue` | `string` | No | Normalized value if attribute expects a category |
| `confidence` | `string` | No | `HIGH`, `MODERATE`, or `LOW`. Defaults to `MODERATE` |
| `confidenceReasoning` | `string` | No | Explanation of confidence level |
| `approvalNotes` | `string` | No | Admin's notes on this approval |
| `editedValue` | `string` | No | Override value if admin modified the synthesis |

### Response — 200 OK

```json
{
  "claimId": "generated-uuid",
  "commitHash": "abc123def456..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `claimId` | `string` | UUID of the created claim record |
| `commitHash` | `string` | Dolt commit hash for the approval |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Missing required fields..." }` | Missing plantId, attributeId, or empty warrantIds |
| `500` | `{ "error": "Failed to approve claim" }` | Database or Dolt commit error |

### Side Effects

This endpoint performs a multi-step write operation on a single database connection:

1. **INSERT `claims`** — new record with `status = 'approved'`, `approved_by = 'admin'`
2. **INSERT `claim_warrants`** — one junction row per selected warrant
3. **Dolt commit** — `dolt_add('.')` + `dolt_commit(...)` with message `"Approve claim: {plant} / {attribute}"`
4. **UPDATE `claims`** — stores `dolt_commit_hash` on the claim record
5. **Second Dolt commit** — commits the hash update

On failure, the route attempts `dolt_checkout('.')` to reset the working state.

### Implementation Note

Uses `pool.connect()` directly (not the `query()` helper) to ensure all Dolt operations run on the **same database connection** — required because `dolt_add` and `dolt_commit` are connection-scoped in DoltgreSQL.

---

## `GET /api/conflicts/{id}`

Fetch a single conflict's full details along with both associated warrants. Used by the expandable conflict row in the queue UI.

**Source:** `admin/src/app/api/conflicts/[id]/route.ts`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Conflict UUID |

### Response — 200 OK

```json
{
  "conflict": {
    "id": "uuid",
    "conflict_type": "RATING_DISAGREEMENT",
    "conflict_mode": "external",
    "severity": "critical",
    "status": "pending",
    "plant_id": "uuid",
    "plant_name": "Arbutus menziesii",
    "attribute_name": "Fire Resistance",
    "value_a": "High",
    "value_b": "Moderate",
    "source_a": "FIRE-01",
    "source_b": "FIRE-03",
    "specialist_verdict": null,
    "specialist_recommendation": null,
    "warrant_a_id": "uuid",
    "warrant_b_id": "uuid",
    "classifier_explanation": "Direct disagreement on fire resistance rating...",
    "specialist_agent": null,
    "specialist_analysis": null,
    "batch_id": "uuid",
    "annotated_at": null,
    "created_at": "2026-03-27T..."
  },
  "warrants": [
    { "id": "uuid", "warrant_type": "existing", "value": "High", "...": "..." },
    { "id": "uuid", "warrant_type": "external", "value": "Moderate", "...": "..." }
  ]
}
```

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "Conflict not found" }` | No conflict with that ID |
| `500` | `{ "error": "Failed to fetch conflict" }` | Database error |

---

## `PATCH /api/conflicts/{id}`

Update the status of a single conflict. Used by the Resolve/Dismiss buttons in the expanded conflict row.

**Source:** `admin/src/app/api/conflicts/[id]/route.ts`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Conflict UUID |

### Request Body

```json
{
  "status": "resolved"
}
```

| Field | Type | Required | Allowed Values |
|-------|------|----------|----------------|
| `status` | `string` | Yes | `pending`, `annotated`, `resolved`, `dismissed` |

### Response — 200 OK

```json
{
  "id": "uuid",
  "status": "resolved"
}
```

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Invalid status..." }` | Status not in allowed values |
| `404` | `{ "error": "Conflict not found" }` | No conflict with that ID |
| `500` | `{ "error": "Failed to update conflict" }` | Database error |

---

## `POST /api/conflicts/{id}/research`

Fetch read-only research context for a conflict: source dataset documentation (DATA-DICTIONARY.md, README.md) and keyword-matched knowledge base sections. No database writes.

**Source:** `admin/src/app/api/conflicts/[id]/research/route.ts`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Conflict UUID |

### Request Body

None required — the route looks up the conflict and its warrants to determine sources and search terms.

### Response — 200 OK

```json
{
  "datasetContexts": [
    {
      "sourceIdCode": "FIRE-01",
      "sourceDataset": "FirePerformancePlants",
      "dataDictionary": "# DATA-DICTIONARY\n...",
      "readme": "# FirePerformancePlants\n..."
    }
  ],
  "knowledgeBaseResults": [
    {
      "documentTitle": "Bethke-UCCE_Literature-Review.pdf",
      "sectionTitle": "Fire Resistance Rating Scales",
      "sectionSummary": "This section compares...",
      "nodeId": "0042"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `datasetContexts` | `array` | DATA-DICTIONARY.md and README.md content per source |
| `knowledgeBaseResults` | `array` | Up to 10 matching sections from 47 indexed knowledge base documents |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "Conflict not found" }` | No conflict with that ID |
| `500` | `{ "error": "Failed to fetch research context" }` | File read or parse error |

### Implementation Note

Reads files directly from `database-sources/` and `knowledge-base/indexes/` on the filesystem. Searches category folders (`fire/`, `deer/`, etc.) to locate the dataset by folder name. Knowledge base search uses keyword matching against pre-indexed structure JSON files.

---

## `POST /api/conflicts/batch`

Batch update the status of multiple conflicts at once. Used by the batch toolbar when conflicts are selected with checkboxes.

**Source:** `admin/src/app/api/conflicts/batch/route.ts`

### Request Body

```json
{
  "ids": ["uuid-1", "uuid-2", "uuid-3"],
  "status": "dismissed"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | `string[]` | Yes | Non-empty array of conflict UUIDs |
| `status` | `string` | Yes | `pending`, `annotated`, `resolved`, or `dismissed` |

### Response — 200 OK

```json
{
  "updated": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `updated` | `number` | Number of conflicts actually updated |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "ids must be a non-empty array" }` | Missing or empty ids |
| `400` | `{ "error": "Invalid status..." }` | Status not in allowed values |
| `500` | `{ "error": "Failed to batch update conflicts" }` | Database error |

---

## `POST /api/conflicts/{id}/specialist`

Run AI specialist analysis on a conflict. Determines whether the conflict is REAL, APPARENT, or NUANCED by analyzing source methodologies, rating scales, and geographic applicability. Supported specialists: `ratingConflictFlow`, `scopeConflictFlow`, `taxonomyConflictFlow`, `researchConflictFlow`, `temporalConflictFlow`, `methodologyConflictFlow` (stub), `definitionConflictFlow` (stub).

**Source:** `admin/src/app/api/conflicts/[id]/specialist/route.ts`
**Requires:** `ANTHROPIC_API_KEY` environment variable

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Conflict UUID |

### Request Body

None required — the route reads the conflict and determines which specialist to run based on `specialist_agent`.

### Response — 200 OK

```json
{
  "verdict": "APPARENT",
  "recommendation": "KEEP_BOTH_WITH_CONTEXT",
  "analysis": "The disagreement stems from different rating scales...",
  "confidence": 0.85,
  "regionAnalysis": {
    "regionA": "Southern California",
    "regionB": "Pacific Northwest",
    "overlapAssessment": "partial",
    "applicability": "Both sources cover portions of the Pacific West."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `verdict` | `string` | `REAL`, `APPARENT`, or `NUANCED` |
| `recommendation` | `string` | `PREFER_A`, `PREFER_B`, `KEEP_BOTH`, `KEEP_BOTH_WITH_CONTEXT`, `NEEDS_RESEARCH`, or `HUMAN_DECIDE` |
| `analysis` | `string` | 2-4 sentence explanation |
| `confidence` | `number` | 0.0-1.0 |
| `regionAnalysis` | `object \| null` | Only present for scope conflicts |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "No specialist agent assigned..." }` | Conflict has no `specialist_agent` value |
| `400` | `{ "error": "Specialist ... is not yet implemented" }` | Unrecognized specialist type |
| `404` | `{ "error": "Conflict not found" }` | No conflict with that ID |
| `500` | `{ "error": "Failed to run specialist analysis" }` | Anthropic API error or parse failure |

### Side Effects

- Updates `conflicts` table: sets `specialist_verdict`, `specialist_analysis`, `specialist_recommendation` on the conflict row.

### Implementation Notes

- Uses Anthropic API directly (`claude-sonnet-4-6-20250514`) via `fetch`, not the SDK
- Loads dataset contexts (DATA-DICTIONARY.md, README.md) and knowledge base search results for both sources
- Builds specialist-specific prompts (rating vs scope) with source methodology and regional context
- Includes JSON extraction with one retry on parse failure

---

## Coverage & Enrichment Endpoints

### `GET /api/coverage`

Attribute coverage gap analysis across all production plants. Returns per-attribute counts of plants with/without values, excluding calculated attributes and Relative Value Matrix flags.

**Source:** `admin/src/app/api/coverage/route.ts`

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sort` | `string` | `coverage_asc` | Sort: `coverage_asc`, `coverage_desc`, `name` |
| `category` | `string` | — | Filter by parent attribute category (e.g., `Flammability`, `Water Requirements`) |

#### Response — 200 OK

```json
[
  {
    "attributeId": "d996587c-383b-4dc6-a23c-239b7de7e47b",
    "attributeName": "List Choice",
    "category": "Flammability",
    "plantsWithValue": 412,
    "totalPlants": 1361,
    "coveragePct": 30.3,
    "gapCount": 949
  }
]
```

#### Implementation Notes

- Queries Neon production DB (`queryProd`)
- Excludes all `CALCULATED_ATTRIBUTE_IDS` and `b1000001-%` Relative Value Matrix flags
- Joins `attributes` → parent `attributes` for category name
- Coverage percentage rounded to 1 decimal place

---

### `GET /api/coverage/{attributeId}`

List plants missing a specific attribute, with pagination.

**Source:** `admin/src/app/api/coverage/[attributeId]/route.ts`

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `attributeId` | `string` | Attribute UUID |

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | `number` | `50` | Max results (capped at 100) |
| `offset` | `number` | `0` | Pagination offset |

#### Response — 200 OK

```json
{
  "plants": [
    {
      "plantId": "uuid",
      "genus": "Abelia",
      "species": "grandiflora",
      "commonName": "glossy abelia"
    }
  ],
  "total": 949
}
```

---

### `GET /api/coverage/plants`

Per-plant completeness scores against 6 key attributes: Flammability List Choice, Water Amount, Drought Tolerant, Deer Resistance, Native Status, and Wildlife Benefits.

**Source:** `admin/src/app/api/coverage/plants/route.ts`

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sort` | `string` | `completeness_asc` | Sort: `completeness_asc`, `completeness_desc`, `name` |
| `limit` | `number` | `50` | Max results (capped at 100) |
| `page` | `number` | `1` | Page number |

#### Response — 200 OK

```json
{
  "plants": [
    {
      "plantId": "uuid",
      "genus": "Abelia",
      "species": "grandiflora",
      "commonName": "glossy abelia",
      "filledAttributes": 2,
      "totalKeyAttributes": 6,
      "completenessPct": 33.3
    }
  ],
  "total": 1361,
  "page": 1,
  "limit": 50
}
```

---

### `GET /api/enrichment`

Enrichment summary: for each gap attribute that has mapped source databases, shows how many production plants could be enriched and from which sources.

**Source:** `admin/src/app/api/enrichment/route.ts`

#### Response — 200 OK

```json
[
  {
    "attributeId": "d996587c-383b-4dc6-a23c-239b7de7e47b",
    "attributeName": "List Choice",
    "category": "Flammability",
    "gapCount": 949,
    "enrichableCount": 287,
    "sourceBreakdown": [
      { "sourceId": "FIRE-01", "displayName": "Fire Performance Plants (SREF)", "candidateCount": 145 },
      { "sourceId": "FIRE-08", "displayName": "Oakland FireSafe", "candidateCount": 89 }
    ]
  }
]
```

#### Implementation Notes

- Scans SQLite source databases (read-only) via `better-sqlite3`
- Uses reverse index from `source-attribute-map.ts` to find sources per attribute
- Matches production `genus || ' ' || species` against source `scientific_name` (case-insensitive)
- Results sorted by enrichable count descending (most impactful first)
- Does NOT auto-ingest — suggestions only. Actual ingestion goes through the upload/fusion pipeline.

---

### `GET /api/enrichment/{attributeId}`

Enrichment candidates for a specific attribute: production plants missing this attribute that have matching data in source SQLite databases.

**Source:** `admin/src/app/api/enrichment/[attributeId]/route.ts`

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `attributeId` | `string` | Attribute UUID |

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | `number` | `50` | Max results (capped at 100) |
| `offset` | `number` | `0` | Pagination offset |

#### Response — 200 OK

```json
{
  "candidates": [
    {
      "plantId": "uuid",
      "genus": "Ceanothus",
      "species": "velutinus",
      "commonName": "snowbrush",
      "sourceId": "FIRE-01",
      "sourceDisplayName": "Fire Performance Plants (SREF)",
      "sourceColumn": "firewise_rating",
      "sourceValue": "1"
    }
  ],
  "total": 145
}
```

---

## `GET /api/dolt/log`

Fetch Dolt commit history from the staging database.

**Source:** `admin/src/app/api/dolt/log/route.ts`

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | `number` | `50` | Max entries to return (capped at 100) |
| `offset` | `number` | `0` | Pagination offset |

### Response — 200 OK

```json
[
  {
    "commit_hash": "abc123def456...",
    "committer": "root",
    "date": "2026-03-28T14:30:00.000Z",
    "message": "Approve claim: Arbutus menziesii / Fire Resistance"
  }
]
```

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `500` | `{ "error": "Failed to fetch log" }` | Database error |

---

## `GET /api/dolt/status`

Check whether there are uncommitted changes in the DoltgreSQL working set.

**Source:** `admin/src/app/api/dolt/status/route.ts`

### Response — 200 OK

```json
{
  "changes": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `changes` | `number` | Number of uncommitted table changes (0 = clean) |

### Notes

Returns `{ "changes": 0 }` on error (graceful degradation for the Save Changes button).

---

## `POST /api/dolt/commit`

Create a manual Dolt commit of all uncommitted changes. Used by the "Save Changes" button in the portal.

**Source:** `admin/src/app/api/dolt/commit/route.ts`

### Request Body

```json
{
  "message": "Manual save: updated deer resistance warrants"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | Commit message |

### Response — 200 OK

```json
{
  "commitHash": "abc123def456..."
}
```

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Commit message required" }` | Missing or non-string message |
| `400` | `{ "error": "No uncommitted changes" }` | Working set is clean |
| `500` | `{ "error": "Failed to commit changes" }` | Database error |

### Side Effects

- Runs `dolt_add('.')` then `dolt_commit(...)` on a single connection
- On failure, attempts `dolt_checkout('.')` to reset working state

---

## `POST /api/dolt/revert`

Revert a recent Dolt commit. Creates a new commit that reverses the changes from the specified commit. Safety-limited to the 5 most recent commits.

**Source:** `admin/src/app/api/dolt/revert/route.ts`

### Request Body

```json
{
  "commitHash": "abc123def456..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `commitHash` | `string` | Yes | Full commit hash to revert |

### Response — 200 OK

```json
{
  "commitHash": "newdef789..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `commitHash` | `string` | The new commit hash created by the revert |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "Commit hash required" }` | Missing or non-string hash |
| `400` | `{ "error": "Can only revert one of the 5 most recent commits" }` | Safety limit exceeded |
| `500` | `{ "error": "Failed to revert commit" }` | Database error |

### Side Effects

- Runs `dolt_revert($hash)` then `dolt_add('.')` + `dolt_commit(...)` with message `"Revert commit <hash>"`
- On failure, attempts `dolt_checkout('.')` to reset working state

---

## `GET /api/sync/preview`

Preview approved claims that are pending sync to the production database. Returns a comparison of current production values vs. new curated values.

**Source:** `admin/src/app/api/sync/preview/route.ts`

### Response — 200 OK

```json
{
  "claims": [
    {
      "id": "claim-uuid",
      "plantName": "Arbutus menziesii",
      "attributeName": "Fire Resistance",
      "oldValue": "Moderate",
      "newValue": "High",
      "confidence": "HIGH"
    }
  ],
  "totalChanges": 1
}
```

| Field | Type | Description |
|-------|------|-------------|
| `claims` | `array` | Approved claims not yet pushed, with old/new comparison |
| `totalChanges` | `number` | Total count of pending changes |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `500` | `{ "error": "Failed to fetch sync preview" }` | Database error |

### Implementation Notes

- Queries Dolt for approved-but-not-pushed claims
- Queries production Neon for current values to show old vs. new comparison
- No writes performed

---

## `POST /api/sync/push`

Execute the production sync: upsert approved claim values into the production Neon PostgreSQL database, mark claims as pushed in Dolt, and log the sync event.

**Source:** `admin/src/app/api/sync/push/route.ts`
**Requires:** `NEON_DATABASE_URL` environment variable

### Request Body

None required.

### Response — 200 OK

```json
{
  "pushed": 5,
  "commitHash": "abc123def456..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `pushed` | `number` | Number of claims pushed (0 if nothing pending) |
| `commitHash` | `string \| null` | Dolt commit hash (null if nothing pushed) |

### Errors

| Status | Body | Cause |
|--------|------|-------|
| `500` | `{ "error": "Failed to push to production" }` | Database error |

### Side Effects

1. **Ensure source** — Creates/reuses "LWF Curation Pipeline" source in production `sources` table
2. **Upsert `"values"`** — For each claim: UPDATE existing row or INSERT new row in production
3. **COMMIT** — Neon transaction committed
4. **UPDATE `claims`** — Marks claims as `status = 'pushed'`, `pushed_to_production = true` in Dolt
5. **INSERT `analysis_batches`** — Logs sync event with `batch_type = 'production_sync'`
6. **Dolt commit** — Two commits: one for claim status changes, one for batch log

On failure: ROLLBACK on Neon, `dolt_checkout('.')` on Dolt, both clients released.

### Implementation Notes

- Uses two separate database connections: one to Dolt (staging), one to Neon (production)
- Upsert strategy: UPDATE first (matching `plant_id + attribute_id`), INSERT if no existing row
- All production values tagged with curation pipeline `source_id` for provenance
- Idempotent: re-running with no pending claims returns `{ pushed: 0, commitHash: null }`

---

## Database Tables Referenced

These endpoints read from and write to the following DoltgreSQL tables. Full schema definitions are in `scripts/create_warrant_tables.sql`.

| Table | Operations | Description |
|-------|-----------|-------------|
| `warrants` | Read, Update | Source evidence records |
| `claims` | Insert, Update | Synthesized/approved claim records |
| `claim_warrants` | Insert | Junction table linking claims to warrants |
| `plants` | Read | Plant master data (via claim view queries) |
| `attributes` | Read | Attribute definitions (via claim view queries) |
| `"values"` | Read | Current production values (quoted — reserved word) |
| `conflicts` | Read, Update | Warrant conflict pairs — queue, detail, status updates |
| `dolt_log` | Read | Commit history (system table) |
| `dolt_status` | Read | Uncommitted changes (system table) |
| `dolt_commit_diff_*` | Read | Row-level diffs between commits (system tables) |

See also: `docs/planning/PROPOSALS-SCHEMA.md` for the full data model.

---

## Source Pipeline Endpoints

### `POST /api/sources/upload`

Upload a CSV file and return a preview with headers, sample rows, and row count.

**Source:** `admin/src/app/api/sources/upload/route.ts`

#### Request

`Content-Type: multipart/form-data` with a `file` field containing a `.csv` file.

#### Response — 200 OK

```json
{
  "uploadId": "uuid-string",
  "headers": ["scientific_name", "common_name", "rating"],
  "rowCount": 541,
  "sampleRows": [["Ceanothus velutinus", "Snowbrush", "1"], ...],
  "fileSize": 45321
}
```

| Field | Type | Description |
|-------|------|-------------|
| `uploadId` | `string` | UUID for referencing this upload in subsequent steps |
| `headers` | `string[]` | CSV column headers |
| `rowCount` | `number` | Total data rows (excluding header) |
| `sampleRows` | `string[][]` | First 10 rows of data |
| `fileSize` | `number` | File size in bytes |

#### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "No CSV file provided" }` | Missing file in form data |
| `400` | `{ "error": "Only .csv files are accepted" }` | Wrong file extension |
| `400` | `{ "error": "CSV must have a header row..." }` | File has fewer than 2 lines |

#### Side Effects

- Writes CSV content to `os.tmpdir()/lwf-uploads/{uploadId}.csv`

---

### `GET /api/sources/create?suggestId={category}`

Suggest the next available source ID for a given category.

**Source:** `admin/src/app/api/sources/create/route.ts`

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `suggestId` | `string` | Category name (fire, deer, water, etc.) |

#### Response — 200 OK

```json
{
  "suggestedId": "FIRE-13"
}
```

---

### `POST /api/sources/create`

Create a dataset folder with `plants.csv` and `README.md` from a previously uploaded CSV.

**Source:** `admin/src/app/api/sources/create/route.ts`

#### Request Body

```json
{
  "uploadId": "uuid-string",
  "name": "FirePerformancePlants",
  "sourceId": "FIRE-13",
  "category": "fire",
  "url": "https://example.com/source",
  "citation": "Author, Title, Year",
  "notes": "Additional context"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uploadId` | `string` | Yes | From the upload step |
| `name` | `string` | Yes | Dataset folder name (no spaces) |
| `sourceId` | `string` | Yes | Source ID code (e.g., FIRE-13) |
| `category` | `string` | Yes | One of: fire, deer, water, pollinators, birds, native, invasive, traits, taxonomy |
| `url` | `string` | No | Source URL |
| `citation` | `string` | No | Citation text |
| `notes` | `string` | No | Additional notes |

#### Response — 200 OK

```json
{
  "datasetFolder": "database-sources/fire/FirePerformancePlants",
  "sourceId": "FIRE-13"
}
```

#### Side Effects

- Creates `database-sources/{category}/{name}/` directory
- Writes `plants.csv` and `README.md`
- Deletes the temp upload file

---

### `POST /api/sources/dictionary`

Generate a DATA-DICTIONARY.md using AI analysis of CSV headers and sample data.

**Source:** `admin/src/app/api/sources/dictionary/route.ts`
**Requires:** `ANTHROPIC_API_KEY` environment variable

#### Request Body

```json
{
  "datasetFolder": "database-sources/fire/NewDataset",
  "sourceId": "FIRE-13"
}
```

#### Response — 200 OK

```json
{
  "dictionary": "# Data Dictionary: NewDataset\n\n**Source ID:** `FIRE-13`\n..."
}
```

#### Side Effects

- Writes `DATA-DICTIONARY.md` to the dataset folder
- Uses `claude-sonnet-4-20250514` for analysis

---

### `PUT /api/sources/dictionary`

Save edited DATA-DICTIONARY.md content back to disk.

#### Request Body

```json
{
  "datasetFolder": "database-sources/fire/NewDataset",
  "content": "# Data Dictionary: NewDataset\n..."
}
```

#### Response — 200 OK

```json
{ "ok": true }
```

---

### `POST /api/sources/run`

Trigger the full analysis pipeline for a dataset. Returns immediately; the pipeline runs asynchronously.

**Source:** `admin/src/app/api/sources/run/route.ts`

#### Request Body

```json
{
  "datasetFolder": "database-sources/fire/NewDataset",
  "sourceDataset": "NewDataset",
  "sourceId": "FIRE-13"
}
```

#### Response — 200 OK

```json
{
  "batchId": "uuid-string"
}
```

#### Side Effects

- Creates an `analysis_batches` record with `status = 'running'`, `batch_type = 'full_analysis'`
- Spawns the `full-analysis` fusion bridge action asynchronously (30 min timeout)
- Pipeline chains: matchPlantFlow → mapSchemaFlow → bulkEnhanceFlow → classifyConflictFlow → Dolt commit
- Updates `analysis_batches.notes` with JSON step progress during execution
- Sets status to `completed` or `failed` when done

---

### `GET /api/sources/{batchId}/status`

Poll the progress of a running pipeline batch.

**Source:** `admin/src/app/api/sources/[batchId]/status/route.ts`

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `batchId` | `string` | Batch UUID from the run response |

#### Response — 200 OK

```json
{
  "batchId": "uuid-string",
  "status": "running",
  "sourceDataset": "NewDataset",
  "currentStep": "enhancing",
  "steps": [
    { "name": "matching", "label": "Match Plants", "status": "completed", "detail": "342 matched, 18 unmatched" },
    { "name": "mapping", "label": "Map Schema", "status": "completed", "detail": "12 columns mapped" },
    { "name": "enhancing", "label": "Create Warrants", "status": "running" },
    { "name": "classifying", "label": "Classify Conflicts", "status": "pending" },
    { "name": "committing", "label": "Commit to Dolt", "status": "pending" }
  ],
  "stats": {
    "totalRecords": 541,
    "plantsMatched": 342,
    "plantsUnmatched": 18,
    "warrantsCreated": 1205,
    "conflictsDetected": null,
    "commitHash": null
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | `string` | `running`, `completed`, or `failed` |
| `currentStep` | `string` | Name of the currently executing step |
| `steps` | `array` | All 5 pipeline steps with status and detail text |
| `stats` | `object` | Accumulated statistics (populated as steps complete) |

#### Errors

| Status | Body | Cause |
|--------|------|-------|
| `404` | `{ "error": "Batch not found" }` | No batch with that ID |

---

## Document Indexing Endpoints

### `POST /api/sources/documents/upload`

Upload a PDF file to the knowledge base directory.

**Source:** `admin/src/app/api/sources/documents/upload/route.ts`

#### Request

`Content-Type: multipart/form-data` with a `file` field containing a `.pdf` file.

#### Response — 200 OK

```json
{
  "filename": "NewDocument.pdf",
  "size": 1234567
}
```

#### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "No PDF file provided" }` | Missing file in form data |
| `400` | `{ "error": "Only .pdf files are accepted" }` | Wrong file extension |

#### Side Effects

- Writes PDF to `knowledge-base/{filename}`

---

### `POST /api/sources/documents/index`

Trigger indexing of a PDF in the knowledge base. Returns immediately; indexing runs asynchronously.

**Source:** `admin/src/app/api/sources/documents/index/route.ts`

#### Request Body

```json
{
  "filename": "NewDocument.pdf"
}
```

#### Response — 200 OK

```json
{
  "status": "indexing",
  "filename": "NewDocument.pdf"
}
```

#### Errors

| Status | Body | Cause |
|--------|------|-------|
| `400` | `{ "error": "filename is required" }` | Missing filename |
| `404` | `{ "error": "PDF not found: ..." }` | File doesn't exist in knowledge-base/ |

#### Side Effects

- Spawns Python indexer (`scripts/index_pdf.py`) via index-bridge (fire-and-forget)
- On success: creates `knowledge-base/indexes/{stem}_structure.json` and updates `manifest.json`

---

### `GET /api/sources/documents/status`

List all PDFs in the knowledge base with their indexing status.

**Source:** `admin/src/app/api/sources/documents/status/route.ts`

#### Response — 200 OK

```json
{
  "total": 49,
  "indexed": 47,
  "documents": [
    {
      "filename": "ABAG_Home-Hardening-Defensible-Space-Resource-Guide.pdf",
      "indexed": true,
      "sections": 8,
      "sizeBytes": 12345,
      "indexFile": "ABAG_Home-Hardening-Defensible-Space-Resource-Guide_structure.json"
    },
    {
      "filename": "DiabloFiresafe_Fire-Resistant-Flammable-Plant-Lists.pdf",
      "indexed": false,
      "sections": null,
      "sizeBytes": null,
      "indexFile": null
    }
  ]
}
```

---

## `GET /api/plants/lookup`

Search taxonomy backbones, source databases, and production DB by scientific name. Supports typeahead suggestions and full cross-database lookup with synonym resolution.

**Source:** `admin/src/app/api/plants/lookup/route.ts`

### Typeahead Mode: `?suggest={prefix}`

Returns top 10 species matching the prefix from USDA_PLANTS (93K accepted species) + POWO_WCVP (362K species).

```json
[
  { "scientificName": "Mahonia aquifolium", "commonName": "hollyleaved barberry", "family": "Berberidaceae" },
  { "scientificName": "Mahonia nervosa", "commonName": "Cascade barberry", "family": "Berberidaceae" }
]
```

### Full Lookup Mode: `?q={scientific_name}`

Searches 3 taxonomy backbones + 30 source databases (via SQLite) + production Neon DB. Resolves synonyms via USDA_PLANTS shared symbol.

```json
{
  "taxonomy": {
    "family": "Berberidaceae",
    "lifeform": "Shrub",
    "climate": "temperate",
    "nativeRange": "Western North America",
    "commonName": "hollyleaved barberry",
    "sources": ["USDA_PLANTS", "POWO_WCVP", "WorldFloraOnline"],
    "synonym": null
  },
  "productionMatch": {
    "exists": true,
    "plantId": "uuid",
    "attributeCount": 47
  },
  "sourceHits": [
    {
      "sourceId": "FIRE-01",
      "displayName": "Fire Performance Plants (SREF)",
      "category": "fire",
      "matchedName": "Mahonia aquifolium",
      "matchConfidence": 1.0,
      "fields": [
        {
          "sourceColumn": "firewise_rating_code",
          "value": "1",
          "attributeId": "d996587c-383b-4dc6-a23c-239b7de7e47b",
          "attributeName": "List Choice",
          "attributeCategory": "Flammability"
        }
      ]
    }
  ]
}
```

When a synonym is detected, `taxonomy.synonym` contains:
```json
{
  "searchedName": "Berberis aquifolium",
  "acceptedName": "Mahonia aquifolium",
  "acceptedCommonName": "hollyleaved barberry"
}
```

---

## `POST /api/plants/create`

Create a new plant with attributes in Dolt staging. Creates warrants (`warrant_type = 'manual_entry'`), pre-approved claims, and a Dolt commit.

**Source:** `admin/src/app/api/plants/create/route.ts`

### Request Body

```json
{
  "genus": "Mahonia",
  "species": "aquifolium",
  "commonName": "hollyleaved barberry",
  "attributes": [
    {
      "attributeId": "d996587c-383b-4dc6-a23c-239b7de7e47b",
      "attributeName": "List Choice",
      "value": "1",
      "sourceIdCode": "FIRE-01",
      "sourceValue": "1",
      "sourceDataset": "Fire Performance Plants (SREF)",
      "matchConfidence": 1.0
    }
  ],
  "curatorNotes": "Added from field observation"
}
```

### Response

```json
{
  "plantId": "uuid",
  "commitHash": "abc123...",
  "warrantCount": 12,
  "claimCount": 12
}
```

---

## `PATCH /api/plants/{plantId}`

Edit attributes on an existing plant. Creates warrants with `warrant_type = 'manual_edit'` and pre-approved claims.

**Source:** `admin/src/app/api/plants/[plantId]/route.ts`

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `plantId` | `string` | Plant UUID |

### Request Body

Same `attributes` array format as `POST /api/plants/create`. Only changed attributes need to be included.

### Response

```json
{
  "plantId": "uuid",
  "commitHash": "abc123...",
  "warrantCount": 3,
  "claimCount": 3
}
```
