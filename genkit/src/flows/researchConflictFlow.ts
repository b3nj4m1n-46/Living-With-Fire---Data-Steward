import { z } from 'zod';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai, MODELS } from '../config.js';
import { getDatasetContext } from '../tools/datasetContext.js';
import { searchDocumentIndex } from '../tools/searchDocumentIndex.js';
import { navigateDocumentTree } from '../tools/navigateDocumentTree.js';
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

const researchOutput = z.object({
  verdict: z.enum(VERDICTS),
  recommendation: z.enum(RECOMMENDATIONS),
  analysis: z.string(),
  confidence: z.number(),
  datasetFindings: z.array(z.object({
    sourceDataset: z.string(),
    methodology: z.string(),
    geographicScope: z.string(),
    relevantExcerpt: z.string(),
  })).nullable(),
  documentFindings: z.array(z.object({
    documentName: z.string(),
    sectionTitle: z.string(),
    finding: z.string(),
    relevance: z.string(),
  })).nullable(),
});

export type ResearchOutput = z.infer<typeof researchOutput>;

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

function formatContext(
  source: string,
  context: { dataDictionary: string; readme: string } | null,
): string {
  if (!context) return `No dataset context available for ${source}.`;

  const parts: string[] = [];
  if (context.dataDictionary) {
    parts.push(`### Data Dictionary\n${context.dataDictionary.slice(0, 3000)}`);
  }
  if (context.readme) {
    parts.push(`### README\n${context.readme.slice(0, 2000)}`);
  }
  return parts.length > 0 ? parts.join('\n\n') : `No detailed context available for ${source}.`;
}

// --- Flow ---

export const researchConflictFlow = ai.defineFlow(
  {
    name: 'researchConflictFlow',
    inputSchema: specialistInput,
    outputSchema: researchOutput,
  },
  async (input) => {
    console.log(`[researchConflictFlow] Analyzing conflict ${input.conflictId}: ${input.plantName} / ${input.attributeName}`);

    // Step 1: Resolve dataset folders and load context
    const [folderA, folderB] = await Promise.all([
      resolveDatasetFolder(input.sourceDatasetA),
      resolveDatasetFolder(input.sourceDatasetB),
    ]);

    const [contextA, contextB] = await Promise.all([
      folderA ? getDatasetContext({ datasetFolder: folderA }) : null,
      folderB ? getDatasetContext({ datasetFolder: folderB }) : null,
    ]);

    // Step 2: Search document index
    const { results: kbResults } = await searchDocumentIndex({
      query: `${input.plantName} ${input.attributeName}`,
      maxResults: 5,
    });

    // Step 3: Navigate top 3 document hits for deeper context
    const docFindings: string[] = [];
    const topHits = kbResults.slice(0, 3);

    for (const hit of topHits) {
      try {
        const detail = await navigateDocumentTree({
          indexFile: hit.documentFile,
          nodeId: hit.nodeId,
        });
        docFindings.push(
          `### ${hit.sectionTitle} (from ${hit.documentFile})\n` +
          `Summary: ${detail.summary.slice(0, 500)}\n` +
          (detail.children.length > 0
            ? `Subsections: ${detail.children.map((c) => c.title).join(', ')}`
            : ''),
        );
      } catch {
        docFindings.push(`### ${hit.sectionTitle}\n${hit.sectionSummary}`);
      }
    }

    // Include remaining hits without navigation
    for (const hit of kbResults.slice(3)) {
      docFindings.push(`### ${hit.sectionTitle}\n${hit.sectionSummary}`);
    }

    const documentFindingsText = docFindings.length > 0
      ? docFindings.join('\n\n')
      : 'No relevant knowledge base documents found.';

    // Step 4: Build prompt and call LLM (Sonnet for deeper analysis)
    const prompt = loadPrompt('research-conflict.md', {
      plantName: input.plantName,
      attributeName: input.attributeName,
      valueA: input.valueA,
      valueB: input.valueB,
      sourceA: input.sourceA,
      sourceB: input.sourceB,
      classifierExplanation: input.classifierExplanation,
      contextA: formatContext(input.sourceA, contextA),
      contextB: formatContext(input.sourceB, contextB),
      documentFindings: documentFindingsText,
    });

    const { text } = await ai.generate({ model: MODELS.quality, prompt });

    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(text) as Record<string, unknown>;
    } catch {
      const { text: retryText } = await ai.generate({
        model: MODELS.quality,
        prompt:
          'Your previous response was not valid JSON. Please respond with ONLY a JSON object ' +
          '(no markdown fencing) matching this schema: { verdict, recommendation, analysis, confidence, datasetFindings, documentFindings }. ' +
          'Here is what you tried:\n\n' + text.slice(0, 2000),
      });
      parsed = extractJSON(retryText) as Record<string, unknown>;
    }

    // Step 5: Validate and normalize
    const verdict = VERDICTS.includes(parsed.verdict as typeof VERDICTS[number])
      ? (parsed.verdict as typeof VERDICTS[number])
      : 'NUANCED';

    const recommendation = RECOMMENDATIONS.includes(parsed.recommendation as typeof RECOMMENDATIONS[number])
      ? (parsed.recommendation as typeof RECOMMENDATIONS[number])
      : 'NEEDS_RESEARCH';

    const analysis = typeof parsed.analysis === 'string'
      ? parsed.analysis
      : 'Research analysis could not be parsed.';

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    // Parse structured findings (best-effort)
    const datasetFindings = Array.isArray(parsed.datasetFindings)
      ? (parsed.datasetFindings as Array<Record<string, unknown>>).map((f) => ({
          sourceDataset: String(f.sourceDataset ?? ''),
          methodology: String(f.methodology ?? ''),
          geographicScope: String(f.geographicScope ?? ''),
          relevantExcerpt: String(f.relevantExcerpt ?? ''),
        }))
      : null;

    const documentFindingsParsed = Array.isArray(parsed.documentFindings)
      ? (parsed.documentFindings as Array<Record<string, unknown>>).map((f) => ({
          documentName: String(f.documentName ?? ''),
          sectionTitle: String(f.sectionTitle ?? ''),
          finding: String(f.finding ?? ''),
          relevance: String(f.relevance ?? ''),
        }))
      : null;

    const result: ResearchOutput = {
      verdict, recommendation, analysis, confidence,
      datasetFindings,
      documentFindings: documentFindingsParsed,
    };

    // Step 6: Write results to DB
    const findingsSummary = [
      datasetFindings ? `Dataset Findings: ${JSON.stringify(datasetFindings)}` : null,
      documentFindingsParsed ? `Document Findings: ${JSON.stringify(documentFindingsParsed)}` : null,
    ].filter(Boolean).join('\n\n');

    const fullAnalysis = findingsSummary
      ? `${analysis}\n\n---\n${findingsSummary}`
      : analysis;

    try {
      await doltPool.query(
        `UPDATE conflicts
         SET specialist_verdict = $1, specialist_analysis = $2,
             specialist_recommendation = $3, status = 'annotated', annotated_at = NOW()
         WHERE id = $4`,
        [result.verdict, fullAnalysis, result.recommendation, input.conflictId],
      );
      console.log(`[researchConflictFlow] Wrote verdict ${result.verdict} for conflict ${input.conflictId}`);
    } catch (err) {
      console.error(`[researchConflictFlow] Failed to write verdict for ${input.conflictId}:`, err);
    }

    return result;
  },
);
