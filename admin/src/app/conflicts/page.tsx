import {
  fetchConflictsList,
  fetchConflictFilterOptions,
  type ConflictListFilters,
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

  const filters: ConflictListFilters = {
    status: params.status,
    severity: params.severity,
    conflictType: params.conflictType,
    conflictMode: params.conflictMode,
    attributeCategory: params.attributeCategory,
    sourceDataset: params.sourceDataset,
    sourceA: params.sourceA,
    sourceB: params.sourceB,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    page: params.page,
  };

  const matrixFilters: MatrixFilters = {
    status: params.status,
    severity: params.severity,
    conflictType: params.conflictType,
  };

  const [{ rows, total }, filterOptions, matrixData] = await Promise.all([
    fetchConflictsList(filters),
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
      filters={filters}
      filterOptions={filterOptions}
      matrixData={matrixData}
      matrixFilters={matrixFilters}
    />
  );
}
