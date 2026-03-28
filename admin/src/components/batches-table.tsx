import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AnalysisBatch } from "@/lib/queries/dashboard";

interface BatchesTableProps {
  batches: AnalysisBatch[];
  conflictsBySeverity: { severity: string; count: number }[];
  criticalPendingCount: number;
  unreviewedLatestBatchCount: number;
}

function timeAgo(date: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(date).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusVariant(status: string) {
  switch (status) {
    case "completed":
      return "secondary" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "default" as const;
  }
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

export function BatchesTable({
  batches,
  conflictsBySeverity,
  criticalPendingCount,
  unreviewedLatestBatchCount,
}: BatchesTableProps) {
  return (
    <div className="space-y-4">
      {/* Analysis Batches Table */}
      <Card>
        <CardHeader>
          <CardTitle>Analysis Batches</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            {batches.length === 0 && (
              <TableCaption>No analysis batches found.</TableCaption>
            )}
            <TableHeader>
              <TableRow>
                <TableHead>Source Dataset</TableHead>
                <TableHead>Source ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Plants Matched</TableHead>
                <TableHead className="text-right">Warrants Created</TableHead>
                <TableHead className="text-right">Conflicts Found</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell className="font-medium">
                    {batch.source_dataset}
                  </TableCell>
                  <TableCell>{batch.source_id_code}</TableCell>
                  <TableCell>{batch.batch_type}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(batch.status)}>
                      {batch.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {batch.plants_matched?.toLocaleString() ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {batch.warrants_created?.toLocaleString() ?? "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {batch.conflicts_detected?.toLocaleString() ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {batch.started_at ? timeAgo(batch.started_at) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Severity Breakdown + Quick Links */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Conflict Severity */}
        <Card>
          <CardHeader>
            <CardTitle>Conflict Severity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {conflictsBySeverity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No conflicts detected.
              </p>
            ) : (
              conflictsBySeverity.map((s) => (
                <Link
                  key={s.severity}
                  href={`/conflicts?severity=${s.severity}`}
                  className="flex items-center justify-between rounded-md px-3 py-2 transition-colors hover:bg-muted"
                >
                  <Badge
                    variant={severityVariant(s.severity)}
                    className={severityClassName(s.severity)}
                  >
                    {s.severity}
                  </Badge>
                  <span className="text-sm font-medium">
                    {s.count.toLocaleString()}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>Attention Needed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {criticalPendingCount === 0 &&
            unreviewedLatestBatchCount === 0 ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                All clear — no urgent items.
              </p>
            ) : (
              <>
                {criticalPendingCount > 0 && (
                  <Link
                    href="/conflicts?severity=critical&status=pending"
                    className="block rounded-md border px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <span className="font-medium text-destructive">
                      {criticalPendingCount.toLocaleString()} critical conflicts
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">
                      need review
                    </span>
                  </Link>
                )}
                {unreviewedLatestBatchCount > 0 && (
                  <Link
                    href="/warrants?status=unreviewed"
                    className="block rounded-md border px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <span className="font-medium">
                      {unreviewedLatestBatchCount.toLocaleString()} unreviewed
                      warrants
                    </span>{" "}
                    <span className="text-sm text-muted-foreground">
                      from latest batch
                    </span>
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
