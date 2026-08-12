import type { ModelListItem } from '@cursor/sdk';
import { encodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

import { importBundledCursorSdk } from './cursor-sdk-package.js';

/** Map SDK `default` id to chatroom's `auto` alias. */
// fallow-ignore-next-line unused-export
export function cursorCatalogBaseId(sdkId: string): string {
  return sdkId === 'default' ? 'auto' : sdkId;
}

/** Map chatroom `auto` back to SDK `default` id for spawn. */
export function cursorSdkBaseId(catalogId: string): string {
  return catalogId === 'auto' ? 'default' : catalogId;
}

/** Pure expansion: SDK models → canonical variant strings. */
// fallow-ignore-next-line unused-export complexity
export function expandCursorSdkModelCatalog(models: readonly ModelListItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  const push = (entry: string) => {
    if (!seen.has(entry)) {
      seen.add(entry);
      result.push(entry);
    }
  };

  for (const model of models) {
    const baseId = cursorCatalogBaseId(model.id);
    const variants = model.variants ?? [];

    if (variants.length === 0) {
      push(baseId);
      continue;
    }

    let pushedPlain = false;
    for (const variant of variants) {
      const params = Object.fromEntries(variant.params.map((p) => [p.id, p.value]));
      const hasParams = Object.keys(params).length > 0;
      if (!hasParams) {
        push(baseId);
        pushedPlain = true;
      } else {
        push(encodeModelVariant(baseId, params));
      }
      if (variant.isDefault && !hasParams) pushedPlain = true;
    }
    if (!pushedPlain) {
      const defaultVariant = variants.find((v) => v.isDefault);
      if (defaultVariant) {
        const dp = Object.fromEntries(defaultVariant.params.map((p) => [p.id, p.value]));
        push(Object.keys(dp).length === 0 ? baseId : encodeModelVariant(baseId, dp));
      }
    }
  }

  return result;
}

/** Fetch models from Cursor SDK and expand to catalog strings. Returns [] on failure. */
export async function fetchCursorSdkModelCatalog(): Promise<string[]> {
  try {
    const sdk = await importBundledCursorSdk();
    const models = await sdk.Cursor.models.list();
    return expandCursorSdkModelCatalog(models);
  } catch (err) {
    console.warn(`[cursor] listModels failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}
