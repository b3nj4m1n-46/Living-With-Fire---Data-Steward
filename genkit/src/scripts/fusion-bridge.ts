/**
 * Fusion Bridge — JSON stdin/stdout interface for admin portal API routes.
 *
 * Reads a JSON command from stdin, executes the requested action, and
 * writes the JSON result to stdout. Used by the admin portal to call
 * Genkit flows without cross-package imports.
 *
 * Actions:
 *   map              — Run mapSchemaFlow on a dataset
 *   match-and-preview — Match plants + dry-run bulkEnhanceFlow (no DB writes)
 *   execute          — Full pipeline: match + enhance + classify (writes to DB)
 *
 * Usage: echo '{"action":"map",...}' | npx tsx src/scripts/fusion-bridge.ts
 */
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { doltPool } from '../tools/index.js';
import { getDatasetContext } from '../tools/datasetContext.js';
import { mapSchemaFlow } from '../flows/mapSchemaFlow.js';
import { matchPlantFlow } from '../flows/matchPlantFlow.js';
import { bulkEnhanceFlow, type MatchResult } from '../flows/bulkEnhanceFlow.js';
import { classifyConflictFlow } from '../flows/classifyConflictFlow.js';
import { synthesizeClaimFlow } from '../flows/synthesizeClaimFlow.js';
import { parseCSV } from '../utils/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Redirect console.log to stderr so only the final JSON result goes to stdout
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  process.stderr.write(args.map(String).join(' ') + '\n');
};

// --- Read stdin ---

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// --- Actions ---

interface MapInput {
  action: 'map';
  sourceDataset: string;
  datasetFolder: string;
  csvPath?: string;
}

interface PreviewInput {
  action: 'match-and-preview';
  sourceDataset: string;
  datasetFolder: string;
  mappingConfig: unknown;
  batchId: string;
}

interface ExecuteInput {
  action: 'execute';
  sourceDataset: string;
  datasetFolder: string;
  mappingConfig: unknown;
  batchId: string;
}

interface FullAnalysisInput {
  action: 'full-analysis';
  sourceDataset: string;
  datasetFolder: string;
  batchId: string;
}

interface ClassifyExistingInput {
  action: 'classify-existing';
  batchId: string;
  mode: 'internal' | 'cross_source';
  plantIds?: string[];
  attributeFilter?: string;
  runSpecialists?: boolean;
}

interface BulkSynthesizeInput {
  action: 'bulk-synthesize';
  batchId: string;
  plantIds?: string[];
  attributeFilter?: string;
  limit?: number;
}

type BridgeInput = MapInput | PreviewInput | ExecuteInput | FullAnalysisInput | ClassifyExistingInput | BulkSynthesizeInput;

async function buildPlantInputs(datasetFolder: string, datasetName: string) {
  const csvPath = resolve(REPO_ROOT, datasetFolder, 'plants.csv');
  const content = await readFile(csvPath, 'utf-8');
  const parsed = parseCSV(content);
  return {
    totalRecords: parsed.rows.length,
    plantInputs: parsed.rows.map((row, idx) => {
      // Support datasets that use 'genus' instead of 'scientific_name'
      const scientificName =
        row['scientific_name'] ||
        row['botanical_name'] ||
        row['species'] ||
        row['taxon'] ||
        (row['genus'] ? `${row['genus']} spp.` : '');
      return {
        sourceRowId: String(idx + 2),
        scientificName,
        commonName: row['common_name'],
        sourceDataset: datasetName,
      };
    }),
  };
}

async function handleMap(input: MapInput) {
  const result = await mapSchemaFlow({
    sourceDataset: input.sourceDataset,
    datasetFolder: input.datasetFolder,
    csvPath: input.csvPath,
  });
  return result;
}

async function handlePreview(input: PreviewInput) {
  const { totalRecords, plantInputs } = await buildPlantInputs(
    input.datasetFolder,
    input.sourceDataset,
  );

  const matchResult = await matchPlantFlow({ plants: plantInputs });

  const enhanceResult = await bulkEnhanceFlow({
    sourceDataset: input.sourceDataset,
    datasetFolder: input.datasetFolder,
    matchResults: matchResult.matches,
    mappingConfig: input.mappingConfig as Parameters<typeof bulkEnhanceFlow>[0]['mappingConfig'],
    batchId: input.batchId,
    dryRun: true,
  });

  return {
    totalSourceRecords: totalRecords,
    matchSummary: matchResult.summary,
    warrantsEstimated: enhanceResult.warrantsCreated,
    warrantsSkipped: enhanceResult.warrantsSkipped,
    warrantsFlagged: enhanceResult.warrantsFlagged,
    plantsCovered: enhanceResult.plantsCovered,
    attributesCovered: enhanceResult.attributesCovered,
    errors: enhanceResult.errors.slice(0, 10),
  };
}

