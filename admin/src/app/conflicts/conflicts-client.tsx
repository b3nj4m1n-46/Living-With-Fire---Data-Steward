"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ConflictsFilters } from "./conflicts-filters";
import { ConflictsTable } from "./conflicts-table";
import { MatrixClient } from "./matrix-client";
import type { ConflictFilterOptions, ConflictListFilters, ConflictListRow } from "@/lib/queries/conflicts";
import type { MatrixData, MatrixFilters } from "@/lib/queries/conflict-matrix";

interface ConflictsClientProps {
  // List view props
  rows: ConflictListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: ConflictListFilters;
  filterOptions: ConflictFilterOptions;
  // Matrix view props
  matrixData: MatrixData;
  matrixFilters: MatrixFilters;
}

export function ConflictsClient({
  rows,
  total,
  page,
  pageSize,
  filters,
  filterOptions,
  matrixData,
  matrixFilters,
}: ConflictsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "list";

  function switchView(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (v === "list") {
      params.delete("view");
    } else {
      params.set("view", v);
    }
    router.push(`/conflicts?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Conflicts</h2>
        <div className="flex rounded-md border">
          <button
            onClick={() => switchView("list")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              view !== "matrix"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            List
          </button>
          <button
            onClick={() => switchView("matrix")}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              view === "matrix"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Matrix
          </button>
        </div>
      </div>

      {view === "matrix" ? (
        <MatrixClient
          data={matrixData}
          currentFilters={matrixFilters}
          filterOptions={{
            statuses: filterOptions.statuses,
            severities: filterOptions.severities,
            conflictTypes: filterOptions.conflictTypes,
          }}
        />
      ) : (
        <>
          <ConflictsFilters options={filterOptions} currentFilters={filters} />
          <ConflictsTable
            rows={rows}
            total={total}
            page={page}
            pageSize={pageSize}
            sortBy={filters.sortBy ?? "severity"}
            sortDir={filters.sortDir ?? "desc"}
          />
        </>
      )}
    </div>
  );
}
