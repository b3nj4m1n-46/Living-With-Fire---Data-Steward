import { z } from 'zod';
import { ai, MODELS } from '../config.js';
import { lookupProductionPlant } from '../tools/lookupPlant.js';
import { resolveSynonym } from '../tools/resolveSynonym.js';
import { fuzzyMatchPlant } from '../tools/fuzzyMatch.js';

// --- Name parser ---

interface ParsedName {
  genus: string;
  species: string | null;
  cultivar: string | null;
  isGenusOnly: boolean;
  raw: string;
}

export function parsePlantName(raw: string): ParsedName {
  let name = raw.trim();

  // Extract cultivar (anything in single quotes)
  let cultivar: string | null = null;
  const cultivarMatch = name.match(/'([^']+)'/);
  if (cultivarMatch) {
    cultivar = cultivarMatch[1];
    name = name.replace(/'[^']+'/g, '').trim();
  }

  // Detect genus-only: "Phyllostachys spp." or "Musa sp."
  if (/\bspp?\.?\s*$/i.test(name)) {
    const genus = name.split(/\s+/)[0] || '';
    return { genus, species: null, cultivar, isGenusOnly: true, raw };
  }

  const parts = name.split(/\s+/);
  const genus = parts[0] || '';

  // Skip hybrid marker (x or ×) to get species
  let speciesIdx = 1;
  if (parts[speciesIdx] && (parts[speciesIdx] === 'x' || parts[speciesIdx] === '×')) {
    speciesIdx = 2;
  }

  let species: string | null = parts[speciesIdx] ?? null;

  // Strip infraspecific qualifiers (var., subsp., f.) — keep just genus+species
  if (species && /^(var|subsp|f)\.?$/i.test(species)) {
    species = null;
  }

  // If species looks like an author (starts with uppercase after genus), treat as genus-only
  if (species && /^[A-Z]/.test(species) && !species.includes('.')) {
    species = null;
  }

  const isGenusOnly = !species;
  return { genus, species, cultivar, isGenusOnly, raw };
}

// --- Flow schemas ---

const matchType = z.enum(['EXACT', 'SYNONYM', 'CULTIVAR', 'GENUS_ONLY', 'FUZZY', 'NONE']);

const plantInput = z.object({
  sourceRowId: z.coerce.string(),
  scientificName: z.string(),
  commonName: z.string().optional(),
  sourceDataset: z.string(),
});

export const matchResult = z.object({
  sourceRowId: z.coerce.string(),
  inputName: z.string(),
  matchType,
  confidence: z.number(),
  productionPlantId: z.string().nullable(),
  productionGenus: z.string().nullable(),
  productionSpecies: z.string().nullable(),
  synonymResolution: z
    .object({
      originalName: z.string(),
      acceptedName: z.string(),
      source: z.string(),
    })
    .optional(),
  alternativeCandidates: z
    .array(
      z.object({
        plantId: z.string(),
        genus: z.string(),
        species: z.string().nullable(),
        similarity: z.number(),
      }),
    )
    .optional(),
  notes: z.string(),
});

const flowInput = z.object({
  plants: z.array(plantInput),
  options: z
    .object({
      fuzzyThreshold: z.number().optional(),
      includeGenusOnly: z.boolean().optional(),
    })
    .optional(),
});

const flowOutput = z.object({
  matches: z.array(matchResult),
  summary: z.object({
    total: z.number(),
    exact: z.number(),
    synonym: z.number(),
    cultivar: z.number(),
    genusOnly: z.number(),
    fuzzy: z.number(),
    noMatch: z.number(),
  }),
});

// --- Main flow ---

export const matchPlantFlow = ai.defineFlow(
  {
    name: 'matchPlantFlow',
    inputSchema: flowInput,
    outputSchema: flowOutput,
  },
  async (input) => {
    const fuzzyThreshold = input.options?.fuzzyThreshold ?? 0.85;
    const includeGenusOnly = input.options?.includeGenusOnly ?? true;

    const summary = { total: 0, exact: 0, synonym: 0, cultivar: 0, genusOnly: 0, fuzzy: 0, noMatch: 0 };
    const matches: z.infer<typeof matchResult>[] = [];

    for (const plant of input.plants) {
      summary.total++;
      const result = await matchSinglePlant(plant, fuzzyThreshold, includeGenusOnly);
      matches.push(result);

      switch (result.matchType) {
        case 'EXACT':
          summary.exact++;
          break;
        case 'SYNONYM':
          summary.synonym++;
          break;
        case 'CULTIVAR':
          summary.cultivar++;
          break;
        case 'GENUS_ONLY':
          summary.genusOnly++;
          break;
        case 'FUZZY':
          summary.fuzzy++;
          break;
        case 'NONE':
          summary.noMatch++;
          break;
      }
    }

    return { matches, summary };
  },
);

