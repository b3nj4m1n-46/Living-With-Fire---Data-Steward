"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  MatrixData,
  MatrixFilters,
  SourcePairRow,
  SourceSummaryRow,
} from "@/lib/queries/conflict-matrix";

// ── Types ───────────────────────────────────────────────────────────────

interface MatrixClientProps {
  data: MatrixData;
  currentFilters: MatrixFilters;
  filterOptions: {
    statuses: string[];
    severities: string[];
    conflictTypes: string[];
  };
}

type SortKey = keyof Pick<
  SourceSummaryRow,
  "source" | "total_conflicts" | "critical_count" | "pending_count" | "resolution_rate"
>;

// ── Color helpers ───────────────────────────────────────────────────────

function getCellColor(count: number, maxCount: number): string {
  if (count === 0 || maxCount === 0) return "bg-muted/30";
  const intensity = count / maxCount;
  if (intensity > 0.75) return "bg-red-500 text-white";
  if (intensity > 0.5) return "bg-orange-400 text-white";
  if (intensity > 0.25) return "bg-yellow-400 text-black";
  return "bg-yellow-200 text-black";
}

function getCellTooltip(
  rowSource: string,
  colSource: string,
  pair: SourcePairRow | undefined
): string {
  if (!pair) return `${rowSource} vs ${colSource}: 0 conflicts`;
  return `${rowSource} vs ${colSource}: ${pair.conflict_count} conflicts (${pair.critical_count} critical, ${pair.moderate_count} moderate, ${pair.minor_count} minor)`;
}

// ── Component ───────────────────────────────────────────────────────────

export function MatrixClient({
  data,
  currentFilters,
  filterOptions,
}: MatrixClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sortKey, setSortKey] = useState<SortKey>("total_conflicts");
  const [sortAsc, setSortAsc] = useState(false);

  // Build pair lookup map (check both orderings)
  const pairMap = useMemo(() => {
    const map = new Map<string, SourcePairRow>();
    for (const pair of data.pairs) {
      map.set(`${pair.source_a}::${pair.source_b}`, pair);
    }
    return map;
  }, [data.pairs]);

  function lookupPair(a: string, b: string): SourcePairRow | undefined {
    return pairMap.get(`${a}::${b}`) ?? pairMap.get(`${b}::${a}`);
  }

  // Unique sorted source names
  const sourceNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of data.sources) names.add(s.source);
    return Array.from(names).sort();
  }, [data.sources]);

  // Sorted source summary for table
  const sortedSources = useMemo(() => {
    const sorted = [...data.sources];
    sorted.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const numA = Number(aVal);
      const numB = Number(bVal);
      return sortAsc ? numA - numB : numB - numA;
    });
    return sorted;
  }, [data.sources, sortKey, sortAsc]);

  // ── Filter handlers ─────────────────────────────────────────────────

  function updateFilter(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("view", "matrix");
    router.push(`/conflicts?${params.toString()}`);
  }

  function clearFilters() {
    router.push("/conflicts?view=matrix");
  }

  const hasAnyFilter =
    currentFilters.status ||
    currentFilters.severity ||
    currentFilters.conflictType;

  // ── Sort handler ────────────────────────────────────────────────────

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return null;
    return sortAsc ? " \u25B2" : " \u25BC";
  }

  // ── Cell click ──────────────────────────────────────────────────────

  function handleCellClick(rowSource: string, colSource: string) {
    const pair = lookupPair(rowSource, colSource);
    if (!pair || pair.conflict_count === 0) return;
    router.push(
      `/conflicts?sourceA=${encodeURIComponent(rowSource)}&sourceB=${encodeURIComponent(colSource)}`
    );
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={currentFilters.status ?? ""}
          onValueChange={(val) => updateFilter("status", val || undefined)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {filterOptions.statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={currentFilters.severity ?? ""}
          onValueChange={(val) => updateFilter("severity", val || undefined)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            {filterOptions.severities.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={currentFilters.conflictType ?? ""}
          onValueChange={(val) =>
            updateFilter("conflictType", val || undefined)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Conflict type" />
          </SelectTrigger>
          <SelectContent>
            {filterOptions.conflictTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t.replace(/_/g, " ")}
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

      {/* Heatmap */}
      {sourceNames.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No conflict data available for the current filters.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Source Pair Heatmap
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <div
              className="inline-grid gap-px"
              style={{
                gridTemplateColumns: `120px repeat(${sourceNames.length}, minmax(48px, 1fr))`,
              }}
            >
              {/* Header row: empty corner + column labels */}
              <div />
              {sourceNames.map((name) => (
                <div
                  key={`col-${name}`}
                  className="flex items-end justify-center pb-1 text-xs font-medium text-muted-foreground"
                  style={{ minHeight: 80 }}
                >
                  <span
                    className="block origin-bottom-left whitespace-nowrap"
                    style={{ transform: "rotate(-45deg)", transformOrigin: "center" }}
                  >
                    {name}
                  </span>
                </div>
              ))}

              {/* Data rows */}
              {sourceNames.map((rowSource) => (
                <>
                  {/* Row label */}
                  <div
                    key={`row-${rowSource}`}
                    className="flex items-center pr-2 text-xs font-medium text-muted-foreground"
                  >
                    {rowSource}
                  </div>

                  {/* Cells */}
                  {sourceNames.map((colSource) => {
                    if (rowSource === colSource) {
                      return (
                        <div
                          key={`${rowSource}-${colSource}`}
                          className="flex h-12 items-center justify-center bg-muted/10 text-xs text-muted-foreground/30"
                        >
                          &mdash;
                        </div>
                      );
                    }

                    const pair = lookupPair(rowSource, colSource);
                    const count = pair?.conflict_count ?? 0;

                    return (
                      <div
                        key={`${rowSource}-${colSource}`}
                        className={`flex h-12 cursor-pointer items-center justify-center text-xs font-medium transition-all hover:ring-2 hover:ring-primary ${getCellColor(count, data.maxConflicts)}`}
                        title={getCellTooltip(rowSource, colSource, pair)}
                        onClick={() => handleCellClick(rowSource, colSource)}
                      >
                        {count > 0 ? count : ""}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>

            {/* Color legend */}
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Fewer</span>
              <div className="flex gap-px">
                <div className="h-4 w-8 bg-muted/30" />
                <div className="h-4 w-8 bg-yellow-200" />
                <div className="h-4 w-8 bg-yellow-400" />
                <div className="h-4 w-8 bg-orange-400" />
                <div className="h-4 w-8 bg-red-500" />
              </div>
              <span>More conflicts</span>
              {data.maxConflicts > 0 && (
                <span className="ml-2">(max: {data.maxConflicts})</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source Summary Table */}
      {data.sources.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Per-Source Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("source")}
                  >
                    Source{sortIndicator("source")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("total_conflicts")}
                  >
                    Total{sortIndicator("total_conflicts")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("critical_count")}
                  >
                    Critical{sortIndicator("critical_count")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("pending_count")}
                  >
                    Pending{sortIndicator("pending_count")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("resolution_rate")}
                  >
                    Resolution Rate{sortIndicator("resolution_rate")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSources.map((s) => (
                  <TableRow key={s.source}>
                    <TableCell>
                      <Link
                        href={`/conflicts?sourceDataset=${encodeURIComponent(s.source)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.source}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      {s.total_conflicts.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.critical_count > 0 ? (
                        <Badge variant="destructive">
                          {s.critical_count.toLocaleString()}
                        </Badge>
                      ) : (
                        "0"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.pending_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {s.resolution_rate}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
