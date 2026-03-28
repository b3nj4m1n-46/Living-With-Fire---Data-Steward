import { fetchDashboardData } from "@/lib/queries/dashboard";
import { SummaryCards } from "@/components/summary-cards";
import { BatchesTable } from "@/components/batches-table";

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
      />
      <BatchesTable
        batches={data.batches}
        conflictsBySeverity={data.conflicts.bySeverity}
        criticalPendingCount={data.criticalPendingCount}
        unreviewedLatestBatchCount={data.unreviewedLatestBatchCount}
      />
    </div>
  );
}
