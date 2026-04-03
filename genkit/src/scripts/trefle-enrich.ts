/**
 * Trefle Enrichment — Query Trefle API for production plants and create warrants.
 *
 * Reads all 1,361 plants from production (Neon), queries Trefle's species
 * endpoint for each, maps Trefle fields to LWF attribute UUIDs, and writes
 * warrants directly into DoltgreSQL staging.
 *
 * Usage: npx tsx src/scripts/trefle-enrich.ts [--dry-run] [--limit N]
 * Requires:
 *   NEON_DATABASE_URL — production database
 *   TREFLE_TOKEN — API token for trefle.io
 *   DoltgreSQL running on port 5433
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { doltPool } from '../tools/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---

const TREFLE_BASE = 'https://trefle.io/api/v1';
const TREFLE_TOKEN = process.env.TREFLE_TOKEN;
const NEON_URL = process.env.NEON_DATABASE_URL;
const SOURCE_ID_CODE = 'TREFLE';
const BATCH_SIZE = 50; // warrants per DB insert batch
const API_DELAY_MS = 500; // 2 requests/sec — Trefle rate limit is 120/min

// --- LWF Attribute UUIDs ---

const ATTR = {
  // Native Status
  nativeStatus: {
    id: '716f3d8f-195f-4d16-824b-6dd1e88767a6',
    name: 'Native Status',
    allowed: [
      { id: 'oregon', display: 'Oregon' },
      { id: 's_oregon', display: 'S. Oregon' },
      { id: 'naturalized', display: 'Naturalized' },
      { id: 'coastal_oregon', display: 'Coastal Oregon' },
      { id: 'california', display: 'California' },
    ],
  },
  // Edible Plant (boolean)
  edible: {
    id: '4afa9fb3-dd3c-4f46-bd99-5b584dc10605',
    name: 'Edible Plant',
  },
  // Plant Structure booleans
  shrub: { id: 'ef9be401-1500-471b-bf8f-b11936d6d047', name: 'Shrub' },
  tree: { id: 'd5673c20-6fb7-49e3-b7e3-d056caf8d205', name: 'Tree' },
  vine: { id: 'eb566f0c-de5c-4981-9060-8ece5ab85997', name: 'Vine' },
  graminoid: { id: 'f1108fb9-e629-4be3-99c1-bdae47ce0cf7', name: 'Graminoid' },
  groundcover: { id: '82f68242-238f-4567-bb47-90da80b5c338', name: 'Groundcover' },
  deciduous: { id: 'fee87734-db6e-4c92-926f-bb606f529b6d', name: 'Deciduous' },
  evergreen: { id: 'f2ed9581-6d15-47ff-93c0-4259bccce5e1', name: 'Evergreen' },
  // Flower Color
  flowerColor: {
    id: '86a95833-886a-42bf-b149-c3754e9d913a',
    name: 'Flower Color',
    allowed: [
      { id: '01', display: 'White/Cream/Green', match: ['white', 'cream', 'green'] },
      { id: '02', display: 'Yellow/Gold', match: ['yellow', 'gold'] },
      { id: '03', display: 'Orange', match: ['orange'] },
      { id: '04', display: 'Pink/Rose/Red/Brown', match: ['pink', 'rose', 'red', 'brown'] },
      { id: '05', display: 'Purple/Lavender', match: ['purple', 'lavender', 'violet'] },
      { id: '06', display: 'Blue', match: ['blue'] },
    ],
  },
  // Habit/Form
  habitForm: {
    id: 'ce4ce677-b02f-4d7d-b7f3-10052b65c03a',
    name: 'Habit/Form',
  },
  // Leaf Structure
  leafStructure: {
    id: 'eebb5a89-20be-4338-adfb-91c829201909',
    name: 'Leaf Structure',
  },
} as const;

// --- Types ---

interface ProductionPlant {
  id: string;
  genus: string;
  species: string;
  common_name: string | null;
}

interface TrefleSpecies {
  id: number;
  common_name: string | null;
  scientific_name: string;
  edible: boolean | null;
  flower: { color: string[] | null; conspicuous: boolean | null } | null;
  foliage: {
    texture: string | null;
    color: string[] | null;
    leaf_retention: boolean | null;
  } | null;
  specifications: {
    growth_form: string | null;
    growth_habit: string[] | null;
    growth_rate: string | null;
  } | null;
  distribution: {
    native: string[] | null;
  } | null;
  duration: string[] | null;
}

interface WarrantRecord {
  plant_id: string;
  plant_genus: string;
  plant_species: string;
  attribute_id: string;
  attribute_name: string;
  value: string;
  source_value: string;
}

// --- Helpers ---

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTrefleSpecies(
  genus: string,
  species: string
): Promise<TrefleSpecies | null> {
  // Build slug: genus-species (lowercase, hyphenated)
  const slug = `${genus}-${species}`.toLowerCase().replace(/\s+/g, '-');
  const url = `${TREFLE_BASE}/species/${slug}?token=${TREFLE_TOKEN}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (res.status === 429) {
        // Rate limited — wait and retry
        const wait = (attempt + 1) * 5000;
        console.warn(`  Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        console.warn(`  Trefle ${res.status} for ${slug}`);
        return null;
      }
      const json = await res.json();
      return json.data as TrefleSpecies;
    } catch (err) {
      console.warn(`  Trefle error for ${slug}: ${err}`);
      return null;
    }
  }
  console.warn(`  Trefle gave up after 3 retries for ${slug}`);
  return null;
}

function mapNativeStatus(distribution: string[] | null): string[] {
  if (!distribution) return [];
  const values: string[] = [];
  const lower = distribution.map((d) => d.toLowerCase());

  if (lower.some((d) => d.includes('oregon'))) values.push('Oregon');
  if (lower.some((d) => d.includes('california'))) values.push('California');
  // Washington counts as Pacific West but isn't a direct LWF allowed value —
  // still useful as source_value context
  return values;
}

function mapFlowerColors(colors: string[] | null): { id: string; display: string }[] {
  if (!colors) return [];
  const matched: { id: string; display: string }[] = [];

  for (const color of colors) {
    const lower = color.toLowerCase();
    for (const allowed of ATTR.flowerColor.allowed) {
      if (allowed.match.some((m) => lower.includes(m))) {
        if (!matched.some((v) => v.id === allowed.id)) {
          matched.push({ id: allowed.id, display: allowed.display });
        }
      }
    }
  }
  return matched;
}

function mapGrowthHabits(
  habits: string[] | string | null
): { attrId: string; attrName: string; value: string }[] {
  if (!habits) return [];
  const habitArr = Array.isArray(habits) ? habits : [habits];
  const results: { attrId: string; attrName: string; value: string }[] = [];
  const lower = habitArr.map((h) => h.toLowerCase());

  if (lower.includes('tree')) results.push({ attrId: ATTR.tree.id, attrName: ATTR.tree.name, value: 'true' });
  if (lower.includes('shrub')) results.push({ attrId: ATTR.shrub.id, attrName: ATTR.shrub.name, value: 'true' });
  if (lower.includes('vine')) results.push({ attrId: ATTR.vine.id, attrName: ATTR.vine.name, value: 'true' });
  if (lower.some((h) => h.includes('graminoid') || h.includes('grass')))
    results.push({ attrId: ATTR.graminoid.id, attrName: ATTR.graminoid.name, value: 'true' });
  if (lower.some((h) => h.includes('subshrub') || h.includes('ground')))
    results.push({ attrId: ATTR.groundcover.id, attrName: ATTR.groundcover.name, value: 'true' });

  return results;
}

function mapLeafRetention(
  foliage: TrefleSpecies['foliage']
): { attrId: string; attrName: string; value: string }[] {
  if (!foliage?.leaf_retention) return [];
  // leaf_retention: true = evergreen, false = deciduous
  if (foliage.leaf_retention === true) {
    return [{ attrId: ATTR.evergreen.id, attrName: ATTR.evergreen.name, value: 'true' }];
  }
  return [{ attrId: ATTR.deciduous.id, attrName: ATTR.deciduous.name, value: 'true' }];
}

function buildWarrants(
  plant: ProductionPlant,
  trefle: TrefleSpecies
): WarrantRecord[] {
  const warrants: WarrantRecord[] = [];
  const base = {
    plant_id: plant.id,
    plant_genus: plant.genus,
    plant_species: plant.species,
  };

  // 1. Native Status
  const nativeRegions = mapNativeStatus(trefle.distribution?.native ?? null);
  for (const region of nativeRegions) {
    const allowed = ATTR.nativeStatus.allowed.find(
      (a) => a.display.toLowerCase() === region.toLowerCase()
    );
    if (allowed) {
      warrants.push({
        ...base,
        attribute_id: ATTR.nativeStatus.id,
        attribute_name: ATTR.nativeStatus.name,
        value: allowed.id,
        source_value: `Native to: ${(trefle.distribution?.native ?? []).join(', ')}`,
      });
    }
  }

  // 2. Edible
  if (trefle.edible === true || trefle.edible === false) {
    warrants.push({
      ...base,
      attribute_id: ATTR.edible.id,
      attribute_name: ATTR.edible.name,
      value: String(trefle.edible),
      source_value: `edible: ${trefle.edible}`,
    });
  }

  // 3. Growth habit → Plant Structure booleans
  const habits = mapGrowthHabits(trefle.specifications?.growth_habit ?? null);
  for (const h of habits) {
    warrants.push({
      ...base,
      attribute_id: h.attrId,
      attribute_name: h.attrName,
      value: h.value,
      source_value: `growth_habit: ${[trefle.specifications?.growth_habit].flat().filter(Boolean).join(', ')}`,
    });
  }

  // 4. Leaf retention → Deciduous/Evergreen
  const retention = mapLeafRetention(trefle.foliage ?? null);
  for (const r of retention) {
    warrants.push({
      ...base,
      attribute_id: r.attrId,
      attribute_name: r.attrName,
      value: r.value,
      source_value: `leaf_retention: ${trefle.foliage?.leaf_retention}`,
    });
  }

  // 5. Flower Color
  const colors = mapFlowerColors(trefle.flower?.color ?? null);
  for (const c of colors) {
    warrants.push({
      ...base,
      attribute_id: ATTR.flowerColor.id,
      attribute_name: ATTR.flowerColor.name,
      value: c.id,
      source_value: `flower.color: ${(trefle.flower?.color ?? []).join(', ')}`,
    });
  }

  return warrants;
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

  if (!TREFLE_TOKEN) {
    console.error('Error: TREFLE_TOKEN environment variable required');
    console.error('Add to .env: TREFLE_TOKEN=usr-NGRjYdW2...');
    process.exitCode = 1;
    return;
  }

  if (!NEON_URL) {
    console.error('Error: NEON_DATABASE_URL environment variable required');
    process.exitCode = 1;
    return;
  }

  console.log(`\n=== Trefle Enrichment ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (limit) console.log(`Limit: ${limit} plants`);
  console.log();

  // 1. Fetch all production plants
  const prodPool = new Pool({
    connectionString: NEON_URL,
    ssl: { rejectUnauthorized: true },
  });

  const plantQuery = limit
    ? `SELECT id, genus, species, common_name FROM plants ORDER BY genus, species LIMIT ${limit}`
    : `SELECT id, genus, species, common_name FROM plants ORDER BY genus, species`;

  const { rows: plants } = await prodPool.query<ProductionPlant>(plantQuery);
  console.log(`Loaded ${plants.length} plants from production\n`);

  // 2. Create batch record in Dolt (skip connection in dry-run)
  const batchId = crypto.randomUUID();
  let doltClient: import('pg').PoolClient | null = null;

  if (!dryRun) {
    doltClient = await doltPool.connect();
    await doltClient.query('BEGIN');
    await doltClient.query(
      `INSERT INTO analysis_batches (id, source_dataset, source_id_code, batch_type, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [batchId, 'trefle.io', SOURCE_ID_CODE, 'api_enrichment', 'running']
    );
    await doltClient.query('COMMIT');
  }
  console.log(`Batch ID: ${batchId}\n`);

  // 3. Query Trefle for each plant and collect warrants
  let trefleHits = 0;
  let trefleMisses = 0;
  let totalWarrants = 0;
  const allWarrants: WarrantRecord[] = [];

  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];
    const species = plant.species?.replace(/\s*spp\.?\s*$/, '').trim();

    // Skip genus-only entries (no species to look up)
    if (!species || species === '' || species.includes('spp')) {
      trefleMisses++;
      continue;
    }

    const trefle = await fetchTrefleSpecies(plant.genus, species);

    if (trefle) {
      trefleHits++;
      const warrants = buildWarrants(plant, trefle);
      if (warrants.length > 0) {
        allWarrants.push(...warrants);
        totalWarrants += warrants.length;
      }
    } else {
      trefleMisses++;
    }

    // Progress
    if ((i + 1) % 50 === 0 || i === plants.length - 1) {
      console.log(
        `  Progress: ${i + 1}/${plants.length} | Hits: ${trefleHits} | Misses: ${trefleMisses} | Warrants: ${totalWarrants}`
      );
    }

    // Rate limiting
    await sleep(API_DELAY_MS);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Trefle hits: ${trefleHits} / ${plants.length}`);
  console.log(`Total warrants to create: ${allWarrants.length}`);

  // Breakdown by attribute
  const byCat: Record<string, number> = {};
  for (const w of allWarrants) {
    byCat[w.attribute_name] = (byCat[w.attribute_name] ?? 0) + 1;
  }
  for (const [name, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  if (dryRun) {
    console.log('\nDry run — no warrants written to Dolt.');
    // Show sample warrants
    console.log('\nSample warrants (first 5):');
    for (const w of allWarrants.slice(0, 5)) {
      console.log(`  ${w.plant_genus} ${w.plant_species} → ${w.attribute_name}: ${w.value} (${w.source_value})`);
    }
  } else {
    // 4. Write warrants to Dolt in batches
    console.log(`\nWriting ${allWarrants.length} warrants to Dolt...`);

    try {
      await doltClient!.query('BEGIN');

      for (let i = 0; i < allWarrants.length; i += BATCH_SIZE) {
        const batch = allWarrants.slice(i, i + BATCH_SIZE);
        const placeholders: string[] = [];
        const params: unknown[] = [];
        let paramIdx = 1;

        for (const w of batch) {
          const warrantId = crypto.randomUUID();
          placeholders.push(
            `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12})`
          );
          params.push(
            warrantId,          // id
            'external',         // warrant_type
            'unreviewed',       // status
            w.plant_id,         // plant_id
            w.plant_genus,      // plant_genus
            w.plant_species,    // plant_species
            w.attribute_id,     // attribute_id
            w.attribute_name,   // attribute_name
            w.value,            // value
            w.source_value,     // source_value
            SOURCE_ID_CODE,     // source_id_code
            'exact',            // match_method
            batchId,            // batch_id
          );
          paramIdx += 13;
        }

        await doltClient!.query(
          `INSERT INTO warrants (
            id, warrant_type, status,
            plant_id, plant_genus, plant_species,
            attribute_id, attribute_name,
            "value", source_value,
            source_id_code,
            match_method, batch_id
          ) VALUES ${placeholders.join(', ')}`,
          params
        );

        const inserted = Math.min(i + BATCH_SIZE, allWarrants.length);
        if (inserted % 200 === 0 || inserted === allWarrants.length) {
          console.log(`  Inserted ${inserted} / ${allWarrants.length}`);
        }
      }

      // Update batch record
      await doltClient!.query(
        `UPDATE analysis_batches
         SET status = $1, total_source_records = $2, plants_matched = $3, warrants_created = $4,
             completed_at = NOW()
         WHERE id = $5`,
        ['completed', plants.length, trefleHits, allWarrants.length, batchId]
      );

      await doltClient!.query('COMMIT');

      // Dolt commit
      await doltClient!.query(`SELECT dolt_add('.')`);
      const commitResult = await doltClient!.query(
        `SELECT dolt_commit('-m', $1)`,
        [`Trefle enrichment: ${allWarrants.length} warrants for ${trefleHits} plants`]
      );
      const commitRow = commitResult.rows[0];
      const commitHash = typeof commitRow === 'object'
        ? String(Object.values(commitRow as Record<string, unknown>)[0])
        : String(commitRow);

      console.log(`\nDolt commit: ${commitHash}`);
    } catch (err) {
      await doltClient!.query('ROLLBACK');
      console.error('Failed to write warrants:', err);
      process.exitCode = 1;
    }
  }

  console.log('\nDone.');
  if (doltClient) doltClient.release();
  await prodPool.end();
  if (!dryRun) await doltPool.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
