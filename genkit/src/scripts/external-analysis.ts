/**
 * External Analysis — Run the full pipeline on an external source dataset.
 *
 * Orchestrates: match → map → enhance → classify for a given dataset folder.
 * Creates an analysis_batches record, writes warrants + conflicts to DB,
 * creates a Dolt commit, and outputs a summary report + JSON file.
 *
 * Usage: npx tsx src/scripts/external-analysis.ts <datasetFolder>
 * Example: npx tsx src/scripts/external-analysis.ts database-sources/fire/FirePerformancePlants
 * Requires: DoltgreSQL running on port 5433 with lwf_staging database
 *           and bootstrapped warrants (npm run bootstrap).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { doltPool } from '../tools/index.js';
import { getDatasetContext } from '../tools/datasetContext.js';
import { matchPlantFlow } from '../flows/matchPlantFlow.js';
import { mapSchemaFlow } from '../flows/mapSchemaFlow.js';
import { bulkEnhanceFlow } from '../flows/bulkEnhanceFlow.js';
import { classifyConflictFlow } from '../flows/classifyConflictFlow.js';
import { parseCSV } from '../utils/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const OUTPUT_DIR = resolve(__dirname, '..', '..', 'output');

async function main() {
  // Parse CLI arguments
  const datasetFolder = process.argv[2];
  if (!datasetFolder) {
    console.error('Usage: tsx src/scripts/external-analysis.ts <datasetFolder>');
    console.error('Example: tsx src/scripts/external-analysis.ts database-sources/fire/FirePerformancePlants');
    process.exitCode = 1;
    return;
  }

  const datasetName = path.basename(datasetFolder);
  const client = await doltPool.connect();
  const batchId = crypto.randomUUID();
  const startTime = Date.now();

  console.log(`\n=== External Analysis: ${datasetName} ===\n`);
  console.log(`Dataset folder: ${datasetFolder}`);
  console.log(`Batch ID: ${batchId}`);

  try {
    // Resolve source ID from dataset context
    const context = await getDatasetContext({ datasetFolder });
    const sourceIdCode = context.sourceId;
    console.log(`Source ID: ${sourceIdCode}\n`);

    // 1. Create analysis_batches record
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO analysis_batches (id, source_dataset, source_id_code, batch_type, status)
       VALUES ($1, $2, $3, 'external_analysis', 'running')`,
      [batchId, datasetName, sourceIdCode],
    );
    await client.query('COMMIT');
    console.log('Created analysis_batches record.\n');

    // === Step 1: Match ===
    console.log('--- Step 1: Match Plants ---\n');
    const csvPath = resolve(REPO_ROOT, datasetFolder, 'plants.csv');
    const csvContent = await readFile(csvPath, 'utf-8');
    const parsed = parseCSV(csvContent);
    const totalSourceRecords = parsed.rows.length;
    console.log(`Loaded ${totalSourceRecords} plants from ${datasetName}/plants.csv`);

    // Build plant input array
    const plantInputs = parsed.rows.map((row, idx) => ({
      sourceRowId: String(idx + 2), // 1-based, accounting for header
      scientificName: row['scientific_name'] ?? '',
      commonName: row['common_name'],
      sourceDataset: datasetName,
    }));

    console.log(`Matching ${plantInputs.length} plants from ${sourceIdCode}...`);
    const matchResult = await matchPlantFlow({
      plants: plantInputs,
    });

    const { summary: matchSummary } = matchResult;
    console.log(`Match results: ${matchSummary.exact} exact, ${matchSummary.synonym} synonym, ${matchSummary.cultivar} cultivar, ${matchSummary.genusOnly} genus-only, ${matchSummary.fuzzy} fuzzy, ${matchSummary.noMatch} none\n`);

    const plantsMatched = matchSummary.total - matchSummary.noMatch;
    const plantsUnmatched = matchSummary.noMatch;

    // === Step 2: Map Schema ===
    console.log('--- Step 2: Map Schema ---\n');
    console.log(`Mapping schema for ${sourceIdCode}...`);
    const mappingConfig = await mapSchemaFlow({
      sourceDataset: datasetName,
      datasetFolder,
    });

    const { summary: mapSummary } = mappingConfig;
    console.log(`Mappings: ${mapSummary.direct} direct, ${mapSummary.crosswalk} crosswalk, ${mapSummary.split} split, ${mapSummary.newAttribute} new, ${mapSummary.skip} skip, ${mapSummary.uncertain} uncertain`);
    if (mappingConfig.unmappedColumns.length > 0) {
      console.log(`Unmapped columns: ${mappingConfig.unmappedColumns.join(', ')}`);
    }
    console.log();

    // === Step 3: Enhance (Create Warrants) ===
    console.log('--- Step 3: Create Warrants ---\n');
    console.log(`Creating warrants for ${sourceIdCode}...`);
    const enhanceResult = await bulkEnhanceFlow({
      sourceDataset: datasetName,
      datasetFolder,
      matchResults: matchResult.matches,
      mappingConfig,
      batchId,
    });

    console.log(`Created ${enhanceResult.warrantsCreated} warrants (${enhanceResult.plantsCovered} plants x ${enhanceResult.attributesCovered} attributes)`);
    console.log(`Skipped: ${enhanceResult.warrantsSkipped}, Flagged: ${enhanceResult.warrantsFlagged}`);
    if (enhanceResult.errors.length > 0) {
      console.log(`Errors: ${enhanceResult.errors.length}`);
      for (const err of enhanceResult.errors.slice(0, 5)) {
        console.log(`  Row ${err.row}: ${err.error}`);
      }
      if (enhanceResult.errors.length > 5) {
        console.log(`  ... and ${enhanceResult.errors.length - 5} more`);
      }
    }
    console.log();

    // === Step 4: Classify Conflicts ===
    console.log('--- Step 4: Detect Conflicts ---\n');
    console.log(`Detecting conflicts between ${sourceIdCode} warrants and existing production warrants...`);
    const classifyResult = await classifyConflictFlow({
      mode: 'external',
      sourceDataset: datasetName,
      batchId,
    });

    const { summary: conflictSummary } = classifyResult;
    console.log(`Found ${conflictSummary.total} conflicts (${conflictSummary.critical} critical, ${conflictSummary.moderate} moderate, ${conflictSummary.minor} minor)`);
    console.log(`Corroborated: ${classifyResult.corroborated}, Complementary: ${classifyResult.complementary}\n`);

    // === Update analysis batch ===
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const notesStr =
      `${sourceIdCode}: ${totalSourceRecords} source records, ${plantsMatched} matched, ` +
      `${enhanceResult.warrantsCreated} warrants, ${conflictSummary.total} conflicts. ` +
      `Elapsed: ${elapsed}s.`;

    await client.query('BEGIN');
    await client.query(
      `UPDATE analysis_batches SET
        status = 'completed',
        completed_at = CURRENT_TIMESTAMP,
        total_source_records = $1,
        plants_matched = $2,
        plants_unmatched = $3,
        warrants_created = $4,
        conflicts_detected = $5,
        agent_model = $6,
        agent_flows_used = $7,
        notes = $8
      WHERE id = $9`,
      [
        totalSourceRecords,
        plantsMatched,
        plantsUnmatched,
        enhanceResult.warrantsCreated,
        conflictSummary.total,
        'anthropic/claude-sonnet-4-6 + anthropic/claude-haiku-4-5',
        JSON.stringify(['matchPlantFlow', 'mapSchemaFlow', 'bulkEnhanceFlow', 'classifyConflictFlow']),
        notesStr,
        batchId,
      ],
    );
    await client.query('COMMIT');
    console.log('Updated analysis_batches record.');

    // === Dolt commit ===
    console.log('Creating Dolt commit...');
    await client.query(`SELECT dolt_add('.')`);
    await client.query(
      `SELECT dolt_commit('-m', $1)`,
      [`analysis: ${sourceIdCode} — ${enhanceResult.warrantsCreated} warrants, ${conflictSummary.total} conflicts`],
    );

    const logResult = await client.query(
      'SELECT commit_hash FROM dolt_log ORDER BY date DESC LIMIT 1',
    );
    const doltCommitHash: string = logResult.rows[0].commit_hash;

    await client.query(
      `UPDATE analysis_batches SET dolt_commit_hash = $1 WHERE id = $2`,
      [doltCommitHash, batchId],
    );
    console.log(`Dolt commit created: ${doltCommitHash}`);

    // === Console summary report ===
    const pad = (label: string, width: number) => label.padEnd(width);
    const num = (n: number, width: number) => String(n).padStart(width);

    // Compute top-level stats from conflicts
    const plantCounts = new Map<string, number>();
    const attrCounts = new Map<string, number>();
    for (const c of classifyResult.conflicts) {
      plantCounts.set(c.plantName, (plantCounts.get(c.plantName) ?? 0) + 1);
      attrCounts.set(c.attributeName, (attrCounts.get(c.attributeName) ?? 0) + 1);
    }
    const topPlants = [...plantCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const topAttributes = [...attrCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    console.log(`
=== External Analysis Complete: ${sourceIdCode} ===

Source records:            ${num(totalSourceRecords, 6)}
Plants matched:            ${num(plantsMatched, 6)}
Plants unmatched:          ${num(plantsUnmatched, 6)}

Match breakdown:
  Exact:                   ${num(matchSummary.exact, 6)}
  Synonym:                 ${num(matchSummary.synonym, 6)}
  Cultivar:                ${num(matchSummary.cultivar, 6)}
  Genus-only:              ${num(matchSummary.genusOnly, 6)}
  Fuzzy:                   ${num(matchSummary.fuzzy, 6)}
  No match:                ${num(matchSummary.noMatch, 6)}

Schema mappings:
  Direct:                  ${num(mapSummary.direct, 6)}
  Crosswalk:               ${num(mapSummary.crosswalk, 6)}
  Split:                   ${num(mapSummary.split, 6)}
  New attribute:           ${num(mapSummary.newAttribute, 6)}
  Skip:                    ${num(mapSummary.skip, 6)}
  Uncertain:               ${num(mapSummary.uncertain, 6)}

Warrants created:          ${num(enhanceResult.warrantsCreated, 6)}
Plants covered:            ${num(enhanceResult.plantsCovered, 6)}
Attributes covered:        ${num(enhanceResult.attributesCovered, 6)}
Warrants skipped:          ${num(enhanceResult.warrantsSkipped, 6)}
Warrants flagged:          ${num(enhanceResult.warrantsFlagged, 6)}

Conflicts detected:        ${num(conflictSummary.total, 6)}
Corroborated:              ${num(classifyResult.corroborated, 6)}
Complementary:             ${num(classifyResult.complementary, 6)}

By severity:
  Critical:                ${num(conflictSummary.critical, 6)}
  Moderate:                ${num(conflictSummary.moderate, 6)}
  Minor:                   ${num(conflictSummary.minor, 6)}

By type:`);

    const sortedTypes = Object.entries(conflictSummary.byType).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes) {
      console.log(`  ${pad(type, 28)} ${num(count, 6)}`);
    }

    if (topPlants.length > 0) {
      console.log('\nTop conflicted plants:');
      topPlants.forEach(([name, count], i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${pad(name, 30)} — ${num(count, 4)} conflicts`);
      });
    }

    if (topAttributes.length > 0) {
      console.log('\nTop conflicted attributes:');
      topAttributes.forEach(([name, count], i) => {
        console.log(`  ${String(i + 1).padStart(2)}. ${pad(name, 30)} — ${num(count, 4)} conflicts`);
      });
    }

    console.log(`\nElapsed time: ${elapsed}s`);
    console.log(`Dolt commit:  ${doltCommitHash}`);

    // === Write JSON summary ===
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = path.join(OUTPUT_DIR, `${sourceIdCode.toLowerCase()}-analysis-summary.json`);

    const jsonSummary = {
      analysisDate: new Date().toISOString(),
      batchId,
      doltCommitHash,
      sourceDataset: datasetName,
      sourceIdCode,
      totalSourceRecords,
      matching: {
        plantsMatched,
        plantsUnmatched,
        breakdown: matchSummary,
      },
      schemaMapping: {
        ...mapSummary,
        unmappedColumns: mappingConfig.unmappedColumns,
      },
      warrants: {
        created: enhanceResult.warrantsCreated,
        skipped: enhanceResult.warrantsSkipped,
        flagged: enhanceResult.warrantsFlagged,
        plantsCovered: enhanceResult.plantsCovered,
        attributesCovered: enhanceResult.attributesCovered,
        errors: enhanceResult.errors.length,
      },
      conflicts: {
        total: conflictSummary.total,
        corroborated: classifyResult.corroborated,
        complementary: classifyResult.complementary,
        bySeverity: {
          critical: conflictSummary.critical,
          moderate: conflictSummary.moderate,
          minor: conflictSummary.minor,
        },
        byType: conflictSummary.byType,
      },
      topConflictedPlants: topPlants.map(([name, count]) => {
        const parts = name.split(' ');
        return { genus: parts[0], species: parts.slice(1).join(' ') || null, conflictCount: count };
      }),
      topConflictedAttributes: topAttributes.map(([name, count]) => ({
        name,
        conflictCount: count,
      })),
      elapsedSeconds: parseFloat(elapsed),
    };

    fs.writeFileSync(outputPath, JSON.stringify(jsonSummary, null, 2));
    console.log(`\nJSON summary written to: ${outputPath}`);

    // === Verification queries ===
    console.log('\n=== Verification ===\n');

    const warrantCount = await client.query(
      'SELECT COUNT(*) AS cnt FROM warrants WHERE source_id_code = $1',
      [sourceIdCode],
    );
    console.log(`Warrants for ${sourceIdCode}: ${warrantCount.rows[0].cnt}`);

    const invalidPlantRefs = await client.query(
      `SELECT COUNT(*) AS cnt FROM warrants w
       WHERE w.source_id_code = $1
         AND NOT EXISTS (SELECT 1 FROM plants p WHERE p.id = w.plant_id)`,
      [sourceIdCode],
    );
    console.log(`Warrants with invalid plant refs: ${invalidPlantRefs.rows[0].cnt}`);

    const conflictCount = await client.query(
      `SELECT COUNT(*) AS cnt FROM conflicts
       WHERE conflict_mode = 'external'
         AND (source_a LIKE $1 OR source_b LIKE $1)`,
      [`%${sourceIdCode}%`],
    );
    console.log(`External conflicts involving ${sourceIdCode}: ${conflictCount.rows[0].cnt}`);

    const batchRecord = await client.query(
      'SELECT status, total_source_records, plants_matched, warrants_created, conflicts_detected, dolt_commit_hash FROM analysis_batches WHERE id = $1',
      [batchId],
    );
    console.log('\nAnalysis batch:', batchRecord.rows[0]);

    const latestCommit = await client.query(
      'SELECT message FROM dolt_log ORDER BY date DESC LIMIT 1',
    );
    console.log(`Latest Dolt commit: "${latestCommit.rows[0].message}"`);

    console.log(`\n=== External Analysis Complete: ${sourceIdCode} ===\n`);
  } catch (err) {
    // Update batch to failed
    try {
      await client.query(
        `UPDATE analysis_batches SET status = 'failed', completed_at = CURRENT_TIMESTAMP, notes = $1 WHERE id = $2`,
        [`Failed: ${err instanceof Error ? err.message : String(err)}`, batchId],
      );
    } catch {
      // Ignore update failure
    }

    console.error(`\nExternal analysis for ${datasetName} FAILED.`);
    console.error(err);
    process.exitCode = 1;
  } finally {
    client.release();
    await doltPool.end();
  }
}

main();
