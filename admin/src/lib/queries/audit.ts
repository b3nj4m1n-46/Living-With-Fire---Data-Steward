import crypto from "node:crypto";
import { queryProd } from "@/lib/production";
import { query } from "@/lib/dolt";

// ── Interfaces ──────────────────────────────────────────────────────────

export interface AuditResults {
  disagreements_found: number;
  validation_failures: number;
  missing_provenance: number;
  warrants_created: number;
  conflicts_created: number;
}

interface DisagreementRow {
  plant_id: string;
  attribute_id: string;
  value: string;
  source_value: string | null;
  source_id: string;
  genus: string;
  species: string;
  attribute_name: string;
}

interface ValidationRow {
  id: string;
  plant_id: string;
  attribute_id: string;
  value: string;
  source_id: string | null;
  genus: string;
  species: string;
  attribute_name: string;
  values_allowed: string | unknown[];
}

interface MissingProvenanceRow {
  id: string;
  plant_id: string;
  attribute_id: string;
  value: string;
  genus: string;
  species: string;
  attribute_name: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const WARRANT_COLS = `(id, warrant_type, status, plant_id, plant_genus, plant_species, attribute_id, attribute_name, "value", source_value, source_id, source_dataset, source_id_code, batch_id, admin_notes)`;

function warrantParams(
  w: {
    plantId: string;
    genus: string;
    species: string;
    attributeId: string;
    attributeName: string;
    value: string;
    sourceValue: string | null;
    sourceId: string | null;
    batchId: string;
    notes: string | null;
  },
  offset: number
): { placeholders: string; values: unknown[] } {
  const id = crypto.randomUUID();
  const values = [
    id,
    "internal_audit",
    "unreviewed",
    w.plantId,
    w.genus,
    w.species,
    w.attributeId,
    w.attributeName,
    w.value,
    w.sourceValue,
    w.sourceId,
    "production",
    "INTERNAL_AUDIT",
    w.batchId,
    w.notes,
  ];
  const placeholders = values
    .map((_, i) => `$${offset + i + 1}`)
    .join(", ");
  return { placeholders: `(${placeholders})`, values };
}

async function batchInsertWarrants(
  rows: Parameters<typeof warrantParams>[0][]
): Promise<string[]> {
  const ids: string[] = [];
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const allValues: unknown[] = [];
    const allPlaceholders: string[] = [];
    for (const row of chunk) {
      const { placeholders, values } = warrantParams(row, allValues.length);
      allPlaceholders.push(placeholders);
      allValues.push(...values);
      ids.push(values[0] as string);
    }
    await query(
      `INSERT INTO warrants ${WARRANT_COLS} VALUES ${allPlaceholders.join(", ")}`,
      allValues
    );
  }
  return ids;
}

const CONFLICT_COLS = `(id, conflict_type, conflict_mode, severity, status, warrant_a_id, warrant_b_id, plant_id, plant_name, attribute_name, value_a, value_b, source_a, source_b, classifier_explanation, batch_id)`;

async function batchInsertConflicts(
  rows: {
    warrantAId: string;
    warrantBId: string;
    plantId: string;
    plantName: string;
    attributeName: string;
    valueA: string;
    valueB: string;
    sourceA: string;
    sourceB: string;
    batchId: string;
  }[]
): Promise<number> {
  const CHUNK = 100;
  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const allValues: unknown[] = [];
    const allPlaceholders: string[] = [];
    for (const r of chunk) {
      const id = crypto.randomUUID();
      const vals = [
        id,
        "value_disagreement",
        "internal",
        "moderate",
        "pending",
        r.warrantAId,
        r.warrantBId,
        r.plantId,
        r.plantName,
        r.attributeName,
        r.valueA,
        r.valueB,
        r.sourceA,
        r.sourceB,
        "Internal audit: multiple sources disagree on value",
        r.batchId,
      ];
      const ph = vals
        .map((_, j) => `$${allValues.length + j + 1}`)
        .join(", ");
      allPlaceholders.push(`(${ph})`);
      allValues.push(...vals);
    }
    await query(
      `INSERT INTO conflicts ${CONFLICT_COLS} VALUES ${allPlaceholders.join(", ")}`,
      allValues
    );
    created += chunk.length;
  }
  return created;
}

