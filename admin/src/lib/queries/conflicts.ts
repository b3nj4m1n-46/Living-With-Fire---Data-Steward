import { query, queryOne } from "@/lib/dolt";
import type { WarrantDetail } from "@/lib/queries/claims";

// ── Interfaces ──────────────────────────────────────────────────────────

export interface ConflictListRow {
  id: string;
  conflict_type: string;
  conflict_mode: string;
  severity: string;
  status: string;
  plant_id: string;
  plant_name: string;
  attribute_name: string;
  value_a: string | null;
  value_b: string | null;
  source_a: string | null;
  source_b: string | null;
  specialist_verdict: string | null;
  specialist_recommendation: string | null;
  created_at: string;
}

export interface ConflictDetail extends ConflictListRow {
  warrant_a_id: string;
  warrant_b_id: string;
  classifier_explanation: string | null;
  specialist_agent: string | null;
  specialist_analysis: string | null;
  batch_id: string | null;
  annotated_at: string | null;
}

export interface ConflictListFilters {
  status?: string;
  severity?: string;
  conflictType?: string;
  attributeCategory?: string;
  sourceDataset?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
}

export interface ConflictFilterOptions {
  statuses: string[];
  severities: string[];
  conflictTypes: string[];
  attributeCategories: string[];
  sourceDatasets: string[];
}

// ── Sort whitelist ──────────────────────────────────────────────────────

const SORTABLE_COLUMNS: Record<string, string> = {
  severity: "CASE c.severity WHEN 'critical' THEN 0 WHEN 'moderate' THEN 1 WHEN 'minor' THEN 2 ELSE 3 END",
  conflict_type: "c.conflict_type",
  plant_name: "c.plant_name",
  attribute_name: "c.attribute_name",
  status: "c.status",
  created_at: "c.created_at",
};

const PAGE_SIZE = 50;

// ── Conflicts List ──────────────────────────────────────────────────────

