import { z } from 'zod';
import { ai, MODELS } from '../config.js';
import { getWarrantGroups } from '../tools/warrantGroups.js';
import { writeConflictsBatch, type ConflictInput } from '../tools/writeConflict.js';
import { ratingConflictFlow, type SpecialistInput } from './ratingConflictFlow.js';
import { scopeConflictFlow } from './scopeConflictFlow.js';
import { taxonomyConflictFlow } from './taxonomyConflictFlow.js';
import { researchConflictFlow } from './researchConflictFlow.js';
import { temporalConflictFlow } from './temporalConflictFlow.js';
import { methodologyConflictFlow } from './methodologyConflictFlow.js';
import { definitionConflictFlow } from './definitionConflictFlow.js';
import { extractJSON } from '../utils/extractJSON.js';
import { loadPrompt } from '../prompts/load.js';

// --- Types ---

interface WarrantInfo {
  id: string;
  value: string;
  sourceValue: string | null;
  sourceDataset: string;
  sourceIdCode: string;
  sourceMethodology: string | null;
  sourceRegion: string | null;
}

interface WarrantPair {
  plantId: string;
  plantName: string;
  attributeName: string;
  warrantA: WarrantInfo;
  warrantB: WarrantInfo;
}

interface ClassifiedConflict {
  conflictId: string | null;
  plantName: string;
  attributeName: string;
  conflictType: string;
  severity: string;
  valueA: string;
  valueB: string;
  sourceA: string;
  sourceB: string;
  classifierExplanation: string;
  specialistRoute: string | null;
}

// --- Constants ---

const CONFLICT_TYPES = [
  'RATING_DISAGREEMENT',
  'SCALE_MISMATCH',
  'SCOPE_DIFFERENCE',
  'TEMPORAL_CONFLICT',
  'METHODOLOGY_DIFFERENCE',
  'GRANULARITY_MISMATCH',
  'DEFINITION_CONFLICT',
  'COMPLETENESS_CONFLICT',
] as const;

const SPECIALIST_ROUTES: Record<string, string | null> = {
  RATING_DISAGREEMENT: 'ratingConflictFlow',
  SCALE_MISMATCH: 'ratingConflictFlow',
  SCOPE_DIFFERENCE: 'scopeConflictFlow',
  TEMPORAL_CONFLICT: 'temporalConflictFlow',
  METHODOLOGY_DIFFERENCE: 'methodologyConflictFlow',
  GRANULARITY_MISMATCH: 'taxonomyConflictFlow',
  DEFINITION_CONFLICT: 'definitionConflictFlow',
  COMPLETENESS_CONFLICT: null,
};

const DEFAULT_SEVERITY: Record<string, string> = {
  RATING_DISAGREEMENT: 'critical',
  SCALE_MISMATCH: 'moderate',
  SCOPE_DIFFERENCE: 'moderate',
  TEMPORAL_CONFLICT: 'minor',
  METHODOLOGY_DIFFERENCE: 'moderate',
  GRANULARITY_MISMATCH: 'minor',
  DEFINITION_CONFLICT: 'moderate',
  COMPLETENESS_CONFLICT: 'minor',
};

const LLM_BATCH_SIZE = 25;
const GROUP_FETCH_LIMIT = 500;

// --- Helpers ---


/** Check if a value is effectively null/empty. */
function isNullish(val: string | null | undefined): boolean {
  if (val == null) return true;
  const trimmed = val.trim().toLowerCase();
  return trimmed === '' || trimmed === 'null' || trimmed === 'unknown' || trimmed === 'n/a';
}

