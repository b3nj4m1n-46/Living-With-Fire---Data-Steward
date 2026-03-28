import { z } from 'zod';
import { ai } from '../config.js';
import { loadIndexCache, type IndexNode } from './searchDocumentIndex.js';

// ── Helpers ──────────────────────────────────────────────────────────

interface FindResult {
  node: IndexNode;
  parentTitle: string | null;
  depth: number;
}

/** Recursively find a node by ID, tracking parent and depth. */
function findNode(
  nodes: IndexNode[],
  targetId: string,
  parentTitle: string | null = null,
  depth = 0,
): FindResult | null {
  for (const n of nodes) {
    if (n.node_id === targetId) {
      return { node: n, parentTitle, depth };
    }
    if (n.nodes?.length) {
      const found = findNode(n.nodes, targetId, n.title, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ── Tool definition ──────────────────────────────────────────────────

export const navigateDocumentTree = ai.defineTool(
  {
    name: 'navigateDocumentTree',
    description:
      'Drills into a specific section of a knowledge-base document index. ' +
      'Use a nodeId from searchDocumentIndex results to explore subsections. ' +
      'Returns the section details plus its child sections for progressive exploration.',
    inputSchema: z.object({
      indexFile: z
        .string()
        .describe(
          'Index filename from search results, e.g. "UCForestProducts_structure.json"',
        ),
      nodeId: z.string().describe('Section node ID from search results'),
    }),
    outputSchema: z.object({
      title: z.string(),
      summary: z.string(),
      children: z.array(
        z.object({
          nodeId: z.string(),
          title: z.string(),
          summary: z.string(),
          hasChildren: z.boolean(),
        }),
      ),
      parentTitle: z.string().nullable(),
      depth: z.number(),
    }),
  },
  async (input) => {
    const idx = await loadIndexCache();
    const doc = idx.documents.get(input.indexFile);

    if (!doc) {
      return {
        title: '',
        summary: `Index file not found: ${input.indexFile}`,
        children: [],
        parentTitle: null,
        depth: 0,
      };
    }

    const result = findNode(doc.structure, input.nodeId);

    if (!result) {
      return {
        title: '',
        summary: `Node not found: ${input.nodeId} in ${input.indexFile}`,
        children: [],
        parentTitle: null,
        depth: 0,
      };
    }

    const { node, parentTitle, depth } = result;

    const children = (node.nodes ?? []).map((child) => ({
      nodeId: child.node_id,
      title: child.title,
      summary: child.summary,
      hasChildren: (child.nodes?.length ?? 0) > 0,
    }));

    return {
      title: node.title,
      summary: node.summary,
      children,
      parentTitle,
      depth,
    };
  },
);
