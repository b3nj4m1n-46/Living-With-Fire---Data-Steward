import { query, queryOne } from "@/lib/dolt";
import type { WarrantDetail } from "@/lib/queries/claims";

// ── Plant Queue Interfaces ──────────────────────────────────────────────

export interface PlantQueueRow {
  plant_id: string;
  plant_name: string;
  total_conflicts: number;
  max_severity: string;
  attributes_affected: number;
  unresolved_count: number;
  queue_status: "pending" | "in_progress" | "complete";
}

export interface PlantQueueFilters {
  severity?: string;
  queueStatus?: string;
  plantSearch?: string;
  page?: string;
}

export interface PlantConflictAttribute {
  attribute_name: string;
  attribute_id: string | null;
  conflict_count: number;
  unresolved_count: number;
  max_severity: string;
}

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
  conflictMode?: string;
  attributeCategory?: string;
  sourceDataset?: string;
  sourceA?: string;
  sourceB?: string;
  sortBy?: string;
  sortDir?: string;
  page?: string;
}

export interface ConflictFilterOptions {
  statuses: string[];
  severities: string[];
  conflictTypes: string[];
  conflictModes: string[];
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

  if (filters.conflictMode) {
    conditions.push(`c.conflict_mode = $${paramIndex}`);
    params.push(filters.conflictMode);
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

  if (filters.sourceA && filters.sourceB) {
    conditions.push(
      `((c.source_a = $${paramIndex} AND c.source_b = $${paramIndex + 1}) OR (c.source_a = $${paramIndex + 1} AND c.source_b = $${paramIndex}))`
    );
    params.push(filters.sourceA, filters.sourceB);
    paramIndex += 2;
  } else if (filters.sourceA) {
    conditions.push(
      `(c.source_a = $${paramIndex} OR c.source_b = $${paramIndex})`
    );
    params.push(filters.sourceA);
    paramIndex++;
  } else if (filters.sourceB) {
    conditions.push(
      `(c.source_a = $${paramIndex} OR c.source_b = $${paramIndex})`
    );
    params.push(filters.sourceB);
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
  const [statuses, severities, conflictTypes, conflictModes, attributeCategories, sourceDatasets] =
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
      query<{ conflict_mode: string }>(
        "SELECT DISTINCT conflict_mode FROM conflicts ORDER BY conflict_mode"
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
    conflictModes: conflictModes.map((r) => r.conflict_mode),
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

// ── Update Specialist Verdict ───────────────────────────────────────────

export async function updateSpecialistVerdict(
  id: string,
  verdict: string,
  analysis: string,
  recommendation: string
): Promise<{ id: string } | null> {
  const rows = await query<{ id: string }>(
    `UPDATE conflicts
     SET specialist_verdict = $1, specialist_analysis = $2,
         specialist_recommendation = $3, status = 'annotated', annotated_at = NOW()
     WHERE id = $4
     RETURNING id`,
    [verdict, analysis, recommendation, id]
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

// ── Plant Conflict Queue ───────────────────────────────────────────────

const QUEUE_PAGE_SIZE = 50;

export async function fetchPlantConflictQueue(
  filters: PlantQueueFilters
): Promise<{ rows: PlantQueueRow[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.severity) {
    conditions.push(`c.severity = $${paramIndex}`);
    params.push(filters.severity);
    paramIndex++;
  }

  if (filters.plantSearch) {
    conditions.push(`LOWER(c.plant_name) LIKE LOWER($${paramIndex})`);
    params.push(`%${filters.plantSearch}%`);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Build HAVING clause for computed queue_status filter
  let havingClause = "";
  if (filters.queueStatus) {
    havingClause = `HAVING CASE
      WHEN SUM(CASE WHEN c.status IN ('pending', 'annotated') THEN 1 ELSE 0 END) = 0 THEN 'complete'
      WHEN SUM(CASE WHEN c.status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END) > 0 THEN 'in_progress'
      ELSE 'pending'
    END = $${paramIndex}`;
    params.push(filters.queueStatus);
    paramIndex++;
  }

  const page = Math.max(1, parseInt(filters.page ?? "1", 10) || 1);
  const offset = (page - 1) * QUEUE_PAGE_SIZE;

  const baseSql = `
    FROM conflicts c
    ${whereClause}
    GROUP BY c.plant_id, c.plant_name
    ${havingClause}
  `;

  const [rows, countResult] = await Promise.all([
    query<{
      plant_id: string;
      plant_name: string;
      total_conflicts: string;
      max_severity: string;
      attributes_affected: string;
      unresolved_count: string;
      queue_status: string;
    }>(
      `SELECT
        c.plant_id,
        c.plant_name,
        COUNT(*)::int AS total_conflicts,
        CASE MAX(CASE c.severity WHEN 'critical' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END)
          WHEN 2 THEN 'critical'
          WHEN 1 THEN 'moderate'
          ELSE 'minor'
        END AS max_severity,
        COUNT(DISTINCT c.attribute_name)::int AS attributes_affected,
        SUM(CASE WHEN c.status IN ('pending', 'annotated') THEN 1 ELSE 0 END)::int AS unresolved_count,
        CASE
          WHEN SUM(CASE WHEN c.status IN ('pending', 'annotated') THEN 1 ELSE 0 END) = 0 THEN 'complete'
          WHEN SUM(CASE WHEN c.status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END) > 0 THEN 'in_progress'
          ELSE 'pending'
        END AS queue_status
      ${baseSql}
      ORDER BY
        MAX(CASE c.severity WHEN 'critical' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END) DESC,
        SUM(CASE WHEN c.status IN ('pending', 'annotated') THEN 1 ELSE 0 END) DESC
      LIMIT ${QUEUE_PAGE_SIZE} OFFSET ${offset}`,
      params
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM (
        SELECT c.plant_id
        ${baseSql}
      ) sub`,
      params
    ),
  ]);

  return {
    rows: rows.map((r) => ({
      plant_id: r.plant_id,
      plant_name: r.plant_name?.trim() ?? "",
      total_conflicts: Number(r.total_conflicts),
      max_severity: r.max_severity,
      attributes_affected: Number(r.attributes_affected),
      unresolved_count: Number(r.unresolved_count),
      queue_status: r.queue_status as PlantQueueRow["queue_status"],
    })),
    total: Number(countResult[0]?.count ?? 0),
  };
}

// ── Plant Conflict Attributes ──────────────────────────────────────────

export async function fetchPlantConflictAttributes(
  plantId: string
): Promise<PlantConflictAttribute[]> {
  const rows = await query<{
    attribute_name: string;
    attribute_id: string | null;
    conflict_count: string;
    unresolved_count: string;
    max_severity: string;
  }>(
    `SELECT
      c.attribute_name,
      (SELECT w.attribute_id FROM warrants w
       WHERE w.plant_id = c.plant_id AND w.attribute_name = c.attribute_name LIMIT 1) AS attribute_id,
      COUNT(*)::int AS conflict_count,
      SUM(CASE WHEN c.status IN ('pending', 'annotated') THEN 1 ELSE 0 END)::int AS unresolved_count,
      CASE MAX(CASE c.severity WHEN 'critical' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END)
        WHEN 2 THEN 'critical'
        WHEN 1 THEN 'moderate'
        ELSE 'minor'
      END AS max_severity
    FROM conflicts c
    WHERE c.plant_id = $1
    GROUP BY c.plant_id, c.attribute_name
    ORDER BY
      MAX(CASE c.severity WHEN 'critical' THEN 2 WHEN 'moderate' THEN 1 ELSE 0 END) DESC,
      COUNT(*) DESC`,
    [plantId]
  );

  return rows.map((r) => ({
    attribute_name: r.attribute_name,
    attribute_id: r.attribute_id,
    conflict_count: Number(r.conflict_count),
    unresolved_count: Number(r.unresolved_count),
    max_severity: r.max_severity,
  }));
}
