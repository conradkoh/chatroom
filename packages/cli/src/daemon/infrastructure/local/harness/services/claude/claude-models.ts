// ANTHROPIC API response shape (partial):
import { CLAUDE_MODEL_VARIANT_COMBINATIONS } from '@workspace/backend/src/domain/entities/harness/claude.model-variants.js';
import { decodeModelVariant, validateModelVariantParams } from '@workspace/backend/src/domain/entities/harness/model-variant.js';
export function decodeClaudeVariant(encoded: string | undefined): { model: string; effort?: string } | undefined {
  if (encoded === undefined) return undefined;
  try { const d = validateModelVariantParams(decodeModelVariant(encoded), CLAUDE_MODEL_VARIANT_COMBINATIONS); const effort = d.params.effort; return { model: d.model, ...(effort && effort !== 'none' ? { effort } : {}) }; }
  catch (error) { if (!encoded.includes('[')) return { model: encoded }; throw error; }
}
// { data: Array<{ id: string, display_name: string, created_at: string }> }
