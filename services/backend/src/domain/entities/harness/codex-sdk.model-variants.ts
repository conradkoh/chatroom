// fallow-ignore-file unused-export
/**
 * Codex SDK harness — model variant vocabulary (HARNESS-SPECIFIC entity).
 *
 * The general encode/decode grammar lives in `model-variant.ts`; this module
 * owns everything codex-specific: the reasoning-level values, and the exact
 * set of allowed variant combinations. Nothing here generalizes to other
 * harnesses — e.g. Anthropic's thinking/effort are separate settings and live
 * in their own future entity.
 */

import { v } from 'convex/values';

import type { ModelVariantSchema } from './model-variant';
import { toLiteralValidators } from '../_shared/v-literals-of';

/** Allowed reasoning-level values. "none" means "leave the harness default". */
export const CODEX_REASONING_LEVEL_VALUES = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

export type CodexReasoningLevel = (typeof CODEX_REASONING_LEVEL_VALUES)[number];

/** SDK effort cap values (excludes harness `none`). */
export const CODEX_MAX_REASONING_LEVEL_VALUES = ['low', 'medium', 'high', 'xhigh'] as const;

export type CodexMaxReasoningLevel = (typeof CODEX_MAX_REASONING_LEVEL_VALUES)[number];

export const codexMaxReasoningLevelValidator = v.union(
  ...toLiteralValidators(CODEX_MAX_REASONING_LEVEL_VALUES)
);

/**
 * The exact set of codex variant param combinations the daemon will accept:
 * no params (plain model id — harness default) or a single `reasoning` level.
 * Any other key or value combination is rejected at spawn.
 */
export const CODEX_MODEL_VARIANT_COMBINATIONS = [
  {},
  { reasoning: 'none' },
  { reasoning: 'low' },
  { reasoning: 'medium' },
  { reasoning: 'high' },
  { reasoning: 'xhigh' },
] as const satisfies ModelVariantSchema;
