import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConflictsPage() {
  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">Conflicts</h2>
      <Card>
        <CardHeader>
          <CardTitle>Conflict Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Filterable conflict table coming in task 013.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
