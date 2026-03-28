import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  fetchClaimsList,
  fetchFilterOptions,
  type ClaimsListFilters,
} from "@/lib/queries/claims";
import { ClaimsFilters } from "./claims-filters";

export const dynamic = "force-dynamic";

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
  const params = await searchParams;

  const filters: ClaimsListFilters = {
    hasConflicts: params.hasConflicts,
    claimStatus: params.claimStatus,
    sourceDataset: params.sourceDataset,
  };

  const [rows, filterOptions] = await Promise.all([
    fetchClaimsList(filters),
    fetchFilterOptions(),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Claims</h2>

      <ClaimsFilters
        options={filterOptions}
        currentFilters={filters}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            {rows.length === 0 && (
              <TableCaption className="py-8">
                No claims found matching the current filters.
              </TableCaption>
            )}
            <TableHeader>
              <TableRow>
                <TableHead>Plant</TableHead>
                <TableHead>Attribute</TableHead>
                <TableHead className="text-right">Warrants</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Conflicts</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.plant_id}-${row.attribute_id}`}>
                  <TableCell>
                    <Link
                      href={`/claims/${row.plant_id}/${row.attribute_id}`}
                      className="font-medium italic hover:underline"
                    >
                      {row.plant_name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/claims/${row.plant_id}/${row.attribute_id}`}
                      className="hover:underline"
                    >
                      {row.attribute_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary">
                      {row.warrant_count}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-muted-foreground">
                      {row.source_datasets || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.has_conflicts ? (
                      <Badge variant="destructive">Yes</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ClaimStatusBadge status={row.claim_status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ClaimStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        No claim
      </Badge>
    );
  }
  switch (status) {
    case "approved":
      return <Badge variant="default">Approved</Badge>;
    case "pushed":
      return <Badge variant="secondary">Pushed</Badge>;
    case "draft":
      return <Badge variant="outline">Draft</Badge>;
    case "reverted":
      return <Badge variant="destructive">Reverted</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
