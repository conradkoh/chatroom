const CURSOR_PROVIDER = 'cursor';

/** SDK lists `default` (displayName "Auto"); we expose the UI-centric alias `auto`. */
const DEFAULT_AUTO_MODEL_ID = 'default';
const UI_AUTO_MODEL_ID = 'auto';

/** Strip `cursor/` prefix so the SDK receives a bare model slug. */
export function resolveCursorSdkModel(model: string): string {
  const prefix = `${CURSOR_PROVIDER}/`;
  const bare = model.startsWith(prefix) ? model.slice(prefix.length) : model;
  return bare === DEFAULT_AUTO_MODEL_ID ? UI_AUTO_MODEL_ID : bare;
}

/**
 * Normalize Cursor.models.list ids for daemon → Convex → UI.
 * Maps SDK `default` to UI-centric `auto` and dedupes aliases.
 */
export function normalizeCursorSdkListedModels(listedModelIds: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const id of listedModelIds) {
    const modelId = id === DEFAULT_AUTO_MODEL_ID ? UI_AUTO_MODEL_ID : id;
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    normalized.push(modelId);
  }

  return normalized;
}
