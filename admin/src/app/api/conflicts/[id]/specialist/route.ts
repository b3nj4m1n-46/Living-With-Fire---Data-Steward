import {
  fetchConflictDetail,
  fetchConflictWarrants,
  updateSpecialistVerdict,
} from "@/lib/queries/conflicts";
import {
  getDatasetContexts,
  searchKnowledgeBase,
  extractJSON,
  type DatasetContext,
  type KBResult,
} from "@/lib/research";
import type { ConflictDetail } from "@/lib/queries/conflicts";

// ── Types ───��────────────────────────���─────────────────────────────────

interface WarrantForContext {
  source_id_code: string | null;
  source_dataset: string | null;
  source_methodology: string | null;
  source_region: string | null;
}

interface SpecialistResult {
  verdict: string;
  recommendation: string;
  analysis: string;
  confidence: number;
  regionAnalysis?: {
    regionA: string | null;
    regionB: string | null;
    overlapAssessment: string;
    applicability: string;
  } | null;
}

// ── Constants ─────────────────���────────────────────────────────────────

const VALID_VERDICTS = ["REAL", "APPARENT", "NUANCED"];
const VALID_RECOMMENDATIONS = [
  "PREFER_A", "PREFER_B", "KEEP_BOTH", "KEEP_BOTH_WITH_CONTEXT",
  "NEEDS_RESEARCH", "HUMAN_DECIDE",
];

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const SPECIALIST_MODEL = "claude-sonnet-4-6-20250514";

// ── Specialist types ──────────────────────────────────────────────────

const STUB_SPECIALISTS = ["methodologyConflictFlow", "definitionConflictFlow"];
const LLM_SPECIALISTS = [
  "ratingConflictFlow", "scopeConflictFlow",
  "taxonomyConflictFlow", "researchConflictFlow", "temporalConflictFlow",
];

// ── Prompt builders ────────────────────────────────────────────────────

