import { CoverageDetailTabs } from "@/app/plants/coverage-tabs";

export const dynamic = "force-dynamic";

export default function CoveragePage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Coverage</h2>
      <CoverageDetailTabs />
    </div>
  );
}
