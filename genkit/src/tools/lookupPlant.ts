import { z } from 'zod';
import { ai } from '../config.js';
import { doltPool } from './dolt.js';

export const lookupProductionPlant = ai.defineTool(
  {
    name: 'lookupProductionPlant',
    description:
      'Looks up a plant by genus (and optionally species) in the staging database, ' +
      'returning the plant record and all its attribute values with source names.',
    inputSchema: z.object({
      genus: z.string().describe('Plant genus, e.g. "Ceanothus"'),
      species: z.string().optional().describe('Plant species, e.g. "velutinus"'),
    }),
    outputSchema: z.object({
      plant: z
        .object({
          id: z.string(),
          genus: z.string(),
          species: z.string().nullable(),
          common_name: z.string().nullable(),
        })
        .nullable(),
      values: z.array(
        z.object({
          attribute_name: z.string(),
          value: z.string().nullable(),
          source_name: z.string().nullable(),
        }),
      ),
      matchCount: z.number(),
    }),
  },
  async (input) => {
    // Find matching plants — split query since DoltgreSQL lacks ILIKE and cast syntax
    const plantResult = input.species
      ? await doltPool.query(
          `SELECT id, genus, species, common_name
           FROM plants
           WHERE LOWER(genus) = LOWER($1) AND LOWER(species) = LOWER($2)
           ORDER BY genus, species`,
          [input.genus, input.species],
        )
      : await doltPool.query(
          `SELECT id, genus, species, common_name
           FROM plants
           WHERE LOWER(genus) = LOWER($1)
           ORDER BY genus, species`,
          [input.genus],
        );

    const matchCount = plantResult.rowCount ?? 0;
    if (matchCount === 0) {
      return { plant: null, values: [], matchCount: 0 };
    }

    const plant = plantResult.rows[0];

    // Get all values for the first matched plant
    // Uses subquery instead of LEFT JOIN — DoltgreSQL panics on LEFT JOIN with nullable FKs
    const valuesResult = await doltPool.query(
      `SELECT a.name AS attribute_name, v."value",
              (SELECT s.name FROM sources s WHERE s.id = v.source_id) AS source_name
       FROM "values" v
       JOIN attributes a ON a.id = v.attribute_id
       WHERE v.plant_id = $1
       ORDER BY a.name`,
      [plant.id],
    );

    return {
      plant: {
        id: plant.id,
        genus: plant.genus,
        species: plant.species,
        common_name: plant.common_name,
      },
      values: valuesResult.rows,
      matchCount,
    };
  },
);
