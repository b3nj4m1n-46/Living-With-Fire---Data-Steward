import { CoverageClient } from "./coverage-client";

export const dynamic = "force-dynamic";

export default function CoveragePage() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Coverage Dashboard</h2>
      <CoverageClient />
    </div>
  );
}
