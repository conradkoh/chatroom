import type { ModelListItem } from '@cursor/sdk';
import { encodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';
import { importBundledCursorSdk } from './cursor-sdk-package.js';
export const cursorCatalogBaseId = (id: string) => id === 'default' ? 'auto' : id;
export const cursorSdkBaseId = (id: string) => id === 'auto' ? 'default' : id;
export function expandCursorSdkModelCatalog(models: readonly ModelListItem[]): string[] {
  const result: string[] = []; const seen = new Set<string>();
  const push = (v: string) => { if (!seen.has(v)) { seen.add(v); result.push(v); } };
  for (const model of models) {
    const base = cursorCatalogBaseId(model.id); const variants = model.variants ?? [];
    if (!variants.length) { push(base); continue; }
    for (const variant of variants) {
      const params = Object.fromEntries(variant.params.map((p) => [p.id, p.value]));
      push(Object.keys(params).length ? encodeModelVariant(base, params) : base);
    }
  }
  return result;
}
export async function fetchCursorSdkModelCatalog(): Promise<string[]> {
  try { const sdk = await importBundledCursorSdk(); return expandCursorSdkModelCatalog(await sdk.Cursor.models.list()); }
  catch (err) { console.warn('[cursor] listModels failed:', err instanceof Error ? err.message : err); return []; }
}
