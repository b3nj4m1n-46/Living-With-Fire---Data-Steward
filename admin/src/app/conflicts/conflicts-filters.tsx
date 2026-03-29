"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlantQueueFilters } from "@/lib/queries/conflicts";

interface ConflictsFiltersProps {
  currentFilters: PlantQueueFilters;
}

export function ConflictsFilters({ currentFilters }: ConflictsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(
    currentFilters.plantSearch ?? ""
  );

  // Debounced plant search
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue) {
        params.set("plantSearch", searchValue);
      } else {
        params.delete("plantSearch");
      }
      params.delete("page");
      router.push(`/conflicts?${params.toString()}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchValue]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    router.push(`/conflicts?${params.toString()}`);
  }

  function clearFilters() {
    setSearchValue("");
    router.push("/conflicts");
  }

  const hasAnyFilter =
    currentFilters.severity ||
    currentFilters.queueStatus ||
    currentFilters.plantSearch;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Plant name search */}
      <Input
        placeholder="Search plants..."
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        className="w-56"
      />

      {/* Severity filter */}
      <Select
        value={currentFilters.severity ?? ""}
        onValueChange={(val) => updateFilter("severity", val || undefined)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Severity" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="critical">Critical</SelectItem>
          <SelectItem value="moderate">Moderate</SelectItem>
          <SelectItem value="minor">Minor</SelectItem>
        </SelectContent>
      </Select>

      {/* Queue status filter */}
      <Select
        value={currentFilters.queueStatus ?? ""}
        onValueChange={(val) => updateFilter("queueStatus", val || undefined)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="in_progress">In progress</SelectItem>
          <SelectItem value="complete">Complete</SelectItem>
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
