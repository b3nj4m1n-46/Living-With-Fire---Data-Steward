import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function ClaimsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-24" />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-36" />
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="flex gap-6 border-b px-4 py-3">
              {["w-28", "w-32", "w-16", "w-24", "w-16", "w-20"].map(
                (w, i) => (
                  <Skeleton key={i} className={`h-4 ${w}`} />
                )
              )}
            </div>
            {/* Rows */}
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-6 border-b px-4 py-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-8 rounded-full" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-5 w-12 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
