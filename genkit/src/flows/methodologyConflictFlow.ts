import { z } from 'zod';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai } from '../config.js';
import { getDatasetContext } from '../tools/datasetContext.js';
import { doltPool } from '../tools/dolt.js';
import { specialistInput, type SpecialistInput } from './ratingConflictFlow.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

const CATEGORIES = [
  'fire', 'deer', 'traits', 'taxonomy', 'water',
  'pollinators', 'birds', 'native', 'invasive',
];

// --- Types ---

const VERDICTS = ['REAL', 'APPARENT', 'NUANCED'] as const;
const RECOMMENDATIONS = [
  'PREFER_A', 'PREFER_B', 'KEEP_BOTH', 'KEEP_BOTH_WITH_CONTEXT',
  'NEEDS_RESEARCH', 'HUMAN_DECIDE',
] as const;

const specialistOutput = z.object({
  verdict: z.enum(VERDICTS),
  recommendation: z.enum(RECOMMENDATIONS),
  analysis: z.string(),
  confidence: z.number(),
});

export type MethodologyOutput = z.infer<typeof specialistOutput>;

// --- Helpers ---

async function resolveDatasetFolder(sourceDataset: string): Promise<string | null> {
  for (const cat of CATEGORIES) {
    const relPath = `database-sources/${cat}/${sourceDataset}`;
    const absPath = resolve(REPO_ROOT, relPath, 'DATA-DICTIONARY.md');
    try {
      await access(absPath);
      return relPath;
    } catch {
      // continue
    }
  }
  return null;
}

// --- Flow ---

export const methodologyConflictFlow = ai.defineFlow(
  {
    name: 'methodologyConflictFlow',
    inputSchema: specialistInput,
    outputSchema: specialistOutput,
  },
  async (input) => {
    console.log(`[methodologyConflictFlow] Stub analysis for conflict ${input.conflictId}: ${input.plantName} / ${input.attributeName}`);

    // Load dataset context to surface methodology descriptions for admin review
    const [folderA, folderB] = await Promise.all([
      resolveDatasetFolder(input.sourceDatasetA),
      resolveDatasetFolder(input.sourceDatasetB),
    ]);

    const [contextA, contextB] = await Promise.all([
      folderA ? getDatasetContext({ datasetFolder: folderA }) : null,
      folderB ? getDatasetContext({ datasetFolder: folderB }) : null,
    ]);

    const methodA = input.sourceMethodologyA ?? 'Unknown';
    const methodB = input.sourceMethodologyB ?? 'Unknown';

    const contextSummaryA = contextA?.dataDictionary
      ? contextA.dataDictionary.slice(0, 1500)
      : 'No data dictionary available.';
    const contextSummaryB = contextB?.dataDictionary
      ? contextB.dataDictionary.slice(0, 1500)
      : 'No data dictionary available.';

    const analysis =
      `Methodology conflict requires human review. ` +
      `Source A (${input.sourceA}) methodology: ${methodA}. ` +
      `Source B (${input.sourceB}) methodology: ${methodB}.\n\n` +
      `--- Source A Data Dictionary ---\n${contextSummaryA}\n\n` +
      `--- Source B Data Dictionary ---\n${contextSummaryB}`;

    const result: MethodologyOutput = {
      verdict: 'NUANCED',
      recommendation: 'HUMAN_DECIDE',
      analysis,
      confidence: 0,
    };

    // Write stub verdict to DB
    try {
      await doltPool.query(
        `UPDATE conflicts
         SET specialist_verdict = $1, specialist_analysis = $2,
             specialist_recommendation = $3, status = 'annotated', annotated_at = NOW()
         WHERE id = $4`,
        [result.verdict, result.analysis, result.recommendation, input.conflictId],
      );
      console.log(`[methodologyConflictFlow] Wrote stub verdict for conflict ${input.conflictId}`);
    } catch (err) {
      console.error(`[methodologyConflictFlow] Failed to write verdict for ${input.conflictId}:`, err);
    }

    return result;
  },
);
