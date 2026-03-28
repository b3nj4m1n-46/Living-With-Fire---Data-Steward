import { query, queryOne } from "@/lib/dolt";

export interface WarrantStats {
  total: number;
  byType: { warrant_type: string; count: number }[];
}

export interface ConflictStats {
  pending: number;
  bySeverity: { severity: string; count: number }[];
}

export interface ClaimStats {
  total: number;
  byStatus: { status: string; count: number }[];
}

export interface DatasetStats {
  completed: number;
  sources: string[];
}

export interface AnalysisBatch {
  id: string;
  source_dataset: string;
  source_id_code: string;
  batch_type: string;
  status: string;
  plants_matched: number | null;
  warrants_created: number | null;
  conflicts_detected: number | null;
  started_at: string;
}

export interface DashboardData {
  warrants: WarrantStats;
  conflicts: ConflictStats;
  claims: ClaimStats;
  datasets: DatasetStats;
  batches: AnalysisBatch[];
  criticalPendingCount: number;
  unreviewedLatestBatchCount: number;
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const [
    warrantTotal,
    warrantsByType,
    pendingConflicts,
    conflictsBySeverity,
    claimTotal,
    claimsByStatus,
    completedDatasets,
    datasetSources,
    batches,
    criticalPending,
    unreviewedLatest,
  ] = await Promise.all([
    queryOne<{ count: string }>("SELECT COUNT(*) as count FROM warrants"),
    query<{ warrant_type: string; count: string }>(
      "SELECT warrant_type, COUNT(*) as count FROM warrants GROUP BY warrant_type"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM conflicts WHERE status = 'pending'"
    ),
    query<{ severity: string; count: string }>(
      "SELECT severity, COUNT(*) as count FROM conflicts GROUP BY severity"
    ),
    queryOne<{ count: string }>("SELECT COUNT(*) as count FROM claims"),
    query<{ status: string; count: string }>(
      "SELECT status, COUNT(*) as count FROM claims GROUP BY status"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM analysis_batches WHERE status = 'completed'"
    ),
    query<{ source_id_code: string }>(
      "SELECT DISTINCT source_id_code FROM analysis_batches WHERE status = 'completed' ORDER BY source_id_code"
    ),
    query<AnalysisBatch>(
      "SELECT id, source_dataset, source_id_code, batch_type, status, plants_matched, warrants_created, conflicts_detected, started_at FROM analysis_batches ORDER BY started_at DESC LIMIT 50"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM conflicts WHERE severity = 'critical' AND status = 'pending'"
    ),
    queryOne<{ count: string }>(
      "SELECT COUNT(*) as count FROM warrants WHERE status = 'unreviewed' AND batch_id = (SELECT id FROM analysis_batches ORDER BY started_at DESC LIMIT 1)"
    ),
  ]);

  return {
    warrants: {
      total: Number(warrantTotal?.count ?? 0),
      byType: warrantsByType.map((r) => ({
        warrant_type: r.warrant_type,
        count: Number(r.count),
      })),
    },
    conflicts: {
      pending: Number(pendingConflicts?.count ?? 0),
      bySeverity: conflictsBySeverity.map((r) => ({
        severity: r.severity,
        count: Number(r.count),
      })),
    },
    claims: {
      total: Number(claimTotal?.count ?? 0),
      byStatus: claimsByStatus.map((r) => ({
        status: r.status,
        count: Number(r.count),
      })),
    },
    datasets: {
      completed: Number(completedDatasets?.count ?? 0),
      sources: datasetSources.map((r) => r.source_id_code),
    },
    batches,
    criticalPendingCount: Number(criticalPending?.count ?? 0),
    unreviewedLatestBatchCount: Number(unreviewedLatest?.count ?? 0),
  };
}