async function expandGenusMatches(
  matches: MatchResult[],
): Promise<MatchResult[]> {
  const expanded: MatchResult[] = [];
  const client = await doltPool.connect();
  try {
    for (const m of matches) {
      if (m.matchType === 'GENUS_ONLY' && !m.productionPlantId && m.productionGenus) {
        // Expand to all species in this genus
        const result = await client.query(
          `SELECT id, genus, species FROM plants WHERE LOWER(genus) = LOWER($1)`,
          [m.productionGenus],
        );
        for (const row of result.rows) {
          expanded.push({
            ...m,
            productionPlantId: row.id,
            productionSpecies: row.species,
            notes: `${m.notes} — expanded to ${row.genus} ${row.species ?? 'sp.'}`,
          });
        }
        if (result.rows.length === 0) {
          expanded.push(m); // keep original if no plants found
        }
      } else {
        expanded.push(m);
      }
    }
  } finally {
    client.release();
  }
  return expanded;
}

async function handleExecute(input: ExecuteInput) {
  const { totalRecords, plantInputs } = await buildPlantInputs(
    input.datasetFolder,
    input.sourceDataset,
  );

  // Step 1: Match
  const matchResult = await matchPlantFlow({ plants: plantInputs });

  // Step 1.5: Expand genus-only matches to all species in genus
  const expandedMatches = await expandGenusMatches(matchResult.matches);
  const plantsMatched = expandedMatches.filter((m) => m.productionPlantId).length;

  // Step 2: Create warrants
  const enhanceResult = await bulkEnhanceFlow({
    sourceDataset: input.sourceDataset,
    datasetFolder: input.datasetFolder,
    matchResults: expandedMatches,
    mappingConfig: input.mappingConfig as Parameters<typeof bulkEnhanceFlow>[0]['mappingConfig'],
    batchId: input.batchId,
  });

  // Step 3: Classify conflicts
  const classifyResult = await classifyConflictFlow({
    mode: 'external',
    sourceDataset: input.sourceDataset,
    batchId: input.batchId,
  });

  // Step 4: Dolt commit
  const client = await doltPool.connect();
  let commitHash = '';
  try {
    const context = await getDatasetContext({ datasetFolder: input.datasetFolder });
    await client.query(`SELECT dolt_add('.')`);
    await client.query(
      `SELECT dolt_commit('-m', $1)`,
      [`fusion: ${context.sourceId} — ${enhanceResult.warrantsCreated} warrants, ${classifyResult.summary.total} conflicts`],
    );
    const logResult = await client.query(
      'SELECT commit_hash FROM dolt_log ORDER BY date DESC LIMIT 1',
    );
    commitHash = logResult.rows[0].commit_hash;
  } finally {
    client.release();
  }

  return {
    totalSourceRecords: totalRecords,
    plantsMatched,
    plantsUnmatched: matchResult.summary.noMatch,
    matchSummary: matchResult.summary,
    warrantsCreated: enhanceResult.warrantsCreated,
    warrantsSkipped: enhanceResult.warrantsSkipped,
    warrantsFlagged: enhanceResult.warrantsFlagged,
    plantsCovered: enhanceResult.plantsCovered,
    attributesCovered: enhanceResult.attributesCovered,
    conflictsDetected: classifyResult.summary.total,
    conflictSummary: classifyResult.summary,
    commitHash,
  };
}

async function updateStepProgress(
  batchId: string,
  currentStep: string,
  stepsStatus: Record<string, { status: string; detail?: string }>,
) {
  const progress = JSON.stringify({ currentStep, steps: stepsStatus });
  const client = await doltPool.connect();
  try {
    await client.query('UPDATE analysis_batches SET notes = $1 WHERE id = $2', [progress, batchId]);
  } finally {
    client.release();
  }
}

