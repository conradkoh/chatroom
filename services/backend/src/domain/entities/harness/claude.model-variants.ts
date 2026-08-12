import type { ModelVariantSchema } from './model-variant';

export const CLAUDE_EFFORT_VALUES = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CLAUDE_MODEL_VARIANT_COMBINATIONS = [
  {},
  ...CLAUDE_EFFORT_VALUES.map((effort) => ({ effort })),
] as const satisfies ModelVariantSchema;

/** Short CLI aliases accepted at spawn but excluded from the server catalog. */
export const CLAUDE_SPAWN_ALIASES = ['opus', 'sonnet', 'haiku'] as const;

/** Canonical model ids listed in HARNESS_MODEL_CATALOG for claude + claude-sdk. */
export const CLAUDE_CATALOG_BASE_MODEL_IDS = [
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

/** Union of catalog ids + spawn aliases (full spawn vocabulary). */
export const CLAUDE_BASE_MODEL_IDS = [
  ...CLAUDE_SPAWN_ALIASES,
  ...CLAUDE_CATALOG_BASE_MODEL_IDS,
] as const;
