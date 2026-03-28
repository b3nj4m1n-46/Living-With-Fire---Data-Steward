"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FilterOptions, ClaimsListFilters } from "@/lib/queries/claims";

interface ClaimsFiltersProps {
  options: FilterOptions;
  currentFilters: ClaimsListFilters;
}

export function ClaimsFilters({ options, currentFilters }: ClaimsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/claims?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/claims");
  }

  const hasAnyFilter =
    currentFilters.hasConflicts ||
    currentFilters.claimStatus ||
    currentFilters.sourceDataset;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Has Conflicts filter */}
      <Select
        value={currentFilters.hasConflicts ?? ""}
        onValueChange={(val) =>
          updateFilter("hasConflicts", val || undefined)
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Conflicts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Has conflicts</SelectItem>
        </SelectContent>
      </Select>

      {/* Claim Status filter */}
      <Select
        value={currentFilters.claimStatus ?? ""}
        onValueChange={(val) =>
          updateFilter("claimStatus", val || undefined)
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Claim status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No claim</SelectItem>
          {options.statuses.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Source Dataset filter */}
      <Select
        value={currentFilters.sourceDataset ?? ""}
        onValueChange={(val) =>
          updateFilter("sourceDataset", val || undefined)
        }
      >
        <SelectTrigger>
          <SelectValue placeholder="Source dataset" />
        </SelectTrigger>
        <SelectContent>
          {options.sourceDatasets.map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasAnyFilter && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
