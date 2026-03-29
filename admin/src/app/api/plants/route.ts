import { fetchPlantList } from "@/lib/queries/plants";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10))
    );
    const sort = url.searchParams.get("sort") ?? "scientific_name";
    const order = url.searchParams.get("order") ?? "asc";

    const result = await fetchPlantList(search, page, limit, sort, order);
    return Response.json(result);
  } catch (error) {
    console.error("GET /api/plants error:", error);
    return Response.json(
      { error: "Failed to fetch plants" },
      { status: 500 }
    );
  }
}
