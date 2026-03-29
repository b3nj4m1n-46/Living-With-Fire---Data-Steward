import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { queryProd } from "@/lib/production";
import {
  DATABASE_SOURCES_ROOT,
  TAXONOMY_BACKBONES,
  SOURCE_DATABASES,
  type SourceEntry,
} from "@/lib/source-registry";
import { resolveAttribute } from "@/lib/attribute-map";

// --- Types ---

type SqliteRow = Record<string, unknown>;

export interface SynonymResolution {
  searchedName: string;
  acceptedName: string;
  acceptedCommonName: string | null;
}

export interface TaxonomyResult {
  family: string | null;
  lifeform: string | null;
  climate: string | null;
  nativeRange: string | null;
  commonName: string | null;
  sources: string[];
  synonym: SynonymResolution | null;
}

export interface ProductionMatch {
  exists: boolean;
  plantId?: string;
  genus?: string;
  species?: string;
  commonName?: string;
  attributeCount?: number;
}

export interface MappedField {
  sourceColumn: string;
  value: string;
  attributeId: string | null;
  attributeName: string | null;
  attributeCategory: string | null;
}

export interface SourceHit {
  sourceId: string;
  displayName: string;
  category: string;
  matchedName: string;
  matchConfidence: number;
  fields: MappedField[];
}

export interface LookupResult {
  taxonomy: TaxonomyResult;
  productionMatch: ProductionMatch;
  sourceHits: SourceHit[];
}

export interface PlantSuggestion {
  scientificName: string;
  commonName: string | null;
  family: string | null;
}

// --- SQLite Helpers ---

function getDbPath(entry: SourceEntry): string {
  return path.join(DATABASE_SOURCES_ROOT, entry.folder, entry.dbFile || "plants.db");
}

function querySqlite(dbPath: string, sql: string, params: unknown[]): SqliteRow[] {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(sql).all(...params) as SqliteRow[];
  } finally {
    db.close();
  }
}

function querySqliteOne(dbPath: string, sql: string, params: unknown[]): SqliteRow | null {
  const rows = querySqlite(dbPath, sql, params);
  return rows[0] ?? null;
}

function str(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  return String(val);
}

// --- Taxonomy Search ---

export function searchTaxonomyBackbones(scientificName: string): TaxonomyResult {
  let target = scientificName.trim();

  const result: TaxonomyResult = {
    family: null,
    lifeform: null,
    climate: null,
    nativeRange: null,
    commonName: null,
    sources: [],
    synonym: null,
  };

  // USDA PLANTS — common_name, family; also handles synonym resolution
  const usda = TAXONOMY_BACKBONES.find((b) => b.sourceId === "TAXON-03")!;
  const usdaDbPath = getDbPath(usda);

  // First try as accepted name
  let usdaRow = querySqliteOne(
    usdaDbPath,
    `SELECT * FROM ${usda.tableName}
     WHERE ${usda.nameColumn} LIKE ? AND (is_synonym = 0 OR is_synonym = 'False')
     LIMIT 1`,
    [`${target}%`]
  );

  // If not found as accepted, check if it's a synonym
  if (!usdaRow) {
    const synonymRow = querySqliteOne(
      usdaDbPath,
      `SELECT * FROM ${usda.tableName}
       WHERE ${usda.nameColumn} LIKE ? AND (is_synonym = 1 OR is_synonym = 'True')
       LIMIT 1`,
      [`${target}%`]
    );

    if (synonymRow && str(synonymRow.symbol)) {
      // Find the accepted name via the shared symbol
      const acceptedRow = querySqliteOne(
        usdaDbPath,
        `SELECT * FROM ${usda.tableName}
         WHERE symbol = ? AND (is_synonym = 0 OR is_synonym = 'False')
         LIMIT 1`,
        [synonymRow.symbol]
      );

      if (acceptedRow) {
        const acceptedFullName = str(acceptedRow.scientific_name_full) || "";
        const acceptedName = acceptedFullName.replace(/\s+[A-Z][a-z]*\.?.*$/, "").trim();

        result.synonym = {
          searchedName: target,
          acceptedName,
          acceptedCommonName: str(acceptedRow.common_name),
        };

        // Use the accepted name for all subsequent searches
        target = acceptedName;
        usdaRow = acceptedRow;
      }
    }
  }

  if (usdaRow) {
    result.commonName = str(usdaRow.common_name);
    result.family = str(usdaRow.family);
    result.sources.push("USDA_PLANTS");
  }

  // POWO — lifeform, climate, native_to
  const powo = TAXONOMY_BACKBONES.find((b) => b.sourceId === "TAXON-01")!;
  const powoRow = querySqliteOne(
    getDbPath(powo),
    `SELECT * FROM ${powo.tableName} WHERE ${powo.nameColumn} = ? COLLATE NOCASE LIMIT 1`,
    [target]
  );
  if (powoRow) {
    result.family = result.family || str(powoRow.family);
    result.lifeform = str(powoRow.lifeform);
    result.climate = str(powoRow.climate);
    result.nativeRange = str(powoRow.native_to);
    result.sources.push("POWO_WCVP");
  }

  // WFO — independent family validation
  const wfo = TAXONOMY_BACKBONES.find((b) => b.sourceId === "TAXON-02")!;
  const wfoRow = querySqliteOne(
    getDbPath(wfo),
    `SELECT * FROM ${wfo.tableName} WHERE ${wfo.nameColumn} = ? COLLATE NOCASE LIMIT 1`,
    [target]
  );
  if (wfoRow) {
    result.family = result.family || str(wfoRow.family);
    result.sources.push("WorldFloraOnline");
  }

  return result;
}

