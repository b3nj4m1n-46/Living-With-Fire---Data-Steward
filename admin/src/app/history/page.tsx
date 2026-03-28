import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HistoryPage() {
  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">History</h2>
      <Card>
        <CardHeader>
          <CardTitle>Dolt Commit Log</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Dolt version history browser coming in a future task.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