// ── Dedup: fetch existing audit warrant keys ────────────────────────────

async function existingAuditKeys(
  batchId: string
): Promise<Set<string>> {
  const rows = await query<{
    plant_id: string;
    attribute_id: string;
    value: string;
  }>(
    `SELECT plant_id, attribute_id, "value" FROM warrants WHERE warrant_type = 'internal_audit'`
  );
  return new Set(rows.map((r) => `${r.plant_id}|${r.attribute_id}|${r.value}`));
}

// ── Main Audit ──────────────────────────────────────────────────────────

export async function runInternalAudit(
  batchId: string
): Promise<AuditResults> {
  const existing = await existingAuditKeys(batchId);
  let warrantsCreated = 0;
  let conflictsCreated = 0;

  // ── Step 1: Multi-source disagreement scan ────────────────────────────

  const disagreementRows = await queryProd<DisagreementRow>(
    `WITH disagreements AS (
       SELECT plant_id, attribute_id
       FROM "values"
       WHERE source_id IS NOT NULL
       GROUP BY plant_id, attribute_id
       HAVING COUNT(DISTINCT "value") > 1 AND COUNT(DISTINCT source_id) > 1
     )
     SELECT v.plant_id, v.attribute_id, v."value", v.source_value, v.source_id,
            p.genus, p.species, a.name AS attribute_name
     FROM "values" v
     JOIN disagreements d ON d.plant_id = v.plant_id AND d.attribute_id = v.attribute_id
     JOIN plants p ON p.id = v.plant_id
     JOIN attributes a ON a.id = v.attribute_id
     WHERE v.source_id IS NOT NULL
     ORDER BY v.plant_id, v.attribute_id, v.source_id`
  );

  // Group by plant_id + attribute_id
  const groups = new Map<string, DisagreementRow[]>();
  for (const row of disagreementRows) {
    const key = `${row.plant_id}|${row.attribute_id}`;
    const arr = groups.get(key) ?? [];
    arr.push(row);
    groups.set(key, arr);
  }

  const disagreementsFound = groups.size;

  // Create warrants + conflicts for each disagreement group
  const warrantQueue: Parameters<typeof warrantParams>[0][] = [];
  const conflictQueue: Parameters<typeof batchInsertConflicts>[0][number][] =
    [];
  // Track warrant IDs per group for conflict creation
  const groupWarrantIds = new Map<string, { id: string; value: string; sourceId: string }[]>();

  for (const [groupKey, rows] of groups) {
    // Deduplicate: only create warrants for values not already in Dolt
    const newRows: DisagreementRow[] = [];
    for (const r of rows) {
      const dedupKey = `${r.plant_id}|${r.attribute_id}|${r.value}`;
      if (!existing.has(dedupKey)) {
        newRows.push(r);
        existing.add(dedupKey); // prevent intra-batch dups
      }
    }

    const warrantIds: { id: string; value: string; sourceId: string }[] = [];
    for (const r of newRows) {
      const wId = crypto.randomUUID();
      warrantQueue.push({
        plantId: r.plant_id,
        genus: r.genus,
        species: r.species,
        attributeId: r.attribute_id,
        attributeName: r.attribute_name,
        value: r.value,
        sourceValue: r.source_value,
        sourceId: r.source_id,
        batchId,
        notes: null,
      });
      warrantIds.push({ id: wId, value: r.value, sourceId: r.source_id });
    }
    groupWarrantIds.set(groupKey, warrantIds);
  }

  // Batch insert all disagreement warrants and capture returned IDs
  const insertedWarrantIds = await batchInsertWarrants(warrantQueue);
  warrantsCreated += insertedWarrantIds.length;

  // Map warrant queue indices to inserted IDs for conflict creation
  let warrantIdx = 0;
  for (const [groupKey, rows] of groups) {
    const sample = rows[0];
    const wIds = groupWarrantIds.get(groupKey) ?? [];
    // Re-map to actual inserted IDs
    const mappedIds: { id: string; value: string; sourceId: string }[] = [];
    for (const w of wIds) {
      if (warrantIdx < insertedWarrantIds.length) {
        mappedIds.push({
          id: insertedWarrantIds[warrantIdx],
          value: w.value,
          sourceId: w.sourceId,
        });
        warrantIdx++;
      }
    }

    // Create one conflict per group using first two warrants
    if (mappedIds.length >= 2) {
      conflictQueue.push({
        warrantAId: mappedIds[0].id,
        warrantBId: mappedIds[1].id,
        plantId: sample.plant_id,
        plantName: `${sample.genus} ${sample.species}`,
        attributeName: sample.attribute_name,
        valueA: mappedIds[0].value,
        valueB: mappedIds[1].value,
        sourceA: mappedIds[0].sourceId,
        sourceB: mappedIds[1].sourceId,
        batchId,
      });
    }
  }

  conflictsCreated += await batchInsertConflicts(conflictQueue);

  // ── Step 2: Value validation scan ─────────────────────────────────────

  const validationRows = await queryProd<ValidationRow>(
    `SELECT v.id, v.plant_id, v.attribute_id, v."value", v.source_id,
            p.genus, p.species, a.name AS attribute_name, a.values_allowed
     FROM "values" v
     JOIN plants p ON p.id = v.plant_id
     JOIN attributes a ON a.id = v.attribute_id
     WHERE a.values_allowed IS NOT NULL
       AND a.values_allowed::text != 'null'
       AND a.values_allowed::text != '""'
       AND length(a.values_allowed::text) > 2
       AND v."value" IS NOT NULL`
  );

  const validationWarrants: Parameters<typeof warrantParams>[0][] = [];
  let validationFailures = 0;

  for (const r of validationRows) {
    // values_allowed is a JSON array of {displayName: string, ...} objects
    let allowedItems: { displayName?: string; id?: string }[];
    try {
      const raw = typeof r.values_allowed === "string"
        ? JSON.parse(r.values_allowed)
        : r.values_allowed;
      allowedItems = Array.isArray(raw) ? raw : [];
    } catch {
      continue; // skip rows with malformed JSON
    }
    const allowed = allowedItems
      .map((item) => (item.displayName ?? item.id ?? "").trim().toLowerCase())
      .filter(Boolean);
    if (allowed.length === 0) continue;
    const val = r.value.trim().toLowerCase();
    if (val && !allowed.includes(val)) {
      const dedupKey = `${r.plant_id}|${r.attribute_id}|${r.value}`;
      if (!existing.has(dedupKey)) {
        existing.add(dedupKey);
        validationFailures++;
        validationWarrants.push({
          plantId: r.plant_id,
          genus: r.genus,
          species: r.species,
          attributeId: r.attribute_id,
          attributeName: r.attribute_name,
          value: r.value,
          sourceValue: null,
          sourceId: r.source_id,
          batchId,
          notes: `Value validation failure: "${r.value}" not in allowed set [${allowed.join(", ")}]`,
        });
      }
    }
  }

  const valIds = await batchInsertWarrants(validationWarrants);
  warrantsCreated += valIds.length;

  // ── Step 3: Missing provenance scan ───────────────────────────────────

  const missingRows = await queryProd<MissingProvenanceRow>(
    `SELECT v.id, v.plant_id, v.attribute_id, v."value",
            p.genus, p.species, a.name AS attribute_name
     FROM "values" v
     JOIN plants p ON p.id = v.plant_id
     JOIN attributes a ON a.id = v.attribute_id
     WHERE v.source_id IS NULL`
  );

  const missingWarrants: Parameters<typeof warrantParams>[0][] = [];

  for (const r of missingRows) {
    const dedupKey = `${r.plant_id}|${r.attribute_id}|${r.value}`;
    if (!existing.has(dedupKey)) {
      existing.add(dedupKey);
      missingWarrants.push({
        plantId: r.plant_id,
        genus: r.genus,
        species: r.species,
        attributeId: r.attribute_id,
        attributeName: r.attribute_name,
        value: r.value ?? "",
        sourceValue: null,
        sourceId: null,
        batchId,
        notes: "Missing provenance: value has no source_id",
      });
    }
  }

  const missingIds = await batchInsertWarrants(missingWarrants);
  warrantsCreated += missingIds.length;

  return {
    disagreements_found: disagreementsFound,
    validation_failures: validationFailures,
    missing_provenance: missingWarrants.length,
    warrants_created: warrantsCreated,
    conflicts_created: conflictsCreated,
  };
}