// --- Source Database Search ---

export function searchSourceDatabases(scientificName: string): SourceHit[] {
  const target = scientificName.trim();
  const genus = target.split(/\s+/)[0];
  const hits: SourceHit[] = [];

  for (const entry of SOURCE_DATABASES) {
    const dbPath = getDbPath(entry);
    if (!fs.existsSync(dbPath)) continue;

    let row: SqliteRow | null = null;
    let confidence = 1.0;
    let matchedName = target;

    if (entry.sourceId === "BIRD-01") {
      // Genus-level match for Tallamy
      row = querySqliteOne(
        dbPath,
        `SELECT * FROM "${entry.tableName}" WHERE "${entry.nameColumn}" = ? COLLATE NOCASE LIMIT 1`,
        [genus]
      );
      confidence = 0.8;
      matchedName = genus;
    } else if (entry.nameColumn === "scientific_name_full") {
      // USDA-style: includes author string, use prefix match
      row = querySqliteOne(
        dbPath,
        `SELECT * FROM "${entry.tableName}" WHERE "${entry.nameColumn}" LIKE ? LIMIT 1`,
        [`${target}%`]
      );
    } else {
      // Standard exact match (case-insensitive)
      row = querySqliteOne(
        dbPath,
        `SELECT * FROM "${entry.tableName}" WHERE "${entry.nameColumn}" = ? COLLATE NOCASE LIMIT 1`,
        [target]
      );
    }

    if (row) {
      const fields: MappedField[] = [];
      for (const col of entry.keyColumns) {
        const val = str(row[col]);
        if (!val) continue;
        const mapping = resolveAttribute(col);
        fields.push({
          sourceColumn: col,
          value: val,
          attributeId: mapping?.attributeId ?? null,
          attributeName: mapping?.attributeName ?? null,
          attributeCategory: mapping?.category ?? null,
        });
      }
      matchedName = str(row[entry.nameColumn]) || matchedName;

      // FLAMITS: also pull aggregate flammability metrics from the data table
      if (entry.sourceId === "FIRE-03") {
        const flamMetrics = querySqlite(
          dbPath,
          `SELECT var_name,
                  ROUND(AVG(CAST(var_value AS REAL)), 2) AS avg_val,
                  COUNT(*) AS n
           FROM data
           WHERE taxon_name = ? AND var_value != ''
             AND var_name IN (
               'flammability index', 'ignition frequency (%)',
               'time to flaming (s)', 'flame height (cm)',
               'flaming duration (s)', 'burnt biomass (%)'
             )
           GROUP BY var_name`,
          [matchedName]
        );
        for (const m of flamMetrics) {
          const varName = str(m.var_name);
          const avgVal = str(m.avg_val);
          const n = str(m.n);
          if (!varName || !avgVal) continue;
          fields.push({
            sourceColumn: varName,
            value: `${avgVal} (n=${n})`,
            attributeId: "34b147da-613b-4df7-8eb9-76fd10e1d7ae", // Flammability Notes
            attributeName: "Flammability Notes",
            attributeCategory: "Flammability",
          });
        }
      }

      hits.push({
        sourceId: entry.sourceId,
        displayName: entry.displayName,
        category: entry.category,
        matchedName,
        matchConfidence: confidence,
        fields,
      });
    }
  }

  return hits;
}

