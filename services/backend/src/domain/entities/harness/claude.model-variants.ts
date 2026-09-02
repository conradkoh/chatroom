import type { ModelVariantSchema } from './model-variant';

export const CLAUDE_EFFORT_VALUES = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CLAUDE_MODEL_VARIANT_COMBINATIONS = [
  {},
  ...CLAUDE_EFFORT_VALUES.map((effort) => ({ effort })),
] as const satisfies ModelVariantSchema;

/**
 * Short unversioned aliases resolved by the claude CLI subprocess.
 * These are confirmed working (tested via live spawn) and are included in the
 * catalog so they appear in the UI model picker. Empty — all aliases have been
 * promoted to CLAUDE_CATALOG_BASE_MODEL_IDS.
 */
export const CLAUDE_SPAWN_ALIASES = [] as const;

/**
 * Canonical model ids listed in HARNESS_MODEL_CATALOG for claude + claude-sdk.
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
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

/** Full spawn vocabulary — equals the catalog since all aliases are now catalog-backed. */
export const CLAUDE_BASE_MODEL_IDS = [
  ...CLAUDE_SPAWN_ALIASES,
  ...CLAUDE_CATALOG_BASE_MODEL_IDS,
] as const;
