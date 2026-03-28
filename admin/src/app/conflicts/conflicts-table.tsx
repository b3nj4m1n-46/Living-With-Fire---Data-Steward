"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WarrantCard } from "@/components/warrant-card";
import { ResearchPanel } from "./research-panel";
import { toast } from "sonner";
import type { ConflictListRow } from "@/lib/queries/conflicts";
import type { ConflictSummary, WarrantDetail } from "@/lib/queries/claims";

interface ConflictsTableProps {
  rows: ConflictListRow[];
  total: number;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDir: string;
}

interface ExpandedData {
  warrants: WarrantDetail[];
  classifier_explanation: string | null;
  specialist_analysis: string | null;
  specialist_agent: string | null;
  warrant_a_id: string;
  warrant_b_id: string;
}

function severityVariant(severity: string) {
  switch (severity) {
    case "critical":
      return "destructive" as const;
    case "moderate":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

function severityClassName(severity: string) {
  if (severity === "moderate") {
    return "border-yellow-500 text-yellow-700 dark:text-yellow-400";
  }
  return undefined;
}

function statusVariant(status: string) {
  switch (status) {
    case "resolved":
      return "default" as const;
    case "dismissed":
      return "secondary" as const;
    case "annotated":
      return "outline" as const;
    default:
      return "outline" as const;
  }
}

const TOTAL_COLUMNS = 9;

export function ConflictsTable({
  rows,
  total,
  page,
  pageSize,
  sortBy,
  sortDir,
}: ConflictsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedData, setExpandedData] = useState<Record<string, ExpandedData>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  const totalPages = Math.ceil(total / pageSize);

  // ── Sorting ─────────────────────────────────────────────────────────

  function handleSort(column: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (sortBy === column) {
      params.set("sortDir", sortDir === "desc" ? "asc" : "desc");
    } else {
      params.set("sortBy", column);
      params.set("sortDir", "desc");
    }
    params.delete("page");
    router.push(`/conflicts?${params.toString()}`);
  }

  function SortIcon({ column }: { column: string }) {
    if (sortBy !== column) return <ArrowUpDown className="ml-1 inline size-3 opacity-40" />;
    return sortDir === "asc" ? (
      <ChevronUp className="ml-1 inline size-3" />
    ) : (
      <ChevronDown className="ml-1 inline size-3" />
    );
  }

  // ── Pagination ──────────────────────────────────────────────────────

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(p));
    }
    router.push(`/conflicts?${params.toString()}`);
  }

  // ── Row Expand ──────────────────────────────────────────────────────

  async function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) {
      next.delete(id);
      setExpandedIds(next);
      return;
    }

    next.add(id);
    setExpandedIds(next);

    if (!expandedData[id]) {
      setLoadingIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/conflicts/${id}`);
        if (!res.ok) throw new Error("Failed to fetch conflict detail");
        const data = await res.json();
        setExpandedData((prev) => ({
          ...prev,
          [id]: {
            warrants: data.warrants,
            classifier_explanation: data.conflict.classifier_explanation,
            specialist_analysis: data.conflict.specialist_analysis,
            specialist_agent: data.conflict.specialist_agent,
            warrant_a_id: data.conflict.warrant_a_id,
            warrant_b_id: data.conflict.warrant_b_id,
          },
        }));
      } catch {
        toast.error("Failed to load conflict details");
        next.delete(id);
        setExpandedIds(new Set(next));
      } finally {
        setLoadingIds((prev) => {
          const s = new Set(prev);
          s.delete(id);
          return s;
        });
      }
    }
  }

  // ── Checkbox Selection ──────────────────────────────────────────────

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((r) => r.id)));
    }
  }

  // ── Quick Actions ───────────────────────────────────────────────────

  async function quickAction(id: string, status: string) {
    try {
      const res = await fetch(`/api/conflicts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Conflict ${status}`);
      router.refresh();
    } catch {
      toast.error("Failed to update conflict");
    }
  }

  // ── Batch Operations ────────────────────────────────────────────────

  async function batchAction(status: string) {
    if (selectedIds.size === 0) return;
    setBatchLoading(true);
    try {
      const res = await fetch("/api/conflicts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), status }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`${data.updated} conflict(s) ${status}`);
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      toast.error("Batch operation failed");
    } finally {
      setBatchLoading(false);
    }
  }

  // ── No-op handler for WarrantCard in read-only context ──────────────

  const noopStatusChange = useCallback(() => {}, []);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <Table>
            {rows.length === 0 && (
              <TableCaption className="py-8">
                No conflicts found matching the current filters.
              </TableCaption>
            )}
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={rows.length > 0 && selectedIds.size === rows.length}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all conflicts"
                  />
                </TableHead>
                <TableHead>
                  <button onClick={() => handleSort("plant_name")} className="inline-flex items-center hover:text-foreground">
                    Plant <SortIcon column="plant_name" />
                  </button>
                </TableHead>
                <TableHead>
                  <button onClick={() => handleSort("attribute_name")} className="inline-flex items-center hover:text-foreground">
                    Attribute <SortIcon column="attribute_name" />
                  </button>
                </TableHead>
                <TableHead>
                  <button onClick={() => handleSort("conflict_type")} className="inline-flex items-center hover:text-foreground">
                    Type <SortIcon column="conflict_type" />
                  </button>
                </TableHead>
                <TableHead>
                  <button onClick={() => handleSort("severity")} className="inline-flex items-center hover:text-foreground">
                    Severity <SortIcon column="severity" />
                  </button>
                </TableHead>
                <TableHead>Values</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>
                  <button onClick={() => handleSort("status")} className="inline-flex items-center hover:text-foreground">
                    Status <SortIcon column="status" />
                  </button>
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const isExpanded = expandedIds.has(row.id);
                const isLoading = loadingIds.has(row.id);
                const detail = expandedData[row.id];

                return (
                  <ConflictRowGroup
                    key={row.id}
                    row={row}
                    isExpanded={isExpanded}
                    isLoading={isLoading}
                    isSelected={selectedIds.has(row.id)}
                    detail={detail}
                    onToggleExpand={() => toggleExpand(row.id)}
                    onToggleSelect={() => toggleSelect(row.id)}
                    onQuickAction={(status) => quickAction(row.id, status)}
                    onStatusChange={noopStatusChange}
                  />
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} conflicts)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Batch toolbar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background p-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <span className="text-sm font-medium">
              {selectedIds.size} conflict{selectedIds.size > 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                disabled={batchLoading}
              >
                Deselect All
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => batchAction("dismissed")}
                disabled={batchLoading}
              >
                Dismiss Selected
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Specialist routing coming in Phase 4"
              >
                Route to Specialist
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => batchAction("resolved")}
                disabled={batchLoading}
              >
                Resolve Selected
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conflict Row + Expanded Detail ────────────────────────────────────

interface ConflictRowGroupProps {
  row: ConflictListRow;
  isExpanded: boolean;
  isLoading: boolean;
  isSelected: boolean;
  detail: ExpandedData | undefined;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onQuickAction: (status: string) => void;
  onStatusChange: (warrantId: string, newStatus: string) => void;
}

function ConflictRowGroup({
  row,
  isExpanded,
  isLoading,
  isSelected,
  detail,
  onToggleExpand,
  onToggleSelect,
  onQuickAction,
  onStatusChange,
}: ConflictRowGroupProps) {
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50">
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            aria-label={`Select conflict for ${row.plant_name}`}
          />
        </TableCell>
        <TableCell>
          <Link
            href={`/claims/${row.plant_id}/${encodeURIComponent(row.attribute_name)}`}
            className="font-medium italic hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.plant_name}
          </Link>
        </TableCell>
        <TableCell>{row.attribute_name}</TableCell>
        <TableCell>
          <Badge variant="outline">{row.conflict_type.replace(/_/g, " ")}</Badge>
        </TableCell>
        <TableCell>
          <Badge
            variant={severityVariant(row.severity)}
            className={severityClassName(row.severity)}
          >
            {row.severity}
          </Badge>
        </TableCell>
        <TableCell>
          <span className="text-sm">
            {row.source_a}: <span className="font-medium">{row.value_a ?? "—"}</span>
            {" vs "}
            {row.source_b}: <span className="font-medium">{row.value_b ?? "—"}</span>
          </span>
        </TableCell>
        <TableCell>
          {row.specialist_verdict ? (
            <Badge variant="secondary">{row.specialist_verdict}</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">Pending</span>
          )}
        </TableCell>
        <TableCell>
          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
        </TableCell>
        <TableCell>
          <button
            onClick={onToggleExpand}
            className="rounded p-1 hover:bg-muted"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        </TableCell>
      </TableRow>

      {/* Expanded detail row */}
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={TOTAL_COLUMNS} className="bg-muted/30 p-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : detail ? (
              <ExpandedConflict
                row={row}
                detail={detail}
                onQuickAction={onQuickAction}
                onStatusChange={onStatusChange}
              />
            ) : null}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Expanded Conflict Content ─────────────────────────────────────────

interface ExpandedConflictProps {
  row: ConflictListRow;
  detail: ExpandedData;
  onQuickAction: (status: string) => void;
  onStatusChange: (warrantId: string, newStatus: string) => void;
}

function ExpandedConflict({
  row,
  detail,
  onQuickAction,
  onStatusChange,
}: ExpandedConflictProps) {
  const warrantA = detail.warrants.find((w) => w.id === detail.warrant_a_id);
  const warrantB = detail.warrants.find((w) => w.id === detail.warrant_b_id);

  // Build empty conflicts array for WarrantCard (conflicts are shown at this level instead)
  const emptyConflicts: ConflictSummary[] = [];

  return (
    <div className="space-y-4">
      {/* Side-by-side warrant cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {warrantA && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Warrant A — {row.source_a}
            </p>
            <WarrantCard
              warrant={warrantA}
              conflicts={emptyConflicts}
              onStatusChange={onStatusChange}
            />
          </div>
        )}
        {warrantB && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              Warrant B — {row.source_b}
            </p>
            <WarrantCard
              warrant={warrantB}
              conflicts={emptyConflicts}
              onStatusChange={onStatusChange}
            />
          </div>
        )}
      </div>

      {/* Classifier explanation */}
      {detail.classifier_explanation && (
        <div className="rounded-md border bg-background px-4 py-3">
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Classification Reasoning
          </p>
          <p className="text-sm">{detail.classifier_explanation}</p>
        </div>
      )}

      {/* Specialist analysis */}
      {detail.specialist_analysis && (
        <div className="rounded-md border bg-background px-4 py-3">
          <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            Specialist Analysis{detail.specialist_agent ? ` (${detail.specialist_agent})` : ""}
          </p>
          <p className="text-sm">{detail.specialist_analysis}</p>
          {row.specialist_verdict && (
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="secondary">{row.specialist_verdict}</Badge>
              {row.specialist_recommendation && (
                <span className="text-sm text-muted-foreground">
                  {row.specialist_recommendation}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Research panel */}
      <ResearchPanel
        conflictId={row.id}
        sourceA={row.source_a}
        sourceB={row.source_b}
        plantName={row.plant_name}
        attributeName={row.attribute_name}
      />

      {/* Quick actions */}
      {row.status === "pending" && (
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => onQuickAction("resolved")}
          >
            Resolve
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onQuickAction("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
