import { query, queryOne } from "@/lib/dolt";

// ── Interfaces ──────────────────────────────────────────────────────────

export interface ClaimsListRow {
  plant_id: string;
  plant_name: string;
  attribute_id: string;
  attribute_name: string;
  warrant_count: number;
  source_datasets: string;
  has_conflicts: boolean;
  claim_status: string | null;
  claim_id: string | null;
}

export interface WarrantDetail {
  id: string;
  warrant_type: string;
  status: string;
  plant_id: string;
  plant_genus: string;
  plant_species: string;
  attribute_id: string;
  attribute_name: string;
  value: string;
  source_value: string | null;
  value_context: string | null;
  source_id: string | null;
  source_dataset: string | null;
  source_id_code: string | null;
  source_methodology: string | null;
  source_region: string | null;
  source_year: string | null;
  source_reliability: string | null;
  match_method: string;
  match_confidence: number | null;
  conflict_ids: string | null;
  specialist_notes: string | null;
  admin_notes: string | null;
  batch_id: string | null;
  created_at: string;
}

export interface ConflictSummary {
  id: string;
  conflict_type: string;
  severity: string;
  status: string;
  specialist_verdict: string | null;
  specialist_analysis: string | null;
  specialist_recommendation: string | null;
  value_a: string | null;
  value_b: string | null;
  source_a: string | null;
  source_b: string | null;
  other_warrant_id: string;
}

export interface ClaimRecord {
  id: string;
  status: string;
  plant_id: string;
  attribute_id: string;
  plant_name: string | null;
  attribute_name: string | null;
  categorical_value: string | null;
  synthesized_text: string;
  confidence: string;
  confidence_reasoning: string | null;
  previous_value: string | null;
  warrant_count: number | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_notes: string | null;
  edited_value: string | null;
  dolt_commit_hash: string | null;
  created_at: string;
}

export interface PlantInfo {
  id: string;
  genus: string;
  species: string | null;
  common_name: string | null;
}

export interface AttributeInfo {
  id: string;
  name: string;
  value_type: string | null;
  values_allowed: string | null;
}

export interface ClaimViewData {
  claim: ClaimRecord | null;
  warrants: WarrantDetail[];
  plant: PlantInfo | null;
  attribute: AttributeInfo | null;
  productionValue: string | null;
  conflicts: ConflictSummary[];
}

export interface ClaimsListFilters {
  hasConflicts?: string;
  claimStatus?: string;
  sourceDataset?: string;
}

export interface FilterOptions {
  statuses: string[];
  sourceDatasets: string[];
}

// ── Claims List ─────────────────────────────────────────────────────────

