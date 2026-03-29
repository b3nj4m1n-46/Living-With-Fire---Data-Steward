import { z } from 'zod';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai, MODELS } from '../config.js';
import { getDatasetContext } from '../tools/datasetContext.js';
import { doltPool } from '../tools/dolt.js';
import { extractJSON } from '../utils/extractJSON.js';
import { loadPrompt } from '../prompts/load.js';
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

const temporalOutput = z.object({
  verdict: z.enum(VERDICTS),
  recommendation: z.enum(RECOMMENDATIONS),
  analysis: z.string(),
  confidence: z.number(),
  temporalAnalysis: z.object({
    yearGap: z.number(),
    newerSource: z.string(),
    supersedes: z.boolean(),
  }).nullable(),
});

export type TemporalOutput = z.infer<typeof temporalOutput>;

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

function formatContextForTemporal(
  context: { dataDictionary: string; readme: string } | null,
): string {
  if (!context) return 'No dataset context available.';

  const parts: string[] = [];
  if (context.readme) {
    parts.push(`### README (source metadata, publication info)\n${context.readme.slice(0, 2000)}`);
  }
  if (context.dataDictionary) {
    parts.push(`### Data Dictionary\n${context.dataDictionary.slice(0, 2000)}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : 'No detailed context available.';
}

// --- Flow ---

export const temporalConflictFlow = ai.defineFlow(
  {
    name: 'temporalConflictFlow',
    inputSchema: specialistInput,
    outputSchema: temporalOutput,
  },
  async (input) => {
    console.log(`[temporalConflictFlow] Analyzing conflict ${input.conflictId}: ${input.plantName} / ${input.attributeName}`);

    // Step 1: Resolve dataset folders and load context
    const [folderA, folderB] = await Promise.all([
      resolveDatasetFolder(input.sourceDatasetA),
      resolveDatasetFolder(input.sourceDatasetB),
    ]);

    const [contextA, contextB] = await Promise.all([
      folderA ? getDatasetContext({ datasetFolder: folderA }) : null,
      folderB ? getDatasetContext({ datasetFolder: folderB }) : null,
    ]);

    // Step 2: Build prompt and call LLM (Haiku — lightweight temporal assessment)
    const prompt = loadPrompt('temporal-conflict.md', {
      plantName: input.plantName,
      attributeName: input.attributeName,
      valueA: input.valueA,
      valueB: input.valueB,
      sourceA: input.sourceA,
      sourceB: input.sourceB,
      classifierExplanation: input.classifierExplanation,
      methodologyA: input.sourceMethodologyA ?? 'Unknown',
      methodologyB: input.sourceMethodologyB ?? 'Unknown',
      regionA: input.sourceRegionA ?? 'Unknown',
      regionB: input.sourceRegionB ?? 'Unknown',
      contextA: formatContextForTemporal(contextA),
      contextB: formatContextForTemporal(contextB),
    });

    const { text } = await ai.generate({ model: MODELS.bulk, prompt });

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(text) as Record<string, unknown>;
    } catch {
      const { text: retryText } = await ai.generate({
        model: MODELS.bulk,
        prompt:
          'Your previous response was not valid JSON. Please respond with ONLY a JSON object ' +
          '(no markdown fencing) matching this schema: { verdict, recommendation, analysis, confidence, temporalAnalysis }. ' +
          'Here is what you tried:\n\n' + text.slice(0, 2000),
      });
      parsed = extractJSON(retryText) as Record<string, unknown>;
    }

    // Step 3: Validate and normalize
    const verdict = VERDICTS.includes(parsed.verdict as typeof VERDICTS[number])
      ? (parsed.verdict as typeof VERDICTS[number])
      : 'NUANCED';

    const recommendation = RECOMMENDATIONS.includes(parsed.recommendation as typeof RECOMMENDATIONS[number])
      ? (parsed.recommendation as typeof RECOMMENDATIONS[number])
      : 'HUMAN_DECIDE';

    const analysis = typeof parsed.analysis === 'string'
      ? parsed.analysis
      : 'Temporal analysis could not be parsed.';

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    // Parse temporal analysis
    let temporalAnalysis: TemporalOutput['temporalAnalysis'] = null;
    const ta = parsed.temporalAnalysis as Record<string, unknown> | null;
    if (ta && typeof ta === 'object') {
      temporalAnalysis = {
        yearGap: typeof ta.yearGap === 'number' ? ta.yearGap : 0,
        newerSource: typeof ta.newerSource === 'string' ? ta.newerSource : 'unknown',
        supersedes: typeof ta.supersedes === 'boolean' ? ta.supersedes : false,
      };
    }

    const result: TemporalOutput = { verdict, recommendation, analysis, confidence, temporalAnalysis };

    // Step 4: Write results to DB
    const fullAnalysis = temporalAnalysis
      ? `${analysis}\n\n---\nTemporal Analysis: ${JSON.stringify(temporalAnalysis)}`
      : analysis;

    try {
      await doltPool.query(
        `UPDATE conflicts
         SET specialist_verdict = $1, specialist_analysis = $2,
             specialist_recommendation = $3, status = 'annotated', annotated_at = NOW()
         WHERE id = $4`,
        [result.verdict, fullAnalysis, result.recommendation, input.conflictId],
      );
      console.log(`[temporalConflictFlow] Wrote verdict ${result.verdict} for conflict ${input.conflictId}`);
    } catch (err) {
      console.error(`[temporalConflictFlow] Failed to write verdict for ${input.conflictId}:`, err);
    }

    return result;
  },
);
