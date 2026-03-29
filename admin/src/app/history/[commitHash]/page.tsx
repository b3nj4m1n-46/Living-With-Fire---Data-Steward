import Link from "next/link";
import { queryOne } from "@/lib/dolt";
import {
  fetchCommitDiffSummary,
  type DoltLogEntry,
} from "@/lib/queries/history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiffTable } from "./diff-table";

export const dynamic = "force-dynamic";

export default async function CommitDiffPage({
  params,
}: {
  params: Promise<{ commitHash: string }>;
}) {
  const { commitHash } = await params;

  const [logEntry, diffs] = await Promise.all([
    queryOne<DoltLogEntry>(
      "SELECT commit_hash, committer, date, message FROM dolt_log WHERE commit_hash = $1 LIMIT 1",
      [commitHash]
    ),
    fetchCommitDiffSummary(commitHash),
  ]);

  if (!logEntry) {
    return (
      <div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/history" />}>
          Back to History
        </Button>
        <p className="mt-4 text-muted-foreground">Commit not found.</p>
      </div>
    );
  }

  return (
    <div>
      <Button variant="outline" size="sm" className="mb-4" nativeButton={false} render={<Link href="/history" />}>
        Back to History
      </Button>

      <h2 className="mb-4 text-2xl font-bold">Commit Details</h2>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="font-medium">Hash</dt>
            <dd className="font-mono">{logEntry.commit_hash}</dd>
            <dt className="font-medium">Message</dt>
            <dd>{logEntry.message}</dd>
            <dt className="font-medium">Committer</dt>
            <dd>{logEntry.committer}</dd>
            <dt className="font-medium">Date</dt>
            <dd>{new Date(logEntry.date).toLocaleString()}</dd>
          </dl>
        </CardContent>
      </Card>

      {diffs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No table changes detected for this commit (may be the initial commit).
        </p>
      ) : (
        <div className="space-y-4">
          {diffs.map((diff) => (
            <Card key={diff.table_name}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="font-mono text-base">
                    {diff.table_name}
                  </CardTitle>
                  <div className="flex gap-2">
                    {diff.added > 0 && (
                      <Badge variant="outline" className="border-green-500 text-green-700">
                        +{diff.added} added
                      </Badge>
                    )}
                    {diff.modified > 0 && (
                      <Badge variant="outline" className="border-yellow-500 text-yellow-700">
                        ~{diff.modified} modified
                      </Badge>
                    )}
                    {diff.deleted > 0 && (
                      <Badge variant="outline" className="border-red-500 text-red-700">
                        -{diff.deleted} deleted
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <DiffTable rows={diff.rows} tableName={diff.table_name} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
