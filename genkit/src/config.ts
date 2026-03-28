import { genkit } from 'genkit';
import { anthropic } from '@genkit-ai/anthropic';

const plugins = process.env.ANTHROPIC_API_KEY
  ? [anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })]
  : [];

export const ai = genkit({ plugins });

// Model constants — single place to change model assignments
export const MODELS = {
  bulk: 'anthropic/claude-haiku-4-5',     // Internal agents: matcher, classifier, specialists
  quality: 'anthropic/claude-sonnet-4-6',  // Admin-facing: synthesis, schema mapper
} as const;
