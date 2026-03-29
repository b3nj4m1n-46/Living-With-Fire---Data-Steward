import { queryProd } from "@/lib/production";

// --- Types ---

export interface PlantListRow {
  id: string;
  genus: string;
  species: string;
  common_name: string | null;
  attribute_count: number;
  last_updated: string | null;
}

export interface PlantListResult {
  plants: PlantListRow[];
  total: number;
  page: number;
  limit: number;
}

// --- Constants ---

const PAGE_SIZE = 50;

const SORTABLE_COLUMNS: Record<string, string> = {
  scientific_name: "p.genus, p.species",
  common_name: "p.common_name",
  last_updated: "p.last_updated",
  attribute_count: "attribute_count",
};

// --- Query Functions ---

export async function fetchPlantList(
  search?: string,
  page = 1,
  limit = PAGE_SIZE,
  sort = "scientific_name",
  order = "asc"
): Promise<PlantListResult> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    conditions.push(
      `(LOWER(p.genus || ' ' || p.species) LIKE $${paramIndex} OR LOWER(COALESCE(p.common_name, '')) LIKE $${paramIndex})`
    );
    params.push(term);
    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const orderCol = SORTABLE_COLUMNS[sort] ?? SORTABLE_COLUMNS.scientific_name;
  const orderDir = order === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${orderCol} ${orderDir}`;

  const offset = (page - 1) * limit;

  const [plants, countResult] = await Promise.all([
    queryProd<PlantListRow>(
      `SELECT
         p.id,
         p.genus,
         p.species,
         p.common_name,
         (SELECT COUNT(*)::int FROM "values" WHERE plant_id = p.id) AS attribute_count,
         p.last_updated
       FROM plants p
       ${whereClause}
       ${orderClause}
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    ),
    queryProd<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM plants p ${whereClause}`,
      params
    ),
  ]);

  return {
    plants,
    total: countResult[0]?.count ?? 0,
    page,
    limit,
  };
}
