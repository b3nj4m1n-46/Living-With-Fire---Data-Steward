/**
 * Smoke test for all Genkit shared tools.
 * Requires DoltgreSQL running on port 5433 with lwf_staging database.
 * Anthropic API test is skipped if ANTHROPIC_API_KEY is not set.
 *
 * Usage: npx tsx src/test-tools.ts
 */
import { ai, MODELS } from './config.js';
import {
  queryDolt,
  getDatasetContext,
  lookupProductionPlant,
  getSourceMetadata,
  doltPool,
} from './tools/index.js';

let passed = 0;
let failed = 0;

function pass(label: string, detail?: string) {
  console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  passed++;
}

function fail(label: string, detail: string) {
  console.log(`  FAIL  ${label} — ${detail}`);
  failed++;
}

// --- Test 1: queryDolt — plant count ---
async function testQueryDoltPlants() {
  const label = 'queryDolt: plant count';
  try {
    const result = await queryDolt({ sql: 'SELECT COUNT(*) AS cnt FROM plants' });
    const cnt = Number(result.rows[0].cnt);
    if (cnt === 1361) pass(label, `${cnt} plants`);
    else fail(label, `expected 1361, got ${cnt}`);
  } catch (e) {
    fail(label, (e as Error).message);
  }
}

// --- Test 2: queryDolt — values count (quoted table) ---
async function testQueryDoltValues() {
  const label = 'queryDolt: values count';
  try {
    const result = await queryDolt({ sql: 'SELECT COUNT(*) AS cnt FROM "values"' });
    const cnt = Number(result.rows[0].cnt);
    if (cnt === 94903) pass(label, `${cnt} values`);
    else fail(label, `expected 94903, got ${cnt}`);
  } catch (e) {
    fail(label, (e as Error).message);
  }
}

// --- Test 3: getDatasetContext ---
async function testDatasetContext() {
  const label = 'getDatasetContext: FirePerformancePlants';
  try {
    const ctx = await getDatasetContext({
      datasetFolder: 'database-sources/fire/FirePerformancePlants',
    });
    const checks = [
      ctx.sourceId === 'FIRE-01',
      ctx.readme.length > 0,
      ctx.dataDictionary.includes('firewise_rating'),
    ];
    if (checks.every(Boolean)) pass(label, `sourceId=${ctx.sourceId}`);
    else fail(label, `sourceId=${ctx.sourceId}, readme=${ctx.readme.length}chars, dict has firewise_rating=${ctx.dataDictionary.includes('firewise_rating')}`);
  } catch (e) {
    fail(label, (e as Error).message);
  }
}

// --- Test 4: lookupProductionPlant ---
async function testLookupPlant() {
  const label = 'lookupProductionPlant: Ceanothus velutinus';
  try {
    const result = await lookupProductionPlant({
      genus: 'Ceanothus',
      species: 'velutinus',
    });
    if (result.plant && result.values.length > 0) {
      pass(label, `${result.values.length} values, matchCount=${result.matchCount}`);
    } else {
      fail(label, `plant=${!!result.plant}, values=${result.values.length}`);
    }
  } catch (e) {
    fail(label, (e as Error).message);
  }
}

// --- Test 5: getSourceMetadata ---
async function testSourceMetadata() {
  const label = 'getSourceMetadata: search by name';
  try {
    // Search for any source — use a broad term
    const result = await getSourceMetadata({ sourceName: 'Ashland' });
    if (result && result.name) {
      pass(label, `found "${result.name}"`);
    } else {
      // Try a fallback search if Ashland doesn't exist
      const fallback = await getSourceMetadata({ sourceName: 'Oregon' });
      if (fallback && fallback.name) {
        pass(label, `found "${fallback.name}" (fallback search)`);
      } else {
        fail(label, 'no source found for "Ashland" or "Oregon"');
      }
    }
  } catch (e) {
    fail(label, (e as Error).message);
  }
}

// --- Test 6: Anthropic API (conditional) ---
async function testAnthropicApi() {
  const label = 'Anthropic API: connectivity';
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(`  SKIP  ${label} — ANTHROPIC_API_KEY not set`);
    return;
  }
  try {
    const response = await ai.generate({
      model: MODELS.bulk,
      prompt: 'Reply with just the word "connected"',
    });
    const text = response.text.toLowerCase();
    if (text.includes('connected')) pass(label);
    else fail(label, `response: "${response.text}"`);
  } catch (e) {
    fail(label, (e as Error).message);
  }
}

// --- Run all tests sequentially ---
async function main() {
  console.log('\n=== LWF Genkit Tools — Smoke Test ===\n');

  await testQueryDoltPlants();
  await testQueryDoltValues();
  await testDatasetContext();
  await testLookupPlant();
  await testSourceMetadata();
  await testAnthropicApi();

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);

  await doltPool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main();