async function handleFullAnalysis(input: FullAnalysisInput) {
  const steps: Record<string, { status: string; detail?: string }> = {
    matching: { status: 'pending' },
    mapping: { status: 'pending' },
    enhancing: { status: 'pending' },
    classifying: { status: 'pending' },
    committing: { status: 'pending' },
  };

  const { totalRecords, plantInputs } = await buildPlantInputs(
    input.datasetFolder,
    input.sourceDataset,
  );

  // Update total records
  const client0 = await doltPool.connect();
  try {
    await client0.query(
      'UPDATE analysis_batches SET total_source_records = $1 WHERE id = $2',
      [totalRecords, input.batchId],
    );
  } finally {
    client0.release();
  }

  // Step 1: Match
  steps.matching.status = 'running';
  await updateStepProgress(input.batchId, 'matching', steps);

  const matchResult = await matchPlantFlow({ plants: plantInputs });

  // Expand genus-only matches to all species in genus
  const expandedMatches = await expandGenusMatches(matchResult.matches);
  const plantsMatched = expandedMatches.filter((m) => m.productionPlantId).length;

  steps.matching = {
    status: 'completed',
    detail: `${plantsMatched} matched, ${matchResult.summary.noMatch} unmatched`,
  };
  await updateStepProgress(input.batchId, 'matching', steps);

  // Update batch with match stats
  const client1 = await doltPool.connect();
  try {
    await client1.query(
      'UPDATE analysis_batches SET plants_matched = $1, plants_unmatched = $2 WHERE id = $3',
      [plantsMatched, matchResult.summary.noMatch, input.batchId],
    );
  } finally {
    client1.release();
  }

  // Step 2: Map schema
  steps.mapping.status = 'running';
  await updateStepProgress(input.batchId, 'mapping', steps);

  const mapResult = await mapSchemaFlow({
    sourceDataset: input.sourceDataset,
    datasetFolder: input.datasetFolder,
  });

  steps.mapping = {
    status: 'completed',
    detail: `${mapResult.mappings.length} columns mapped`,
  };
  await updateStepProgress(input.batchId, 'mapping', steps);

  // Store mapping config
  const client2 = await doltPool.connect();
  try {
    await client2.query(
      'UPDATE analysis_batches SET mapping_config = $1 WHERE id = $2',
      [JSON.stringify(mapResult), input.batchId],
    );
  } finally {
    client2.release();
  }

  // Step 3: Enhance (create warrants)
  steps.enhancing.status = 'running';
  await updateStepProgress(input.batchId, 'enhancing', steps);

  const enhanceResult = await bulkEnhanceFlow({
    sourceDataset: input.sourceDataset,
    datasetFolder: input.datasetFolder,
    matchResults: expandedMatches,
    mappingConfig: mapResult as Parameters<typeof bulkEnhanceFlow>[0]['mappingConfig'],
    batchId: input.batchId,
  });

  steps.enhancing = {
    status: 'completed',
    detail: `${enhanceResult.warrantsCreated} warrants created`,
  };
  await updateStepProgress(input.batchId, 'enhancing', steps);

  // Update batch with warrant stats
  const client3 = await doltPool.connect();
  try {
    await client3.query(
      'UPDATE analysis_batches SET warrants_created = $1 WHERE id = $2',
      [enhanceResult.warrantsCreated, input.batchId],
    );
  } finally {
    client3.release();
  }

  // Step 4: Classify conflicts
  steps.classifying.status = 'running';
  await updateStepProgress(input.batchId, 'classifying', steps);

  const classifyResult = await classifyConflictFlow({
    mode: 'external',
    sourceDataset: input.sourceDataset,
    batchId: input.batchId,
  });

  steps.classifying = {
    status: 'completed',
    detail: `${classifyResult.summary.total} conflicts detected`,
  };
  await updateStepProgress(input.batchId, 'classifying', steps);

  // Update batch with conflict stats
  const client4 = await doltPool.connect();
  try {
    await client4.query(
      'UPDATE analysis_batches SET conflicts_detected = $1 WHERE id = $2',
      [classifyResult.summary.total, input.batchId],
    );
  } finally {
    client4.release();
  }

  // Step 5: Dolt commit
  steps.committing.status = 'running';
  await updateStepProgress(input.batchId, 'committing', steps);

  const client5 = await doltPool.connect();
  let commitHash = '';
  try {
    const context = await getDatasetContext({ datasetFolder: input.datasetFolder });
    await client5.query(`SELECT dolt_add('.')`);
    await client5.query(
      `SELECT dolt_commit('-m', $1)`,
      [`full-analysis: ${context.sourceId} — ${enhanceResult.warrantsCreated} warrants, ${classifyResult.summary.total} conflicts`],
    );
    const logResult = await client5.query(
      'SELECT commit_hash FROM dolt_log ORDER BY date DESC LIMIT 1',
    );
    commitHash = logResult.rows[0].commit_hash;
  } finally {
    client5.release();
  }

  steps.committing = { status: 'completed', detail: commitHash.slice(0, 8) };
  await updateStepProgress(input.batchId, 'committing', steps);

  return {
    totalSourceRecords: totalRecords,
    plantsMatched,
    plantsUnmatched: matchResult.summary.noMatch,
    matchSummary: matchResult.summary,
    warrantsCreated: enhanceResult.warrantsCreated,
    warrantsSkipped: enhanceResult.warrantsSkipped,
    warrantsFlagged: enhanceResult.warrantsFlagged,
    plantsCovered: enhanceResult.plantsCovered,
    attributesCovered: enhanceResult.attributesCovered,
    conflictsDetected: classifyResult.summary.total,
    conflictSummary: classifyResult.summary,
    commitHash,
  };
}

