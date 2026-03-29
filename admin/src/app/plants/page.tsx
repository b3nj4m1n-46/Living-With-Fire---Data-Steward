import Link from "next/link";
import { fetchPlantList } from "@/lib/queries/plants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    search?: string;
    page?: string;
    sort?: string;
    order?: string;
  }>;
}

export default async function PlantsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = params.search ?? "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10));
  const sort = params.sort ?? "scientific_name";
  const order = params.order ?? "asc";

  let result = { plants: [] as Awaited<ReturnType<typeof fetchPlantList>>["plants"], total: 0, page, limit: 50 };
  try {
    result = await fetchPlantList(search || undefined, page, 50, sort, order);
  } catch {
    // Render empty — DB may not be available
  }

  const totalPages = Math.ceil(result.total / result.limit);

  function sortUrl(column: string) {
    const newOrder = sort === column && order === "asc" ? "desc" : "asc";
    const sp = new URLSearchParams();
    if (search) sp.set("search", search);
    sp.set("sort", column);
    sp.set("order", newOrder);
    return `/plants?${sp.toString()}`;
  }

  function pageUrl(p: number) {
    const sp = new URLSearchParams();
    if (search) sp.set("search", search);
    if (sort !== "scientific_name") sp.set("sort", sort);
    if (order !== "asc") sp.set("order", order);
    sp.set("page", String(p));
    return `/plants?${sp.toString()}`;
  }

  function sortIndicator(column: string) {
    if (sort !== column) return "";
    return order === "asc" ? " \u25B2" : " \u25BC";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Plants</h2>
        <Link href="/plants/add">
          <Button>Add New Plant</Button>
        </Link>
      </div>

      <form method="get" action="/plants" className="flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by scientific or common name…"
          className="flex h-9 w-full max-w-sm rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
        {search && (
          <Link href="/plants">
            <Button variant="ghost" type="button">
              Clear
            </Button>
          </Link>
        )}
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Link href={sortUrl("scientific_name")} className="hover:underline">
                    Scientific Name{sortIndicator("scientific_name")}
                  </Link>
                </TableHead>
                <TableHead>
                  <Link href={sortUrl("common_name")} className="hover:underline">
                    Common Name{sortIndicator("common_name")}
                  </Link>
                </TableHead>
                <TableHead className="text-right">
                  <Link href={sortUrl("attribute_count")} className="hover:underline">
                    Attributes{sortIndicator("attribute_count")}
                  </Link>
                </TableHead>
                <TableHead>
                  <Link href={sortUrl("last_updated")} className="hover:underline">
                    Last Updated{sortIndicator("last_updated")}
                  </Link>
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.plants.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    {search
                      ? `No plants matching "${search}".`
                      : "No plants found."}
                  </TableCell>
                </TableRow>
              ) : (
                result.plants.map((plant) => (
                  <TableRow key={plant.id}>
                    <TableCell className="font-medium">
                      <span className="italic">
                        {plant.genus} {plant.species}
                      </span>
                    </TableCell>
                    <TableCell>
                      {plant.common_name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {plant.attribute_count.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {plant.last_updated
                        ? new Date(plant.last_updated).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/plants/${plant.id}`}
                        className="text-primary underline-offset-4 hover:underline text-sm"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {result.total.toLocaleString()} plants &middot; page {page} of{" "}
            {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageUrl(page - 1)}>
                <Button variant="outline" size="sm">
                  Previous
                </Button>
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageUrl(page + 1)}>
                <Button variant="outline" size="sm">
                  Next
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
