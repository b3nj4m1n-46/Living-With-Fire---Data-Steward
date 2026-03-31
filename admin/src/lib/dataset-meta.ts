import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";

// --- Shared constants ---

export const REPO_ROOT = resolve(process.cwd(), "..");
export const DB_SOURCES = resolve(REPO_ROOT, "database-sources");
export const SOURCE_ID_RE = /\*\*Source ID:\*\*\s*`([^`]+)`/;
export const PLANTS_RE = /\*\*Plants:\*\*\s*(\d[\d,]*)/;

// Column names that indicate a CSV contains plant data
const PLANT_COLUMNS = new Set([
  "scientific_name",
  "species",
  "taxon",
  "botanical_name",
  "plant_name",
  "common_name",
  "usda_symbol",
]);

// --- parseDatasetMeta ---

export async function parseDatasetMeta(
  folder: string
): Promise<{ sourceId: string; plantCount: number | null }> {
  const ddPath = resolve(folder, "DATA-DICTIONARY.md");
  const readmePath = resolve(folder, "README.md");

  const [dd, readme] = await Promise.all([
    readFile(ddPath, "utf-8").catch(() => ""),
    readFile(readmePath, "utf-8").catch(() => ""),
  ]);

  const idMatch = SOURCE_ID_RE.exec(dd) ?? SOURCE_ID_RE.exec(readme);
  const sourceId = idMatch?.[1] ?? "UNKNOWN";

  const countMatch = PLANTS_RE.exec(readme) ?? PLANTS_RE.exec(dd);
  let plantCount = countMatch
    ? parseInt(countMatch[1].replace(/,/g, ""), 10)
    : null;

  // Fallback chain: CSV rows → SQLite count
  if (plantCount === null) {
    plantCount = await countCsvRows(folder);
  }
  if (plantCount === null || plantCount <= 5) {
    // CSV might be an LFS pointer or stub — try SQLite
    const sqliteCount = await countSqliteRows(folder);
    if (sqliteCount !== null && sqliteCount > (plantCount ?? 0)) {
      plantCount = sqliteCount;
    }
  }

  return { sourceId, plantCount };
}

// --- CSV fallback ---

async function countCsvRows(folder: string): Promise<number | null> {
  let entries: string[];
  try {
    entries = await readdir(folder);
  } catch {
    return null;
  }

  // Check for plants.csv first (standard name)
  if (entries.includes("plants.csv")) {
    const count = await countLines(resolve(folder, "plants.csv"));
    if (count !== null && count > 0) return count;
  }

  // Fall back: check all CSVs in the folder root for plant-like columns
  const csvFiles = entries.filter(
    (e) =>
      e.endsWith(".csv") &&
      e !== "plants.csv" &&
      e !== "references.csv" &&
      e !== "nurseries.csv"
  );

  let maxCount = 0;
  for (const csv of csvFiles) {
    const csvPath = resolve(folder, csv);
    const header = await readFirstLine(csvPath);
    if (!header) continue;

    const columns = header.split(",").map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ""));
    const hasPlantColumn = columns.some((c) => PLANT_COLUMNS.has(c));
    if (!hasPlantColumn) continue;

    const count = await countLines(csvPath);
    if (count !== null && count > maxCount) {
      maxCount = count;
    }
  }

  return maxCount > 0 ? maxCount : null;
}

async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const newline = content.indexOf("\n");
    return newline === -1 ? content : content.slice(0, newline).trim();
  } catch {
    return null;
  }
}

async function countLines(filePath: string): Promise<number | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    // Detect Git LFS pointer files
    if (content.startsWith("version https://git-lfs.github.com/")) {
      return null;
    }
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    return Math.max(0, lines.length - 1); // subtract header
  } catch {
    return null;
  }
}

async function countSqliteRows(folder: string): Promise<number | null> {
  const dbPath = resolve(folder, "plants.db");
  try {
    await stat(dbPath);
  } catch {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    // Find the main data table (usually "plants")
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableName =
      tables.find((t) => t.name === "plants")?.name ??
      tables.find((t) => t.name !== "sqlite_sequence")?.name;
    if (!tableName) { db.close(); return null; }
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM "${tableName}"`).get() as { cnt: number };
    db.close();
    return row.cnt;
  } catch {
    return null;
  }
}