async function matchSinglePlant(
  plant: z.infer<typeof plantInput>,
  fuzzyThreshold: number,
  includeGenusOnly: boolean,
): Promise<z.infer<typeof matchResult>> {
  const parsed = parsePlantName(plant.scientificName);
  const base = {
    sourceRowId: plant.sourceRowId,
    inputName: plant.scientificName,
  };

  // Step 1: Exact match
  if (parsed.species) {
    const exact = await lookupProductionPlant({ genus: parsed.genus, species: parsed.species });
    if (exact.plant) {
      return {
        ...base,
        matchType: 'EXACT',
        confidence: 1.0,
        productionPlantId: exact.plant.id,
        productionGenus: exact.plant.genus,
        productionSpecies: exact.plant.species,
        notes: `Exact match on ${parsed.genus} ${parsed.species}`,
      };
    }
  }

  // Step 2: Synonym resolution
  if (parsed.species) {
    const synonymResult = await resolveSynonym({
      scientificName: `${parsed.genus} ${parsed.species}`,
    });

    if (synonymResult.acceptedName && synonymResult.synonymOf) {
      // It's a synonym — look up the accepted name in production
      const accepted = await lookupProductionPlant({
        genus: synonymResult.acceptedName.genus,
        species: synonymResult.acceptedName.species,
      });

      if (accepted.plant) {
        return {
          ...base,
          matchType: 'SYNONYM',
          confidence: 0.95,
          productionPlantId: accepted.plant.id,
          productionGenus: accepted.plant.genus,
          productionSpecies: accepted.plant.species,
          synonymResolution: {
            originalName: `${parsed.genus} ${parsed.species}`,
            acceptedName: `${synonymResult.acceptedName.genus} ${synonymResult.acceptedName.species}`,
            source: synonymResult.source!,
          },
          notes: `Synonym resolved via ${synonymResult.source}: ${parsed.genus} ${parsed.species} → ${synonymResult.acceptedName.genus} ${synonymResult.acceptedName.species}`,
        };
      }
    }
  }

  // Step 3: Cultivar fallback — try without cultivar
  if (parsed.cultivar && parsed.species) {
    const withoutCultivar = await lookupProductionPlant({
      genus: parsed.genus,
      species: parsed.species,
    });
    // Only reaches here if exact didn't match (e.g., the full name including cultivar was parsed differently)
    // But species was already tried above — cultivar step handles cases where the name parsing
    // extracted species differently with cultivar present
    if (withoutCultivar.plant) {
      return {
        ...base,
        matchType: 'CULTIVAR',
        confidence: 0.9,
        productionPlantId: withoutCultivar.plant.id,
        productionGenus: withoutCultivar.plant.genus,
        productionSpecies: withoutCultivar.plant.species,
        notes: `Cultivar stripped: '${parsed.cultivar}' removed, matched on ${parsed.genus} ${parsed.species}`,
      };
    }
  }

  // For cultivar-only names like "Cornus x 'Rutban'" where species is null after cultivar extraction
  if (parsed.cultivar && !parsed.species) {
    const genusOnly = await lookupProductionPlant({ genus: parsed.genus });
    if (genusOnly.plant && includeGenusOnly) {
      return {
        ...base,
        matchType: 'GENUS_ONLY',
        confidence: 0.5,
        productionPlantId: genusOnly.matchCount === 1 ? genusOnly.plant.id : null,
        productionGenus: genusOnly.plant.genus,
        productionSpecies: null,
        notes: `Cultivar '${parsed.cultivar}' with genus-only match (${genusOnly.matchCount} plants in genus)`,
      };
    }
  }

  // Step 4: Genus-only match
  if (parsed.isGenusOnly && includeGenusOnly) {
    const genusResult = await lookupProductionPlant({ genus: parsed.genus });
    if (genusResult.plant) {
      return {
        ...base,
        matchType: 'GENUS_ONLY',
        confidence: 0.5,
        productionPlantId: genusResult.matchCount === 1 ? genusResult.plant.id : null,
        productionGenus: genusResult.plant.genus,
        productionSpecies: null,
        notes: `Genus-only match: ${genusResult.matchCount} plants in genus ${parsed.genus}`,
      };
    }
  }

  // Step 5: Fuzzy match
  const fuzzyResult = await fuzzyMatchPlant({
    genus: parsed.genus,
    species: parsed.species ?? undefined,
    limit: 5,
  });

  if (fuzzyResult.candidates.length > 0) {
    const best = fuzzyResult.candidates[0];

    if (best.similarity >= fuzzyThreshold) {
      // Check if AI tiebreaker is needed (top 2 within 0.05 of each other)
      const needsTiebreaker =
        fuzzyResult.candidates.length >= 2 &&
        fuzzyResult.candidates[1].similarity >= best.similarity - 0.05;

      if (needsTiebreaker && process.env.ANTHROPIC_API_KEY) {
        const aiPick = await resolveAmbiguous(plant, fuzzyResult.candidates.slice(0, 3));
        if (aiPick) {
          return {
            ...base,
            matchType: 'FUZZY',
            confidence: aiPick.similarity * 0.9,
            productionPlantId: aiPick.plantId,
            productionGenus: aiPick.genus,
            productionSpecies: aiPick.species,
            alternativeCandidates: fuzzyResult.candidates.slice(0, 3).map((c) => ({
              plantId: c.plantId,
              genus: c.genus,
              species: c.species,
              similarity: c.similarity,
            })),
            notes: `AI tiebreaker selected from ${fuzzyResult.candidates.length} candidates`,
          };
        }
      }

      return {
        ...base,
        matchType: 'FUZZY',
        confidence: best.similarity * 0.9,
        productionPlantId: best.plantId,
        productionGenus: best.genus,
        productionSpecies: best.species,
        alternativeCandidates: fuzzyResult.candidates.slice(0, 3).map((c) => ({
          plantId: c.plantId,
          genus: c.genus,
          species: c.species,
          similarity: c.similarity,
        })),
        notes: `Fuzzy match: ${best.matchReason}`,
      };
    }
  }

  // Step 6: No match
  return {
    ...base,
    matchType: 'NONE',
    confidence: 0,
    productionPlantId: null,
    productionGenus: null,
    productionSpecies: null,
    alternativeCandidates: fuzzyResult.candidates.slice(0, 3).map((c) => ({
      plantId: c.plantId,
      genus: c.genus,
      species: c.species,
      similarity: c.similarity,
    })),
    notes: `No match found for ${plant.scientificName}${fuzzyResult.candidates.length > 0 ? ` (best fuzzy: ${fuzzyResult.candidates[0].genus} ${fuzzyResult.candidates[0].species} at ${Math.round(fuzzyResult.candidates[0].similarity * 100)}%)` : ''}`,
  };
}

async function resolveAmbiguous(
  plant: z.infer<typeof plantInput>,
  candidates: Array<{
    plantId: string;
    genus: string;
    species: string | null;
    commonName: string | null;
    similarity: number;
  }>,
): Promise<(typeof candidates)[0] | null> {
  try {
    const candidateList = candidates
      .map((c, i) => `${i + 1}. ${c.genus} ${c.species ?? ''} (${c.commonName ?? 'no common name'}) [${Math.round(c.similarity * 100)}%]`)
      .join('\n');

    const { text } = await ai.generate({
      model: MODELS.bulk,
      prompt:
        `A source dataset lists the plant "${plant.scientificName}"` +
        (plant.commonName ? ` (common name: "${plant.commonName}")` : '') +
        `. Which of these production database candidates is the best match?\n\n${candidateList}\n\n` +
        `Reply with ONLY the number (1, 2, or 3) of the best match, or 0 if none are appropriate.`,
    });

    const pick = parseInt(text.trim(), 10);
    if (pick >= 1 && pick <= candidates.length) {
      return candidates[pick - 1];
    }
    return null;
  } catch {
    return null;
  }
}
