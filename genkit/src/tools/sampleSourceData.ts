import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai } from '../config.js';
import { parseCSV } from '../utils/csv.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

export const sampleSourceData = ai.defineTool(
  {
    name: 'sampleSourceData',
    description:
      'Reads a source CSV file and returns headers, sample rows, total row count, ' +
      'and per-column unique values (up to 20 each). Use this to understand the actual ' +
      'data distribution before mapping columns to production attributes.',
    inputSchema: z.object({
      csvPath: z
        .string()
        .describe('Relative path from repo root, e.g. "database-sources/fire/FirePerformancePlants/plants.csv"'),
      sampleSize: z.number().optional().describe('Number of sample rows to return (default 10)'),
    }),
    outputSchema: z.object({
      headers: z.array(z.string()),
      sampleRows: z.array(z.record(z.string(), z.string())),
      totalRows: z.number(),
      uniqueValues: z.record(z.string(), z.array(z.string())),
    }),
  },
  async (input) => {
    const fullPath = resolve(REPO_ROOT, input.csvPath);
    const content = await readFile(fullPath, 'utf-8');
    const parsed = parseCSV(content);

    const sampleSize = input.sampleSize ?? 10;
    const sampleRows = parsed.rows.slice(0, sampleSize);

    // Collect unique values per column (up to 20 each)
    const uniqueValues: Record<string, string[]> = {};
    for (const header of parsed.headers) {
      const seen = new Set<string>();
      for (const row of parsed.rows) {
        const val = row[header];
        if (val !== undefined && val !== '') {
          seen.add(val);
          if (seen.size >= 20) break;
        }
      }
      uniqueValues[header] = [...seen];
    }

    return {
      headers: parsed.headers,
      sampleRows,
      totalRows: parsed.rows.length,
      uniqueValues,
    };
  },
);
