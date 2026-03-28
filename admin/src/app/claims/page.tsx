import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClaimsPage() {
  return (
    <div>
      <h2 className="mb-4 text-2xl font-bold">Claims</h2>
      <Card>
        <CardHeader>
          <CardTitle>Claim Curation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Claim curation list coming in task 012.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
