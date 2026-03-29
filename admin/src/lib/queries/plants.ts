import { queryProd } from "@/lib/production";
import { query } from "@/lib/dolt";
import { KEY_ATTRIBUTE_IDS } from "@/lib/queries/coverage";

// --- Types ---

export interface PlantListRow {
  id: string;
  genus: string;
  species: string;
  common_name: string | null;
  attribute_count: number;
  completeness_pct: number;
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
  completeness: "filled_key_attributes",
};

// --- Query Functions ---

export async function fetchPlantList(
  search?: string,
  page = 1,
  limit = PAGE_SIZE,
  sort = "scientific_name",
  order = "asc"
): Promise<PlantListResult> {
  // KEY_ATTRIBUTE_IDS occupy $1..$6
  const keyParams: unknown[] = [...KEY_ATTRIBUTE_IDS];
  const keyPlaceholders = KEY_ATTRIBUTE_IDS.map((_, i) => `$${i + 1}`).join(", ");

  // Build WHERE for main query (key IDs occupy $1..$6, search starts at $7)
  let mainWhere = "";
  const mainSearchParams: unknown[] = [];
  let mainParamIndex = KEY_ATTRIBUTE_IDS.length + 1; // 7

  // Build WHERE for count query (search starts at $1, no key IDs needed)
  let countWhere = "";
  const countParams: unknown[] = [];

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    mainWhere = `WHERE (LOWER(p.genus || ' ' || p.species) LIKE $${mainParamIndex} OR LOWER(COALESCE(p.common_name, '')) LIKE $${mainParamIndex})`;
    mainSearchParams.push(term);
    mainParamIndex++;

    countWhere = `WHERE (LOWER(p.genus || ' ' || p.species) LIKE $1 OR LOWER(COALESCE(p.common_name, '')) LIKE $1)`;
    countParams.push(term);
  }

  const orderCol = SORTABLE_COLUMNS[sort] ?? SORTABLE_COLUMNS.scientific_name;
  const orderDir = order === "desc" ? "DESC" : "ASC";
  const orderClause = `ORDER BY ${orderCol} ${orderDir}`;

  const offset = (page - 1) * limit;

  const [rows, countResult] = await Promise.all([
    queryProd<PlantListRow & { filled_key_attributes: number }>(
      `SELECT
         p.id,
         p.genus,
         p.species,
         p.common_name,
         (SELECT COUNT(*)::int FROM "values" WHERE plant_id = p.id) AS attribute_count,
         (SELECT COUNT(DISTINCT attribute_id)::int
          FROM "values"
          WHERE plant_id = p.id AND attribute_id IN (${keyPlaceholders})
         ) AS filled_key_attributes,
         p.last_updated
       FROM plants p
       ${mainWhere}
       ${orderClause}
       LIMIT $${mainParamIndex} OFFSET $${mainParamIndex + 1}`,
      [...keyParams, ...mainSearchParams, limit, offset]
    ),
    queryProd<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM plants p ${countWhere}`,
      countParams
    ),
  ]);

  const totalKey = KEY_ATTRIBUTE_IDS.length;
  const plants: PlantListRow[] = rows.map((r) => ({
    id: r.id,
    genus: r.genus,
    species: r.species,
    common_name: r.common_name,
    attribute_count: r.attribute_count,
    completeness_pct: Math.round((r.filled_key_attributes / totalKey) * 1000) / 10,
    last_updated: r.last_updated,
  }));

  return {
    plants,
    total: countResult[0]?.count ?? 0,
    page,
    limit,
  };
}

// --- Plant Detail Types ---

export interface PlantDetailIdentity {
  id: string;
  genus: string;
  species: string;
  common_name: string | null;
  last_updated: string | null;
}

export interface AttributeValueRow {
  attribute_id: string;
  attribute_name: string;
  attribute_notes: string | null;
  category: string | null;
  value: string;
  source_value: string | null;
  value_notes: string | null;
  values_allowed: string | null;
  source_name: string | null;
  source_id: string | null;
}

export interface CurationOverlay {
  warrantCounts: Record<string, number>;
  conflictCounts: Record<string, number>;
  pendingClaims: Record<string, { id: string; status: string }>;
}

export interface PlantDetail {
  plant: PlantDetailIdentity;
  attributes: AttributeValueRow[];
  categories: string[];
  overlay: CurationOverlay;
  pendingSync: boolean;
  pendingClaimCount: number;
}

// --- Plant Detail Query ---

export async function fetchPlantDetail(
  plantId: string
): Promise<PlantDetail | null> {
  const [plant, attributes, warrantRows, conflictRows, claimRows] =
    await Promise.all([
      // 1. Plant identity (Neon)
      queryProd<PlantDetailIdentity>(
        `SELECT id, genus, species, common_name, last_updated
         FROM plants WHERE id = $1`,
        [plantId]
      ).then((rows) => rows[0] ?? null),

      // 2. All attribute values with category, source, and allowed values (Neon)
      // Uses recursive CTE to walk up the attribute hierarchy to find the root category
      queryProd<AttributeValueRow>(
        `WITH RECURSIVE ancestors AS (
           SELECT id, name, parent_attribute_id, name AS root_name
           FROM attributes
           WHERE parent_attribute_id IS NULL
           UNION ALL
           SELECT a.id, a.name, a.parent_attribute_id, anc.root_name
           FROM attributes a
           JOIN ancestors anc ON anc.id = a.parent_attribute_id
         )
         SELECT
           v.attribute_id,
           a.name AS attribute_name,
           a.notes AS attribute_notes,
           anc.root_name AS category,
           v."value",
           v.source_value,
           v.notes AS value_notes,
           a.values_allowed::text AS values_allowed,
           s.name AS source_name,
           v.source_id
         FROM "values" v
         JOIN attributes a ON a.id = v.attribute_id
         JOIN ancestors anc ON anc.id = a.id
         LEFT JOIN sources s ON s.id = v.source_id
         WHERE v.plant_id = $1
           AND NOT (COALESCE(v."value", '') = '' AND (v.source_value IS NULL OR v.source_value = '' OR v.source_value = 'x'))
         ORDER BY anc.root_name, a.name`,
        [plantId]
      ),

      // 3. Warrant counts per attribute (Dolt)
      query<{ attribute_id: string; count: number }>(
        `SELECT attribute_id, COUNT(*)::int AS count
         FROM warrants
         WHERE plant_id = $1 AND status != 'excluded'
         GROUP BY attribute_id`,
        [plantId]
      ),

      // 4. Unresolved conflict counts per attribute (Dolt)
      query<{ attribute_name: string; count: number }>(
        `SELECT attribute_name, COUNT(*)::int AS count
         FROM conflicts
         WHERE plant_id = $1 AND status IN ('pending', 'annotated')
         GROUP BY attribute_name`,
        [plantId]
      ),

      // 5. Pending claims per attribute (Dolt)
      query<{ attribute_id: string; id: string; status: string }>(
        `SELECT attribute_id, id, status
         FROM claims
         WHERE plant_id = $1 AND status IN ('draft', 'approved')`,
        [plantId]
      ),
    ]);

  if (!plant) return null;

  // Build overlay records
  const warrantCounts: Record<string, number> = {};
  for (const r of warrantRows) {
    warrantCounts[r.attribute_id] = Number(r.count);
  }

  const conflictCounts: Record<string, number> = {};
  for (const r of conflictRows) {
    conflictCounts[r.attribute_name] = Number(r.count);
  }

  const pendingClaims: Record<string, { id: string; status: string }> = {};
  for (const r of claimRows) {
    pendingClaims[r.attribute_id] = { id: r.id, status: r.status };
  }

  const pendingClaimCount = claimRows.filter(
    (r) => r.status === "approved"
  ).length;

  // Extract distinct categories in query order
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const a of attributes) {
    const cat = a.category ?? "Uncategorized";
    if (!seen.has(cat)) {
      seen.add(cat);
      categories.push(cat);
    }
  }

  return {
    plant,
    attributes,
    categories,
    overlay: { warrantCounts, conflictCounts, pendingClaims },
    pendingSync: pendingClaimCount > 0,
    pendingClaimCount,
  };
}
