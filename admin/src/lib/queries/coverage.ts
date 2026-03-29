import { queryProd } from "@/lib/production";
import { CALCULATED_ATTRIBUTE_IDS } from "@/lib/attribute-map";

// --- Types ---

export interface AttributeCoverage {
  attributeId: string;
  attributeName: string;
  category: string;
  plantsWithValue: number;
  totalPlants: number;
  coveragePct: number;
  gapCount: number;
}

export interface PlantGapRow {
  plantId: string;
  genus: string;
  species: string;
  commonName: string | null;
}

export interface PlantCompleteness {
  plantId: string;
  genus: string;
  species: string;
  commonName: string | null;
  filledAttributes: number;
  totalKeyAttributes: number;
  completenessPct: number;
}

// The 6 key attributes that drive the Relative Value Matrix
export const KEY_ATTRIBUTE_IDS = [
  "d996587c-383b-4dc6-a23c-239b7de7e47b", // Flammability List Choice
  "d9174148-6563-4f92-9673-01feb6a529ce", // Water Amount
  "af3e70d2-dc9c-4027-a09f-15d7d8b0dd10", // Drought Tolerant
  "ff4c4d0e-35d5-4804-aea3-2a6334ef8cb5", // Deer Resistance
  "716f3d8f-195f-4d16-824b-6dd1e88767a6", // Native Status
  "ff75e529-5b5c-4461-8191-0382e33a4bd5", // Wildlife Benefits
];

// --- Attribute Coverage ---

export async function getAttributeCoverage(
  sort?: string,
  category?: string
): Promise<AttributeCoverage[]> {
  const calculatedIds = [...CALCULATED_ATTRIBUTE_IDS];
  const params: unknown[] = [...calculatedIds];
  let paramIndex = calculatedIds.length + 1;

  const excludePlaceholders = calculatedIds
    .map((_, i) => `$${i + 1}`)
    .join(", ");

  let categoryClause = "";
  if (category) {
    categoryClause = `AND LOWER(COALESCE(pa.name, '')) = LOWER($${paramIndex})`;
    params.push(category);
    paramIndex++;
  }

  const sql = `
    SELECT
      a.id AS attribute_id,
      a.name AS attribute_name,
      COALESCE(pa.name, 'Uncategorized') AS category,
      COUNT(DISTINCT v.plant_id)::int AS plants_with_value,
      (SELECT COUNT(*)::int FROM plants) AS total_plants
    FROM attributes a
    LEFT JOIN attributes pa ON pa.id = a.parent_attribute_id
    LEFT JOIN "values" v ON v.attribute_id = a.id
    WHERE a.parent_attribute_id IS NOT NULL
      AND a.id NOT LIKE 'b1000001-%'
      AND a.id NOT IN (${excludePlaceholders})
      ${categoryClause}
    GROUP BY a.id, a.name, pa.name
  `;

  const rows = await queryProd<{
    attribute_id: string;
    attribute_name: string;
    category: string;
    plants_with_value: number;
    total_plants: number;
  }>(sql, params);

  const results: AttributeCoverage[] = rows.map((r) => ({
    attributeId: r.attribute_id,
    attributeName: r.attribute_name,
    category: r.category,
    plantsWithValue: r.plants_with_value,
    totalPlants: r.total_plants,
    coveragePct:
      r.total_plants > 0
        ? Math.round((r.plants_with_value / r.total_plants) * 1000) / 10
        : 0,
    gapCount: r.total_plants - r.plants_with_value,
  }));

  // Sort
  switch (sort) {
    case "coverage_desc":
      results.sort((a, b) => b.coveragePct - a.coveragePct);
      break;
    case "name":
      results.sort((a, b) => a.attributeName.localeCompare(b.attributeName));
      break;
    case "coverage_asc":
    default:
      results.sort((a, b) => a.coveragePct - b.coveragePct);
      break;
  }

  return results;
}

// --- Plants Missing a Specific Attribute ---

export async function getPlantsGap(
  attributeId: string,
  limit?: number,
  offset?: number
): Promise<{ plants: PlantGapRow[]; total: number }> {
  const countSql = `
    SELECT COUNT(*)::int AS count
    FROM plants p
    WHERE NOT EXISTS (
      SELECT 1 FROM "values" v WHERE v.plant_id = p.id AND v.attribute_id = $1
    )
  `;
  const countResult = await queryProd<{ count: number }>(countSql, [
    attributeId,
  ]);
  const total = countResult[0]?.count ?? 0;

  const params: unknown[] = [attributeId];
  let paramIndex = 2;
  let limitClause = "";

  if (limit != null) {
    limitClause += ` LIMIT $${paramIndex}`;
    params.push(limit);
    paramIndex++;
  }
  if (offset != null) {
    limitClause += ` OFFSET $${paramIndex}`;
    params.push(offset);
    paramIndex++;
  }

  const sql = `
    SELECT p.id AS plant_id, p.genus, p.species, p.common_name
    FROM plants p
    WHERE NOT EXISTS (
      SELECT 1 FROM "values" v WHERE v.plant_id = p.id AND v.attribute_id = $1
    )
    ORDER BY p.genus, p.species
    ${limitClause}
  `;

  const rows = await queryProd<{
    plant_id: string;
    genus: string;
    species: string;
    common_name: string | null;
  }>(sql, params);

  return {
    plants: rows.map((r) => ({
      plantId: r.plant_id,
      genus: r.genus,
      species: r.species,
      commonName: r.common_name,
    })),
    total,
  };
}

// --- Per-Plant Completeness ---

export async function getPlantCompleteness(
  sort?: string,
  limit = 50,
  offset = 0
): Promise<{ plants: PlantCompleteness[]; total: number }> {
  const keyIds = KEY_ATTRIBUTE_IDS;
  const placeholders = keyIds.map((_, i) => `$${i + 1}`).join(", ");

  const orderClause =
    sort === "completeness_desc"
      ? "filled_attributes DESC"
      : sort === "name"
        ? "p.genus ASC, p.species ASC"
        : "filled_attributes ASC";

  const limitIdx = keyIds.length + 1;
  const offsetIdx = keyIds.length + 2;

  const sql = `
    SELECT
      p.id,
      p.genus,
      p.species,
      p.common_name,
      COUNT(DISTINCT v.attribute_id)::int AS filled_attributes
    FROM plants p
    LEFT JOIN "values" v ON v.plant_id = p.id
      AND v.attribute_id IN (${placeholders})
    GROUP BY p.id, p.genus, p.species, p.common_name
    ORDER BY ${orderClause}, p.genus, p.species
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countSql = `SELECT COUNT(*)::int AS count FROM plants`;

  const [rows, countResult] = await Promise.all([
    queryProd<{
      id: string;
      genus: string;
      species: string;
      common_name: string | null;
      filled_attributes: number;
    }>(sql, [...keyIds, limit, offset]),
    queryProd<{ count: number }>(countSql),
  ]);

  const total = countResult[0]?.count ?? 0;
  const totalKey = keyIds.length;

  return {
    plants: rows.map((r) => ({
      plantId: r.id,
      genus: r.genus,
      species: r.species,
      commonName: r.common_name,
      filledAttributes: r.filled_attributes,
      totalKeyAttributes: totalKey,
      completenessPct:
        Math.round((r.filled_attributes / totalKey) * 1000) / 10,
    })),
    total,
  };
}
