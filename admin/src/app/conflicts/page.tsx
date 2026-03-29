import {
  fetchPlantConflictQueue,
  fetchConflictFilterOptions,
  type PlantQueueFilters,
} from "@/lib/queries/conflicts";
import {
  fetchMatrixData,
  type MatrixFilters,
} from "@/lib/queries/conflict-matrix";
import { ConflictsClient } from "./conflicts-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;

  const queueFilters: PlantQueueFilters = {
    severity: params.severity,
    queueStatus: params.queueStatus,
    plantSearch: params.plantSearch,
    page: params.page,
  };

  const matrixFilters: MatrixFilters = {
    status: params.status,
    severity: params.severity,
    conflictType: params.conflictType,
  };

  const [{ rows, total }, filterOptions, matrixData] = await Promise.all([
    fetchPlantConflictQueue(queueFilters),
    fetchConflictFilterOptions(),
    fetchMatrixData(matrixFilters),
  ]);

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  return (
    <ConflictsClient
      rows={rows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      filters={queueFilters}
      matrixData={matrixData}
      matrixFilters={matrixFilters}
      matrixFilterOptions={{
        statuses: filterOptions.statuses,
        severities: filterOptions.severities,
        conflictTypes: filterOptions.conflictTypes,
      }}
    />
  );
}
