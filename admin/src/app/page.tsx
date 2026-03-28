import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { query } from "@/lib/dolt";

export const dynamic = "force-dynamic";

async function getStats() {
  const [warrants, conflicts, claims, plants] = await Promise.all([
    query<{ count: string }>("SELECT COUNT(*) as count FROM warrants"),
    query<{ count: string }>("SELECT COUNT(*) as count FROM conflicts"),
    query<{ count: string }>("SELECT COUNT(*) as count FROM claims"),
    query<{ count: string }>("SELECT COUNT(*) as count FROM plants"),
  ]);
  return {
    warrants: Number(warrants[0].count),
    conflicts: Number(conflicts[0].count),
    claims: Number(claims[0].count),
    plants: Number(plants[0].count),
  };
}

export default async function DashboardPage() {
  const stats = await getStats();

  const cards = [
    { title: "Plants", value: stats.plants },
    { title: "Warrants", value: stats.warrants },
    { title: "Conflicts", value: stats.conflicts },
    { title: "Claims", value: stats.claims },
  ];

  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">Dashboard</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ title, value }) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