function buildRatingPrompt(
  conflict: ConflictDetail,
  warrants: WarrantForContext[],
  contexts: DatasetContext[],
  kbResults: KBResult[]
): string {
  const warrantA = warrants[0];
  const warrantB = warrants[1];
  const ctxA = contexts.find((c) => c.sourceDataset === warrantA?.source_dataset);
  const ctxB = contexts.find((c) => c.sourceDataset === warrantB?.source_dataset);

  const kbSection = kbResults.length > 0
    ? kbResults.map((r) => `### ${r.sectionTitle}\n${r.sectionSummary}`).join("\n\n")
    : "No relevant knowledge base entries found.";

  const scaleNote = conflict.conflict_type === "SCALE_MISMATCH"
    ? "\n\nThis conflict was classified as a SCALE_MISMATCH. Pay special attention to whether the two sources use incompatible rating scales. If so, attempt to map both values to a common scale."
    : "";

  return `You are a plant attribute specialist analyzing a rating conflict between two data sources for the Pacific West (Oregon, California, Washington) plant selection tool.

## Conflict Details
- Plant: ${conflict.plant_name}
- Attribute: ${conflict.attribute_name}
- Source A (${conflict.source_a}): "${conflict.value_a}"
- Source B (${conflict.source_b}): "${conflict.value_b}"
- Classifier noted: ${conflict.classifier_explanation ?? "No explanation provided"}${scaleNote}

## Source A Context (${conflict.source_a})
Methodology: ${warrantA?.source_methodology ?? "Unknown"}
Region: ${warrantA?.source_region ?? "Unknown"}

${ctxA?.dataDictionary ? `### Data Dictionary\n${ctxA.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxA?.readme ? `### README\n${ctxA.readme.slice(0, 2000)}` : ""}

## Source B Context (${conflict.source_b})
Methodology: ${warrantB?.source_methodology ?? "Unknown"}
Region: ${warrantB?.source_region ?? "Unknown"}

${ctxB?.dataDictionary ? `### Data Dictionary\n${ctxB.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxB?.readme ? `### README\n${ctxB.readme.slice(0, 2000)}` : ""}

## Knowledge Base Research
${kbSection}

## Your Task
Analyze this rating conflict and determine:

1. **Verdict**: REAL, APPARENT, or NUANCED?
   - REAL: Sources genuinely disagree about this plant's rating
   - APPARENT: Conflict is due to different scales/definitions that can be reconciled
   - NUANCED: Partially real — genuine disagreement but context explains part of the difference

2. **Recommendation**: PREFER_A, PREFER_B, KEEP_BOTH, KEEP_BOTH_WITH_CONTEXT, NEEDS_RESEARCH, or HUMAN_DECIDE

3. **Analysis**: 2-4 sentences explaining your reasoning.

4. **Confidence**: 0.0-1.0

Respond with ONLY valid JSON (no markdown fencing):
{
  "verdict": "REAL",
  "recommendation": "PREFER_A",
  "analysis": "...",
  "confidence": 0.85
}`;
}

function buildScopePrompt(
  conflict: ConflictDetail,
  warrants: WarrantForContext[],
  contexts: DatasetContext[],
  kbResults: KBResult[]
): string {
  const warrantA = warrants[0];
  const warrantB = warrants[1];
  const ctxA = contexts.find((c) => c.sourceDataset === warrantA?.source_dataset);
  const ctxB = contexts.find((c) => c.sourceDataset === warrantB?.source_dataset);

  const kbSection = kbResults.length > 0
    ? kbResults.map((r) => `### ${r.sectionTitle}\n${r.sectionSummary}`).join("\n\n")
    : "No relevant knowledge base entries found.";

  return `You are a plant attribute specialist analyzing a geographic scope conflict between two data sources. The target region is the Pacific West (Oregon, California, Washington).

## Conflict Details
- Plant: ${conflict.plant_name}
- Attribute: ${conflict.attribute_name}
- Source A (${conflict.source_a}): "${conflict.value_a}"
- Source B (${conflict.source_b}): "${conflict.value_b}"
- Classifier noted: ${conflict.classifier_explanation ?? "No explanation provided"}

## Source A Context (${conflict.source_a})
Methodology: ${warrantA?.source_methodology ?? "Unknown"}
Region: ${warrantA?.source_region ?? "Not specified"}

${ctxA?.dataDictionary ? `### Data Dictionary\n${ctxA.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxA?.readme ? `### README\n${ctxA.readme.slice(0, 2000)}` : ""}

## Source B Context (${conflict.source_b})
Methodology: ${warrantB?.source_methodology ?? "Unknown"}
Region: ${warrantB?.source_region ?? "Not specified"}

${ctxB?.dataDictionary ? `### Data Dictionary\n${ctxB.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxB?.readme ? `### README\n${ctxB.readme.slice(0, 2000)}` : ""}

## Knowledge Base Research
${kbSection}

## Your Task
This conflict was classified as a SCOPE_DIFFERENCE — values may apply to different geographic/climatic contexts.

Analyze and determine:

1. **Verdict**: REAL, APPARENT, or NUANCED?
2. **Recommendation**: PREFER_A, PREFER_B, KEEP_BOTH, KEEP_BOTH_WITH_CONTEXT, NEEDS_RESEARCH, or HUMAN_DECIDE
3. **Analysis**: 2-4 sentences addressing regional applicability.
4. **Confidence**: 0.0-1.0
5. **Region Analysis**: Geographic overlap and applicability assessment.

Respond with ONLY valid JSON (no markdown fencing):
{
  "verdict": "APPARENT",
  "recommendation": "PREFER_A",
  "analysis": "...",
  "confidence": 0.8,
  "regionAnalysis": {
    "regionA": "Southern California",
    "regionB": "New Jersey",
    "overlapAssessment": "disjoint",
    "applicability": "Source A covers the Pacific West directly; Source B is not applicable."
  }
}`;
}

function buildTaxonomyPrompt(
  conflict: ConflictDetail,
  warrants: WarrantForContext[],
  contexts: DatasetContext[],
  kbResults: KBResult[]
): string {
  const warrantA = warrants[0];
  const warrantB = warrants[1];
  const ctxA = contexts.find((c) => c.sourceDataset === warrantA?.source_dataset);
  const ctxB = contexts.find((c) => c.sourceDataset === warrantB?.source_dataset);

  const kbSection = kbResults.length > 0
    ? kbResults.map((r) => `### ${r.sectionTitle}\n${r.sectionSummary}`).join("\n\n")
    : "No relevant knowledge base entries found.";

  return `You are a plant taxonomy specialist analyzing a naming/granularity conflict. You have access to POWO/WCVP and World Flora Online as authoritative backbones.

## Conflict Details
- Plant: ${conflict.plant_name}
- Attribute: ${conflict.attribute_name}
- Source A (${conflict.source_a}): "${conflict.value_a}"
- Source B (${conflict.source_b}): "${conflict.value_b}"
- Classifier noted: ${conflict.classifier_explanation ?? "No explanation provided"}

## Source A Context (${conflict.source_a})
${ctxA?.dataDictionary ? `### Data Dictionary\n${ctxA.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxA?.readme ? `### README\n${ctxA.readme.slice(0, 2000)}` : ""}

## Source B Context (${conflict.source_b})
${ctxB?.dataDictionary ? `### Data Dictionary\n${ctxB.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxB?.readme ? `### README\n${ctxB.readme.slice(0, 2000)}` : ""}

## Knowledge Base Research
${kbSection}

## Common Taxonomy Issues
1. SYNONYMS: One name may be an old synonym of the other
2. RECLASSIFICATION: Genus splits/merges over time
3. GENUS vs SPECIES: Source rates genus-level but production has individual species
4. CULTIVAR CONFUSION: Source rates a cultivar, production has the species
5. SPELLING VARIANTS: Typos in source data
6. AUTHORITY DIFFERENCES: Same binomial, different authors

## Your Task
Classify as SAME_TAXON, DIFFERENT_TAXA, GENUS_SPECIES_MISMATCH, CULTIVAR_SPECIES_MISMATCH, or UNRESOLVED.

Respond with ONLY valid JSON (no markdown fencing):
{
  "verdict": "APPARENT",
  "recommendation": "KEEP_BOTH",
  "analysis": "...",
  "confidence": 0.9,
  "taxonomyAnalysis": {
    "resolution": "SAME_TAXON",
    "nameA": "...",
    "nameB": "...",
    "acceptedName": "...",
    "backboneEvidence": "..."
  }
}`;
}

function buildResearchPrompt(
  conflict: ConflictDetail,
  warrants: WarrantForContext[],
  contexts: DatasetContext[],
  kbResults: KBResult[]
): string {
  const warrantA = warrants[0];
  const warrantB = warrants[1];
  const ctxA = contexts.find((c) => c.sourceDataset === warrantA?.source_dataset);
  const ctxB = contexts.find((c) => c.sourceDataset === warrantB?.source_dataset);

  const kbSection = kbResults.length > 0
    ? kbResults.map((r) => `### ${r.sectionTitle}\n${r.sectionSummary}`).join("\n\n")
    : "No relevant knowledge base entries found.";

  return `You are a research agent with access to structured metadata for 40+ plant datasets AND knowledge-base document summaries. Synthesize evidence to evaluate this conflict.

## Conflict Details
- Plant: ${conflict.plant_name}
- Attribute: ${conflict.attribute_name}
- Source A (${conflict.source_a}): "${conflict.value_a}"
- Source B (${conflict.source_b}): "${conflict.value_b}"
- Classifier noted: ${conflict.classifier_explanation ?? "No explanation provided"}

## Source A Context (${conflict.source_a})
Methodology: ${warrantA?.source_methodology ?? "Unknown"}
Region: ${warrantA?.source_region ?? "Unknown"}

${ctxA?.dataDictionary ? `### Data Dictionary\n${ctxA.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxA?.readme ? `### README\n${ctxA.readme.slice(0, 2000)}` : ""}

## Source B Context (${conflict.source_b})
Methodology: ${warrantB?.source_methodology ?? "Unknown"}
Region: ${warrantB?.source_region ?? "Unknown"}

${ctxB?.dataDictionary ? `### Data Dictionary\n${ctxB.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxB?.readme ? `### README\n${ctxB.readme.slice(0, 2000)}` : ""}

## Knowledge Base Document Findings
${kbSection}

## Your Task
Synthesize all evidence. Compare methodologies, geographic scope, temporal context, and document findings.

Respond with ONLY valid JSON (no markdown fencing):
{
  "verdict": "NUANCED",
  "recommendation": "KEEP_BOTH_WITH_CONTEXT",
  "analysis": "...",
  "confidence": 0.7,
  "datasetFindings": [{"sourceDataset": "...", "methodology": "...", "geographicScope": "...", "relevantExcerpt": "..."}],
  "documentFindings": [{"documentName": "...", "sectionTitle": "...", "finding": "...", "relevance": "..."}]
}`;
}

function buildTemporalPrompt(
  conflict: ConflictDetail,
  warrants: WarrantForContext[],
  contexts: DatasetContext[],
  kbResults: KBResult[]
): string {
  const warrantA = warrants[0];
  const warrantB = warrants[1];
  const ctxA = contexts.find((c) => c.sourceDataset === warrantA?.source_dataset);
  const ctxB = contexts.find((c) => c.sourceDataset === warrantB?.source_dataset);

  return `You are a temporal conflict specialist. When sources from different time periods disagree, determine whether the newer source supersedes the older one.

## Conflict Details
- Plant: ${conflict.plant_name}
- Attribute: ${conflict.attribute_name}
- Source A (${conflict.source_a}): "${conflict.value_a}"
- Source B (${conflict.source_b}): "${conflict.value_b}"
- Classifier noted: ${conflict.classifier_explanation ?? "No explanation provided"}

## Source A Context (${conflict.source_a})
Methodology: ${warrantA?.source_methodology ?? "Unknown"}
Region: ${warrantA?.source_region ?? "Unknown"}

${ctxA?.dataDictionary ? `### Data Dictionary\n${ctxA.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxA?.readme ? `### README\n${ctxA.readme.slice(0, 2000)}` : ""}

## Source B Context (${conflict.source_b})
Methodology: ${warrantB?.source_methodology ?? "Unknown"}
Region: ${warrantB?.source_region ?? "Unknown"}

${ctxB?.dataDictionary ? `### Data Dictionary\n${ctxB.dataDictionary.slice(0, 3000)}` : "No data dictionary available."}

${ctxB?.readme ? `### README\n${ctxB.readme.slice(0, 2000)}` : ""}

## Temporal Assessment Rules
1. Age alone does NOT determine quality.
2. Check if newer source explicitly references the older one.
3. Taxonomy changes over time may explain the conflict.
4. Fire science pre-2000 used different testing standards.
5. Climate change affects drought stress and flammability.
6. Invasiveness assessments change as species spread.

Respond with ONLY valid JSON (no markdown fencing):
{
  "verdict": "APPARENT",
  "recommendation": "PREFER_B",
  "analysis": "...",
  "confidence": 0.8,
  "temporalAnalysis": {
    "yearGap": 15,
    "newerSource": "B",
    "supersedes": true
  }
}`;
}

// ── Anthropic API call ──���──��───────────────────────────────────────────

async function callAnthropic(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SPECIALIST_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? "";
}

// ── Route Handler ──────────────────────────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Fetch conflict
    const conflict = await fetchConflictDetail(id);
    if (!conflict) {
      return Response.json({ error: "Conflict not found" }, { status: 404 });
    }

    if (!conflict.specialist_agent) {
      return Response.json(
        { error: "No specialist agent assigned to this conflict" },
        { status: 400 }
      );
    }

    const agent = conflict.specialist_agent;

    if (!STUB_SPECIALISTS.includes(agent) && !LLM_SPECIALISTS.includes(agent)) {
      return Response.json(
        { error: `Specialist "${agent}" is not recognized` },
        { status: 400 }
      );
    }

    // 2. Fetch warrants
    const warrants = await fetchConflictWarrants(
      conflict.warrant_a_id,
      conflict.warrant_b_id
    );

    // 3. Handle stub specialists (no LLM call needed)
    if (STUB_SPECIALISTS.includes(agent)) {
      const [datasetContexts] = await Promise.all([
        getDatasetContexts(warrants),
      ]);

      const warrantA = warrants[0];
      const warrantB = warrants[1];
      const ctxA = datasetContexts.find((c) => c.sourceDataset === warrantA?.source_dataset);
      const ctxB = datasetContexts.find((c) => c.sourceDataset === warrantB?.source_dataset);

      const label = agent === "methodologyConflictFlow" ? "Methodology" : "Definition";
      const stubAnalysis =
        `${label} conflict requires human review.\n\n` +
        `Source A (${conflict.source_a}) methodology: ${warrantA?.source_methodology ?? "Unknown"}\n` +
        `Source B (${conflict.source_b}) methodology: ${warrantB?.source_methodology ?? "Unknown"}\n\n` +
        `--- Source A Data Dictionary ---\n${ctxA?.dataDictionary?.slice(0, 1500) ?? "Not available"}\n\n` +
        `--- Source B Data Dictionary ---\n${ctxB?.dataDictionary?.slice(0, 1500) ?? "Not available"}`;

      await updateSpecialistVerdict(id, "NUANCED", stubAnalysis, "HUMAN_DECIDE");

      return Response.json({
        verdict: "NUANCED",
        recommendation: "HUMAN_DECIDE",
        analysis: stubAnalysis,
        confidence: 0,
      } satisfies SpecialistResult);
    }

    // 4. Load dataset contexts and search knowledge base
    const [datasetContexts, kbResults] = await Promise.all([
      getDatasetContexts(warrants),
      searchKnowledgeBase(conflict.plant_name, conflict.attribute_name),
    ]);

    // 5. Build prompt based on specialist type
    let prompt: string;
    switch (agent) {
      case "scopeConflictFlow":
        prompt = buildScopePrompt(conflict, warrants, datasetContexts, kbResults);
        break;
      case "taxonomyConflictFlow":
        prompt = buildTaxonomyPrompt(conflict, warrants, datasetContexts, kbResults);
        break;
      case "researchConflictFlow":
        prompt = buildResearchPrompt(conflict, warrants, datasetContexts, kbResults);
        break;
      case "temporalConflictFlow":
        prompt = buildTemporalPrompt(conflict, warrants, datasetContexts, kbResults);
        break;
      default:
        prompt = buildRatingPrompt(conflict, warrants, datasetContexts, kbResults);
        break;
    }

    // 6. Call Anthropic API
    const responseText = await callAnthropic(prompt);

    // 7. Parse response
    let parsed: Record<string, unknown>;
    try {
      parsed = extractJSON(responseText);
    } catch {
      const retryText = await callAnthropic(
        "Your previous response was not valid JSON. Please respond with ONLY a JSON object " +
        "(no markdown fencing) matching this schema: { verdict, recommendation, analysis, confidence }. " +
        "Here is what you tried:\n\n" + responseText.slice(0, 2000)
      );
      parsed = extractJSON(retryText);
    }

    // 8. Validate
    const verdict = VALID_VERDICTS.includes(parsed.verdict as string)
      ? (parsed.verdict as string)
      : "NUANCED";

    const recommendation = VALID_RECOMMENDATIONS.includes(parsed.recommendation as string)
      ? (parsed.recommendation as string)
      : "HUMAN_DECIDE";

    const analysis = typeof parsed.analysis === "string"
      ? parsed.analysis
      : "Specialist analysis could not be parsed.";

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    // 9. Append domain-specific analysis to stored analysis
    let fullAnalysis = analysis;
    const regionAnalysis = parsed.regionAnalysis as Record<string, unknown> | null;
    if (regionAnalysis && typeof regionAnalysis === "object") {
      fullAnalysis += `\n\n---\nRegion Analysis: ${JSON.stringify(regionAnalysis)}`;
    }
    const taxonomyAnalysis = parsed.taxonomyAnalysis as Record<string, unknown> | null;
    if (taxonomyAnalysis && typeof taxonomyAnalysis === "object") {
      fullAnalysis += `\n\n---\nTaxonomy Analysis: ${JSON.stringify(taxonomyAnalysis)}`;
    }
    const temporalAnalysis = parsed.temporalAnalysis as Record<string, unknown> | null;
    if (temporalAnalysis && typeof temporalAnalysis === "object") {
      fullAnalysis += `\n\n---\nTemporal Analysis: ${JSON.stringify(temporalAnalysis)}`;
    }
    const datasetFindings = parsed.datasetFindings as unknown[] | null;
    const documentFindings = parsed.documentFindings as unknown[] | null;
    if (Array.isArray(datasetFindings)) {
      fullAnalysis += `\n\n---\nDataset Findings: ${JSON.stringify(datasetFindings)}`;
    }
    if (Array.isArray(documentFindings)) {
      fullAnalysis += `\n\nDocument Findings: ${JSON.stringify(documentFindings)}`;
    }

    // 10. Write results to DB
    await updateSpecialistVerdict(id, verdict, fullAnalysis, recommendation);

    // 11. Return result
    const result: SpecialistResult = {
      verdict,
      recommendation,
      analysis,
      confidence,
    };

    if (regionAnalysis && typeof regionAnalysis === "object") {
      result.regionAnalysis = {
        regionA: typeof regionAnalysis.regionA === "string" ? regionAnalysis.regionA : null,
        regionB: typeof regionAnalysis.regionB === "string" ? regionAnalysis.regionB : null,
        overlapAssessment: typeof regionAnalysis.overlapAssessment === "string"
          ? regionAnalysis.overlapAssessment : "unknown",
        applicability: typeof regionAnalysis.applicability === "string"
          ? regionAnalysis.applicability : "",
      };
    }

    return Response.json(result);
  } catch (error) {
    console.error("POST /api/conflicts/[id]/specialist error:", error);
    return Response.json(
      { error: "Failed to run specialist analysis" },
      { status: 500 }
    );
  }
}
