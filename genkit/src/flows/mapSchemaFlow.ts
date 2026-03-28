import { z } from 'zod';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai, MODELS } from '../config.js';
import { getDatasetContext } from '../tools/datasetContext.js';
import { getProductionAttributes } from '../tools/productionAttributes.js';
import { sampleSourceData } from '../tools/sampleSourceData.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

// --- Schemas ---

const mappingType = z.enum(['DIRECT', 'CROSSWALK', 'SPLIT', 'NEW_ATTRIBUTE', 'SKIP', 'UNCERTAIN']);

export const columnMapping = z.object({
  sourceColumn: z.string(),
  sourceType: z.string(),
  sourceDefinition: z.string(),
  mappingType,
  targetAttributeId: z.string().nullable(),
  targetAttributeName: z.string().nullable(),
  confidence: z.number(),
  reasoning: z.string(),
  crosswalk: z.record(z.string(), z.string()).nullable(),
  notes: z.string(),
});

const flowInput = z.object({
  sourceDataset: z.string().describe('Dataset folder name, e.g. "FirePerformancePlants"'),
  datasetFolder: z.string().describe('Full relative path, e.g. "database-sources/fire/FirePerformancePlants"'),
  csvPath: z.string().optional().describe('Override CSV path (default: first .csv in datasetFolder)'),
});

export const mapSchemaOutput = z.object({
  sourceDataset: z.string(),
  sourceIdCode: z.string(),
  mappings: z.array(columnMapping),
  unmappedColumns: z.array(z.string()),
  summary: z.object({
    total: z.number(),
    direct: z.number(),
    crosswalk: z.number(),
    split: z.number(),
    newAttribute: z.number(),
    skip: z.number(),
    uncertain: z.number(),
  }),
});

// --- Helpers ---

/** Find the first .csv file in a dataset folder. */
async function findCSV(datasetFolder: string): Promise<string> {
  const fullDir = resolve(REPO_ROOT, datasetFolder);
  const entries = await readdir(fullDir);
  const csv = entries.find((f) => f.endsWith('.csv'));
  if (!csv) throw new Error(`No .csv file found in ${datasetFolder}`);
  return `${datasetFolder}/${csv}`;
}

/** Format production attributes as a readable table for the LLM prompt. */
function formatAttributesTable(
  attrs: Array<{
    id: string;
    name: string;
    parentName: string | null;
    valueType: string;
    valuesAllowed: string | null;
    selectionType: string | null;
  }>,
): string {
  const lines = ['| ID | Name | Parent Category | Value Type | Allowed Values | Selection |', '|----|------|-----------------|------------|----------------|-----------|'];
  for (const a of attrs) {
    lines.push(
      `| ${a.id} | ${a.name} | ${a.parentName ?? '(root)'} | ${a.valueType} | ${a.valuesAllowed ?? ''} | ${a.selectionType ?? ''} |`,
    );
  }
  return lines.join('\n');
}

/** Format unique values per column for the LLM prompt. */
function formatUniqueValues(uv: Record<string, string[]>): string {
  return Object.entries(uv)
    .map(([col, vals]) => `- **${col}**: ${vals.join(', ')}`)
    .join('\n');
}

/** Format sample rows as a readable table. */
function formatSampleRows(headers: string[], rows: Record<string, string>[]): string {
  if (rows.length === 0) return '(no data rows)';
  const headerLine = '| ' + headers.join(' | ') + ' |';
  const sep = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const dataLines = rows.map((r) => '| ' + headers.map((h) => r[h] ?? '').join(' | ') + ' |');
  return [headerLine, sep, ...dataLines].join('\n');
}

/** Extract JSON from an LLM response that may include markdown fencing or preamble. */
function extractJSON(text: string): unknown {
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // Try fenced JSON block
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  // Try brace extraction
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      // continue
    }
  }

  throw new Error(`Could not extract JSON from LLM response:\n${text.slice(0, 500)}`);
}

// --- Flow ---

