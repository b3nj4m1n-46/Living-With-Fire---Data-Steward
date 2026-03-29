/**
 * Bulk Enhance Flow — Create warrant records from matched+mapped source data.
 *
 * Pure data transformation (no LLM calls). Takes match results from
 * matchPlantFlow, mapping config from mapSchemaFlow, reads the source CSV,
 * and inserts warrant records into DoltgreSQL.
 */
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { parseCSV } from '../utils/csv.js';
import { doltPool } from '../tools/index.js';
import { matchResult } from './matchPlantFlow.js';
import { columnMapping, mapSchemaOutput } from './mapSchemaFlow.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const BATCH_SIZE = 500;

// --- Types ---

export type MatchResult = z.infer<typeof matchResult>;
export type ColumnMapping = z.infer<typeof columnMapping>;
export type MappingConfig = z.infer<typeof mapSchemaOutput>;

export interface BulkEnhanceInput {
  sourceDataset: string;
  datasetFolder: string;
  matchResults: MatchResult[];
  mappingConfig: MappingConfig;
  batchId: string;
  dryRun?: boolean;
}

export interface BulkEnhanceOutput {
  warrantsCreated: number;
  warrantsSkipped: number;
  warrantsFlagged: number;
  plantsCovered: number;
  attributesCovered: number;
  errors: Array<{ row: number; error: string }>;
}

// --- Flow ---

export async function bulkEnhanceFlow(input: BulkEnhanceInput): Promise<BulkEnhanceOutput> {
  const {
    sourceDataset,
    datasetFolder,
    matchResults,
    mappingConfig,
    batchId,
    dryRun = false,
  } = input;

  // 1. Read and parse source CSV
  const csvPath = resolve(REPO_ROOT, datasetFolder, 'plants.csv');
  const content = await readFile(csvPath, 'utf-8');
  const parsed = parseCSV(content);

  // 2. Build lookup: scientificName → MatchResult
  const matchLookup = new Map<string, MatchResult>();
  for (const m of matchResults) {
    matchLookup.set(m.inputName.toLowerCase(), m);
  }

  // 3. Filter mappings to actionable ones (not SKIP, not UNCERTAIN without target)
  const actionableMappings = mappingConfig.mappings.filter(
    (m) => m.mappingType !== 'SKIP' && m.targetAttributeId !== null,
  );

  // 4. Process each CSV row
  const warrantRecords: Array<Record<string, unknown>> = [];
  const errors: Array<{ row: number; error: string }> = [];
  let skipped = 0;
  let flagged = 0;
  const plantsWithWarrants = new Set<string>();
  const attributesWithWarrants = new Set<string>();

  for (let rowIdx = 0; rowIdx < parsed.rows.length; rowIdx++) {
    const row = parsed.rows[rowIdx];
    const sciName =
      row['scientific_name'] ||
      row['botanical_name'] ||
      row['species'] ||
      row['taxon'] ||
      (row['genus'] ? `${row['genus']} spp.` : '');

    if (!sciName) {
      errors.push({ row: rowIdx + 2, error: 'Missing scientific_name' });
      skipped++;
      continue;
    }

    // Look up match result
    const match = matchLookup.get(sciName.toLowerCase());
    if (!match || match.matchType === 'NONE' || !match.productionPlantId) {
      skipped++;
      continue;
    }

    // Flag low-confidence matches
    const isLowConfidence = match.confidence < 0.8;

    for (const mapping of actionableMappings) {
      try {
        const sourceValue = row[mapping.sourceColumn] ?? '';
        if (!sourceValue) continue; // skip empty values

        // Apply crosswalk transformation if needed
        let normalizedValue = sourceValue;
        if (mapping.mappingType === 'CROSSWALK' && mapping.crosswalk) {
          const mapped = mapping.crosswalk[sourceValue];
          if (mapped !== undefined) {
            normalizedValue = mapped;
          } else {
            // Try case-insensitive lookup
            const lowerSource = sourceValue.toLowerCase();
            const entry = Object.entries(mapping.crosswalk).find(
              ([k]) => k.toLowerCase() === lowerSource,
            );
            if (entry) {
              normalizedValue = entry[1];
            } else {
              // Value not in crosswalk — flag it
              flagged++;
              normalizedValue = sourceValue; // keep original
            }
          }
        }

        const isFlagged = isLowConfidence || mapping.mappingType === 'UNCERTAIN';
        if (isFlagged) flagged++;

        warrantRecords.push({
          id: crypto.randomUUID(),
          warrant_type: 'external',
          status: 'unreviewed',
          plant_id: match.productionPlantId,
          plant_genus: match.productionGenus,
          plant_species: match.productionSpecies,
          attribute_id: mapping.targetAttributeId,
          attribute_name: mapping.targetAttributeName,
          value: normalizedValue,
          source_value: sourceValue,
          source_dataset: sourceDataset,
          source_id_code: mappingConfig.sourceIdCode,
          source_file: 'plants.csv',
          source_row: rowIdx + 2, // 1-based, accounting for header
          source_column: mapping.sourceColumn,
          match_method: match.matchType.toLowerCase(),
          match_confidence: match.confidence,
          batch_id: batchId,
        });

        plantsWithWarrants.add(match.productionPlantId);
        attributesWithWarrants.add(mapping.targetAttributeId!);
      } catch (err) {
        errors.push({
          row: rowIdx + 2,
          error: `Column ${mapping.sourceColumn}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // 5. Batch-insert warrants (unless dry run)
  if (!dryRun && warrantRecords.length > 0) {
    const client = await doltPool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < warrantRecords.length; i += BATCH_SIZE) {
        const batch = warrantRecords.slice(i, i + BATCH_SIZE);
        const placeholders: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        for (const rec of batch) {
          placeholders.push(
            `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
          );
          params.push(
            rec.id,
            rec.warrant_type,
            rec.status,
            rec.plant_id,
            rec.plant_genus,
            rec.plant_species,
            rec.attribute_id,
            rec.attribute_name,
            rec.value,
            rec.source_value,
            rec.source_dataset,
            rec.source_id_code,
            rec.source_file,
            rec.source_row,
            rec.source_column,
            rec.match_method,
            rec.match_confidence,
            rec.batch_id,
          );
        }

        await client.query(
          `INSERT INTO warrants (
            id, warrant_type, status,
            plant_id, plant_genus, plant_species,
            attribute_id, attribute_name,
            "value", source_value,
            source_dataset, source_id_code,
            source_file, source_row, source_column,
            match_method, match_confidence, batch_id
          ) VALUES ${placeholders.join(', ')}`,
          params,
        );

        const inserted = Math.min(i + BATCH_SIZE, warrantRecords.length);
        if (inserted % 1000 === 0 || inserted === warrantRecords.length) {
          console.log(`  Inserted ${inserted} / ${warrantRecords.length} warrants`);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    warrantsCreated: warrantRecords.length,
    warrantsSkipped: skipped,
    warrantsFlagged: flagged,
    plantsCovered: plantsWithWarrants.size,
    attributesCovered: attributesWithWarrants.size,
    errors,
  };
}