export async function fetchClaimsList(
  filters: ClaimsListFilters
): Promise<ClaimsListRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters.hasConflicts === "true") {
    conditions.push(
      `(w.conflict_ids IS NOT NULL AND w.conflict_ids != '[]' AND w.conflict_ids != '')`
    );
  }

  if (filters.claimStatus) {
    if (filters.claimStatus === "none") {
      conditions.push(`c.id IS NULL`);
    } else {
      conditions.push(`c.status = $${paramIndex}`);
      params.push(filters.claimStatus);
      paramIndex++;
    }
  }

  if (filters.sourceDataset) {
    conditions.push(`w.source_dataset = $${paramIndex}`);
    params.push(filters.sourceDataset);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT
      w.plant_id,
      w.plant_genus || ' ' || COALESCE(w.plant_species, '') AS plant_name,
      w.attribute_id,
      w.attribute_name,
      COUNT(DISTINCT w.id)::int AS warrant_count,
      STRING_AGG(DISTINCT w.source_id_code, ', ') AS source_datasets,
      BOOL_OR(w.conflict_ids IS NOT NULL AND w.conflict_ids != '[]' AND w.conflict_ids != '') AS has_conflicts,
      c.status AS claim_status,
      c.id AS claim_id
    FROM warrants w
    LEFT JOIN claims c ON c.plant_id = w.plant_id AND c.attribute_id = w.attribute_id
    ${whereClause}
    GROUP BY w.plant_id, w.plant_genus, w.plant_species, w.attribute_id, w.attribute_name, c.status, c.id
    ORDER BY
      BOOL_OR(w.conflict_ids IS NOT NULL AND w.conflict_ids != '[]' AND w.conflict_ids != '') DESC,
      COUNT(DISTINCT w.id) DESC
    LIMIT 500
  `;

  const rows = await query<{
    plant_id: string;
    plant_name: string;
    attribute_id: string;
    attribute_name: string;
    warrant_count: string | number;
    source_datasets: string | null;
    has_conflicts: boolean;
    claim_status: string | null;
    claim_id: string | null;
  }>(sql, params);

  return rows.map((r) => ({
    plant_id: r.plant_id,
    plant_name: r.plant_name?.trim() ?? "",
    attribute_id: r.attribute_id,
    attribute_name: r.attribute_name,
    warrant_count: Number(r.warrant_count),
    source_datasets: r.source_datasets ?? "",
    has_conflicts: Boolean(r.has_conflicts),
    claim_status: r.claim_status,
    claim_id: r.claim_id,
  }));
}

// ── Filter Options ──────────────────────────────────────────────────────

export async function fetchFilterOptions(): Promise<FilterOptions> {
  const [statuses, datasets] = await Promise.all([
    query<{ status: string }>(
      "SELECT DISTINCT status FROM claims ORDER BY status"
    ),
    query<{ source_id_code: string }>(
      "SELECT DISTINCT source_id_code FROM warrants WHERE source_id_code IS NOT NULL ORDER BY source_id_code"
    ),
  ]);

  return {
    statuses: statuses.map((r) => r.status),
    sourceDatasets: datasets.map((r) => r.source_id_code),
  };
}

// ── Claim View Data ─────────────────────────────────────────────────────

export async function fetchClaimViewData(
  plantId: string,
  attributeId: string
): Promise<ClaimViewData> {
  const [claim, warrants, plant, attribute, productionVal, conflicts] =
    await Promise.all([
      // Existing claim (if any)
      queryOne<ClaimRecord>(
        `SELECT * FROM claims WHERE plant_id = $1 AND attribute_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [plantId, attributeId]
      ),

      // All warrants for this plant+attribute
      query<WarrantDetail>(
        `SELECT id, warrant_type, status, plant_id, plant_genus, plant_species,
                attribute_id, attribute_name, "value", source_value, value_context,
                source_id, source_dataset, source_id_code, source_methodology,
                source_region, source_year, source_reliability,
                match_method, match_confidence, conflict_ids, specialist_notes,
                admin_notes, batch_id, created_at
         FROM warrants
         WHERE plant_id = $1 AND attribute_id = $2
         ORDER BY
           CASE warrant_type WHEN 'existing' THEN 0 WHEN 'external' THEN 1 ELSE 2 END,
           source_dataset, created_at`,
        [plantId, attributeId]
      ),

      // Plant info
      queryOne<PlantInfo>(
        `SELECT id, genus, species, common_name FROM plants WHERE id = $1`,
        [plantId]
      ),

      // Attribute info
      queryOne<AttributeInfo>(
        `SELECT id, name, value_type, values_allowed FROM attributes WHERE id = $1`,
        [attributeId]
      ),

      // Current production value
      queryOne<{ value: string }>(
        `SELECT "value" FROM "values" WHERE plant_id = $1 AND attribute_id = $2 LIMIT 1`,
        [plantId, attributeId]
      ),

      // Conflicts involving warrants for this plant+attribute
      query<{
        id: string;
        conflict_type: string;
        severity: string;
        status: string;
        specialist_verdict: string | null;
        specialist_analysis: string | null;
        specialist_recommendation: string | null;
        value_a: string | null;
        value_b: string | null;
        source_a: string | null;
        source_b: string | null;
        warrant_a_id: string;
        warrant_b_id: string;
      }>(
        `SELECT c.id, c.conflict_type, c.severity, c.status,
                c.specialist_verdict, c.specialist_analysis, c.specialist_recommendation,
                c.value_a, c.value_b, c.source_a, c.source_b,
                c.warrant_a_id, c.warrant_b_id
         FROM conflicts c
         WHERE c.plant_id = $1
           AND c.attribute_name = (SELECT attribute_name FROM warrants WHERE plant_id = $1 AND attribute_id = $2 LIMIT 1)`,
        [plantId, attributeId]
      ),
    ]);

  // Map conflicts to include a reference to "the other warrant"
  const conflictSummaries: ConflictSummary[] = conflicts.map((c) => ({
    id: c.id,
    conflict_type: c.conflict_type,
    severity: c.severity,
    status: c.status,
    specialist_verdict: c.specialist_verdict,
    specialist_analysis: c.specialist_analysis,
    specialist_recommendation: c.specialist_recommendation,
    value_a: c.value_a,
    value_b: c.value_b,
    source_a: c.source_a,
    source_b: c.source_b,
    other_warrant_id: c.warrant_b_id,
  }));

  return {
    claim,
    warrants,
    plant,
    attribute,
    productionValue: productionVal?.value ?? null,
    conflicts: conflictSummaries,
  };
}
