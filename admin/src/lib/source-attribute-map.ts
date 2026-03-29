/**
 * Reverse index: given a production attribute UUID, find which source
 * databases carry data for it. Discovers ALL columns from each source
 * SQLite DB dynamically — not limited to keyColumns.
 *
 * Also tracks unmapped columns (source data with no production attribute yet)
 * so the enrichment system can surface data gaps in the production schema.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import {
  DATABASE_SOURCES_ROOT,
  SOURCE_DATABASES,
  type SourceEntry,
} from "@/lib/source-registry";
import {
  resolveAttribute,
  CALCULATED_ATTRIBUTE_IDS,
} from "@/lib/attribute-map";

export interface SourceAttributeLink {
  sourceId: string;
  displayName: string;
  category: string;
  dbPath: string;
  tableName: string;
  nameColumn: string;
  sourceColumn: string;
}

export interface UnmappedColumn {
  sourceId: string;
  displayName: string;
  category: string;
  dbPath: string;
  tableName: string;
  nameColumn: string;
  sourceColumn: string;
  sampleValues: string[];
  nonNullCount: number;
}

// Columns that are structural/ID-only and never useful as enrichment data
const SKIP_COLUMNS = new Set([
  "id", "ID", "rowid",
  "taxon_id", "taxon_ID",
  "source_plant_id", "source_plant_ID",
  "source_leaf_id", "source_leaf_ID",
  "source_distrib_id", "source_distrib_ID",
  "source_ID", "source_id",
  "site_ID", "site_id",
  "symbol", "synonym_symbol",
  "is_synonym",
  "slug", "url", "page",
  "rank",
]);

let reverseIndex: Map<string, SourceAttributeLink[]> | null = null;
let unmappedColumnsCache: UnmappedColumn[] | null = null;

/**
 * Discover all columns from a SQLite table via PRAGMA table_info.
 */
function discoverColumns(dbPath: string, tableName: string): string[] {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
      name: string;
    }[];
    return rows.map((r) => r.name);
  } finally {
    db.close();
  }
}

/**
 * Get sample values and non-null count for a column.
 */
function getSampleData(
  dbPath: string,
  tableName: string,
  column: string
): { sampleValues: string[]; nonNullCount: number } {
  if (!fs.existsSync(dbPath))
    return { sampleValues: [], nonNullCount: 0 };
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const countRow = db
      .prepare(
        `SELECT COUNT(*) AS n FROM "${tableName}"
         WHERE "${column}" IS NOT NULL AND "${column}" != ''`
      )
      .get() as { n: number };

    const sampleRows = db
      .prepare(
        `SELECT DISTINCT "${column}" AS val FROM "${tableName}"
         WHERE "${column}" IS NOT NULL AND "${column}" != ''
         LIMIT 5`
      )
      .all() as { val: string }[];

    return {
      sampleValues: sampleRows.map((r) => String(r.val)),
      nonNullCount: countRow?.n ?? 0,
    };
  } finally {
    db.close();
  }
}

function buildIndexes(): {
  mapped: Map<string, SourceAttributeLink[]>;
  unmapped: UnmappedColumn[];
} {
  const mapped = new Map<string, SourceAttributeLink[]>();
  const unmapped: UnmappedColumn[] = [];

  for (const entry of SOURCE_DATABASES) {
    const dbPath = path.join(
      DATABASE_SOURCES_ROOT,
      entry.folder,
      entry.dbFile || "plants.db"
    );

    // Discover all columns dynamically from the actual DB
    const allColumns = discoverColumns(dbPath, entry.tableName);
    if (allColumns.length === 0) continue;

    for (const col of allColumns) {
      // Skip the name column and structural columns
      if (col === entry.nameColumn) continue;
      if (SKIP_COLUMNS.has(col)) continue;

      const mapping = resolveAttribute(col);

      if (mapping && !CALCULATED_ATTRIBUTE_IDS.has(mapping.attributeId)) {
        // Mapped column — add to reverse index
        const link: SourceAttributeLink = {
          sourceId: entry.sourceId,
          displayName: entry.displayName,
          category: entry.category,
          dbPath,
          tableName: entry.tableName,
          nameColumn: entry.nameColumn,
          sourceColumn: col,
        };

        const existing = mapped.get(mapping.attributeId);
        if (existing) {
          existing.push(link);
        } else {
          mapped.set(mapping.attributeId, [link]);
        }
      } else if (!mapping) {
        // Unmapped column — track for discovery
        const { sampleValues, nonNullCount } = getSampleData(
          dbPath,
          entry.tableName,
          col
        );

        // Only track columns that actually have data
        if (nonNullCount > 0) {
          unmapped.push({
            sourceId: entry.sourceId,
            displayName: entry.displayName,
            category: entry.category,
            dbPath,
            tableName: entry.tableName,
            nameColumn: entry.nameColumn,
            sourceColumn: col,
            sampleValues,
            nonNullCount,
          });
        }
      }
    }
  }

  // Sort unmapped by non-null count descending (most data first)
  unmapped.sort((a, b) => b.nonNullCount - a.nonNullCount);

  return { mapped, unmapped };
}

function ensureIndexes() {
  if (!reverseIndex || !unmappedColumnsCache) {
    const result = buildIndexes();
    reverseIndex = result.mapped;
    unmappedColumnsCache = result.unmapped;
  }
}

export function getSourcesForAttribute(
  attributeId: string
): SourceAttributeLink[] {
  ensureIndexes();
  return reverseIndex!.get(attributeId) ?? [];
}

/**
 * Get all source columns that don't map to any production attribute.
 * These represent potential new attributes or data the production schema
 * doesn't yet capture.
 */
export function getUnmappedColumns(): UnmappedColumn[] {
  ensureIndexes();
  return unmappedColumnsCache!;
}

/**
 * Get unmapped columns grouped by a suggested category based on source.
 */
export function getUnmappedSummary(): {
  totalUnmapped: number;
  bySource: {
    sourceId: string;
    displayName: string;
    columns: { column: string; nonNullCount: number; sampleValues: string[] }[];
  }[];
} {
  const unmapped = getUnmappedColumns();
  const bySource = new Map<
    string,
    {
      sourceId: string;
      displayName: string;
      columns: {
        column: string;
        nonNullCount: number;
        sampleValues: string[];
      }[];
    }
  >();

  for (const col of unmapped) {
    let entry = bySource.get(col.sourceId);
    if (!entry) {
      entry = {
        sourceId: col.sourceId,
        displayName: col.displayName,
        columns: [],
      };
      bySource.set(col.sourceId, entry);
    }
    entry.columns.push({
      column: col.sourceColumn,
      nonNullCount: col.nonNullCount,
      sampleValues: col.sampleValues,
    });
  }

  return {
    totalUnmapped: unmapped.length,
    bySource: Array.from(bySource.values()),
  };
}
