import { z } from 'zod';
import { ai } from '../config.js';
import { doltPool } from './dolt.js';

const warrantDetail = z.object({
  id: z.string(),
  value: z.string(),
  sourceValue: z.string().nullable(),
  sourceId: z.string().nullable(),
  sourceDataset: z.string(),
  sourceIdCode: z.string(),
  sourceMethodology: z.string().nullable(),
  sourceRegion: z.string().nullable(),
  warrantType: z.string(),
  matchConfidence: z.number(),
});

const warrantGroup = z.object({
  plantId: z.string(),
  plantGenus: z.string(),
  plantSpecies: z.string().nullable(),
  attributeId: z.string(),
  attributeName: z.string(),
  warrantCount: z.number(),
  warrants: z.array(warrantDetail),
});

export const getWarrantGroups = ai.defineTool(
  {
    name: 'getWarrantGroups',
    description:
      'Finds groups of warrants that share the same plant+attribute — these are conflict candidates. ' +
      'Returns warrant groups with full details for each warrant in the group.',
    inputSchema: z.object({
      mode: z
        .enum(['internal', 'external', 'all'])
        .describe("'internal' = existing production warrants, 'external' = new dataset warrants, 'all' = both"),
      plantIds: z.array(z.string()).optional().describe('Filter to specific plant IDs'),
      attributeFilter: z.string().optional().describe('Filter by attribute name pattern (SQL LIKE)'),
      minGroupSize: z.number().optional().describe('Minimum warrants per group (default 2)'),
      limit: z.number().optional().describe('Max groups to return (default 500)'),
      offset: z.number().optional().describe('Offset for pagination (default 0)'),
    }),
    outputSchema: z.object({
      groups: z.array(warrantGroup),
      totalGroups: z.number(),
    }),
  },
  async (input) => {
    const minGroupSize = input.minGroupSize ?? 2;
    const limit = input.limit ?? 500;
    const offset = input.offset ?? 0;

    // Build dynamic WHERE clause
    const conditions: string[] = ["status != 'excluded'"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (input.mode === 'internal') {
      conditions.push(`warrant_type = $${paramIdx++}`);
      params.push('existing');
    } else if (input.mode === 'external') {
      conditions.push(`warrant_type = $${paramIdx++}`);
      params.push('external');
    }

    if (input.plantIds && input.plantIds.length > 0) {
      conditions.push(`plant_id = ANY($${paramIdx++})`);
      params.push(input.plantIds);
    }

    if (input.attributeFilter) {
      conditions.push(`attribute_name ILIKE $${paramIdx++}`);
      params.push(`%${input.attributeFilter}%`);
    }

    const whereClause = conditions.join(' AND ');

    // Phase 1: Count total groups (for pagination info)
    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT plant_id, attribute_id
        FROM warrants
        WHERE ${whereClause}
        GROUP BY plant_id, attribute_id
        HAVING COUNT(*) >= $${paramIdx}
      ) AS grouped`;
    const countResult = await doltPool.query(countSql, [...params, minGroupSize]);
    const totalGroups = parseInt(countResult.rows[0]?.total ?? '0', 10);

    if (totalGroups === 0) {
      return { groups: [], totalGroups: 0 };
    }

    // Phase 1b: Fetch group keys
    const groupSql = `
      SELECT plant_id, attribute_id, plant_genus, plant_species, attribute_name, COUNT(*) AS cnt
      FROM warrants
      WHERE ${whereClause}
      GROUP BY plant_id, attribute_id, plant_genus, plant_species, attribute_name
      HAVING COUNT(*) >= $${paramIdx}
      ORDER BY cnt DESC
      LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}`;
    const groupResult = await doltPool.query(groupSql, [...params, minGroupSize, limit, offset]);

    // Phase 2: Fetch warrant details, batched 50 groups at a time
    const BATCH_SIZE = 50;
    const groups: z.infer<typeof warrantGroup>[] = [];

    for (let i = 0; i < groupResult.rows.length; i += BATCH_SIZE) {
      const batch = groupResult.rows.slice(i, i + BATCH_SIZE);

      const detailPromises = batch.map(async (group: Record<string, unknown>) => {
        const detailSql = `
          SELECT id, "value", source_value, source_id, source_dataset, source_id_code,
                 source_methodology, source_region, warrant_type, match_confidence
          FROM warrants
          WHERE plant_id = $1 AND attribute_id = $2 AND status != 'excluded'
          ORDER BY source_id_code`;
        const detailResult = await doltPool.query(detailSql, [group.plant_id, group.attribute_id]);

        return {
          plantId: group.plant_id as string,
          plantGenus: group.plant_genus as string,
          plantSpecies: (group.plant_species as string) || null,
          attributeId: group.attribute_id as string,
          attributeName: group.attribute_name as string,
          warrantCount: parseInt(group.cnt as string, 10),
          warrants: detailResult.rows.map((w: Record<string, unknown>) => ({
            id: w.id as string,
            value: w.value as string,
            sourceValue: (w.source_value as string) || null,
            sourceId: (w.source_id as string) || null,
            sourceDataset: (w.source_dataset as string) || '',
            sourceIdCode: (w.source_id_code as string) || '',
            sourceMethodology: (w.source_methodology as string) || null,
            sourceRegion: (w.source_region as string) || null,
            warrantType: w.warrant_type as string,
            matchConfidence: parseFloat(String(w.match_confidence ?? '1')),
          })),
        };
      });

      const batchResults = await Promise.all(detailPromises);
      groups.push(...batchResults);
    }

    return { groups, totalGroups };
  },
);
