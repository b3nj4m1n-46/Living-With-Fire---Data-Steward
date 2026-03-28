import {
  fetchConflictsList,
  fetchConflictFilterOptions,
  type ConflictListFilters,
} from "@/lib/queries/conflicts";
import { ConflictsFilters } from "./conflicts-filters";
import { ConflictsTable } from "./conflicts-table";

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
    attributeCategory: params.attributeCategory,
    sourceDataset: params.sourceDataset,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    page: params.page,
  };

  const [{ rows, total }, filterOptions] = await Promise.all([
    fetchConflictsList(filters),
    fetchConflictFilterOptions(),
  ]);

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Conflicts</h2>

      <ConflictsFilters options={filterOptions} currentFilters={filters} />

      <ConflictsTable
        rows={rows}
        total={total}
        page={page}
        pageSize={PAGE_SIZE}
        sortBy={filters.sortBy ?? "severity"}
        sortDir={filters.sortDir ?? "desc"}
      />
    </div>
  );
}
