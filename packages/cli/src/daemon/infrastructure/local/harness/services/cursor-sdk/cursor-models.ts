const CURSOR_PROVIDER = 'cursor';

/** SDK lists `default` (displayName "Auto"); we expose the UI-centric alias `auto`. */
const DEFAULT_AUTO_MODEL_ID = 'default';
const UI_AUTO_MODEL_ID = 'auto';

import { CURSOR_MODEL_VARIANT_COMBINATIONS, cursorLegacySlugToVariant, cursorVariantToCliSlug, validateCursorVariantForBase } from '@workspace/backend/src/domain/entities/harness/cursor.model-variants.js';
import { decodeModelVariant, validateModelVariantParams } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

export function decodeCursorVariant(encoded: string | undefined): { cliSlug: string; params: Record<string, string> } | undefined {
  if (encoded === undefined) return undefined;
  try {
    const decoded = validateModelVariantParams(decodeModelVariant(encoded), CURSOR_MODEL_VARIANT_COMBINATIONS);
    validateCursorVariantForBase(decoded.model, decoded.params);
    return { cliSlug: cursorVariantToCliSlug(decoded.model, decoded.params), params: decoded.params };
  } catch (error) {
    if (!encoded.includes('[')) {
      const legacy = cursorLegacySlugToVariant(encoded);
      if (legacy) return { cliSlug: cursorVariantToCliSlug(legacy.base, legacy.params), params: legacy.params };
      return { cliSlug: encoded, params: {} };
    }
    throw error;
  }
}

/** Strip `cursor/` prefix so the SDK receives a bare model slug. */
export function resolveCursorSdkModel(model: string): string {
  const prefix = `${CURSOR_PROVIDER}/`;
  const bare = model.startsWith(prefix) ? model.slice(prefix.length) : model;
  return bare === DEFAULT_AUTO_MODEL_ID ? UI_AUTO_MODEL_ID : bare;
}

export function resolveCursorSdkSpawnModelId(model?: string, defaultModel = 'composer-2.5'): string {
  if (!model) return defaultModel;
  const bare = resolveCursorSdkModel(model);
  return resolveCursorSdkModel(decodeCursorVariant(bare)?.cliSlug ?? bare);
}
