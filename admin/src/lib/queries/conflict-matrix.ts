import { query } from "@/lib/dolt";

// ── Interfaces ──────────────────────────────────────────────────────────

export interface SourcePairRow {
  source_a: string;
  source_b: string;
  conflict_count: number;
  critical_count: number;
  moderate_count: number;
  minor_count: number;
  pending_count: number;
  resolved_count: number;
}

export interface SourceSummaryRow {
  source: string;
  total_conflicts: number;
  critical_count: number;
  pending_count: number;
  resolved_count: number;
  resolution_rate: number;
}

export interface MatrixFilters {
  status?: string;
  severity?: string;
  conflictType?: string;
}

export interface MatrixData {
  pairs: SourcePairRow[];
  sources: SourceSummaryRow[];
  maxConflicts: number;
}

// ── Filter builder ──────────────────────────────────────────────────────

function buildWhereClause(
  filters: MatrixFilters,
  alias: string,
  startIndex: number
): { clause: string; params: unknown[]; nextIndex: number } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = startIndex;

  if (filters.status) {
    conditions.push(`${alias}.status = $${idx}`);
    params.push(filters.status);
    idx++;
  }

  if (filters.severity) {
    conditions.push(`${alias}.severity = $${idx}`);
    params.push(filters.severity);
    idx++;
  }

  if (filters.conflictType) {
    conditions.push(`${alias}.conflict_type = $${idx}`);
    params.push(filters.conflictType);
    idx++;
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    nextIndex: idx,
  };
}

// ── Matrix Data ─────────────────────────────────────────────────────────

export async function fetchMatrixData(
  filters: MatrixFilters
): Promise<MatrixData> {
  const { clause: where1, params: params1 } = buildWhereClause(
    filters,
    "c",
    1
  );

  // Source pair aggregation
  const pairsQuery = query<{
    source_a: string;
    source_b: string;
    conflict_count: string;
    critical_count: string;
    moderate_count: string;
    minor_count: string;
    pending_count: string;
    resolved_count: string;
  }>(
    `SELECT c.source_a, c.source_b,
      COUNT(*)::int AS conflict_count,
      SUM(CASE WHEN c.severity = 'critical' THEN 1 ELSE 0 END)::int AS critical_count,
      SUM(CASE WHEN c.severity = 'moderate' THEN 1 ELSE 0 END)::int AS moderate_count,
      SUM(CASE WHEN c.severity = 'minor' THEN 1 ELSE 0 END)::int AS minor_count,
      SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
      SUM(CASE WHEN c.status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END)::int AS resolved_count
    FROM conflicts c
    ${where1}
    GROUP BY c.source_a, c.source_b
    ORDER BY conflict_count DESC`,
    params1
  );

  // Per-source summary — need to duplicate WHERE params for UNION ALL legs
  const { clause: innerWhere1, params: innerParams1, nextIndex } =
    buildWhereClause(filters, "c", 1);
  const { clause: innerWhere2, params: innerParams2 } = buildWhereClause(
    filters,
    "c",
    nextIndex
  );

  const sourcesQuery = query<{
    source: string;
    total_conflicts: string;
    critical_count: string;
    pending_count: string;
    resolved_count: string;
    resolution_rate: string;
  }>(
    `SELECT source,
      COUNT(*)::int AS total_conflicts,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)::int AS critical_count,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
      SUM(CASE WHEN status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END)::int AS resolved_count,
      ROUND(100.0 * SUM(CASE WHEN status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS resolution_rate
    FROM (
      SELECT c.source_a AS source, c.severity, c.status FROM conflicts c ${innerWhere1}
      UNION ALL
      SELECT c.source_b AS source, c.severity, c.status FROM conflicts c ${innerWhere2}
    ) sub
    GROUP BY source
    ORDER BY total_conflicts DESC`,
    [...innerParams1, ...innerParams2]
  );

  const [pairsRaw, sourcesRaw] = await Promise.all([pairsQuery, sourcesQuery]);

  const pairs: SourcePairRow[] = pairsRaw.map((r) => ({
    source_a: r.source_a,
    source_b: r.source_b,
    conflict_count: Number(r.conflict_count),
    critical_count: Number(r.critical_count),
    moderate_count: Number(r.moderate_count),
    minor_count: Number(r.minor_count),
    pending_count: Number(r.pending_count),
    resolved_count: Number(r.resolved_count),
  }));

  const sources: SourceSummaryRow[] = sourcesRaw.map((r) => ({
    source: r.source,
    total_conflicts: Number(r.total_conflicts),
    critical_count: Number(r.critical_count),
    pending_count: Number(r.pending_count),
    resolved_count: Number(r.resolved_count),
    resolution_rate: Number(r.resolution_rate ?? 0),
  }));

  const maxConflicts =
    pairs.length > 0
      ? Math.max(...pairs.map((p) => p.conflict_count))
      : 0;

  return { pairs, sources, maxConflicts };
}

// ── Pair Type Breakdown ─────────────────────────────────────────────────

export interface PairTypeBreakdownRow {
  conflict_type: string;
  severity: string;
  count: number;
  pending: number;
}

export async function fetchPairTypeBreakdown(
  sourceA: string,
  sourceB: string
): Promise<PairTypeBreakdownRow[]> {
  const rows = await query<{
    conflict_type: string;
    severity: string;
    count: string;
    pending: string;
  }>(
    `SELECT conflict_type, severity,
      COUNT(*)::int AS count,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending
    FROM conflicts
    WHERE (source_a = $1 AND source_b = $2) OR (source_a = $2 AND source_b = $1)
    GROUP BY conflict_type, severity
    ORDER BY count DESC`,
    [sourceA, sourceB]
  );

  return rows.map((r) => ({
    conflict_type: r.conflict_type,
    severity: r.severity,
    count: Number(r.count),
    pending: Number(r.pending),
  }));
}

// ── Top Conflicting Pairs (for dashboard) ───────────────────────────────

export async function fetchTopConflictingPairs(
  limit = 5
): Promise<SourcePairRow[]> {
  const rows = await query<{
    source_a: string;
    source_b: string;
    conflict_count: string;
    critical_count: string;
    moderate_count: string;
    minor_count: string;
    pending_count: string;
    resolved_count: string;
  }>(
    `SELECT source_a, source_b,
      COUNT(*)::int AS conflict_count,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)::int AS critical_count,
      SUM(CASE WHEN severity = 'moderate' THEN 1 ELSE 0 END)::int AS moderate_count,
      SUM(CASE WHEN severity = 'minor' THEN 1 ELSE 0 END)::int AS minor_count,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
      SUM(CASE WHEN status IN ('resolved', 'dismissed') THEN 1 ELSE 0 END)::int AS resolved_count
    FROM conflicts
    GROUP BY source_a, source_b
    ORDER BY conflict_count DESC
    LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    source_a: r.source_a,
    source_b: r.source_b,
    conflict_count: Number(r.conflict_count),
    critical_count: Number(r.critical_count),
    moderate_count: Number(r.moderate_count),
    minor_count: Number(r.minor_count),
    pending_count: Number(r.pending_count),
    resolved_count: Number(r.resolved_count),
  }));
}
