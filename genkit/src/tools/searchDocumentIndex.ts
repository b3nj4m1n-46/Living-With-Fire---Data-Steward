import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ai } from '../config.js';

// Repo root is three levels up from genkit/src/tools/
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const INDEXES_DIR = resolve(REPO_ROOT, 'knowledge-base', 'indexes');

// ── Index types ──────────────────────────────────────────────────────

interface ManifestEntry {
  file: string;
  doc_name: string;
  top_level_sections: number;
  size_bytes: number;
}

interface Manifest {
  total: number;
  indexes: ManifestEntry[];
}

export interface IndexNode {
  title: string;
  node_id: string;
  start_index: number;
  end_index: number;
  summary: string;
  nodes?: IndexNode[];
}

interface DocumentStructure {
  doc_name: string;
  structure: IndexNode[];
}

export interface IndexCache {
  manifest: Manifest;
  documents: Map<string, DocumentStructure>; // keyed by index filename
}

// ── Shared cache (used by navigateDocumentTree too) ──────────────────

let cache: IndexCache | null = null;

export async function loadIndexCache(): Promise<IndexCache> {
  if (cache) return cache;

  const manifestText = await readFile(
    resolve(INDEXES_DIR, 'manifest.json'),
    'utf-8',
  );
  const manifest: Manifest = JSON.parse(manifestText);

  const documents = new Map<string, DocumentStructure>();

  // Load all structure files in parallel
  const loads = manifest.indexes.map(async (entry) => {
    const text = await readFile(resolve(INDEXES_DIR, entry.file), 'utf-8');
    documents.set(entry.file, JSON.parse(text));
  });
  await Promise.all(loads);

  cache = { manifest, documents };
  return cache;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Flatten a node tree into an array of { node, depth } */
function flattenNodes(
  nodes: IndexNode[],
  depth = 0,
): Array<{ node: IndexNode; depth: number }> {
  const out: Array<{ node: IndexNode; depth: number }> = [];
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.nodes?.length) {
      out.push(...flattenNodes(n.nodes, depth + 1));
    }
  }
  return out;
}

/** Score a text against keywords. Returns number of distinct keyword hits. */
function scoreText(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) hits++;
  }
  return hits;
}

// ── Tool definition ──────────────────────────────────────────────────

export const searchDocumentIndex = ai.defineTool(
  {
    name: 'searchDocumentIndex',
    description:
      'Searches across all 45+ knowledge-base document indexes by keyword. ' +
      'Returns matching sections with titles, summaries, and node IDs for drill-down. ' +
      'Use this to find research context about plant fire resistance, deer browse, ' +
      'defensible space methodology, and other topics covered by the knowledge base.',
    inputSchema: z.object({
      query: z
        .string()
        .describe('Search terms, e.g. "Ceanothus fire resistance methodology"'),
      maxResults: z
        .number()
        .optional()
        .default(10)
        .describe('Maximum results to return (default 10)'),
    }),
    outputSchema: z.object({
      results: z.array(
        z.object({
          documentTitle: z.string(),
          documentFile: z.string(),
          sectionTitle: z.string(),
          sectionSummary: z.string(),
          nodeId: z.string(),
          relevanceScore: z.number(),
          sourceDocument: z.string(),
        }),
      ),
      totalMatches: z.number(),
    }),
  },
  async (input) => {
    const idx = await loadIndexCache();

    // Tokenize query into keywords (lowercase, skip very short tokens)
    const keywords = input.query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    if (keywords.length === 0) {
      return { results: [], totalMatches: 0 };
    }

    // Search every node in every document
    const scored: Array<{
      documentTitle: string;
      documentFile: string;
      sectionTitle: string;
      sectionSummary: string;
      nodeId: string;
      relevanceScore: number;
      sourceDocument: string;
    }> = [];

    for (const [filename, doc] of idx.documents) {
      const manifestEntry = idx.manifest.indexes.find(
        (e) => e.file === filename,
      );
      const sourceDocument = manifestEntry?.doc_name ?? filename;

      // Get the document-level title from the first top-level section
      const documentTitle =
        doc.structure[0]?.title ?? sourceDocument.replace(/_structure\.json$/, '');

      const flat = flattenNodes(doc.structure);
      for (const { node } of flat) {
        const titleScore = scoreText(node.title, keywords) * 3;
        const summaryScore = scoreText(node.summary, keywords);
        const total = titleScore + summaryScore;

        if (total > 0) {
          scored.push({
            documentTitle,
            documentFile: filename,
            sectionTitle: node.title,
            sectionSummary: node.summary,
            nodeId: node.node_id,
            relevanceScore: total,
            sourceDocument,
          });
        }
      }
    }

    // Sort by relevance descending, then slice
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return {
      results: scored.slice(0, input.maxResults),
      totalMatches: scored.length,
    };
  },
);