export async function fetchConflictsList(
  filters: ConflictListFilters
): Promise<{ rows: ConflictListRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.status) {
    conditions.push(`c.status = $${paramIndex}`);
    params.push(filters.status);
    paramIndex++;
  }

  if (filters.severity) {
    conditions.push(`c.severity = $${paramIndex}`);
    params.push(filters.severity);
    paramIndex++;
  }

  if (filters.conflictType) {
    conditions.push(`c.conflict_type = $${paramIndex}`);
    params.push(filters.conflictType);
    paramIndex++;
  }

  if (filters.attributeCategory) {
    conditions.push(
      `LOWER(c.attribute_name) LIKE LOWER($${paramIndex})`
    );
    params.push(`%${filters.attributeCategory}%`);
    paramIndex++;
  }

  if (filters.sourceDataset) {
    conditions.push(
      `(c.source_a = $${paramIndex} OR c.source_b = $${paramIndex})`
    );
    params.push(filters.sourceDataset);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Sort
  const sortCol = SORTABLE_COLUMNS[filters.sortBy ?? "severity"] ?? SORTABLE_COLUMNS.severity;
  const sortDir = filters.sortDir === "asc" ? "ASC" : "DESC";
  const orderBy = `ORDER BY ${sortCol} ${sortDir}, c.created_at DESC`;

  // Pagination
  const page = Math.max(1, parseInt(filters.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [rows, countResult] = await Promise.all([
    query<ConflictListRow>(
      `SELECT
        c.id, c.conflict_type, c.conflict_mode, c.severity, c.status,
        c.plant_id, c.plant_name, c.attribute_name,
        c.value_a, c.value_b, c.source_a, c.source_b,
        c.specialist_verdict, c.specialist_recommendation,
        c.created_at
      FROM conflicts c
      ${whereClause}
      ${orderBy}
      LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params
    ),
    queryOne<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM conflicts c ${whereClause}`,
      params
    ),
  ]);

  return {
    rows,
    total: Number(countResult?.count ?? 0),
  };
}

// ── Conflict Detail ─────────────────────────────────────────────────────

export async function fetchConflictDetail(
  id: string
): Promise<ConflictDetail | null> {
  return queryOne<ConflictDetail>(
    `SELECT
      c.id, c.conflict_type, c.conflict_mode, c.severity, c.status,
      c.plant_id, c.plant_name, c.attribute_name,
      c.value_a, c.value_b, c.source_a, c.source_b,
      c.specialist_verdict, c.specialist_recommendation,
      c.warrant_a_id, c.warrant_b_id,
      c.classifier_explanation,
      c.specialist_agent, c.specialist_analysis,
      c.batch_id, c.annotated_at, c.created_at
    FROM conflicts c
    WHERE c.id = $1`,
    [id]
  );
}

// ── Conflict Warrants ───────────────────────────────────────────────────

export async function fetchConflictWarrants(
  warrantAId: string,
  warrantBId: string
): Promise<WarrantDetail[]> {
  return query<WarrantDetail>(
    `SELECT id, warrant_type, status, plant_id, plant_genus, plant_species,
            attribute_id, attribute_name, "value", source_value, value_context,
            source_id, source_dataset, source_id_code, source_methodology,
            source_region, source_year, source_reliability,
            match_method, match_confidence, conflict_ids, specialist_notes,
            admin_notes, batch_id, created_at
     FROM warrants
     WHERE id IN ($1, $2)`,
    [warrantAId, warrantBId]
  );
}

// ── Filter Options ──────────────────────────────────────────────────────

export async function fetchConflictFilterOptions(): Promise<ConflictFilterOptions> {
  const [statuses, severities, conflictTypes, attributeCategories, sourceDatasets] =
    await Promise.all([
      query<{ status: string }>(
        "SELECT DISTINCT status FROM conflicts ORDER BY status"
      ),
      query<{ severity: string }>(
        "SELECT DISTINCT severity FROM conflicts ORDER BY severity"
      ),
      query<{ conflict_type: string }>(
        "SELECT DISTINCT conflict_type FROM conflicts ORDER BY conflict_type"
      ),
      query<{ category: string }>(
        `SELECT DISTINCT
          CASE
            WHEN LOWER(attribute_name) LIKE '%fire%' OR LOWER(attribute_name) LIKE '%flammab%' THEN 'fire'
            WHEN LOWER(attribute_name) LIKE '%water%' OR LOWER(attribute_name) LIKE '%drought%' OR LOWER(attribute_name) LIKE '%irrigation%' THEN 'water'
            WHEN LOWER(attribute_name) LIKE '%deer%' OR LOWER(attribute_name) LIKE '%browse%' THEN 'deer'
            WHEN LOWER(attribute_name) LIKE '%native%' OR LOWER(attribute_name) LIKE '%origin%' THEN 'native'
            WHEN LOWER(attribute_name) LIKE '%invasiv%' THEN 'invasive'
            WHEN LOWER(attribute_name) LIKE '%pollinat%' OR LOWER(attribute_name) LIKE '%bird%' OR LOWER(attribute_name) LIKE '%wildlife%' OR LOWER(attribute_name) LIKE '%lepidopt%' THEN 'wildlife'
            ELSE 'other'
          END AS category
        FROM conflicts
        ORDER BY category`
      ),
      query<{ source: string }>(
        `SELECT DISTINCT source FROM (
          SELECT source_a AS source FROM conflicts WHERE source_a IS NOT NULL
          UNION
          SELECT source_b AS source FROM conflicts WHERE source_b IS NOT NULL
        ) s ORDER BY source`
      ),
    ]);

  return {
    statuses: statuses.map((r) => r.status),
    severities: severities.map((r) => r.severity),
    conflictTypes: conflictTypes.map((r) => r.conflict_type),
    attributeCategories: attributeCategories.map((r) => r.category),
    sourceDatasets: sourceDatasets.map((r) => r.source),
  };
}

// ── Update Conflict Status ──────────────────────────────────────────────

const VALID_STATUSES = ["pending", "annotated", "resolved", "dismissed"];

export function isValidConflictStatus(status: string): boolean {
  return VALID_STATUSES.includes(status);
}

export async function updateConflictStatus(
  id: string,
  status: string
): Promise<{ id: string; status: string } | null> {
  const rows = await query<{ id: string; status: string }>(
    `UPDATE conflicts SET status = $1 WHERE id = $2 RETURNING id, status`,
    [status, id]
  );
  return rows[0] || null;
}

// ── Batch Update ────────────────────────────────────────────────────────

export async function batchUpdateConflictStatus(
  ids: string[],
  status: string
): Promise<number> {
  if (ids.length === 0) return 0;

  // Build dynamic IN clause: WHERE id IN ($1, $2, $3, ...)
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  const params: unknown[] = [status, ...ids];

  const rows = await query<{ id: string }>(
    `UPDATE conflicts SET status = $1 WHERE id IN (${placeholders}) RETURNING id`,
    params
  );

  return rows.length;
}
