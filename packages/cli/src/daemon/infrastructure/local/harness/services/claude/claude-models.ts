// ANTHROPIC API response shape (partial):
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE_MODEL_VARIANT_COMBINATIONS } from '@workspace/backend/src/domain/entities/harness/claude.model-variants.js';
import { stripProviderPrefix } from '@workspace/backend/src/domain/entities/harness/model-provider.js';
import {
  decodeModelVariant,
  validateModelVariantParams,
} from '@workspace/backend/src/domain/entities/harness/model-variant.js';

export function decodeClaudeVariant(
  encoded: string | undefined
): { model: string; effort?: EffortLevel } | undefined {
  if (encoded === undefined) return undefined;
  const stripped = stripProviderPrefix('anthropic', encoded);
  try {
    const d = validateModelVariantParams(
      decodeModelVariant(stripped),
      CLAUDE_MODEL_VARIANT_COMBINATIONS
    );
    const effort = d.params.effort;
    return { model: d.model, ...(effort && effort !== 'none' ? { effort } : {}) };
  } catch (error) {
    if (!stripped.includes('[')) return { model: stripped };
    throw error;
  }
}
// { data: Array<{ id: string, display_name: string, created_at: string }> }
