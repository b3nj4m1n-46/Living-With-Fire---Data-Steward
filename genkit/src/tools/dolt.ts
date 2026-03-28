import { z } from 'zod';
import { Pool } from 'pg';
import { ai } from '../config.js';

export const doltPool = new Pool({
  connectionString:
    process.env.DOLT_CONNECTION_STRING ||
    'postgresql://postgres:password@localhost:5433/lwf_staging',
});

export const queryDolt = ai.defineTool(
  {
    name: 'queryDolt',
    description:
      'Executes a parameterized SQL query against the DoltgreSQL staging database. ' +
      'IMPORTANT: The "values" table name must always be quoted because it is a PostgreSQL reserved word.',
    inputSchema: z.object({
      sql: z.string().describe('The SQL query to execute (use $1, $2, etc. for parameters)'),
      params: z
        .array(z.any())
        .optional()
        .describe('Query parameters for safe parameterized queries'),
    }),
    outputSchema: z.object({
      rows: z.array(z.any()),
      rowCount: z.number(),
    }),
  },
  async (input) => {
    const result = await doltPool.query(input.sql, input.params ?? []);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
    };
  },
);
