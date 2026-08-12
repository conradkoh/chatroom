// ANTHROPIC API response shape (partial):
import { CLAUDE_MODEL_VARIANT_COMBINATIONS } from '@workspace/backend/src/domain/entities/harness/claude.model-variants.js';
import { decodeModelVariant, validateModelVariantParams } from '@workspace/backend/src/domain/entities/harness/model-variant.js';
export function decodeClaudeVariant(encoded: string | undefined): { model: string; effort?: string } | undefined {
  if (encoded === undefined) return undefined;
  try { const d = validateModelVariantParams(decodeModelVariant(encoded), CLAUDE_MODEL_VARIANT_COMBINATIONS); const effort = d.params.effort; return { model: d.model, ...(effort && effort !== 'none' ? { effort } : {}) }; }
  catch (error) { if (!encoded.includes('[')) return { model: encoded }; throw error; }
}
// { data: Array<{ id: string, display_name: string, created_at: string }> }

export const CLAUDE_FALLBACK_MODELS = [
  // Aliases — always resolve to latest in family; never need updating
  'opus',
  'sonnet',
  'haiku',
  // Specific pinned versions
  'claude-opus-4-8',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

export async function fetchClaudeModels(): Promise<string[] | undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!resp.ok) return undefined;
    const json = (await resp.json()) as { data: { id: string }[] };
    const ids = json.data.map((m) => m.id).filter((id) => id.startsWith('claude-'));
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}
