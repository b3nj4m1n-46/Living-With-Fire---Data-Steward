"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PlantQueueRow } from "@/lib/queries/conflicts";

interface PlantQueueTableProps {
  rows: PlantQueueRow[];
  total: number;
  page: number;
  pageSize: number;
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

function queueStatusVariant(status: string) {
  switch (status) {
    case "complete":
      return "default" as const;
    case "in_progress":
      return "outline" as const;
    default:
      return "secondary" as const;
  }
}

function queueStatusLabel(status: string) {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "complete":
      return "Complete";
    default:
      return "Pending";
  }
}

export function PlantQueueTable({
  rows,
  total,
  page,
  pageSize,
}: PlantQueueTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const totalPages = Math.ceil(total / pageSize);

  function goToPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p <= 1) {
      params.delete("page");
    } else {
      params.set("page", String(p));
    }
    router.push(`/conflicts?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <Table>
            {rows.length === 0 && (
              <TableCaption className="py-8">
                No plants with conflicts match the current filters.
              </TableCaption>
            )}
            <TableHeader>
              <TableRow>
                <TableHead>Plant</TableHead>
                <TableHead className="text-right">Conflicts</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead className="text-right">Attributes</TableHead>
                <TableHead className="text-right">Unresolved</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.plant_id}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell>
                    <Link
                      href={`/conflicts/${row.plant_id}`}
                      className="font-medium italic hover:underline"
                    >
                      {row.plant_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">{row.total_conflicts}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={severityVariant(row.max_severity)}
                      className={severityClassName(row.max_severity)}
                    >
                      {row.max_severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {row.attributes_affected}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.unresolved_count > 0 ? (
                      <Badge variant="destructive">
                        {row.unresolved_count}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={queueStatusVariant(row.queue_status)}>
                      {queueStatusLabel(row.queue_status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} plants)
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
    </div>
  );
}
