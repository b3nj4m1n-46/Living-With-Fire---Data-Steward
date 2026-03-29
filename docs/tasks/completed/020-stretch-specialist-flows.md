# Stretch Specialist Flows — Taxonomy, Research, Temporal (+ stubs for Methodology, Definition)

> **Status:** COMPLETE
> **Priority:** P3 (polish)
> **Depends on:** 014-specialist-agents (rating + scope must land first to establish the pattern)
> **Blocks:** None — all of these are additive to the demo
> **Commit:** 0061ef4

## Problem

The Conflict Classifier routes conflicts to 6 specialist flows (see `SPECIALIST_ROUTES` in `classifyConflictFlow.ts` lines 53-62). Currently only rating and scope are planned for implementation (014). The other 4 specialists — taxonomy, temporal, methodology, definition — have no flows, so routed conflicts hit a dead end.

Three of these (taxonomy, research, temporal) are **80%+ done** — existing tools and flows already handle the core logic. The remaining two (methodology, definition) are real work but follow an identical pattern. Building the easy three and stubbing the hard two gets us 5/6 specialists working for the demo and prevents the "what happens when I click this?" dead end in the admin portal.

## Current Implementation

### Already built (just needs a flow wrapper)

| Agent | What exists | What's missing |
|---|---|---|
| **Taxonomy** | `resolveSynonym` tool queries POWO/WFO, `matchPlantFlow` handles synonym resolution, `fuzzyMatch` handles spelling variants | A `taxonomyConflictFlow` that takes a GRANULARITY_MISMATCH conflict, runs the existing tools, and returns a structured resolution |
| **Research** | `getDatasetContext`, `searchDocumentIndex`, `navigateDocumentTree` tools all built and registered (T22a-d) | A `researchConflictFlow` that orchestrates the 3 tools with an LLM call to produce a structured evidence report |
| **Temporal** | `getDatasetContext` returns README with publication dates, `getSourceMetadata` tool exists | A `temporalConflictFlow` that compares dates, checks for supersession, and returns a recommendation |

### Needs real implementation (stub for now)

| Agent | Why it's harder |
|---|---|
| **Methodology** | Requires LLM to assess methodology quality hierarchy from DATA-DICTIONARY prose — not a simple lookup |
| **Definition** | Requires LLM to compare term definitions across sources and determine if conflict is semantic vs real |

## Proposed Changes

### 1. Taxonomy Conflict Flow (`taxonomyConflictFlow.ts`)

Wraps existing tools into a specialist flow:

1. Extract the two plant names from the conflict's warrants
2. Call `resolveSynonym` for both names
3. Call `fuzzyMatchPlant` if synonym resolution fails
4. LLM prompt (small — Haiku): given the backbone results, classify as SAME_TAXON / DIFFERENT_TAXA / GENUS_SPECIES_MISMATCH / CULTIVAR_SPECIES_MISMATCH / UNRESOLVED
5. Return structured output per `taxonomy-agent.md` schema

**Prompt template** (extract to `genkit/src/prompts/taxonomy-conflict.md` per 017):
- System prompt from `docs/planning/agents/taxonomy-agent.md` lines 22-38
- Dynamic: backbone query results, conflict context

### 2. Research Conflict Flow (`researchConflictFlow.ts`)

Orchestrates the 3 existing research tools with an LLM synthesis:

1. Identify source datasets from conflict warrants
2. Call `getDatasetContext` for each source dataset
3. Call `searchDocumentIndex` with plant name + attribute keywords
4. For top 3-5 document hits, call `navigateDocumentTree` to get section details
5. LLM prompt (Sonnet — needs reasoning): synthesize dataset metadata + document findings into structured evidence report
6. Return output per `research-agent.md` schema

**Prompt template** (extract to `genkit/src/prompts/research-conflict.md` per 017):
- System prompt from `docs/planning/agents/research-agent.md` lines 30-49
- Dynamic: conflict context, dataset findings, document findings

### 3. Temporal Conflict Flow (`temporalConflictFlow.ts`)

Lightweight date-comparison flow:

1. Call `getDatasetContext` for both sources — extract publication year from README
2. Calculate year gap
3. If gap < 3 years: likely not a real temporal conflict, recommend reclassify
4. LLM prompt (Haiku): given the year gap, field context, and methodology notes, assess whether newer supersedes older
5. Return output per `temporal-agent.md` schema

**Prompt template** (extract to `genkit/src/prompts/temporal-conflict.md` per 017):
- System prompt from `docs/planning/agents/temporal-agent.md` lines 20-30
- Dynamic: year gap, source metadata, conflict context

### 4. Methodology Stub (`methodologyConflictFlow.ts`)

Minimal stub that returns useful info without deep analysis:

1. Call `getDatasetContext` for both sources
2. Return a structured response with `recommendation: "HUMAN_DECIDE"` and the methodology text from each DATA-DICTIONARY
3. No LLM call — just surfaces the raw methodology descriptions for the admin

### 5. Definition Stub (`definitionConflictFlow.ts`)

Minimal stub:

1. Call `getDatasetContext` for both sources
2. Extract term definitions from DATA-DICTIONARY if present
3. Return with `recommendation: "HUMAN_DECIDE"` and both definitions side-by-side
4. No LLM call

### 6. Wire into Conflict Classifier dispatch

Update `classifyConflictFlow.ts` `SPECIALIST_ROUTES` — all 6 routes now point to real flows (3 full, 2 stubs, plus existing rating from 014). Update admin portal conflict detail page to render specialist output for all types.

### What Does NOT Change

- `classifyConflictFlow.ts` classification logic — only the dispatch table
- Existing tools (resolveSynonym, fuzzyMatch, dataset context, PageIndex tools)
- `matchPlantFlow`, `mapSchemaFlow`, `bulkEnhanceFlow`
- Agent profile MDs in `docs/planning/agents/` — those remain design specs

## Migration Strategy

1. Implement `taxonomyConflictFlow.ts` — mostly wiring existing tools
2. Implement `researchConflictFlow.ts` — orchestrate existing tools + LLM synthesis
3. Implement `temporalConflictFlow.ts` — date comparison + small LLM call
4. Implement `methodologyConflictFlow.ts` stub — getDatasetContext + HUMAN_DECIDE
5. Implement `definitionConflictFlow.ts` stub — getDatasetContext + HUMAN_DECIDE
6. Update specialist dispatch in classifier or admin portal API routes
7. Test: run classifier on existing conflicts, verify each type routes and returns output

## Files Modified

### New Files
- `genkit/src/flows/taxonomyConflictFlow.ts`
- `genkit/src/flows/researchConflictFlow.ts`
- `genkit/src/flows/temporalConflictFlow.ts`
- `genkit/src/flows/methodologyConflictFlow.ts` (stub)
- `genkit/src/flows/definitionConflictFlow.ts` (stub)

### Modified Files
- `admin/` conflict detail API route or page — render specialist output for new types
- `docs/planning/agents/README.md` — update flow status column

## Verification

1. Create a test conflict of type GRANULARITY_MISMATCH → verify `taxonomyConflictFlow` returns a resolution with backbone evidence
2. Create a test conflict and call `researchConflictFlow` → verify it returns dataset findings + document findings from PageIndex
3. Create a TEMPORAL_CONFLICT between FIRE-01 (~2010) and a newer source → verify year gap calculation and recommendation
4. Create a METHODOLOGY_DIFFERENCE conflict → verify stub returns both methodology descriptions with HUMAN_DECIDE
5. Create a DEFINITION_CONFLICT → verify stub returns both definitions with HUMAN_DECIDE
6. Verify admin portal renders all 6 specialist types without errors
