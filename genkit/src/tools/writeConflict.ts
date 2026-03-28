import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ai } from '../config.js';
import { doltPool } from './dolt.js';

const conflictInput = z.object({
  conflictType: z.string().describe('One of the 8 conflict types from CONFLICT-TAXONOMY.md'),
  conflictMode: z.enum(['internal', 'external', 'cross_source']),
  severity: z.enum(['critical', 'moderate', 'minor']),
  warrantAId: z.string(),
  warrantBId: z.string(),
  plantId: z.string(),
  plantName: z.string(),
  attributeName: z.string(),
  valueA: z.string(),
  valueB: z.string(),
  sourceA: z.string(),
  sourceB: z.string(),
  classifierExplanation: z.string(),
  specialistAgent: z.string().nullable().describe('Which specialist flow should review this'),
  batchId: z.string().optional(),
});

export type ConflictInput = z.infer<typeof conflictInput>;

const INSERT_SQL = `
  INSERT INTO conflicts (
    id, conflict_type, conflict_mode, severity, status,
    warrant_a_id, warrant_b_id,
    plant_id, plant_name, attribute_name,
    value_a, value_b, source_a, source_b,
    classifier_explanation, specialist_agent, batch_id
  ) VALUES (
    $1, $2, $3, $4, 'pending',
    $5, $6,
    $7, $8, $9,
    $10, $11, $12, $13,
    $14, $15, $16
  )`;

export const writeConflict = ai.defineTool(
  {
    name: 'writeConflict',
    description:
      'Inserts a single conflict record into the conflicts table. ' +
      'Links two disagreeing warrants with a classification and severity.',
    inputSchema: conflictInput,
    outputSchema: z.object({
      conflictId: z.string(),
      success: z.boolean(),
    }),
  },
  async (input) => {
    const id = randomUUID();
    try {
      await doltPool.query(INSERT_SQL, [
        id,
        input.conflictType,
        input.conflictMode,
        input.severity,
        input.warrantAId,
        input.warrantBId,
        input.plantId,
        input.plantName,
        input.attributeName,
        input.valueA,
        input.valueB,
        input.sourceA,
        input.sourceB,
        input.classifierExplanation,
        input.specialistAgent,
        input.batchId ?? null,
      ]);
      return { conflictId: id, success: true };
    } catch (err) {
      console.error('Failed to write conflict:', err);
      return { conflictId: '', success: false };
    }
  },
);

/**
 * Bulk-insert conflict records. Used by the flow for efficiency — not a Genkit tool.
 * Returns the IDs of successfully inserted conflicts.
 */
export async function writeConflictsBatch(conflicts: ConflictInput[]): Promise<string[]> {
  if (conflicts.length === 0) return [];

  const ids: string[] = [];
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const c of conflicts) {
    const id = randomUUID();
    ids.push(id);
    placeholders.push(
      `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, 'pending', ` +
        `$${paramIdx + 4}, $${paramIdx + 5}, ` +
        `$${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, ` +
        `$${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, ` +
        `$${paramIdx + 13}, $${paramIdx + 14}, $${paramIdx + 15})`,
    );
    values.push(
      id,
      c.conflictType,
      c.conflictMode,
      c.severity,
      c.warrantAId,
      c.warrantBId,
      c.plantId,
      c.plantName,
      c.attributeName,
      c.valueA,
      c.valueB,
      c.sourceA,
      c.sourceB,
      c.classifierExplanation,
      c.specialistAgent,
      c.batchId ?? null,
    );
    paramIdx += 16;
  }

  const sql = `
    INSERT INTO conflicts (
      id, conflict_type, conflict_mode, severity, status,
      warrant_a_id, warrant_b_id,
      plant_id, plant_name, attribute_name,
      value_a, value_b, source_a, source_b,
      classifier_explanation, specialist_agent, batch_id
    ) VALUES ${placeholders.join(', ')}`;

  await doltPool.query(sql, values);
  return ids;
}