async function handleClassifyExisting(input: ClassifyExistingInput) {
  const steps: Record<string, { status: string; detail?: string }> = {
    classifying: { status: 'pending' },
    committing: { status: 'pending' },
  };

  // Step 1: Classify
  steps.classifying.status = 'running';
  await updateStepProgress(input.batchId, 'classifying', steps);

  const classifyResult = await classifyConflictFlow({
    mode: input.mode,
    plantIds: input.plantIds,
    attributeFilter: input.attributeFilter,
    batchId: input.batchId,
    runSpecialists: input.runSpecialists ?? false,
  });

  steps.classifying = {
    status: 'completed',
    detail: `${classifyResult.summary.total} conflicts classified`,
  };
  await updateStepProgress(input.batchId, 'classifying', steps);

  // Update batch stats
  const client1 = await doltPool.connect();
  try {
    await client1.query(
      'UPDATE analysis_batches SET conflicts_detected = $1 WHERE id = $2',
      [classifyResult.summary.total, input.batchId],
    );
  } finally {
    client1.release();
  }

  // Step 2: Dolt commit
  steps.committing.status = 'running';
  await updateStepProgress(input.batchId, 'committing', steps);

  const client2 = await doltPool.connect();
  let commitHash = '';
  try {
    await client2.query(`SELECT dolt_add('.')`);
    await client2.query(
      `SELECT dolt_commit('-m', $1)`,
      [`agent-ops: classify — ${classifyResult.summary.total} conflicts`],
    );
    const logResult = await client2.query(
      'SELECT commit_hash FROM dolt_log ORDER BY date DESC LIMIT 1',
    );
    commitHash = logResult.rows[0].commit_hash;
  } finally {
    client2.release();
  }

  steps.committing = { status: 'completed', detail: commitHash.slice(0, 8) };
  await updateStepProgress(input.batchId, 'committing', steps);

  return {
    conflictsDetected: classifyResult.summary.total,
    conflictSummary: classifyResult.summary,
    commitHash,
  };
}

