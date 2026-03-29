import { z } from 'zod';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai, MODELS } from '../config.js';
import { resolveSynonym } from '../tools/resolveSynonym.js';
import { fuzzyMatchPlant } from '../tools/fuzzyMatch.js';
import { doltPool } from '../tools/dolt.js';
import { extractJSON } from '../utils/extractJSON.js';
import { loadPrompt } from '../prompts/load.js';
import { specialistInput, type SpecialistInput } from './ratingConflictFlow.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

// --- Types ---

const VERDICTS = ['REAL', 'APPARENT', 'NUANCED'] as const;
const RECOMMENDATIONS = [
  'PREFER_A', 'PREFER_B', 'KEEP_BOTH', 'KEEP_BOTH_WITH_CONTEXT',
  'NEEDS_RESEARCH', 'HUMAN_DECIDE',
] as const;
const TAXONOMY_RESOLUTIONS = [
  'SAME_TAXON', 'DIFFERENT_TAXA', 'GENUS_SPECIES_MISMATCH',
  'CULTIVAR_SPECIES_MISMATCH', 'UNRESOLVED',
] as const;

const taxonomyOutput = z.object({
  verdict: z.enum(VERDICTS),
  recommendation: z.enum(RECOMMENDATIONS),
  analysis: z.string(),
  confidence: z.number(),
  taxonomyAnalysis: z.object({
    resolution: z.enum(TAXONOMY_RESOLUTIONS),
    nameA: z.string(),
    nameB: z.string(),
    acceptedName: z.string().nullable(),
    backboneEvidence: z.string(),
  }).nullable(),
});

export type TaxonomyOutput = z.infer<typeof taxonomyOutput>;

// --- Helpers ---

function parsePlantNameParts(name: string): { genus: string; species: string } {
  const parts = name.trim().split(/\s+/);
  return { genus: parts[0] || '', species: parts[1] || '' };
}

function formatSynonymResult(result: {
  acceptedName: { genus: string; species: string; authority: string } | null;
  synonymOf: string | null;
  source: string | null;
  confidence: number;
}): string {
  if (!result.acceptedName && !result.synonymOf) {
    return 'Not found in any taxonomy backbone (USDA, POWO, WFO).';
  }
  const accepted = result.acceptedName
    ? `${result.acceptedName.genus} ${result.acceptedName.species}`.trim()
    : 'unknown';
  const synonym = result.synonymOf
    ? ` (synonym of ${result.synonymOf})`
    : ' (accepted name)';
  return `${accepted}${synonym} — source: ${result.source}, confidence: ${result.confidence}`;
}

// --- Flow ---

