import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai } from '../config.js';

// Repo root is three levels up from genkit/src/tools/
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const SOURCE_ID_RE = /\*\*Source ID:\*\*\s*`([^`]+)`/;

export const getDatasetContext = ai.defineTool(
  {
    name: 'getDatasetContext',
    description:
      'Reads the DATA-DICTIONARY.md and README.md for a source dataset folder, ' +
      'returning the full text content and extracted Source ID. ' +
      'Use this to understand a dataset\'s methodology, rating scales, and geographic scope.',
    inputSchema: z.object({
      datasetFolder: z
        .string()
        .describe(
          'Relative path from the repo root, e.g. "database-sources/fire/FirePerformancePlants"',
        ),
    }),
    outputSchema: z.object({
      dataDictionary: z.string(),
      readme: z.string(),
      sourceId: z.string(),
    }),
  },
  async (input) => {
    const folder = resolve(REPO_ROOT, input.datasetFolder);

    const [dataDictionary, readme] = await Promise.all([
      readFile(resolve(folder, 'DATA-DICTIONARY.md'), 'utf-8').catch(() => ''),
      readFile(resolve(folder, 'README.md'), 'utf-8').catch(() => ''),
    ]);

    // Extract source ID from DATA-DICTIONARY first, fall back to README
    const match =
      SOURCE_ID_RE.exec(dataDictionary) ?? SOURCE_ID_RE.exec(readme);
    const sourceId = match?.[1] ?? 'UNKNOWN';

    return { dataDictionary, readme, sourceId };
  },
);
