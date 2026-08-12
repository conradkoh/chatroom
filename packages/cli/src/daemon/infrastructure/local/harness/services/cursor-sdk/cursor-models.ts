import type { ModelSelection } from '@cursor/sdk';

import {
  cursorLegacySlugToVariant,
  cursorVariantToCliSlug,
} from '@workspace/backend/src/domain/entities/harness/cursor.model-variants.js';
import { decodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

import { cursorSdkBaseId } from './cursor-sdk-model-catalog.js';

const CURSOR_PROVIDER = 'cursor';

/** SDK lists `default` (displayName "Auto"); we expose the UI-centric alias `auto`. */
const DEFAULT_AUTO_MODEL_ID = 'default';
const UI_AUTO_MODEL_ID = 'auto';

export function decodeCursorVariant(
  encoded: string | undefined
): { cliSlug: string; params: Record<string, string> } | undefined {
  if (encoded === undefined) return undefined;
  if (!encoded.includes('[')) {
    const legacy = cursorLegacySlugToVariant(encoded);
    if (legacy) return { cliSlug: cursorVariantToCliSlug(legacy.base, legacy.params), params: legacy.params };
  }
  try {
    const decoded = decodeModelVariant(encoded);
    return {
      cliSlug: cursorVariantToCliSlug(decoded.model, decoded.params),
      params: decoded.params,
    };
  } catch {
    if (!encoded.includes('[')) {
      const legacy = cursorLegacySlugToVariant(encoded);
      if (legacy) {
        return { cliSlug: cursorVariantToCliSlug(legacy.base, legacy.params), params: legacy.params };
      }
      return { cliSlug: encoded, params: {} };
    }
    throw new Error(`malformed cursor model variant: "${encoded}"`);
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

export function decodedVariantToModelSelection(decoded: {
  model: string;
  params: Record<string, string>;
}): ModelSelection {
  const params = Object.entries(decoded.params).map(([id, value]) => ({ id, value }));
  return {
    id: cursorSdkBaseId(decoded.model),
    ...(params.length > 0 ? { params } : {}),
  };
}

export function resolveCursorSdkSpawnModelSelection(
  model?: string,
  defaultModel = 'composer-2.5'
): ModelSelection {
  if (!model) return { id: defaultModel };
  const bare = resolveCursorSdkModel(model);
  if (bare.includes('[')) {
    const decoded = decodeModelVariant(bare);
    return decodedVariantToModelSelection(decoded);
  }
  const legacy = decodeCursorVariant(bare);
  if (legacy && Object.keys(legacy.params).length > 0) {
    return decodedVariantToModelSelection({ model: bare, params: legacy.params });
  }
  return { id: cursorSdkBaseId(bare) };
}