export const taxonomyConflictFlow = ai.defineFlow(
  {
    name: 'taxonomyConflictFlow',
    inputSchema: specialistInput,
    outputSchema: taxonomyOutput,
  },
  async (input) => {
    console.log(`[taxonomyConflictFlow] Analyzing conflict ${input.conflictId}: ${input.plantName} / ${input.attributeName}`);

    // Step 1: Resolve synonyms for both plant names
    // The conflict may involve two different names for the same plant,
    // or the plantName itself with different values from different-named sources
    const nameA = input.plantName;
    const nameB = input.valueB.includes(' ') && /^[A-Z]/.test(input.valueB)
      ? input.valueB  // valueB might be a plant name in granularity conflicts
      : input.plantName;

    const [synResultA, synResultB] = await Promise.all([
      resolveSynonym({ scientificName: nameA }),
      nameA !== nameB ? resolveSynonym({ scientificName: nameB }) : Promise.resolve(null),
    ]);

    // Step 2: Fuzzy match fallback if synonym resolution fails
    let fuzzyResults = 'No fuzzy match needed.';
    const partsA = parsePlantNameParts(nameA);

    if (!synResultA.acceptedName) {
      const fuzzy = await fuzzyMatchPlant({ genus: partsA.genus, species: partsA.species || undefined, limit: 3 });
      if (fuzzy.candidates.length > 0) {
        fuzzyResults = 'Fuzzy matches for name A:\n' +
          fuzzy.candidates.map((c) => `  - ${c.genus} ${c.species ?? ''} (${c.matchReason}, similarity: ${c.similarity})`).join('\n');
      }
    }

    if (nameA !== nameB && synResultB && !synResultB.acceptedName) {
      const partsB = parsePlantNameParts(nameB);
      const fuzzy = await fuzzyMatchPlant({ genus: partsB.genus, species: partsB.species || undefined, limit: 3 });
      if (fuzzy.candidates.length > 0) {
        fuzzyResults += '\nFuzzy matches for name B:\n' +
          fuzzy.candidates.map((c) => `  - ${c.genus} ${c.species ?? ''} (${c.matchReason}, similarity: ${c.similarity})`).join('\n');
      }
    }

    // Step 3: Build prompt and call LLM
    const prompt = loadPrompt('taxonomy-conflict.md', {
      plantName: input.plantName,
      attributeName: input.attributeName,
      valueA: input.valueA,
      valueB: input.valueB,
      sourceA: input.sourceA,
      sourceB: input.sourceB,
      classifierExplanation: input.classifierExplanation,
      synonymResultA: formatSynonymResult(synResultA),
      synonymResultB: synResultB
        ? formatSynonymResult(synResultB)
        : 'Same as name A (conflict is not between two different names).',
      fuzzyResults,
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
          '(no markdown fencing) matching this schema: { verdict, recommendation, analysis, confidence, taxonomyAnalysis }. ' +
          'Here is what you tried:\n\n' + text.slice(0, 2000),
      });
      parsed = extractJSON(retryText) as Record<string, unknown>;
    }

    // Step 4: Validate and normalize
    const verdict = VERDICTS.includes(parsed.verdict as typeof VERDICTS[number])
      ? (parsed.verdict as typeof VERDICTS[number])
      : 'NUANCED';

    const recommendation = RECOMMENDATIONS.includes(parsed.recommendation as typeof RECOMMENDATIONS[number])
      ? (parsed.recommendation as typeof RECOMMENDATIONS[number])
      : 'HUMAN_DECIDE';

    const analysis = typeof parsed.analysis === 'string'
      ? parsed.analysis
      : 'Specialist analysis could not be parsed.';

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    // Parse taxonomy analysis
    let taxonomyAnalysis: TaxonomyOutput['taxonomyAnalysis'] = null;
    const ta = parsed.taxonomyAnalysis as Record<string, unknown> | null;
    if (ta && typeof ta === 'object') {
      const resolution = TAXONOMY_RESOLUTIONS.includes(ta.resolution as typeof TAXONOMY_RESOLUTIONS[number])
        ? (ta.resolution as typeof TAXONOMY_RESOLUTIONS[number])
        : 'UNRESOLVED';

      taxonomyAnalysis = {
        resolution,
        nameA: typeof ta.nameA === 'string' ? ta.nameA : nameA,
        nameB: typeof ta.nameB === 'string' ? ta.nameB : nameB,
        acceptedName: typeof ta.acceptedName === 'string' ? ta.acceptedName : null,
        backboneEvidence: typeof ta.backboneEvidence === 'string' ? ta.backboneEvidence : '',
      };
    }

    const result: TaxonomyOutput = { verdict, recommendation, analysis, confidence, taxonomyAnalysis };

    // Step 5: Write results to DB
    const fullAnalysis = taxonomyAnalysis
      ? `${analysis}\n\n---\nTaxonomy Analysis: ${JSON.stringify(taxonomyAnalysis)}`
      : analysis;

    try {
      await doltPool.query(
        `UPDATE conflicts
         SET specialist_verdict = $1, specialist_analysis = $2,
             specialist_recommendation = $3, status = 'annotated', annotated_at = NOW()
         WHERE id = $4`,
        [result.verdict, fullAnalysis, result.recommendation, input.conflictId],
      );
      console.log(`[taxonomyConflictFlow] Wrote verdict ${result.verdict} for conflict ${input.conflictId}`);
    } catch (err) {
      console.error(`[taxonomyConflictFlow] Failed to write verdict for ${input.conflictId}:`, err);
    }

    return result;
  },
);
