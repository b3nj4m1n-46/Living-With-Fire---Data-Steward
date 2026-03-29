"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ConflictsFilters } from "./conflicts-filters";
import { PlantQueueTable } from "./plant-queue-table";
import { MatrixClient } from "./matrix-client";
import type { PlantQueueRow, PlantQueueFilters } from "@/lib/queries/conflicts";
import type { MatrixData, MatrixFilters } from "@/lib/queries/conflict-matrix";

interface ConflictsClientProps {
  rows: PlantQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: PlantQueueFilters;
  matrixData: MatrixData;
  matrixFilters: MatrixFilters;
  matrixFilterOptions: {
    statuses: string[];
    severities: string[];
    conflictTypes: string[];
  };
}

export function ConflictsClient({
  rows,
  total,
  page,
  pageSize,
  filters,
  matrixData,
  matrixFilters,
  matrixFilterOptions,
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
            Plant Queue
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
          filterOptions={matrixFilterOptions}
        />
      ) : (
        <>
          <ConflictsFilters currentFilters={filters} />
          <PlantQueueTable
            rows={rows}
            total={total}
            page={page}
            pageSize={pageSize}
          />
        </>
      )}
    </div>
  );
}