/** Generate pairwise comparisons. If N > 5, compare each against the mode value. */
function generatePairs(
  warrants: WarrantInfo[],
  plantId: string,
  plantName: string,
  attributeName: string,
): WarrantPair[] {
  if (warrants.length <= 5) {
    const pairs: WarrantPair[] = [];
    for (let i = 0; i < warrants.length; i++) {
      for (let j = i + 1; j < warrants.length; j++) {
        pairs.push({
          plantId,
          plantName,
          attributeName,
          warrantA: warrants[i],
          warrantB: warrants[j],
        });
      }
    }
    return pairs;
  }

  // N > 5: compare each against the most common value
  const freq = new Map<string, number>();
  for (const w of warrants) {
    const key = w.value.trim().toLowerCase();
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  let modeValue = '';
  let modeCount = 0;
  for (const [val, count] of freq) {
    if (count > modeCount) {
      modeValue = val;
      modeCount = count;
    }
  }

  // Find one warrant with the mode value to use as the anchor
  const anchor = warrants.find((w) => w.value.trim().toLowerCase() === modeValue)!;
  const pairs: WarrantPair[] = [];
  for (const w of warrants) {
    if (w.id === anchor.id) continue;
    pairs.push({
      plantId,
      plantName,
      attributeName,
      warrantA: anchor,
      warrantB: w,
    });
  }
  return pairs;
}

// --- LLM prompt ---

function buildClassificationPrompt(pairs: WarrantPair[]): string {
  const pairDescriptions = pairs
    .map(
      (p, i) =>
        `Pair ${i + 1}:
  Plant: ${p.plantName}
  Attribute: ${p.attributeName}
  Warrant A: value="${p.warrantA.value}", source="${p.warrantA.sourceIdCode} (${p.warrantA.sourceDataset})", methodology="${p.warrantA.sourceMethodology ?? 'unknown'}", region="${p.warrantA.sourceRegion ?? 'unknown'}"
  Warrant B: value="${p.warrantB.value}", source="${p.warrantB.sourceIdCode} (${p.warrantB.sourceDataset})", methodology="${p.warrantB.sourceMethodology ?? 'unknown'}", region="${p.warrantB.sourceRegion ?? 'unknown'}"`,
    )
    .join('\n\n');

  return loadPrompt('classify-conflict.md', { pairDescriptions });
}

// --- Flow schemas ---

const flowInput = z.object({
  mode: z.enum(['internal', 'external', 'cross_source']),
  plantIds: z.array(z.string()).optional(),
  attributeFilter: z.string().optional(),
  sourceDataset: z.string().optional().describe('For external mode: which new dataset'),
  batchId: z.string().optional(),
  dryRun: z.boolean().optional().describe('If true, classify but do not write to DB'),
  runSpecialists: z.boolean().optional().describe('If true, dispatch specialist flows after classification'),
});

const classifiedConflictSchema = z.object({
  conflictId: z.string().nullable(),
  plantName: z.string(),
  attributeName: z.string(),
  conflictType: z.string(),
  severity: z.string(),
  valueA: z.string(),
  valueB: z.string(),
  sourceA: z.string(),
  sourceB: z.string(),
  classifierExplanation: z.string(),
  specialistRoute: z.string().nullable(),
});

const flowOutput = z.object({
  conflicts: z.array(classifiedConflictSchema),
  corroborated: z.number(),
  complementary: z.number(),
  summary: z.object({
    total: z.number(),
    critical: z.number(),
    moderate: z.number(),
    minor: z.number(),
    byType: z.record(z.string(), z.number()),
  }),
});

// --- Main flow ---

export const classifyConflictFlow = ai.defineFlow(
  {
    name: 'classifyConflictFlow',
    inputSchema: flowInput,
    outputSchema: flowOutput,
  },
  async (input) => {
    const dryRun = input.dryRun ?? false;
    const modeForGroups = input.mode === 'cross_source' ? 'all' : input.mode;

    // Step 1: Fetch all warrant groups (paginated)
    const allGroups: Awaited<ReturnType<typeof getWarrantGroups>>['groups'] = [];
    let offset = 0;
    let totalGroups = 0;

    do {
      const result = await getWarrantGroups({
        mode: modeForGroups,
        plantIds: input.plantIds,
        attributeFilter: input.attributeFilter,
        minGroupSize: 2,
        limit: GROUP_FETCH_LIMIT,
        offset,
      });
      allGroups.push(...result.groups);
      totalGroups = result.totalGroups;
      offset += GROUP_FETCH_LIMIT;
    } while (allGroups.length < totalGroups);

    console.log(`Found ${totalGroups} warrant groups to analyze.`);

    // Step 2: Deterministic pre-classification + pair generation
    let corroborated = 0;
    let complementary = 0;
    const deterministicConflicts: ClassifiedConflict[] = [];
    const needsLLM: WarrantPair[] = [];

    for (const group of allGroups) {
      const plantName = `${group.plantGenus} ${group.plantSpecies ?? ''}`.trim();
      const warrants: WarrantInfo[] = group.warrants.map((w) => ({
        id: w.id,
        value: w.value,
        sourceValue: w.sourceValue,
        sourceDataset: w.sourceDataset,
        sourceIdCode: w.sourceIdCode,
        sourceMethodology: w.sourceMethodology,
        sourceRegion: w.sourceRegion,
      }));

      const pairs = generatePairs(warrants, group.plantId, plantName, group.attributeName);

      for (const pair of pairs) {
        const valA = pair.warrantA.value.trim().toLowerCase();
        const valB = pair.warrantB.value.trim().toLowerCase();

        // Identical values → corroboration
        if (valA === valB) {
          corroborated++;
          continue;
        }

        // One null, one non-null → completeness conflict
        if (isNullish(pair.warrantA.value) !== isNullish(pair.warrantB.value)) {
          complementary++;
          deterministicConflicts.push({
            conflictId: null,
            plantName: pair.plantName,
            attributeName: pair.attributeName,
            conflictType: 'COMPLETENESS_CONFLICT',
            severity: 'minor',
            valueA: pair.warrantA.value,
            valueB: pair.warrantB.value,
            sourceA: pair.warrantA.sourceIdCode,
            sourceB: pair.warrantB.sourceIdCode,
            classifierExplanation: `One source provides a value ("${isNullish(pair.warrantA.value) ? pair.warrantB.value : pair.warrantA.value}") while the other has no data.`,
            specialistRoute: null,
          });
          // Store pair info for DB write
          (deterministicConflicts[deterministicConflicts.length - 1] as ClassifiedConflict & { _pair: WarrantPair })._pair = pair;
          continue;
        }

        // Different non-null values → needs LLM
        needsLLM.push(pair);
      }
    }

    console.log(
      `Pre-classification: ${corroborated} corroborated, ${complementary} complementary, ${needsLLM.length} need LLM classification.`,
    );

    // Step 3: Write deterministic completeness conflicts
    const allConflicts: ClassifiedConflict[] = [];

    if (!dryRun && deterministicConflicts.length > 0) {
      const batchInputs: ConflictInput[] = deterministicConflicts.map((c) => {
        const pair = (c as ClassifiedConflict & { _pair: WarrantPair })._pair;
        return {
          conflictType: c.conflictType,
          conflictMode: input.mode,
          severity: c.severity as 'critical' | 'moderate' | 'minor',
          warrantAId: pair.warrantA.id,
          warrantBId: pair.warrantB.id,
          plantId: pair.plantId,
          plantName: c.plantName,
          attributeName: c.attributeName,
          valueA: c.valueA,
          valueB: c.valueB,
          sourceA: c.sourceA,
          sourceB: c.sourceB,
          classifierExplanation: c.classifierExplanation,
          specialistAgent: null,
          batchId: input.batchId,
        };
      });

      try {
        const ids = await writeConflictsBatch(batchInputs);
        for (let i = 0; i < deterministicConflicts.length; i++) {
          deterministicConflicts[i].conflictId = ids[i] ?? null;
        }
      } catch (err) {
        console.error('Failed to write completeness conflicts:', err);
      }
    }
    allConflicts.push(...deterministicConflicts.map(({ ...c }) => {
      delete (c as Record<string, unknown>)._pair;
      return c;
    }));

    // Map conflictId → WarrantPair for specialist dispatch
    const pairMap = new Map<string, WarrantPair>();

    // Step 4: LLM batched classification
    const totalBatches = Math.ceil(needsLLM.length / LLM_BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batchStart = batchIdx * LLM_BATCH_SIZE;
      const batchEnd = Math.min(batchStart + LLM_BATCH_SIZE, needsLLM.length);
      const batchPairs = needsLLM.slice(batchStart, batchEnd);

      console.log(
        `Processing batch ${batchIdx + 1}/${totalBatches} (pairs ${batchStart + 1}-${batchEnd})...`,
      );

      let classifications: Array<{
        pairIndex: number;
        conflictType: string;
        severity: string;
        explanation: string;
        specialistRoute: string | null;
      }>;

      try {
        const prompt = buildClassificationPrompt(batchPairs);
        const { text } = await ai.generate({ model: MODELS.bulk, prompt });

        let parsed: unknown;
        try {
          parsed = extractJSON(text);
        } catch {
          // Retry once
          const { text: retryText } = await ai.generate({
            model: MODELS.bulk,
            prompt:
              'Your previous response was not valid JSON. Please respond with ONLY a JSON array ' +
              '(no markdown fencing, no explanation) matching the schema I described. ' +
              'Here is what you tried to produce:\n\n' +
              text.slice(0, 2000),
          });
          parsed = extractJSON(retryText);
        }

        classifications = Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        console.error(`LLM classification failed for batch ${batchIdx + 1}:`, err);
        // Mark all pairs in this batch as uncertain
        classifications = batchPairs.map((_, i) => ({
          pairIndex: i + 1,
          conflictType: 'RATING_DISAGREEMENT',
          severity: 'moderate',
          explanation: 'LLM classification failed — defaulting to rating disagreement for manual review.',
          specialistRoute: 'ratingConflictFlow',
        }));
      }

      // Build classified conflicts for this batch
      const batchConflicts: ClassifiedConflict[] = [];
      const batchDbInputs: ConflictInput[] = [];

      for (const cls of classifications) {
        const pairIdx = (cls.pairIndex ?? 1) - 1;
        const pair = batchPairs[pairIdx];
        if (!pair) continue;

        // Validate conflict type
        const conflictType = CONFLICT_TYPES.includes(cls.conflictType as (typeof CONFLICT_TYPES)[number])
          ? cls.conflictType
          : 'RATING_DISAGREEMENT';

        const severity = ['critical', 'moderate', 'minor'].includes(cls.severity)
          ? cls.severity
          : (DEFAULT_SEVERITY[conflictType] ?? 'moderate');

        const specialistRoute = SPECIALIST_ROUTES[conflictType] ?? null;

        const conflict: ClassifiedConflict = {
          conflictId: null,
          plantName: pair.plantName,
          attributeName: pair.attributeName,
          conflictType,
          severity,
          valueA: pair.warrantA.value,
          valueB: pair.warrantB.value,
          sourceA: pair.warrantA.sourceIdCode,
          sourceB: pair.warrantB.sourceIdCode,
          classifierExplanation: cls.explanation ?? '',
          specialistRoute,
        };

        batchConflicts.push(conflict);

        batchDbInputs.push({
          conflictType,
          conflictMode: input.mode,
          severity: severity as 'critical' | 'moderate' | 'minor',
          warrantAId: pair.warrantA.id,
          warrantBId: pair.warrantB.id,
          plantId: pair.plantId,
          plantName: pair.plantName,
          attributeName: pair.attributeName,
          valueA: pair.warrantA.value,
          valueB: pair.warrantB.value,
          sourceA: pair.warrantA.sourceIdCode,
          sourceB: pair.warrantB.sourceIdCode,
          classifierExplanation: cls.explanation ?? '',
          specialistAgent: specialistRoute,
          batchId: input.batchId,
        });
      }

      // Write batch to DB
      if (!dryRun && batchDbInputs.length > 0) {
        try {
          const ids = await writeConflictsBatch(batchDbInputs);
          for (let i = 0; i < batchConflicts.length; i++) {
            batchConflicts[i].conflictId = ids[i] ?? null;
          }
        } catch (err) {
          console.error(`Failed to write batch ${batchIdx + 1} to DB:`, err);
        }
      }

      // Track pairs for specialist dispatch
      for (let i = 0; i < batchConflicts.length; i++) {
        const cid = batchConflicts[i].conflictId;
        if (cid) {
          const pairIdx = ((classifications[i]?.pairIndex ?? 1) - 1);
          const pair = batchPairs[pairIdx];
          if (pair) pairMap.set(cid, pair);
        }
      }

      allConflicts.push(...batchConflicts);
    }

    // Step 4.5: Optional specialist dispatch (non-blocking)
    if (input.runSpecialists && !dryRun) {
      const dispatchable = allConflicts.filter(
        (c) => c.conflictId && c.specialistRoute != null,
      );

      if (dispatchable.length > 0) {
        console.log(`Dispatching ${dispatchable.length} conflicts to specialist flows...`);

        const results = await Promise.allSettled(
          dispatchable.map(async (conflict) => {
            const pair = pairMap.get(conflict.conflictId!);
            if (!pair) return;

            const specialistInput: SpecialistInput = {
              conflictId: conflict.conflictId!,
              plantName: conflict.plantName,
              attributeName: conflict.attributeName,
              valueA: conflict.valueA,
              valueB: conflict.valueB,
              sourceA: conflict.sourceA,
              sourceB: conflict.sourceB,
              sourceDatasetA: pair.warrantA.sourceDataset,
              sourceDatasetB: pair.warrantB.sourceDataset,
              sourceMethodologyA: pair.warrantA.sourceMethodology ?? null,
              sourceMethodologyB: pair.warrantB.sourceMethodology ?? null,
              sourceRegionA: pair.warrantA.sourceRegion ?? null,
              sourceRegionB: pair.warrantB.sourceRegion ?? null,
              classifierExplanation: conflict.classifierExplanation,
              conflictType: conflict.conflictType,
            };

            if (conflict.specialistRoute === 'ratingConflictFlow') {
              return ratingConflictFlow(specialistInput);
            } else if (conflict.specialistRoute === 'scopeConflictFlow') {
              return scopeConflictFlow(specialistInput);
            } else if (conflict.specialistRoute === 'taxonomyConflictFlow') {
              return taxonomyConflictFlow(specialistInput);
            } else if (conflict.specialistRoute === 'temporalConflictFlow') {
              return temporalConflictFlow(specialistInput);
            } else if (conflict.specialistRoute === 'methodologyConflictFlow') {
              return methodologyConflictFlow(specialistInput);
            } else if (conflict.specialistRoute === 'definitionConflictFlow') {
              return definitionConflictFlow(specialistInput);
            }
          }),
        );

        const succeeded = results.filter((r) => r.status === 'fulfilled').length;
        const failed = results.filter((r) => r.status === 'rejected').length;
        console.log(`Specialist dispatch: ${succeeded} succeeded, ${failed} failed.`);
      }
    }

    // Step 5: Build summary
    const summary = {
      total: allConflicts.length,
      critical: 0,
      moderate: 0,
      minor: 0,
      byType: {} as Record<string, number>,
    };

    for (const c of allConflicts) {
      if (c.severity === 'critical') summary.critical++;
      else if (c.severity === 'moderate') summary.moderate++;
      else summary.minor++;

      summary.byType[c.conflictType] = (summary.byType[c.conflictType] ?? 0) + 1;
    }

    console.log(
      `Classification complete: ${summary.total} conflicts (${summary.critical} critical, ${summary.moderate} moderate, ${summary.minor} minor), ` +
        `${corroborated} corroborated, ${complementary} complementary.`,
    );

    return {
      conflicts: allConflicts,
      corroborated,
      complementary,
      summary,
    };
  },
);