async function handleBulkSynthesize(input: BulkSynthesizeInput) {
  const limit = input.limit ?? 100;
  const steps: Record<string, { status: string; detail?: string }> = {
    querying: { status: 'pending' },
    synthesizing: { status: 'pending' },
    writing: { status: 'pending' },
    committing: { status: 'pending' },
  };

  // Step 1: Find unsynthesized plant-attribute pairs
  steps.querying.status = 'running';
  await updateStepProgress(input.batchId, 'querying', steps);

  const client0 = await doltPool.connect();
  let pairs: Array<{
    plant_id: string;
    attribute_id: string;
    plant_name: string;
    attribute_name: string;
  }>;
  try {
    let pairsQuery = `
      SELECT w.plant_id, w.attribute_id,
             CONCAT(w.plant_genus, ' ', COALESCE(w.plant_species, '')) AS plant_name,
             w.attribute_name
      FROM warrants w
      LEFT JOIN claims c ON c.plant_id = w.plant_id AND c.attribute_id = w.attribute_id
      WHERE c.id IS NULL
        AND w.status != 'rejected'
    `;
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.plantIds && input.plantIds.length > 0) {
      const placeholders = input.plantIds.map(() => `$${paramIdx++}`).join(', ');
      pairsQuery += ` AND w.plant_id IN (${placeholders})`;
      params.push(...input.plantIds);
    }
    if (input.attributeFilter) {
      pairsQuery += ` AND w.attribute_name = $${paramIdx++}`;
      params.push(input.attributeFilter);
    }

    pairsQuery += `
      GROUP BY w.plant_id, w.attribute_id, w.plant_genus, w.plant_species, w.attribute_name
      HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC
      LIMIT $${paramIdx}
    `;
    params.push(limit);

    const result = await client0.query(pairsQuery, params);
    pairs = result.rows;
  } finally {
    client0.release();
  }

  steps.querying = { status: 'completed', detail: `${pairs.length} pairs found` };
  await updateStepProgress(input.batchId, 'querying', steps);

  if (pairs.length === 0) {
    // Nothing to synthesize
    steps.synthesizing = { status: 'completed', detail: 'No pairs to synthesize' };
    steps.writing = { status: 'completed', detail: 'Nothing to write' };
    steps.committing = { status: 'completed', detail: 'Skipped' };
    await updateStepProgress(input.batchId, 'committing', steps);
    return { claimsGenerated: 0, pairsProcessed: 0, pairsSkipped: 0, commitHash: '' };
  }

  // Step 2: Synthesize each pair
  steps.synthesizing.status = 'running';
  await updateStepProgress(input.batchId, 'synthesizing', steps);

  const synthResults: Array<{
    pair: typeof pairs[0];
    output: Awaited<ReturnType<typeof synthesizeClaimFlow>>;
    warrantIds: string[];
  }> = [];
  let pairsSkipped = 0;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    try {
      // Fetch warrants for this pair
      const client = await doltPool.connect();
      let warrants;
      let conflicts;
      let prodVal;
      try {
        const wResult = await client.query(
          `SELECT id, "value",
                  source_value AS "sourceValue", value_context AS "valueContext",
                  source_dataset AS "sourceDataset", source_id_code AS "sourceIdCode",
                  source_methodology AS "sourceMethodology", source_region AS "sourceRegion",
                  source_year AS "sourceYear", source_reliability AS "sourceReliability",
                  warrant_type AS "warrantType", match_confidence AS "matchConfidence"
           FROM warrants
           WHERE plant_id = $1 AND attribute_id = $2 AND status != 'rejected'
           ORDER BY source_dataset`,
          [pair.plant_id, pair.attribute_id],
        );
        warrants = wResult.rows;

        const cResult = await client.query(
          `SELECT id, conflict_type AS "conflictType", severity, status,
                  specialist_verdict AS "specialistVerdict",
                  specialist_analysis AS "specialistAnalysis",
                  specialist_recommendation AS "specialistRecommendation",
                  value_a AS "valueA", value_b AS "valueB",
                  source_a AS "sourceA", source_b AS "sourceB"
           FROM conflicts
           WHERE plant_id = $1 AND attribute_name = $2`,
          [pair.plant_id, pair.attribute_name],
        );
        conflicts = cResult.rows;

        const pvResult = await client.query(
          `SELECT "value" FROM "values" WHERE plant_id = $1 AND attribute_id = $2 LIMIT 1`,
          [pair.plant_id, pair.attribute_id],
        );
        prodVal = pvResult.rows[0]?.value ?? null;
      } finally {
        client.release();
      }

      if (warrants.length < 2) {
        pairsSkipped++;
        continue;
      }

      const output = await synthesizeClaimFlow({
        plantId: pair.plant_id,
        plantName: pair.plant_name.trim(),
        attributeId: pair.attribute_id,
        attributeName: pair.attribute_name,
        warrants,
        conflicts,
        productionValue: prodVal,
      });

      synthResults.push({
        pair,
        output,
        warrantIds: warrants.map((w: { id: string }) => w.id),
      });

      // Update progress periodically
      if ((i + 1) % 5 === 0 || i === pairs.length - 1) {
        steps.synthesizing.detail = `${synthResults.length} synthesized, ${pairsSkipped} skipped (${i + 1}/${pairs.length})`;
        await updateStepProgress(input.batchId, 'synthesizing', steps);
      }
    } catch (err) {
      console.error(`[bulk-synthesize] Error on pair ${pair.plant_id}/${pair.attribute_id}:`, err);
      pairsSkipped++;
    }
  }

  steps.synthesizing = {
    status: 'completed',
    detail: `${synthResults.length} synthesized, ${pairsSkipped} skipped`,
  };
  await updateStepProgress(input.batchId, 'synthesizing', steps);

  // Step 3: Write claims to DB
  steps.writing.status = 'running';
  await updateStepProgress(input.batchId, 'writing', steps);

  const client3 = await doltPool.connect();
  try {
    for (const { pair, output, warrantIds } of synthResults) {
      // Generate claim ID
      const idResult = await client3.query("SELECT gen_random_uuid()::text AS id");
      const claimId = idResult.rows[0].id;

      await client3.query(
        `INSERT INTO claims (
          id, status, plant_id, attribute_id, plant_name, attribute_name,
          categorical_value, synthesized_text, confidence, confidence_reasoning,
          warrant_count
        ) VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          claimId,
          pair.plant_id,
          pair.attribute_id,
          pair.plant_name.trim(),
          pair.attribute_name,
          output.categorical_value,
          output.synthesized_text,
          output.confidence,
          output.confidence_reasoning,
          warrantIds.length,
        ],
      );

      // Link warrants via claim_warrants junction table
      for (const wId of warrantIds) {
        const cwId = await client3.query("SELECT gen_random_uuid()::text AS id");
        await client3.query(
          `INSERT INTO claim_warrants (id, claim_id, warrant_id) VALUES ($1, $2, $3)`,
          [cwId.rows[0].id, claimId, wId],
        );
      }
    }
  } finally {
    client3.release();
  }

  steps.writing = { status: 'completed', detail: `${synthResults.length} claims written` };
  await updateStepProgress(input.batchId, 'writing', steps);

  // Update batch stats
  const clientStats = await doltPool.connect();
  try {
    await clientStats.query(
      'UPDATE analysis_batches SET claims_generated = $1 WHERE id = $2',
      [synthResults.length, input.batchId],
    );
  } finally {
    clientStats.release();
  }

  // Step 4: Dolt commit
  steps.committing.status = 'running';
  await updateStepProgress(input.batchId, 'committing', steps);

  const client4 = await doltPool.connect();
  let commitHash = '';
  try {
    await client4.query(`SELECT dolt_add('.')`);
    await client4.query(
      `SELECT dolt_commit('-m', $1)`,
      [`agent-ops: synthesize — ${synthResults.length} claims`],
    );
    const logResult = await client4.query(
      'SELECT commit_hash FROM dolt_log ORDER BY date DESC LIMIT 1',
    );
    commitHash = logResult.rows[0].commit_hash;
  } finally {
    client4.release();
  }

  steps.committing = { status: 'completed', detail: commitHash.slice(0, 8) };
  await updateStepProgress(input.batchId, 'committing', steps);

  return {
    claimsGenerated: synthResults.length,
    pairsProcessed: pairs.length,
    pairsSkipped,
    commitHash,
  };
}

// --- Main ---

async function main() {
  try {
    const raw = await readStdin();
    const input: BridgeInput = JSON.parse(raw);

    let result: unknown;
    switch (input.action) {
      case 'map':
        result = await handleMap(input);
        break;
      case 'match-and-preview':
        result = await handlePreview(input);
        break;
      case 'execute':
        result = await handleExecute(input);
        break;
      case 'full-analysis':
        result = await handleFullAnalysis(input);
        break;
      case 'classify-existing':
        result = await handleClassifyExisting(input);
        break;
      case 'bulk-synthesize':
        result = await handleBulkSynthesize(input);
        break;
      default:
        throw new Error(`Unknown action: ${(input as { action: string }).action}`);
    }

    process.stdout.write(JSON.stringify(result));
    process.exitCode = 0;
  } catch (err) {
    process.stderr.write(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    process.exitCode = 1;
  } finally {
    await doltPool.end();
  }
}

main();
