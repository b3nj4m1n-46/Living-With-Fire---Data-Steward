import { z } from 'zod';
import { ai } from '../config.js';
import { doltPool } from './dolt.js';

const sourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string().nullable(),
  region: z.string().nullable(),
  target_location: z.string().nullable(),
  topics_addressed: z.string().nullable(),
  attribution: z.string().nullable(),
  ref_code: z.string().nullable(),
  file_link: z.string().nullable(),
});

export const getSourceMetadata = ai.defineTool(
  {
    name: 'getSourceMetadata',
    description:
      'Returns metadata about a production source by UUID or by name pattern (case-insensitive).',
    inputSchema: z.object({
      sourceId: z.string().optional().describe('Source UUID to look up directly'),
      sourceName: z
        .string()
        .optional()
        .describe('Partial source name to search for (case-insensitive)'),
    }),
    outputSchema: sourceSchema.nullable(),
  },
  async (input) => {
    let result;

    if (input.sourceId) {
      result = await doltPool.query('SELECT * FROM sources WHERE id = $1', [
        input.sourceId,
      ]);
    } else if (input.sourceName) {
      result = await doltPool.query(
        `SELECT * FROM sources WHERE LOWER(name) LIKE LOWER(CONCAT('%', $1, '%')) LIMIT 1`,
        [input.sourceName],
      );
    } else {
      return null;
    }

    if (!result.rows.length) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      url: row.url ?? null,
      address: row.address ?? null,
      phone: row.phone ?? null,
      notes: row.notes ?? null,
      region: row.region ?? null,
      target_location: row.target_location ?? null,
      topics_addressed: row.topics_addressed ?? null,
      attribution: row.attribution ?? null,
      ref_code: row.ref_code ?? null,
      file_link: row.file_link ?? null,
    };
  },
);