export const mapSchemaFlow = ai.defineFlow(
  {
    name: 'mapSchemaFlow',
    inputSchema: flowInput,
    outputSchema: mapSchemaOutput,
  },
  async (input) => {
    // 1. Resolve CSV path
    const csvPath = input.csvPath ?? (await findCSV(input.datasetFolder));

    // 2. Gather context in parallel
    const [context, attrResult, sample] = await Promise.all([
      getDatasetContext({ datasetFolder: input.datasetFolder }),
      getProductionAttributes({}),
      sampleSourceData({ csvPath }),
    ]);

    // 3. Build valid attribute ID set for validation
    const validAttrIds = new Set(attrResult.attributes.map((a) => a.id));

    // 4. Build the LLM prompt
    const prompt = `You are a schema mapping specialist for a plant database.
Your task is to map every column from a source dataset to our production attribute schema (EAV model with 125 attributes).

## Source Dataset: ${input.sourceDataset} (${context.sourceId})

### Data Dictionary
${context.dataDictionary || '(not available)'}

### README
${context.readme || '(not available)'}

## Production Attribute Schema (Target)

${formatAttributesTable(attrResult.attributes)}

## Source CSV Analysis

**Total rows:** ${sample.totalRows}
**Headers:** ${sample.headers.join(', ')}

### Sample Data (first ${sample.sampleRows.length} rows):
${formatSampleRows(sample.headers, sample.sampleRows)}

### Unique Values Per Column:
${formatUniqueValues(sample.uniqueValues)}

## Instructions

For EACH source column, determine the best mapping to a production attribute.

**Mapping types:**
- **DIRECT** — Column maps 1:1 to a production attribute, values are already compatible
- **CROSSWALK** — Column maps 1:1 to a production attribute but values need translation (you MUST provide a "crosswalk" object mapping each source value to the production value)
- **SPLIT** — One column needs to be split into multiple production attributes (create one entry per target attribute)
- **NEW_ATTRIBUTE** — Column represents data not in the current production schema
- **SKIP** — Column should be ignored (join keys like scientific_name, internal IDs, slugs, URLs)
- **UNCERTAIN** — Cannot determine mapping confidently

**Rules:**
- scientific_name / botanical_name columns are JOIN KEYS — mark as SKIP
- For CROSSWALK mappings, provide the full crosswalk object mapping every unique source value to its production equivalent
- Set confidence 0.0-1.0 based on how certain you are about the mapping
- Use the exact attribute UUIDs from the production schema table above
- Include ALL source columns — do not omit any

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{
  "mappings": [
    {
      "sourceColumn": "column_name",
      "sourceType": "data type description",
      "sourceDefinition": "what this column represents",
      "mappingType": "DIRECT|CROSSWALK|SPLIT|NEW_ATTRIBUTE|SKIP|UNCERTAIN",
      "targetAttributeId": "uuid-from-table-above or null",
      "targetAttributeName": "attribute name or null",
      "confidence": 0.95,
      "reasoning": "brief explanation of why this mapping was chosen",
      "crosswalk": {"source_val": "production_val"} or null,
      "notes": "any caveats or additional context"
    }
  ]
}`;

    // 5. Call the LLM
    const { text } = await ai.generate({
      model: MODELS.quality,
      prompt,
    });

    // 6. Extract and parse JSON
    let parsed: { mappings: Array<Record<string, unknown>> };
    try {
      parsed = extractJSON(text) as typeof parsed;
    } catch {
      // Retry once with a simpler prompt
      const { text: retryText } = await ai.generate({
        model: MODELS.quality,
        prompt:
          'Your previous response was not valid JSON. Please respond with ONLY the JSON object ' +
          '(no markdown fencing, no explanation text) matching the schema I described. ' +
          'Here is what you tried to produce:\n\n' +
          text.slice(0, 2000),
      });
      parsed = extractJSON(retryText) as typeof parsed;
    }

    // 7. Validate and build typed mappings
    const mappings: z.infer<typeof columnMapping>[] = (parsed.mappings ?? []).map((m) => {
      const targetId = (m.targetAttributeId as string) ?? null;
      let mType = (m.mappingType as string) ?? 'UNCERTAIN';
      let notes = (m.notes as string) ?? '';

      // Validate target attribute ID exists
      if (targetId && !validAttrIds.has(targetId)) {
        mType = 'UNCERTAIN';
        notes = `${notes} [Original targetAttributeId "${targetId}" not found in production schema]`.trim();
      }

      return {
        sourceColumn: (m.sourceColumn as string) ?? '',
        sourceType: (m.sourceType as string) ?? '',
        sourceDefinition: (m.sourceDefinition as string) ?? '',
        mappingType: mType as z.infer<typeof mappingType>,
        targetAttributeId: validAttrIds.has(targetId ?? '') ? targetId : null,
        targetAttributeName: (m.targetAttributeName as string) ?? null,
        confidence: typeof m.confidence === 'number' ? m.confidence : 0,
        reasoning: (m.reasoning as string) ?? '',
        crosswalk: (m.crosswalk as Record<string, string>) ?? null,
        notes,
      };
    });

    // 8. Find unmapped columns (CSV headers not in any mapping)
    const mappedColumns = new Set(mappings.map((m) => m.sourceColumn));
    const unmappedColumns = sample.headers.filter((h) => !mappedColumns.has(h));

    // 9. Compute summary
    const summary = {
      total: mappings.length,
      direct: 0,
      crosswalk: 0,
      split: 0,
      newAttribute: 0,
      skip: 0,
      uncertain: 0,
    };

    for (const m of mappings) {
      switch (m.mappingType) {
        case 'DIRECT':
          summary.direct++;
          break;
        case 'CROSSWALK':
          summary.crosswalk++;
          break;
        case 'SPLIT':
          summary.split++;
          break;
        case 'NEW_ATTRIBUTE':
          summary.newAttribute++;
          break;
        case 'SKIP':
          summary.skip++;
          break;
        case 'UNCERTAIN':
          summary.uncertain++;
          break;
      }
    }

    return {
      sourceDataset: input.sourceDataset,
      sourceIdCode: context.sourceId,
      mappings,
      unmappedColumns,
      summary,
    };
  },
);
