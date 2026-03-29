# Admin Portal API Reference

**Base URL:** `http://localhost:3000` (development)
**Authentication:** None (local admin tool)
**Database:** DoltgreSQL (`lwf_staging`)

All endpoints are Next.js Route Handlers served from `admin/src/app/api/`.

---

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `PATCH` | `/api/warrants/{id}` | Update warrant curation status |
| `POST` | `/api/synthesize` | Generate AI claim synthesis from warrants (Anthropic Sonnet 4.6) |
| `POST` | `/api/claims/approve` | Approve a claim with Dolt version control |
| `GET` | `/api/conflicts/{id}` | Get conflict detail with both warrants |
| `PATCH` | `/api/conflicts/{id}` | Update conflict status |
| `POST` | `/api/conflicts/{id}/research` | Fetch research context for a conflict |
| `POST` | `/api/conflicts/{id}/specialist` | Run AI specialist analysis (rating or scope) |
| `POST` | `/api/conflicts/batch` | Batch update conflict statuses |
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
