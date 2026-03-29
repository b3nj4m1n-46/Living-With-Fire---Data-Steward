import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function HistoryLoading() {
  return (
    <div>
      <Skeleton className="mb-4 h-8 w-28" />
      <Skeleton className="mb-6 h-4 w-80" />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="flex gap-6 border-b px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
            {/* Rows */}
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-6 border-b px-4 py-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
