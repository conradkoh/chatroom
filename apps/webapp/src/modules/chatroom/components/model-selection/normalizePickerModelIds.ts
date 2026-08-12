import {
  CLAUDE_CATALOG_BASE_MODEL_IDS,
  CLAUDE_SPAWN_ALIASES,
} from '@workspace/backend/src/domain/entities/harness/claude.model-variants';
import { decodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant';

import { getBaseModelId } from '../../utils/modelSelection';

const aliasFamilies: Record<string, string> = {
  opus: 'claude-opus',
  sonnet: 'claude-sonnet',
  haiku: 'claude-haiku',
};

export function normalizePickerModelIds(models: readonly string[]): string[] {
  const modelSet = new Set(models);
  const hasCanonicalClaude = CLAUDE_CATALOG_BASE_MODEL_IDS.some((id) => modelSet.has(id));
  const result: string[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const base = getBaseModelId(model);
    if (hasCanonicalClaude && CLAUDE_SPAWN_ALIASES.includes(base as never)) {
      const family = aliasFamilies[base];
      if (models.some((candidate) => getBaseModelId(candidate).startsWith(family))) continue;
    }
    try {
      const decoded = decodeModelVariant(model);
      if ((decoded.params.effort === 'none' || decoded.params.reasoning === 'none') && modelSet.has(decoded.model)) continue;
    } catch {
      // Preserve malformed or unknown IDs rather than hiding user-visible models.
    }
    if (!seen.has(model)) {
      seen.add(model);
      result.push(model);
    }
  }
  return result;
}
