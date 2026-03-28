import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function WarrantsPage() {
  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">Warrants</h2>
      <Card>
        <CardHeader>
          <CardTitle>Warrant Browser</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Warrant browser coming in a future task.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