// --- Production DB Search ---

export async function searchProductionDb(
  scientificName: string
): Promise<ProductionMatch> {
  const parts = scientificName.trim().split(/\s+/);
  const genus = parts[0] || "";
  const species = parts.slice(1).join(" ") || "";

  const rows = await queryProd<{
    id: string;
    genus: string;
    species: string;
    common_name: string | null;
  }>(
    `SELECT id, genus, species, common_name
     FROM plants
     WHERE LOWER(genus) = LOWER($1) AND LOWER(species) = LOWER($2)
     LIMIT 1`,
    [genus, species]
  );

  if (rows.length === 0) {
    return { exists: false };
  }

  const plant = rows[0];
  const countRows = await queryProd<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM "values" WHERE plant_id = $1`,
    [plant.id]
  );

  return {
    exists: true,
    plantId: plant.id,
    genus: plant.genus,
    species: plant.species,
    commonName: plant.common_name ?? undefined,
    attributeCount: countRows[0]?.count ?? 0,
  };
}

// --- Typeahead Suggestions ---

export function suggestPlants(prefix: string): PlantSuggestion[] {
  const target = prefix.trim();
  if (target.length < 2) return [];

  const suggestions: PlantSuggestion[] = [];
  const seen = new Set<string>();

  // USDA — most relevant for US-focused project, has common_name
  const usda = TAXONOMY_BACKBONES.find((b) => b.sourceId === "TAXON-03")!;
  const usdaRows = querySqlite(
    getDbPath(usda),
    `SELECT scientific_name_full, common_name, family
     FROM ${usda.tableName}
     WHERE scientific_name_full LIKE ? AND (is_synonym = 0 OR is_synonym = 'False')
     LIMIT 15`,
    [`${target}%`]
  );

  for (const row of usdaRows) {
    if (suggestions.length >= 10) break;
    const fullName = str(row.scientific_name_full);
    if (!fullName) continue;
    // Strip author suffix for display
    const displayName = fullName.replace(/\s+[A-Z][a-z]*\.?.*$/, "").trim();
    if (seen.has(displayName)) continue;
    seen.add(displayName);
    suggestions.push({
      scientificName: displayName,
      commonName: str(row.common_name),
      family: str(row.family),
    });
  }

  // If few USDA results, supplement from POWO
  if (suggestions.length < 5) {
    const powo = TAXONOMY_BACKBONES.find((b) => b.sourceId === "TAXON-01")!;
    const powoDbPath = getDbPath(powo);
    if (fs.existsSync(powoDbPath)) {
      const powoRows = querySqlite(
        powoDbPath,
        `SELECT scientific_name, family
         FROM ${powo.tableName}
         WHERE scientific_name LIKE ?
         LIMIT 10`,
        [`${target}%`]
      );
      for (const row of powoRows) {
        if (suggestions.length >= 10) break;
        const name = str(row.scientific_name);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        suggestions.push({
          scientificName: name,
          commonName: null,
          family: str(row.family),
        });
      }
    }
  }

  return suggestions;
}

// --- Combined Lookup ---

export async function lookupPlant(
  scientificName: string
): Promise<LookupResult> {
  const taxonomy = searchTaxonomyBackbones(scientificName);

  // If synonym was resolved, search sources + production under the accepted name
  const searchName = taxonomy.synonym?.acceptedName || scientificName;
  const sourceHits = searchSourceDatabases(searchName);
  const productionMatch = await searchProductionDb(searchName);

  return { taxonomy, productionMatch, sourceHits };
}
