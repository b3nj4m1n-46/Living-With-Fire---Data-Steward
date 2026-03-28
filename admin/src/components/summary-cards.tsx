import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  WarrantStats,
  ConflictStats,
  ClaimStats,
  DatasetStats,
} from "@/lib/queries/dashboard";

interface SummaryCardsProps {
  warrants: WarrantStats;
  conflicts: ConflictStats;
  claims: ClaimStats;
  datasets: DatasetStats;
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

export function SummaryCards({
  warrants,
  conflicts,
  claims,
  datasets,
}: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* Total Warrants */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Total Warrants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {warrants.total.toLocaleString()}
          </p>
          {warrants.byType.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {warrants.byType.map((t) => (
                <Badge key={t.warrant_type} variant="secondary">
                  {t.count.toLocaleString()} {t.warrant_type}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Conflicts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Pending Conflicts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {conflicts.pending.toLocaleString()}
          </p>
          {conflicts.bySeverity.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {conflicts.bySeverity.map((s) => (
                <Badge
                  key={s.severity}
                  variant={severityVariant(s.severity)}
                  className={severityClassName(s.severity)}
                >
                  {s.count.toLocaleString()} {s.severity}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Claims Generated */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Claims Generated
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {claims.total.toLocaleString()}
          </p>
          {claims.byStatus.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {claims.byStatus.map((s) => (
                <Badge key={s.status} variant="secondary">
                  {s.count.toLocaleString()} {s.status}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Datasets Processed */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Datasets Processed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{datasets.completed}</p>
          {datasets.sources.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {datasets.sources.length <= 6
                ? datasets.sources.join(", ")
                : `${datasets.sources.slice(0, 5).join(", ")} +${datasets.sources.length - 5} more`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
