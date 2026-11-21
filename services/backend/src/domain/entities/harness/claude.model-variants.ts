import type { ModelVariantSchema } from './model-variant';

export const CLAUDE_EFFORT_VALUES = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CLAUDE_MODEL_VARIANT_COMBINATIONS = [
  {},
  ...CLAUDE_EFFORT_VALUES.map((effort) => ({ effort })),
] as const satisfies ModelVariantSchema;

/**
 * Canonical model ids listed in HARNESS_MODEL_CATALOG for claude-sdk.
 * Unversioned aliases (opus, sonnet, haiku) are included so the UI can list
 * them; the claude CLI subprocess resolves them to their current pinned version.
 */
export const CLAUDE_CATALOG_BASE_MODEL_IDS = [
  // Unversioned aliases — resolved by claude CLI to the current pinned version.
  'opus',
  'sonnet',
  'haiku',
  // Versioned / pinned model ids.
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-fable-5-2',
  'claude-fable-5-1',
  'claude-fable-5',
  // Mythos models require an organization verified through Anthropic's access programs.
  'claude-mythos-5-1',
  'claude-mythos-5',
  'claude-opus-5-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-5-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-5-5',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
] as const;
