import Link from "next/link";
import { fetchDashboardData } from "@/lib/queries/dashboard";
import { SummaryCards } from "@/components/summary-cards";
import { BatchesTable } from "@/components/batches-table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await fetchDashboardData();

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <SummaryCards
        warrants={data.warrants}
        conflicts={data.conflicts}
        claims={data.claims}
        datasets={data.datasets}
        mappingStats={data.mappingStats}
        pendingSyncCount={data.pendingSyncCount}
      />
      {data.topConflictingPairs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Top Conflicting Source Pairs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.topConflictingPairs.map((pair) => (
                <Link
                  key={`${pair.source_a}-${pair.source_b}`}
                  href={`/conflicts?sourceA=${encodeURIComponent(pair.source_a)}&sourceB=${encodeURIComponent(pair.source_b)}`}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span>
                    <span className="font-medium">{pair.source_a}</span>
                    {" vs "}
                    <span className="font-medium">{pair.source_b}</span>
                  </span>
                  <Badge variant="secondary">
                    {pair.count.toLocaleString()} pending
                  </Badge>
                </Link>
              ))}
            </div>
            <Link
              href="/matrix"
              className="mt-3 inline-block text-xs text-primary hover:underline"
            >
              View full matrix
            </Link>
          </CardContent>
        </Card>
      )}

      <BatchesTable
        batches={data.batches}
        conflictsBySeverity={data.conflicts.bySeverity}
        criticalPendingCount={data.criticalPendingCount}
        unreviewedLatestBatchCount={data.unreviewedLatestBatchCount}
      />
    </div>
  );
}
